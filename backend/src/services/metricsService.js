const logger = require('../config/logger');

class MetricsService {
  constructor() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
    };

    this.startTime = Date.now();
  }

  recordRequest(success = true) {
    this.metrics.totalRequests++;

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    logger.debug('Metrics: Request recorded', {
      success,
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
    });
  }

  recordError(errorType = 'unknown') {
    this.metrics.failedRequests++;

    logger.error('Metrics: Error recorded', {
      errorType,
      totalErrors: this.metrics.failedRequests,
    });
  }

  getSuccessRate() {
    const total = this.metrics.totalRequests;
    return total > 0 ? (this.metrics.successfulRequests / total * 100).toFixed(2) : 0;
  }

  getMetricsSummary() {
    const uptime = Date.now() - this.startTime;

    return {
      uptime: `${Math.floor(uptime / 1000)}s`,
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      successRate: `${this.getSuccessRate()}%`,
    };
  }

  resetMetrics() {
    logger.info('Metrics: Resetting all metrics', {
      previousTotalRequests: this.metrics.totalRequests,
      resetTimestamp: new Date().toISOString(),
    });

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
    };
  }

  logPeriodicMetrics() {
    const summary = this.getMetricsSummary();

    logger.info('Metrics: Periodic summary', {
      ...summary,
      timestamp: new Date().toISOString(),
    });

    // Log warning for low success rate
    if (parseFloat(this.getSuccessRate()) < 95 && this.metrics.totalRequests > 10) {
      logger.warn('Metrics: Low success rate detected', {
        successRate: this.getSuccessRate(),
        totalRequests: this.metrics.totalRequests,
        failedRequests: this.metrics.failedRequests,
      });
    }
  }
}

// Singleton instance
let metricsServiceInstance = null;

function getMetricsService() {
  if (!metricsServiceInstance) {
    metricsServiceInstance = new MetricsService();

    // Set up periodic logging every 10 minutes
    setInterval(() => {
      metricsServiceInstance.logPeriodicMetrics();
    }, 10 * 60 * 1000);

    logger.info('Metrics service initialized with basic logging');
  }
  return metricsServiceInstance;
}

module.exports = {
  MetricsService,
  getMetricsService,
};
