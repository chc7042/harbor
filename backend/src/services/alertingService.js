const logger = require('../config/logger');
const { getDeploymentPathService } = require('./deploymentPathService');

/**
 * 배포 경로 탐지 실패에 대한 알림 서비스
 * 연속된 실패나 높은 실패율을 감지하여 경고를 발생시킴
 */
class AlertingService {
  constructor() {
    this.alertThresholds = {
      consecutiveFailures: parseInt(process.env.ALERT_CONSECUTIVE_FAILURES) || 5,
      failureRateThreshold: parseFloat(process.env.ALERT_FAILURE_RATE_THRESHOLD) || 0.8, // 80%
      timeWindowMinutes: parseInt(process.env.ALERT_TIME_WINDOW_MINUTES) || 30,
      cooldownMinutes: parseInt(process.env.ALERT_COOLDOWN_MINUTES) || 60,
    };

    this.consecutiveFailures = 0;
    this.alertState = {
      lastAlertTime: null,
      lastAlertType: null,
      suppressedAlerts: 0,
    };

    this.alertHandlers = [];
    this.recentFailures = []; // Track recent failures for rate calculation

    // Register default console alert handler
    this.registerAlertHandler(this.consoleAlertHandler.bind(this));

    logger.info('AlertingService initialized', {
      thresholds: this.alertThresholds,
    });
  }

