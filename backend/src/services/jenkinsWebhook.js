const crypto = require('crypto');
const { AppError } = require('../middleware/error');
const logger = require('../config/logger');
const { query } = require('../config/database');
const { getNASService } = require('./nasService');
const { getPathResolver } = require('./pathResolver');

/**
 * Jenkins Webhook 처리 서비스
 */
class JenkinsWebhookService {
  constructor() {
    this.webhookSecret = process.env.JENKINS_WEBHOOK_SECRET || null;
    logger.info(`🔧 [JENKINS-WEBHOOK] Webhook secret configured: ${!!this.webhookSecret}`);
    
    this.supportedEvents = [
      'job.started',
      'job.completed',
      'job.finalized',
      'job.deleted',
      'build.started',
      'build.completed',
      'build.finalized',
    ];

    // 중복 요청 방지를 위한 캐시
    this.recentRequests = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5분간 캐시 유지

    // 캐시 정리 타이머
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredCache();
    }, 60 * 1000); // 1분마다 정리
  }

  /**
   * 캐시된 요청 정리
   */
  cleanupExpiredCache() {
    const now = Date.now();
    for (const [key, timestamp] of this.recentRequests.entries()) {
      if (now - timestamp > this.cacheTimeout) {
        this.recentRequests.delete(key);
      }
    }
  }

  /**
   * 중복 요청 확인 및 캐시 추가
   */
  isDuplicateRequest(projectName, buildNumber, eventType, payload) {
    // 요청 고유 식별자 생성 (프로젝트명, 빌드번호, 이벤트타입, 페이로드 해시)
    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')
      .substring(0, 8);

    const requestId = `${projectName}:${buildNumber}:${eventType}:${payloadHash}`;
    const now = Date.now();

    // 최근 요청 캐시에서 확인
    if (this.recentRequests.has(requestId)) {
      const lastRequestTime = this.recentRequests.get(requestId);
      if (now - lastRequestTime < this.cacheTimeout) {
        logger.warn(`Duplicate webhook request detected and ignored: ${requestId}`);
        return true;
      }
    }

    // 캐시에 현재 요청 추가
    this.recentRequests.set(requestId, now);
    return false;
  }

  /**
   * Webhook 서명 검증
   */
  verifySignature(payload, signature, secret) {
    if (!secret) {
      logger.warn('Jenkins webhook secret not configured, skipping signature verification');
      return true; // 개발환경에서는 서명 검증 건너뛰기
    }

    if (!signature) {
      throw new AppError('Webhook signature is missing', 401);
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');

    const providedSignature = signature.replace('sha256=', '');

    if (expectedSignature !== providedSignature) {
      throw new AppError('Invalid webhook signature', 401);
    }

    return true;
  }

  /**
   * Jenkins Webhook 데이터 파싱
   */
  parseWebhookData(payload) {
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

      // Jenkins Generic Webhook Plugin 형식
      if (data.build && data.job) {
        return this.parseGenericWebhook(data);
      }

      // Jenkins Build Event 형식
      if (data.project && data.number) {
        return this.parseBuildEvent(data);
      }

      // Custom Webhook 형식
      if (data.project_name && data.build_number) {
        return this.parseCustomWebhook(data);
      }

      throw new AppError('Unsupported webhook format', 400);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to parse webhook data: ${error.message}`, 400);
    }
  }

  /**
   * Generic Webhook Plugin 형식 파싱
   */
  parseGenericWebhook(data) {
    const { build, job } = data;

    return {
      project_name: job.name,
      build_number: build.number,
      status: this.mapBuildStatus(build.status),
      branch: build.scm?.branch || 'main',
      commit_hash: build.scm?.commit || null,
      started_at: build.timestamp ? new Date(build.timestamp) : new Date(),
      completed_at: build.status === 'SUCCESS' || build.status === 'FAILURE' ? new Date() : null,
      duration: build.duration || null,
      jenkins_url: build.url,
      triggered_by: build.causes?.[0]?.userName || 'system',
      environment: this.extractEnvironment(job.name),
      log_url: `${build.url}console`,
      parameters: build.parameters || {},
      raw_data: data,
    };
  }

  /**
   * Build Event 형식 파싱
   */
  parseBuildEvent(data) {
    return {
      project_name: data.project.name,
      build_number: data.number,
      status: this.mapBuildStatus(data.result || data.status),
      branch: data.scm?.branch || 'main',
      commit_hash: data.scm?.commit || null,
      started_at: data.timestamp ? new Date(data.timestamp) : new Date(),
      completed_at: data.result ? new Date() : null,
      duration: data.duration || null,
      jenkins_url: data.url,
      triggered_by: data.causes?.[0]?.userName || 'system',
      environment: this.extractEnvironment(data.project.name),
      log_url: `${data.url}console`,
      parameters: data.parameters || {},
      raw_data: data,
    };
  }

  /**
   * Custom Webhook 형식 파싱
   */
  parseCustomWebhook(data) {
    return {
      project_name: data.project_name,
      build_number: data.build_number,
      status: this.mapBuildStatus(data.status),
      branch: data.branch || 'main',
      commit_hash: data.commit_hash || null,
      started_at: data.started_at ? new Date(data.started_at) : new Date(),
      completed_at: data.completed_at ? new Date(data.completed_at) : null,
      duration: data.duration || null,
      jenkins_url: data.jenkins_url,
      triggered_by: data.triggered_by || 'system',
      environment: data.environment || this.extractEnvironment(data.project_name),
      log_url: data.log_url,
      parameters: data.parameters || {},
      artifact_info: data.artifact_info || {},
      raw_data: data,
    };
  }

  /**
   * 빌드 상태 매핑
   */
  mapBuildStatus(status) {
    if (!status) return 'pending';

    const statusMap = {
      'SUCCESS': 'success',
      'FAILURE': 'failed',
      'ABORTED': 'cancelled',
      'UNSTABLE': 'failed',
      'BUILDING': 'in_progress',
      'PENDING': 'pending',
      'STARTED': 'in_progress',
      'COMPLETED': 'success',
    };

    return statusMap[status.toUpperCase()] || 'pending';
  }

  /**
   * 프로젝트명에서 환경 추출
   */
  extractEnvironment(projectName) {
    const name = projectName.toLowerCase();

    if (name.includes('prod') || name.includes('production')) {
      return 'production';
    } else if (name.includes('stag') || name.includes('staging')) {
      return 'staging';
    } else if (name.includes('dev') || name.includes('development')) {
      return 'development';
    }

    return 'development';
  }

  /**
   * 배포 정보 데이터베이스 저장
   */
  async saveDeployment(deploymentData) {
    try {
      const {
        project_name,
        build_number,
        status,
        branch,
        commit_hash,
        started_at,
        completed_at,
        duration,
        jenkins_url,
        triggered_by,
        environment,
        log_url,
        parameters,
        artifact_info,
        raw_data,
      } = deploymentData;

      // 중복 체크
      const existingDeployment = await this.findExistingDeployment(
        project_name,
        build_number,
      );

      if (existingDeployment) {
        // 기존 배포 정보 업데이트
        return await this.updateDeployment(existingDeployment.id, deploymentData);
      }

      // 새 배포 정보 생성
      const insertQuery = `
        INSERT INTO deployments (
          project_name, build_number, status, branch, commit_hash,
          started_at, completed_at, duration, jenkins_url, triggered_by,
          environment, log_url, parameters, artifact_info, raw_data,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) RETURNING *
      `;

      const result = await query(insertQuery, [
        project_name,
        build_number,
        status,
        branch,
        commit_hash,
        started_at,
        completed_at,
        duration,
        jenkins_url,
        triggered_by,
        environment,
        log_url,
        JSON.stringify(parameters),
        JSON.stringify(artifact_info),
        JSON.stringify(raw_data),
      ]);

      logger.info(`New deployment saved: ${project_name} #${build_number}`);
      return result.rows[0];

    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn('Failed to save deployment (dev mode):', error.message);
        // 개발환경에서는 모의 응답 반환
        return {
          id: Math.floor(Math.random() * 1000),
          ...deploymentData,
          created_at: new Date(),
          updated_at: new Date(),
        };
      }
      throw new AppError(`Failed to save deployment: ${error.message}`, 500);
    }
  }

  /**
   * 기존 배포 정보 찾기
   */
  async findExistingDeployment(projectName, buildNumber) {
    try {
      const selectQuery = `
        SELECT * FROM deployments
        WHERE project_name = $1 AND build_number = $2
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const result = await query(selectQuery, [projectName, buildNumber]);
      return result.rows[0] || null;

    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn('Failed to find existing deployment (dev mode):', error.message);
        return null;
      }
      throw error;
    }
  }

  /**
   * 배포 정보 업데이트
   */
  async updateDeployment(deploymentId, deploymentData) {
    try {
      const {
        status,
        completed_at,
        duration,
        artifact_info,
        raw_data,
      } = deploymentData;

      const updateQuery = `
        UPDATE deployments SET
          status = $1,
          completed_at = $2,
          duration = $3,
          artifact_info = $4,
          raw_data = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
        RETURNING *
      `;

      const result = await query(updateQuery, [
        status,
        completed_at,
        duration,
        JSON.stringify(artifact_info),
        JSON.stringify(raw_data),
        deploymentId,
      ]);

      logger.info(`Deployment updated: ID ${deploymentId}`);
      return result.rows[0];

    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn('Failed to update deployment (dev mode):', error.message);
        return { id: deploymentId, ...deploymentData };
      }
      throw new AppError(`Failed to update deployment: ${error.message}`, 500);
    }
  }

  /**
   * 성공한 빌드에 대해 NAS 증분 스캔 트리거
   */
  async triggerNASScanForBuild(deploymentData) {
    try {
      // 성공한 빌드만 스캔
      if (deploymentData.status !== 'success') {
        logger.info(`🔍 [JENKINS-WEBHOOK] Skipping NAS scan for non-successful build: ${deploymentData.project_name} #${deploymentData.build_number} (${deploymentData.status})`);
        return null;
      }

      logger.info(`🔍 [JENKINS-WEBHOOK] Triggering NAS scan for successful build: ${deploymentData.project_name} #${deploymentData.build_number}`);

      const pathResolver = getPathResolver();
      
      // 프로젝트명에서 버전 추출
      const version = pathResolver.extractVersion(deploymentData.project_name);
      if (!version) {
        logger.warn(`🔍 [JENKINS-WEBHOOK] Could not extract version from project: ${deploymentData.project_name}`);
        return null;
      }

      // NAS 서비스를 통해 증분 스캔 실행
      const nasService = getNASService();
      
      // 특정 버전에 대한 증분 스캔 실행 (지난 1시간)
      const scanOptions = {
        sinceHours: 1,  // 지난 1시간 내 변경된 파일만
        saveToDatabase: true,
        version: version,
        triggeredBy: 'jenkins-webhook',
        buildNumber: deploymentData.build_number.toString(),
        buildDate: this.extractBuildDate(deploymentData)
      };

      const scanResult = await nasService.incrementalScanAndSave(scanOptions);
      
      logger.info(`🔍 [JENKINS-WEBHOOK] NAS scan completed for ${deploymentData.project_name}: found ${scanResult.newFiles} new files, ${scanResult.updatedFiles} updated files`);
      
      return {
        triggered: true,
        version: version,
        scanResult: scanResult,
        buildInfo: {
          project: deploymentData.project_name,
          buildNumber: deploymentData.build_number,
          buildDate: scanOptions.buildDate
        }
      };

    } catch (error) {
      logger.error(`🔍 [JENKINS-WEBHOOK] Failed to trigger NAS scan for ${deploymentData.project_name} #${deploymentData.build_number}:`, error.message);
      // NAS 스캔 실패가 webhook 처리 전체를 실패시키지 않도록 함
      return {
        triggered: false,
        error: error.message,
        buildInfo: {
          project: deploymentData.project_name,
          buildNumber: deploymentData.build_number
        }
      };
    }
  }

  /**
   * 빌드 날짜 추출 (YYMMDD 형식)
   */
  extractBuildDate(deploymentData) {
    const buildTime = deploymentData.completed_at || deploymentData.started_at || new Date();
    const date = new Date(buildTime);
    
    // YYMMDD 형식으로 변환
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    
    return `${year}${month}${day}`;
  }

  /**
   * Webhook 이벤트 처리
   */
  async processWebhook(payload, signature, headers = {}) {
    try {
      // 서명 검증
      this.verifySignature(payload, signature, this.webhookSecret);

      // 데이터 파싱
      const deploymentData = this.parseWebhookData(payload);
      const eventType = headers['x-jenkins-event'] || 'unknown';

      // 중복 요청 체크
      const parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (this.isDuplicateRequest(
        deploymentData.project_name,
        deploymentData.build_number,
        eventType,
        parsedPayload,
      )) {
        return {
          success: true,
          message: 'Duplicate request ignored',
          deployment: null,
          eventType,
          ignored: true,
        };
      }

      logger.info(`Processing Jenkins webhook: ${eventType} for ${deploymentData.project_name} #${deploymentData.build_number}`);

      // 데이터베이스 저장
      const savedDeployment = await this.saveDeployment(deploymentData);

      // 성공한 빌드에 대해 NAS 스캔 트리거
      let nasScanResult = null;
      if (eventType.includes('completed') || eventType.includes('finalized')) {
        nasScanResult = await this.triggerNASScanForBuild(deploymentData);
      }

      // 웹소켓을 통한 실시간 업데이트 (추후 구현)
      // this.notifyClients(savedDeployment);

      return {
        success: true,
        deployment: savedDeployment,
        eventType,
        nasScan: nasScanResult,
      };

    } catch (error) {
      logger.error('Webhook processing failed:', error.message);
      throw error;
    }
  }

  /**
   * Webhook 상태 확인
   */
  async getWebhookStatus() {
    try {
      // 최근 24시간 Webhook 통계
      const statsQuery = `
        SELECT
          COUNT(*) as total_webhooks,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_deployments,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_deployments,
          COUNT(CASE WHEN created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour' THEN 1 END) as recent_webhooks
        FROM deployments
        WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
      `;

      const result = await query(statsQuery);
      const stats = result.rows[0];

      // NAS 스캔 통계 추가 (nas_artifacts 테이블에서 Jenkins로 트리거된 스캔 확인)
      let nasScanStats = {
        totalScans: 0,
        recentScans: 0,
        triggeredByJenkins: 0
      };

      try {
        const nasScanQuery = `
          SELECT
            COUNT(*) as total_scans,
            COUNT(CASE WHEN scanned_at > CURRENT_TIMESTAMP - INTERVAL '1 hour' THEN 1 END) as recent_scans,
            COUNT(CASE WHEN search_path LIKE '%jenkins-webhook%' THEN 1 END) as triggered_by_jenkins
          FROM nas_artifacts
          WHERE scanned_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
        `;
        
        const nasResult = await query(nasScanQuery);
        if (nasResult.rows[0]) {
          nasScanStats = {
            totalScans: parseInt(nasResult.rows[0].total_scans),
            recentScans: parseInt(nasResult.rows[0].recent_scans),
            triggeredByJenkins: parseInt(nasResult.rows[0].triggered_by_jenkins)
          };
        }
      } catch (nasError) {
        logger.warn('Failed to get NAS scan stats:', nasError.message);
      }

      return {
        status: 'active',
        secretConfigured: !!this.webhookSecret,
        supportedEvents: this.supportedEvents,
        nasIntegration: {
          enabled: true,
          autoScanOnSuccess: true,
          scanWindow: '1 hour'
        },
        stats: {
          totalWebhooks: parseInt(stats.total_webhooks),
          successfulDeployments: parseInt(stats.successful_deployments),
          failedDeployments: parseInt(stats.failed_deployments),
          recentWebhooks: parseInt(stats.recent_webhooks),
          nasScan: nasScanStats
        },
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        return {
          status: 'active',
          secretConfigured: !!this.webhookSecret,
          supportedEvents: this.supportedEvents,
          nasIntegration: {
            enabled: true,
            autoScanOnSuccess: true,
            scanWindow: '1 hour'
          },
          stats: {
            totalWebhooks: 0,
            successfulDeployments: 0,
            failedDeployments: 0,
            recentWebhooks: 0,
            nasScan: {
              totalScans: 0,
              recentScans: 0,
              triggeredByJenkins: 0
            }
          },
          timestamp: new Date().toISOString(),
        };
      }
      throw new AppError(`Failed to get webhook status: ${error.message}`, 500);
    }
  }

  /**
   * 서비스 종료 시 정리 작업
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.recentRequests.clear();
    logger.info('Jenkins Webhook Service destroyed');
  }
}

// 싱글톤 인스턴스
let webhookService = null;

function getJenkinsWebhookService() {
  if (!webhookService) {
    webhookService = new JenkinsWebhookService();
  }
  return webhookService;
}

module.exports = {
  JenkinsWebhookService,
  getJenkinsWebhookService,
};
