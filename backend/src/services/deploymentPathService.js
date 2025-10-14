const { query, getPoolStatus } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../middleware/error');

/**
 * 배포 경로 캐시 관리 서비스
 * deployment_paths 테이블에 대한 CRUD 작업 제공
 */
class DeploymentPathService {
  constructor() {
    this.tableName = 'deployment_paths';
    this.connectionTimeout = 10000; // 10초
    this.retryAttempts = 3;
  }

  /**
   * 데이터베이스 연결 상태 확인
   * @returns {Promise<boolean>} - 연결 상태
   */
  async checkDatabaseConnection() {
    try {
      const poolStatus = getPoolStatus();
      if (poolStatus.status !== 'active') {
        throw new Error(`Database pool not active: ${poolStatus.status}`);
      }

      // 간단한 쿼리로 연결 테스트
      await query('SELECT 1');
      return true;
    } catch (error) {
      logger.error(`Database connection check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 입력 파라미터 검증
   * @param {Object} params - 검증할 파라미터 객체
   * @param {Array} required - 필수 필드 목록
   * @throws {AppError} - 검증 실패 시 에러
   */
  validateParameters(params, required = []) {
    const missing = required.filter(field =>
      params[field] === undefined || params[field] === null || params[field] === '',
    );

    if (missing.length > 0) {
      throw new AppError(`Missing required parameters: ${missing.join(', ')}`, 400);
    }

    // 프로젝트명 길이 검증
    if (params.projectName && params.projectName.length > 100) {
      throw new AppError('Project name must be 100 characters or less', 400);
    }

    // 버전 길이 검증
    if (params.version && params.version.length > 20) {
      throw new AppError('Version must be 20 characters or less', 400);
    }

    // 빌드 번호 검증
    if (params.buildNumber !== undefined && (!Number.isInteger(params.buildNumber) || params.buildNumber < 0)) {
      throw new AppError('Build number must be a non-negative integer', 400);
    }

    // NAS 경로 검증
    if (params.nasPath && typeof params.nasPath !== 'string') {
      throw new AppError('NAS path must be a string', 400);
    }

    // 날짜 검증
    if (params.buildDate && !(params.buildDate instanceof Date) && isNaN(Date.parse(params.buildDate))) {
      throw new AppError('Build date must be a valid date', 400);
    }
  }

  /**
   * 데이터베이스 에러 분류 및 적절한 에러 메시지 생성
   * @param {Error} error - 원본 에러
   * @param {string} operation - 수행 중이던 작업
   * @returns {AppError} - 분류된 애플리케이션 에러
   */
  handleDatabaseError(error, operation) {
    // 연결 관련 에러
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      logger.error(`Database connection error during ${operation}: ${error.message}`);
      return new AppError('Database connection failed. Please try again later.', 503);
    }

    // PostgreSQL 특정 에러 코드
    switch (error.code) {
      case '23505': // unique_violation
        logger.warn(`Unique constraint violation during ${operation}: ${error.message}`);
        return new AppError('Record already exists', 409);

      case '23503': // foreign_key_violation
        logger.error(`Foreign key constraint violation during ${operation}: ${error.message}`);
        return new AppError('Referenced record does not exist', 400);

      case '23502': // not_null_violation
        logger.error(`Not null constraint violation during ${operation}: ${error.message}`);
        return new AppError('Required field cannot be null', 400);

      case '42P01': // undefined_table
        logger.error(`Table does not exist during ${operation}: ${error.message}`);
        return new AppError('Database schema error. Please contact administrator.', 500);

      case '42703': // undefined_column
        logger.error(`Column does not exist during ${operation}: ${error.message}`);
        return new AppError('Database schema error. Please contact administrator.', 500);

      case '53300': // too_many_connections
        logger.error(`Too many database connections during ${operation}: ${error.message}`);
        return new AppError('Database is currently busy. Please try again later.', 503);

      default:
        logger.error(`Database error during ${operation}: ${error.message}`);
        return new AppError(`Database operation failed: ${operation}`, 500);
    }
  }

  /**
   * 재시도 로직을 포함한 쿼리 실행
   * @param {string} queryText - SQL 쿼리
   * @param {Array} params - 쿼리 파라미터
   * @param {string} operation - 작업 설명
   * @returns {Promise<Object>} - 쿼리 결과
   */
  async executeWithRetry(queryText, params, operation) {
    let lastError;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        // 연결 상태 확인 (첫 번째 시도가 아닌 경우)
        if (attempt > 1) {
          const isConnected = await this.checkDatabaseConnection();
          if (!isConnected) {
            logger.warn(`Database not connected on retry attempt ${attempt}/${this.retryAttempts}`);
            throw new Error('Database connection not available');
          }
        }

        const result = await query(queryText, params);

        // 재시도 후 성공한 경우 로그
        if (attempt > 1) {
          logger.info(`${operation} succeeded on retry attempt ${attempt}/${this.retryAttempts}`);
        }

        return result;
      } catch (error) {
        lastError = error;

        // 재시도할 수 없는 에러인지 확인
        if (error.code === '23505' || error.code === '23503' || error.code === '23502' ||
            error.code === '42P01' || error.code === '42703') {
          logger.debug(`Non-retryable error during ${operation}, not retrying: ${error.code}`);
          break;
        }

        if (attempt < this.retryAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 지수 백오프, 최대 5초
          logger.warn(`${operation} failed on attempt ${attempt}/${this.retryAttempts}, retrying in ${delay}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          logger.error(`${operation} failed after ${this.retryAttempts} attempts: ${error.message}`);
        }
      }
    }

