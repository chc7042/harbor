const { executeQuery } = require('../config/database');
const logger = require('../config/logger');

class DeploymentModel {
  // 새 배포 정보 생성
  static async create(deploymentData) {
    const {
      projectName,
      environment,
      version,
      buildNumber,
      jenkinsJobUrl,
      jenkinsJobName,
      status = 'pending',
      deployedBy,
      gitCommitHash,
      gitBranch,
      gitCommitMessage,
      nasPath,
      notes,
      estimatedDuration,
      tags,
    } = deploymentData;

    const query = `
      INSERT INTO deployments (
        project_name, environment, version, build_number,
        jenkins_job_url, jenkins_job_name, status, deployed_by,
        git_commit_hash, git_branch, git_commit_message,
        nas_path, notes, estimated_duration, tags,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      RETURNING *
    `;

    const values = [
      projectName,
      environment,
      version,
      buildNumber,
      jenkinsJobUrl,
      jenkinsJobName,
      status,
      deployedBy,
      gitCommitHash,
      gitBranch,
      gitCommitMessage,
      nasPath,
      notes,
      estimatedDuration,
      JSON.stringify(tags || []),
    ];

    try {
      const result = await executeQuery(query, values);
      logger.info(`새 배포 정보 생성: ${projectName} ${version} - ${environment}`);
      return result.rows[0];
    } catch (error) {
      logger.error('배포 정보 생성 실패:', error);
      throw new Error(`배포 정보 생성 실패: ${error.message}`);
    }
  }

  // ID로 배포 정보 조회
  static async findById(id) {
    const query = 'SELECT * FROM deployments WHERE id = $1';

    try {
      const result = await executeQuery(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }

      const deployment = result.rows[0];
      // JSON 필드 파싱
      deployment.tags = JSON.parse(deployment.tags || '[]');

      return deployment;
    } catch (error) {
      logger.error('배포 정보 조회 실패:', error);
      throw new Error(`배포 정보 조회 실패: ${error.message}`);
    }
  }