  /**
   * 알림 핸들러 등록
   * @param {Function} handler - (alertType, data) => Promise<void> 형태의 핸들러
   */
  registerAlertHandler(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Alert handler must be a function');
    }
    this.alertHandlers.push(handler);
    logger.debug('Alert handler registered', { totalHandlers: this.alertHandlers.length });
  }

  /**
   * 배포 경로 탐지 실패 기록
   * @param {Object} failureData - 실패 데이터
   * @param {string} failureData.projectName - 프로젝트명
   * @param {string} failureData.version - 버전
   * @param {number} failureData.buildNumber - 빌드 번호
   * @param {string} failureData.reason - 실패 이유
   * @param {number} failureData.responseTime - 응답 시간 (ms)
   */
  async recordPathDetectionFailure(failureData) {
    const failure = {
      timestamp: new Date(),
      projectName: failureData.projectName,
      version: failureData.version,
      buildNumber: failureData.buildNumber,
      reason: failureData.reason,
      responseTime: failureData.responseTime,
    };

    this.recentFailures.push(failure);
    this.consecutiveFailures++;

    // 최근 실패 기록을 시간 윈도우로 제한
    const cutoffTime = new Date(Date.now() - this.alertThresholds.timeWindowMinutes * 60 * 1000);
    this.recentFailures = this.recentFailures.filter(f => f.timestamp > cutoffTime);

    logger.warn('Path detection failure recorded', {
      project: `${failureData.projectName} v${failureData.version} #${failureData.buildNumber}`,
      reason: failureData.reason,
      consecutiveFailures: this.consecutiveFailures,
      recentFailuresCount: this.recentFailures.length,
    });

    await this.checkAlertConditions();
  }

  /**
   * 성공한 배포 경로 탐지 기록 (연속 실패 카운터 리셋)
   */
  recordPathDetectionSuccess() {
    if (this.consecutiveFailures > 0) {
      logger.info('Path detection success - resetting consecutive failure count', {
        previousConsecutiveFailures: this.consecutiveFailures,
      });
      this.consecutiveFailures = 0;
    }
  }

  /**
   * 알림 조건 확인 및 알림 발송
   */
  async checkAlertConditions() {
    const now = new Date();

    // 쿨다운 기간 확인
    if (this.alertState.lastAlertTime) {
      const timeSinceLastAlert = now.getTime() - this.alertState.lastAlertTime.getTime();
      const cooldownMs = this.alertThresholds.cooldownMinutes * 60 * 1000;

      if (timeSinceLastAlert < cooldownMs) {
        this.alertState.suppressedAlerts++;
        logger.debug('Alert suppressed due to cooldown', {
          timeSinceLastAlert: `${Math.round(timeSinceLastAlert / 1000)}s`,
          cooldownPeriod: `${this.alertThresholds.cooldownMinutes}m`,
          suppressedAlerts: this.alertState.suppressedAlerts,
        });
        return;
      }
    }

    // 연속 실패 확인
    if (this.consecutiveFailures >= this.alertThresholds.consecutiveFailures) {
      await this.sendAlert('consecutive_failures', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.alertThresholds.consecutiveFailures,
      });
      return;
    }

    // 실패율 확인
    const failureRate = await this.calculateRecentFailureRate();
    if (failureRate >= this.alertThresholds.failureRateThreshold && this.recentFailures.length >= 5) {
      await this.sendAlert('high_failure_rate', {
        failureRate: Math.round(failureRate * 100),
        threshold: Math.round(this.alertThresholds.failureRateThreshold * 100),
        timeWindowMinutes: this.alertThresholds.timeWindowMinutes,
        totalRequests: this.recentFailures.length + await this.getRecentSuccessCount(),
        failedRequests: this.recentFailures.length,
      });
    }
  }

  /**
   * 최근 실패율 계산
   * @returns {Promise<number>} - 0과 1 사이의 실패율
   */
  async calculateRecentFailureRate() {
    try {
      // 최근 성공 요청 수 추정
      const recentSuccessEstimate = await this.getRecentSuccessCount();
      const totalRecentRequests = this.recentFailures.length + recentSuccessEstimate;

      if (totalRecentRequests === 0) return 0;

      return this.recentFailures.length / totalRecentRequests;
    } catch (error) {
      logger.error('Error calculating failure rate', { error: error.message });
      return 0;
    }
  }

  /**
   * 최근 성공 요청 수 추정
   * @returns {Promise<number>} - 추정된 성공 요청 수
   */
  async getRecentSuccessCount() {
    try {
      const deploymentPathService = getDeploymentPathService();
      const cutoffTime = new Date(Date.now() - this.alertThresholds.timeWindowMinutes * 60 * 1000);

      // 최근 저장된 배포 경로 개수를 성공으로 간주
      const recentPaths = await deploymentPathService.getRecentPaths(50);
      const recentSuccessfulPaths = recentPaths.filter(path =>
        new Date(path.verifiedAt) > cutoffTime,
      );

      return recentSuccessfulPaths.length;
    } catch (error) {
      logger.error('Error getting recent success count', { error: error.message });
      return 0;
    }
  }

  /**
   * 알림 발송
   * @param {string} alertType - 알림 유형
   * @param {Object} data - 알림 데이터
   */
  async sendAlert(alertType, data) {
    const alertData = {
      type: alertType,
      timestamp: new Date(),
      data,
      suppressedAlerts: this.alertState.suppressedAlerts,
    };

    this.alertState.lastAlertTime = new Date();
    this.alertState.lastAlertType = alertType;
    this.alertState.suppressedAlerts = 0;

    logger.error('Deployment path detection alert triggered', alertData);

    // 모든 등록된 핸들러에 알림 전송
    const handlerPromises = this.alertHandlers.map(async (handler) => {
      try {
        await handler(alertType, alertData);
      } catch (error) {
        logger.error('Alert handler failed', {
          error: error.message,
          alertType,
        });
      }
    });

    await Promise.allSettled(handlerPromises);
  }

  /**
   * 기본 콘솔 알림 핸들러
   * @param {string} alertType - 알림 유형
   * @param {Object} alertData - 알림 데이터
   */
  async consoleAlertHandler(alertType, alertData) {
    const { data, timestamp } = alertData;

    switch (alertType) {
      case 'consecutive_failures':
        logger.error('🚨 ALERT: Consecutive deployment path detection failures detected!', {
          consecutiveFailures: data.consecutiveFailures,
          threshold: data.threshold,
          timestamp: timestamp.toISOString(),
          action: 'Check Jenkins connectivity, NAS availability, and database status',
        });
        break;

      case 'high_failure_rate':
        logger.error('🚨 ALERT: High deployment path detection failure rate detected!', {
          failureRate: `${data.failureRate}%`,
          threshold: `${data.threshold}%`,
          timeWindow: `${data.timeWindowMinutes} minutes`,
          totalRequests: data.totalRequests,
          failedRequests: data.failedRequests,
          timestamp: timestamp.toISOString(),
          action: 'Check system performance and external dependencies',
        });
        break;

      default:
        logger.error(`🚨 ALERT: Unknown alert type: ${alertType}`, alertData);
    }
  }

  /**
   * Webhook 알림 핸들러 (Slack, Teams 등)
   * @param {string} webhookUrl - Webhook URL
   * @returns {Function} - 알림 핸들러 함수
   */
  createWebhookAlertHandler(webhookUrl) {
    return async (alertType, alertData) => {
      try {
        const axios = require('axios');
        const { data, timestamp } = alertData;

        let message = '';
        switch (alertType) {
          case 'consecutive_failures':
            message = '🚨 **Deployment Path Detection Alert**\n\n' +
                     '**Type:** Consecutive Failures\n' +
                     `**Count:** ${data.consecutiveFailures}/${data.threshold}\n` +
                     `**Time:** ${timestamp.toISOString()}\n` +
                     '**Action:** Check Jenkins connectivity, NAS availability, and database status';
            break;

          case 'high_failure_rate':
            message = '🚨 **Deployment Path Detection Alert**\n\n' +
                     '**Type:** High Failure Rate\n' +
                     `**Rate:** ${data.failureRate}% (threshold: ${data.threshold}%)\n` +
                     `**Period:** ${data.timeWindowMinutes} minutes\n` +
                     `**Requests:** ${data.failedRequests}/${data.totalRequests} failed\n` +
                     `**Time:** ${timestamp.toISOString()}\n` +
                     '**Action:** Check system performance and external dependencies';
            break;
        }

        const payload = {
          text: message,
          timestamp: timestamp.toISOString(),
          alert_type: alertType,
          data: data,
        };

        await axios.post(webhookUrl, payload, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        });

        logger.info('Webhook alert sent successfully', { webhookUrl, alertType });
      } catch (error) {
        logger.error('Failed to send webhook alert', {
          error: error.message,
          webhookUrl,
          alertType,
        });
      }
    };
  }

  /**
   * 이메일 알림 핸들러 (SMTP 설정 필요)
   * @param {Object} emailConfig - 이메일 설정
   * @returns {Function} - 알림 핸들러 함수
   */
  createEmailAlertHandler(emailConfig) {
    return async (alertType, alertData) => {
      try {
        // 이메일 전송 로직은 필요시 구현
        // nodemailer 등을 사용하여 SMTP 서버로 이메일 전송
        logger.info('Email alert would be sent here', {
          emailConfig,
          alertType,
          alertData,
        });
      } catch (error) {
        logger.error('Failed to send email alert', {
          error: error.message,
          alertType,
        });
      }
    };
  }

  /**
   * 알림 서비스 상태 조회
   * @returns {Object} - 알림 서비스 상태
   */
  getAlertStatus() {
    return {
      thresholds: this.alertThresholds,
      state: {
        ...this.alertState,
        consecutiveFailures: this.consecutiveFailures,
        lastAlertTime: this.alertState.lastAlertTime?.toISOString() || null,
      },
      recentFailures: this.recentFailures.length,
      registeredHandlers: this.alertHandlers.length,
    };
  }

  /**
   * 알림 임계값 업데이트
   * @param {Object} newThresholds - 새로운 임계값
   */
  updateThresholds(newThresholds) {
    this.alertThresholds = { ...this.alertThresholds, ...newThresholds };
    logger.info('Alert thresholds updated', { thresholds: this.alertThresholds });
  }

  /**
   * 알림 상태 리셋
   */
  resetAlertState() {
    this.consecutiveFailures = 0;
    this.alertState = {
      lastAlertTime: null,
      lastAlertType: null,
      suppressedAlerts: 0,
    };
    this.recentFailures = [];
    logger.info('Alert state reset');
  }
}

// 싱글톤 인스턴스
let alertingService = null;

function getAlertingService() {
  if (!alertingService) {
    alertingService = new AlertingService();
  }
  return alertingService;
}

module.exports = {
  AlertingService,
  getAlertingService,
};