    throw this.handleDatabaseError(lastError, operation);
  }

  /**
   * 프로젝트명, 버전, 빌드번호로 캐시된 경로 조회
   * @param {string} projectName - 프로젝트명 (예: "3.0.0/mr3.0.0_release")
   * @param {string} version - 버전 (예: "3.0.0")
   * @param {number} buildNumber - 빌드 번호
   * @returns {Promise<Object|null>} - 캐시된 배포 경로 정보 또는 null
   */
  async findByProjectVersionBuild(projectName, version, buildNumber) {
    // 입력 파라미터 검증
    this.validateParameters({ projectName, version, buildNumber }, ['projectName', 'version', 'buildNumber']);

    try {
      const result = await this.executeWithRetry(
        `SELECT * FROM ${this.tableName}
         WHERE project_name = $1 AND version = $2 AND build_number = $3`,
        [projectName, version, buildNumber],
        'findByProjectVersionBuild',
      );

      if (result.rows.length === 0) {
        logger.debug(`No cached path found for ${projectName} v${version} #${buildNumber}`);
        return null;
      }

      const deploymentPath = result.rows[0];
      logger.debug(`Found cached path for ${projectName} v${version} #${buildNumber}: ${deploymentPath.nas_path}`);

      return this.formatDeploymentPath(deploymentPath);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.handleDatabaseError(error, 'findByProjectVersionBuild');
    }
  }

  /**
   * 검증된 배포 경로를 데이터베이스에 저장
   * @param {Object} pathData - 배포 경로 데이터
   * @param {string} pathData.projectName - 프로젝트명
   * @param {string} pathData.version - 버전
   * @param {number} pathData.buildNumber - 빌드 번호
   * @param {Date} pathData.buildDate - 빌드 날짜
   * @param {string} pathData.nasPath - NAS 경로
   * @param {string} [pathData.downloadFile] - 메인 다운로드 파일명
   * @param {Array} [pathData.allFiles] - 모든 파일 목록
   * @returns {Promise<Object>} - 저장된 배포 경로 정보
   */
  async saveDeploymentPath(pathData) {
    const {
      projectName,
      version,
      buildNumber,
      buildDate,
      nasPath,
      downloadFile = null,
      allFiles = [],
    } = pathData;

    // 입력 파라미터 검증
    this.validateParameters(
      { projectName, version, buildNumber, buildDate, nasPath },
      ['projectName', 'version', 'buildNumber', 'buildDate', 'nasPath'],
    );

    // allFiles 배열 검증
    if (!Array.isArray(allFiles)) {
      throw new AppError('allFiles must be an array', 400);
    }

    try {
      // 날짜 형변환 처리
      const processedBuildDate = buildDate instanceof Date ? buildDate : new Date(buildDate);

      // JSON 직렬화 안전성 검증
      let serializedFiles;
      try {
        serializedFiles = JSON.stringify(allFiles);
        if (serializedFiles.length > 1000000) { // 1MB 제한
          throw new AppError('allFiles data is too large (max 1MB)', 400);
        }
      } catch (jsonError) {
        throw new AppError('allFiles contains non-serializable data', 400);
      }

      // UPSERT 쿼리 (INSERT ... ON CONFLICT UPDATE)
      const result = await this.executeWithRetry(
        `INSERT INTO ${this.tableName}
         (project_name, version, build_number, build_date, nas_path, download_file, all_files, verified_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (project_name, version, build_number)
         DO UPDATE SET
           build_date = EXCLUDED.build_date,
           nas_path = EXCLUDED.nas_path,
           download_file = EXCLUDED.download_file,
           all_files = EXCLUDED.all_files,
           verified_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [projectName, version, buildNumber, processedBuildDate, nasPath, downloadFile, serializedFiles],
        'saveDeploymentPath',
      );

      const savedPath = result.rows[0];
      logger.info(`Saved deployment path cache: ${projectName} v${version} #${buildNumber} -> ${nasPath}`);

      return this.formatDeploymentPath(savedPath);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.handleDatabaseError(error, 'saveDeploymentPath');
    }
  }

  /**
   * 프로젝트별 최근 배포 경로 목록 조회
   * @param {string} projectName - 프로젝트명
   * @param {number} limit - 조회할 개수 (기본값: 10)
   * @returns {Promise<Array>} - 최근 배포 경로 목록
   */
  async getRecentPathsByProject(projectName, limit = 10) {
    // 입력 파라미터 검증
    this.validateParameters({ projectName }, ['projectName']);

    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new AppError('Limit must be an integer between 1 and 1000', 400);
    }

    try {
      const result = await this.executeWithRetry(
        `SELECT * FROM ${this.tableName}
         WHERE project_name = $1
         ORDER BY build_date DESC, verified_at DESC
         LIMIT $2`,
        [projectName, limit],
        'getRecentPathsByProject',
      );

      logger.debug(`Found ${result.rows.length} recent paths for project: ${projectName}`);

      return result.rows.map(row => this.formatDeploymentPath(row));
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.handleDatabaseError(error, 'getRecentPathsByProject');
    }
  }

  /**
   * 날짜 범위별 배포 경로 조회
   * @param {Date} startDate - 시작 날짜
   * @param {Date} endDate - 종료 날짜
   * @returns {Promise<Array>} - 해당 기간의 배포 경로 목록
   */
  async getPathsByDateRange(startDate, endDate) {
    // 입력 파라미터 검증
    this.validateParameters({ startDate, endDate }, ['startDate', 'endDate']);

    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError('Invalid date format', 400);
    }

    if (start > end) {
      throw new AppError('Start date must be before end date', 400);
    }

    // 너무 넓은 범위 방지 (1년 제한)
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > oneYear) {
      throw new AppError('Date range cannot exceed one year', 400);
    }

    try {
      const result = await this.executeWithRetry(
        `SELECT * FROM ${this.tableName}
         WHERE build_date BETWEEN $1 AND $2
         ORDER BY build_date DESC, project_name, build_number DESC`,
        [start, end],
        'getPathsByDateRange',
      );

      logger.debug(`Found ${result.rows.length} paths between ${start.toISOString()} and ${end.toISOString()}`);

      return result.rows.map(row => this.formatDeploymentPath(row));
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.handleDatabaseError(error, 'getPathsByDateRange');
    }
  }

  /**
   * 특정 배포 경로 삭제
   * @param {string} projectName - 프로젝트명
   * @param {string} version - 버전
   * @param {number} buildNumber - 빌드 번호
   * @returns {Promise<boolean>} - 삭제 성공 여부
   */
  async deleteDeploymentPath(projectName, version, buildNumber) {
    // 입력 파라미터 검증
    this.validateParameters({ projectName, version, buildNumber }, ['projectName', 'version', 'buildNumber']);

    try {
      const result = await this.executeWithRetry(
        `DELETE FROM ${this.tableName}
         WHERE project_name = $1 AND version = $2 AND build_number = $3`,
        [projectName, version, buildNumber],
        'deleteDeploymentPath',
      );

      const deleted = result.rowCount > 0;
      if (deleted) {
        logger.info(`Deleted deployment path cache: ${projectName} v${version} #${buildNumber}`);
      } else {
        logger.warn(`No deployment path found to delete: ${projectName} v${version} #${buildNumber}`);
      }

      return deleted;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.handleDatabaseError(error, 'deleteDeploymentPath');
    }
  }

  /**
   * 오래된 캐시 데이터 정리
   * @param {number} daysOld - 삭제할 데이터의 기준 일수 (기본값: 90일)
   * @returns {Promise<number>} - 삭제된 레코드 수
   */
  async cleanupOldPaths(daysOld = 90) {
    // 입력 파라미터 검증
    if (!Number.isInteger(daysOld) || daysOld < 1 || daysOld > 3650) {
      throw new AppError('daysOld must be an integer between 1 and 3650 (10 years)', 400);
    }

    try {
      // SQL 인젝션 방지를 위해 파라미터화된 쿼리 사용
      const result = await this.executeWithRetry(
        `DELETE FROM ${this.tableName}
         WHERE verified_at < CURRENT_TIMESTAMP - ($1 || ' days')::INTERVAL`,
        [daysOld.toString()],
        'cleanupOldPaths',
      );

      const deletedCount = result.rowCount;
      logger.info(`Cleaned up ${deletedCount} old deployment path cache entries (older than ${daysOld} days)`);

      return deletedCount;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.handleDatabaseError(error, 'cleanupOldPaths');
    }
  }

  /**
   * 캐시 통계 정보 조회
   * @returns {Promise<Object>} - 캐시 통계
   */
  async getCacheStats() {
    try {
      const statsQuery = `
        SELECT
          COUNT(*) as total_cached_paths,
          COUNT(DISTINCT project_name) as unique_projects,
          COUNT(DISTINCT version) as unique_versions,
          MIN(build_date) as oldest_build_date,
          MAX(build_date) as newest_build_date,
          MIN(verified_at) as oldest_cache_entry,
          MAX(verified_at) as newest_cache_entry
        FROM ${this.tableName}
      `;

      const result = await this.executeWithRetry(statsQuery, [], 'getCacheStats');
      const stats = result.rows[0];

      // 안전한 숫자 변환
      const safeParseInt = (value) => {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? 0 : parsed;
      };

      stats.total_cached_paths = safeParseInt(stats.total_cached_paths);
      stats.unique_projects = safeParseInt(stats.unique_projects);
      stats.unique_versions = safeParseInt(stats.unique_versions);

      logger.debug('Retrieved deployment path cache statistics');

      return stats;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.handleDatabaseError(error, 'getCacheStats');
    }
  }

  /**
   * 최근 배포 경로 목록 조회 (모든 프로젝트)
   * @param {number} limit - 조회할 개수 (기본값: 10)
   * @returns {Promise<Array>} - 최근 배포 경로 목록
   */
  async getRecentPaths(limit = 10) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new AppError('Limit must be an integer between 1 and 1000', 400);
    }

    try {
      const result = await this.executeWithRetry(
        `SELECT * FROM ${this.tableName}
         ORDER BY verified_at DESC
         LIMIT $1`,
        [limit],
        'getRecentPaths',
      );

      logger.debug(`Found ${result.rows.length} recent deployment paths`);

      return result.rows.map(row => this.formatDeploymentPath(row));
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.handleDatabaseError(error, 'getRecentPaths');
    }
  }

  /**
   * 데이터베이스 행을 표준 형식으로 변환
   * @param {Object} row - 데이터베이스 행 객체
   * @returns {Object} - 형식화된 배포 경로 객체
   */
  formatDeploymentPath(row) {
    try {
      // 안전한 JSON 파싱
      let allFiles = [];
      if (row.all_files) {
        if (typeof row.all_files === 'string') {
          try {
            allFiles = JSON.parse(row.all_files);
          } catch (jsonError) {
            logger.warn(`Failed to parse all_files JSON for deployment path ID ${row.id}: ${jsonError.message}`);
            allFiles = [];
          }
        } else if (Array.isArray(row.all_files)) {
          allFiles = row.all_files;
        }
      }

      return {
        id: row.id,
        projectName: row.project_name || '',
        version: row.version || '',
        buildNumber: row.build_number || 0,
        buildDate: row.build_date,
        nasPath: row.nas_path || '',
        downloadFile: row.download_file || null,
        allFiles: allFiles,
        verifiedAt: row.verified_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      logger.error(`Error formatting deployment path row: ${error.message}`);
      // 기본값으로 안전한 객체 반환
      return {
        id: row?.id || null,
        projectName: '',
        version: '',
        buildNumber: 0,
        buildDate: null,
        nasPath: '',
        downloadFile: null,
        allFiles: [],
        verifiedAt: null,
        createdAt: null,
        updatedAt: null,
      };
    }
  }
}

// 싱글톤 인스턴스
let deploymentPathService = null;

function getDeploymentPathService() {
  if (!deploymentPathService) {
    deploymentPathService = new DeploymentPathService();
  }
  return deploymentPathService;
}

module.exports = {
  DeploymentPathService,
  getDeploymentPathService,
};