  // 배포 목록 조회 (검색, 필터링, 페이지네이션 지원)
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 20,
      projectName,
      environment,
      status,
      search,
      startDate,
      endDate,
      sortBy = 'created_at',
      sortOrder = 'DESC',
    } = options;

    const offset = (page - 1) * limit;
    const conditions = [];
    const values = [];
    let paramIndex = 1;

    // 조건 추가
    if (projectName) {
      conditions.push(`project_name = $${paramIndex++}`);
      values.push(projectName);
    }

    if (environment) {
      conditions.push(`environment = $${paramIndex++}`);
      values.push(environment);
    }

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    if (search) {
      conditions.push(`(
        project_name ILIKE $${paramIndex} OR
        version ILIKE $${paramIndex} OR
        git_commit_message ILIKE $${paramIndex} OR
        deployed_by ILIKE $${paramIndex}
      )`);
      values.push(`%${search}%`);
      paramIndex++;
    }

    if (startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(startDate);
    }

    if (endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 정렬 필드 검증
    const allowedSortFields = ['created_at', 'updated_at', 'project_name', 'environment', 'status'];
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const validSortOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

    // 메인 쿼리
    const dataQuery = `
      SELECT * FROM deployments
      ${whereClause}
      ORDER BY ${validSortBy} ${validSortOrder}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
    values.push(limit, offset);

    // 카운트 쿼리
    const countQuery = `
      SELECT COUNT(*) as total FROM deployments
      ${whereClause}
    `;
    const countValues = values.slice(0, values.length - 2); // limit과 offset 제거

    try {
      const [dataResult, countResult] = await Promise.all([
        executeQuery(dataQuery, values),
        executeQuery(countQuery, countValues),
      ]);

      const deployments = dataResult.rows.map(deployment => ({
        ...deployment,
        tags: JSON.parse(deployment.tags || '[]'),
      }));

      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return {
        data: deployments,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
          hasNext: page < totalPages,
          hasPrevious: page > 1,
        },
      };
    } catch (error) {
      logger.error('배포 목록 조회 실패:', error);
      throw new Error(`배포 목록 조회 실패: ${error.message}`);
    }
  }

  // 배포 정보 업데이트
  static async update(id, updateData) {
    const allowedFields = [
      'status', 'started_at', 'completed_at', 'duration_seconds',
      'error_message', 'nas_path', 'notes', 'tags',
    ];

    const updates = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updateData).forEach(field => {
      if (allowedFields.includes(field) && updateData[field] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        let value = updateData[field];

        // JSON 필드 처리
        if (field === 'tags') {
          value = JSON.stringify(value || []);
        }

        values.push(value);
      }
    });

    if (updates.length === 0) {
      throw new Error('업데이트할 필드가 없습니다.');
    }

    updates.push('updated_at = NOW()');

    const query = `
      UPDATE deployments
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    values.push(id);

    try {
      const result = await executeQuery(query, values);
      if (result.rows.length === 0) {
        return null;
      }

      const deployment = result.rows[0];
      deployment.tags = JSON.parse(deployment.tags || '[]');

      logger.info(`배포 정보 업데이트: ID ${id}`);
      return deployment;
    } catch (error) {
      logger.error('배포 정보 업데이트 실패:', error);
      throw new Error(`배포 정보 업데이트 실패: ${error.message}`);
    }
  }

  // 배포 정보 삭제
  static async delete(id) {
    const query = 'DELETE FROM deployments WHERE id = $1 RETURNING *';

    try {
      const result = await executeQuery(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }

      logger.info(`배포 정보 삭제: ID ${id}`);
      return result.rows[0];
    } catch (error) {
      logger.error('배포 정보 삭제 실패:', error);
      throw new Error(`배포 정보 삭제 실패: ${error.message}`);
    }
  }

  // 프로젝트별 최근 배포 조회
  static async findLatestByProject(projectName, limit = 10) {
    const query = `
      SELECT * FROM deployments
      WHERE project_name = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    try {
      const result = await executeQuery(query, [projectName, limit]);
      return result.rows.map(deployment => ({
        ...deployment,
        tags: JSON.parse(deployment.tags || '[]'),
      }));
    } catch (error) {
      logger.error('프로젝트별 최근 배포 조회 실패:', error);
      throw new Error(`프로젝트별 최근 배포 조회 실패: ${error.message}`);
    }
  }

  // 배포 통계 조회
  static async getStats(options = {}) {
    const { startDate, endDate, projectName, environment } = options;

    const conditions = [];
    const values = [];
    let paramIndex = 1;

    if (startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(startDate);
    }

    if (endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(endDate);
    }

    if (projectName) {
      conditions.push(`project_name = $${paramIndex++}`);
      values.push(projectName);
    }

    if (environment) {
      conditions.push(`environment = $${paramIndex++}`);
      values.push(environment);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT
        COUNT(*) as total_deployments,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_deployments,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_deployments,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_deployments,
        COALESCE(AVG(duration_seconds), 0) as average_duration,
        COUNT(DISTINCT project_name) as unique_projects
      FROM deployments
      ${whereClause}
    `;

    try {
      const result = await executeQuery(query, values);
      const stats = result.rows[0];

      // 성공률 계산
      const totalDeployments = parseInt(stats.total_deployments);
      const successfulDeployments = parseInt(stats.successful_deployments);
      const successRate = totalDeployments > 0 ? (successfulDeployments / totalDeployments) * 100 : 0;

      return {
        totalDeployments,
        successfulDeployments,
        failedDeployments: parseInt(stats.failed_deployments),
        inProgressDeployments: parseInt(stats.in_progress_deployments),
        successRate: parseFloat(successRate.toFixed(2)),
        averageDuration: parseFloat(stats.average_duration),
        uniqueProjects: parseInt(stats.unique_projects),
      };
    } catch (error) {
      logger.error('배포 통계 조회 실패:', error);
      throw new Error(`배포 통계 조회 실패: ${error.message}`);
    }
  }

  // 프로젝트별 통계
  static async getProjectStats() {
    const query = `
      SELECT
        project_name,
        COUNT(*) as total_deployments,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_deployments,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_deployments,
        COALESCE(AVG(duration_seconds), 0) as average_duration,
        MAX(created_at) as last_deployment
      FROM deployments
      GROUP BY project_name
      ORDER BY total_deployments DESC
    `;

    try {
      const result = await executeQuery(query);
      return result.rows.map(row => ({
        projectName: row.project_name,
        totalDeployments: parseInt(row.total_deployments),
        successfulDeployments: parseInt(row.successful_deployments),
        failedDeployments: parseInt(row.failed_deployments),
        successRate: parseInt(row.total_deployments) > 0
          ? parseFloat(((parseInt(row.successful_deployments) / parseInt(row.total_deployments)) * 100).toFixed(2))
          : 0,
        averageDuration: parseFloat(row.average_duration),
        lastDeployment: row.last_deployment,
      }));
    } catch (error) {
      logger.error('프로젝트별 통계 조회 실패:', error);
      throw new Error(`프로젝트별 통계 조회 실패: ${error.message}`);
    }
  }

  // 환경별 통계
  static async getEnvironmentStats() {
    const query = `
      SELECT
        environment,
        COUNT(*) as total_deployments,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_deployments,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_deployments,
        COALESCE(AVG(duration_seconds), 0) as average_duration
      FROM deployments
      GROUP BY environment
      ORDER BY total_deployments DESC
    `;

    try {
      const result = await executeQuery(query);
      return result.rows.map(row => ({
        environment: row.environment,
        totalDeployments: parseInt(row.total_deployments),
        successfulDeployments: parseInt(row.successful_deployments),
        failedDeployments: parseInt(row.failed_deployments),
        successRate: parseInt(row.total_deployments) > 0
          ? parseFloat(((parseInt(row.successful_deployments) / parseInt(row.total_deployments)) * 100).toFixed(2))
          : 0,
        averageDuration: parseFloat(row.average_duration),
      }));
    } catch (error) {
      logger.error('환경별 통계 조회 실패:', error);
      throw new Error(`환경별 통계 조회 실패: ${error.message}`);
    }
  }
}

module.exports = DeploymentModel;
