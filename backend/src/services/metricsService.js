const logger = require('../config/logger');

class MetricsService {
  constructor() {
    this.metrics = {
      deploymentExtraction: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        fallbackToLegacy: 0,
        averageResponseTime: 0,
        responseTimes: [],
        maxResponseTime: 0,
        minResponseTime: Infinity,
        operationCounts: {
          cacheHits: 0,
          apiCalls: 0,
          nasVerifications: 0,
          pathGenerations: 0,
          dbSaves: 0,
          legacyFallbacks: 0,
        },
        stepPerformance: {
          cache: { totalTime: 0, count: 0, avgTime: 0 },
          api: { totalTime: 0, count: 0, avgTime: 0 },
          pathGeneration: { totalTime: 0, count: 0, avgTime: 0 },
          nasVerification: { totalTime: 0, count: 0, avgTime: 0 },
          dbSave: { totalTime: 0, count: 0, avgTime: 0 },
          legacy: { totalTime: 0, count: 0, avgTime: 0 },
        },
        errorCounts: {
          dbErrors: 0,
          apiErrors: 0,
          nasErrors: 0,
          timeouts: 0,
          unknownErrors: 0,
        },
        pathCandidates: {
          totalGenerated: 0,
          averageGenerated: 0,
          successfulVerifications: 0,
          failedVerifications: 0,
        },
      },
    };

    this.startTime = Date.now();
    this.lastReset = Date.now();
  }

  recordDeploymentExtractionStart(jobName, buildNumber) {
    this.metrics.deploymentExtraction.totalRequests++;

    const requestId = `${jobName}#${buildNumber}-${Date.now()}`;
    logger.debug('Metrics: Starting deployment extraction tracking', {
      requestId,
      jobName,
      buildNumber,
      totalRequests: this.metrics.deploymentExtraction.totalRequests,
      timestamp: new Date().toISOString(),
    });

    return {
      requestId,
      startTime: Date.now(),
    };
  }

  recordDeploymentExtractionComplete(requestData, result) {
    const endTime = Date.now();
    const duration = endTime - requestData.startTime;

    // Update response time metrics
    this.metrics.deploymentExtraction.responseTimes.push(duration);
    this.updateAverageResponseTime();
    this.metrics.deploymentExtraction.maxResponseTime = Math.max(
      this.metrics.deploymentExtraction.maxResponseTime,
      duration,
    );
    this.metrics.deploymentExtraction.minResponseTime = Math.min(
      this.metrics.deploymentExtraction.minResponseTime,
      duration,
    );

    if (result.success) {
      this.metrics.deploymentExtraction.successfulRequests++;
    } else {
      this.metrics.deploymentExtraction.failedRequests++;
    }

    logger.info('Metrics: Deployment extraction completed', {
      requestId: requestData.requestId,
      duration: `${duration}ms`,
      success: result.success,
      totalSuccessful: this.metrics.deploymentExtraction.successfulRequests,
      totalFailed: this.metrics.deploymentExtraction.failedRequests,
      averageResponseTime: `${this.metrics.deploymentExtraction.averageResponseTime.toFixed(2)}ms`,
      maxResponseTime: `${this.metrics.deploymentExtraction.maxResponseTime}ms`,
      minResponseTime: `${this.metrics.deploymentExtraction.minResponseTime}ms`,
    });
  }

  recordCacheHit(duration = 0) {
    this.metrics.deploymentExtraction.cacheHits++;
    this.metrics.deploymentExtraction.operationCounts.cacheHits++;
    this.updateStepPerformance('cache', duration);

    logger.debug('Metrics: Cache hit recorded', {
      cacheHits: this.metrics.deploymentExtraction.cacheHits,
      duration: `${duration}ms`,
      cacheHitRate: this.getCacheHitRate(),
    });
  }

  recordCacheMiss(duration = 0) {
    this.metrics.deploymentExtraction.cacheMisses++;
    this.updateStepPerformance('cache', duration);

    logger.debug('Metrics: Cache miss recorded', {
      cacheMisses: this.metrics.deploymentExtraction.cacheMisses,
      duration: `${duration}ms`,
      cacheHitRate: this.getCacheHitRate(),
    });
  }

  recordApiCall(duration = 0, success = true) {
    this.metrics.deploymentExtraction.operationCounts.apiCalls++;
    this.updateStepPerformance('api', duration);

    if (!success) {
      this.metrics.deploymentExtraction.errorCounts.apiErrors++;
    }

    logger.debug('Metrics: API call recorded', {
      apiCalls: this.metrics.deploymentExtraction.operationCounts.apiCalls,
      apiErrors: this.metrics.deploymentExtraction.errorCounts.apiErrors,
      duration: `${duration}ms`,
      success,
    });
  }

  recordPathGeneration(duration = 0, candidatesGenerated = 0) {
    this.metrics.deploymentExtraction.operationCounts.pathGenerations++;
    this.metrics.deploymentExtraction.pathCandidates.totalGenerated += candidatesGenerated;
    this.updateStepPerformance('pathGeneration', duration);
    this.updateAveragePathCandidates();

    logger.debug('Metrics: Path generation recorded', {
      pathGenerations: this.metrics.deploymentExtraction.operationCounts.pathGenerations,
      candidatesGenerated,
      totalCandidates: this.metrics.deploymentExtraction.pathCandidates.totalGenerated,
      averageCandidates: this.metrics.deploymentExtraction.pathCandidates.averageGenerated,
      duration: `${duration}ms`,
    });
  }

  recordNasVerification(duration = 0, pathsChecked = 0, successfulPaths = 0) {
    this.metrics.deploymentExtraction.operationCounts.nasVerifications++;
    this.metrics.deploymentExtraction.pathCandidates.successfulVerifications += successfulPaths;
    this.metrics.deploymentExtraction.pathCandidates.failedVerifications += (pathsChecked - successfulPaths);
    this.updateStepPerformance('nasVerification', duration);

    logger.debug('Metrics: NAS verification recorded', {
      nasVerifications: this.metrics.deploymentExtraction.operationCounts.nasVerifications,
      pathsChecked,
      successfulPaths,
      totalSuccessful: this.metrics.deploymentExtraction.pathCandidates.successfulVerifications,
      totalFailed: this.metrics.deploymentExtraction.pathCandidates.failedVerifications,
      duration: `${duration}ms`,
    });
  }

  recordDbSave(duration = 0, success = true) {
    this.metrics.deploymentExtraction.operationCounts.dbSaves++;
    this.updateStepPerformance('dbSave', duration);

    if (!success) {
      this.metrics.deploymentExtraction.errorCounts.dbErrors++;
    }

    logger.debug('Metrics: Database save recorded', {
      dbSaves: this.metrics.deploymentExtraction.operationCounts.dbSaves,
      dbErrors: this.metrics.deploymentExtraction.errorCounts.dbErrors,
      duration: `${duration}ms`,
      success,
    });
  }

  recordLegacyFallback(duration = 0, reason = 'unknown') {
    this.metrics.deploymentExtraction.fallbackToLegacy++;
    this.metrics.deploymentExtraction.operationCounts.legacyFallbacks++;
    this.updateStepPerformance('legacy', duration);

    logger.warn('Metrics: Legacy fallback recorded', {
      fallbackToLegacy: this.metrics.deploymentExtraction.fallbackToLegacy,
      legacyFallbacks: this.metrics.deploymentExtraction.operationCounts.legacyFallbacks,
      fallbackRate: this.getFallbackRate(),
      reason,
      duration: `${duration}ms`,
    });
  }

  recordError(errorType = 'unknown', duration = 0) {
    const {errorCounts} = this.metrics.deploymentExtraction;

    switch (errorType) {
      case 'db':
        errorCounts.dbErrors++;
        break;
      case 'api':
        errorCounts.apiErrors++;
        break;
      case 'nas':
        errorCounts.nasErrors++;
        break;
      case 'timeout':
        errorCounts.timeouts++;
        break;
      default:
        errorCounts.unknownErrors++;
    }

    logger.error('Metrics: Error recorded', {
      errorType,
      dbErrors: errorCounts.dbErrors,
      apiErrors: errorCounts.apiErrors,
      nasErrors: errorCounts.nasErrors,
      timeouts: errorCounts.timeouts,
      unknownErrors: errorCounts.unknownErrors,
      duration: `${duration}ms`,
    });
  }

  updateStepPerformance(step, duration) {
    const stepMetrics = this.metrics.deploymentExtraction.stepPerformance[step];
    if (stepMetrics) {
      stepMetrics.totalTime += duration;
      stepMetrics.count++;
      stepMetrics.avgTime = stepMetrics.totalTime / stepMetrics.count;
    }
  }

  updateAverageResponseTime() {
    const {responseTimes} = this.metrics.deploymentExtraction;
    if (responseTimes.length > 0) {
      const sum = responseTimes.reduce((a, b) => a + b, 0);
      this.metrics.deploymentExtraction.averageResponseTime = sum / responseTimes.length;
    }

    // Keep only the last 1000 response times to prevent memory issues
    if (responseTimes.length > 1000) {
      this.metrics.deploymentExtraction.responseTimes = responseTimes.slice(-1000);
    }
  }

  updateAveragePathCandidates() {
    const {pathGenerations} = this.metrics.deploymentExtraction.operationCounts;
    const {totalGenerated} = this.metrics.deploymentExtraction.pathCandidates;

    if (pathGenerations > 0) {
      this.metrics.deploymentExtraction.pathCandidates.averageGenerated =
        totalGenerated / pathGenerations;
    }
  }

  getCacheHitRate() {
    const total = this.metrics.deploymentExtraction.cacheHits + this.metrics.deploymentExtraction.cacheMisses;
    return total > 0 ? (this.metrics.deploymentExtraction.cacheHits / total * 100).toFixed(2) : 0;
  }

  getFallbackRate() {
    const total = this.metrics.deploymentExtraction.totalRequests;
    return total > 0 ? (this.metrics.deploymentExtraction.fallbackToLegacy / total * 100).toFixed(2) : 0;
  }

  getSuccessRate() {
    const total = this.metrics.deploymentExtraction.totalRequests;
    return total > 0 ? (this.metrics.deploymentExtraction.successfulRequests / total * 100).toFixed(2) : 0;
  }

  getMetricsSummary() {
    const uptime = Date.now() - this.startTime;
    const resetTime = Date.now() - this.lastReset;

    return {
      uptime: `${Math.floor(uptime / 1000)}s`,
      resetTime: `${Math.floor(resetTime / 1000)}s`,
      totalRequests: this.metrics.deploymentExtraction.totalRequests,
      successRate: `${this.getSuccessRate()}%`,
      cacheHitRate: `${this.getCacheHitRate()}%`,
      fallbackRate: `${this.getFallbackRate()}%`,
      averageResponseTime: `${this.metrics.deploymentExtraction.averageResponseTime.toFixed(2)}ms`,
      maxResponseTime: `${this.metrics.deploymentExtraction.maxResponseTime}ms`,
      minResponseTime: this.metrics.deploymentExtraction.minResponseTime === Infinity ?
        'N/A' : `${this.metrics.deploymentExtraction.minResponseTime}ms`,
      operationCounts: this.metrics.deploymentExtraction.operationCounts,
      stepPerformance: Object.keys(this.metrics.deploymentExtraction.stepPerformance).reduce((acc, step) => {
        const stepData = this.metrics.deploymentExtraction.stepPerformance[step];
        acc[step] = {
          count: stepData.count,
          avgTime: `${stepData.avgTime.toFixed(2)}ms`,
          totalTime: `${stepData.totalTime}ms`,
        };
        return acc;
      }, {}),
      errorCounts: this.metrics.deploymentExtraction.errorCounts,
      pathCandidates: {
        totalGenerated: this.metrics.deploymentExtraction.pathCandidates.totalGenerated,
        averageGenerated: this.metrics.deploymentExtraction.pathCandidates.averageGenerated.toFixed(2),
        successfulVerifications: this.metrics.deploymentExtraction.pathCandidates.successfulVerifications,
        failedVerifications: this.metrics.deploymentExtraction.pathCandidates.failedVerifications,
      },
    };
  }

  getDetailedMetrics() {
    return {
      ...this.getMetricsSummary(),
      rawMetrics: this.metrics,
      lastResponseTimes: this.metrics.deploymentExtraction.responseTimes.slice(-10),
    };
  }

  resetMetrics() {
    logger.info('Metrics: Resetting all metrics', {
      previousUptime: Date.now() - this.startTime,
      previousTotalRequests: this.metrics.deploymentExtraction.totalRequests,
      resetTimestamp: new Date().toISOString(),
    });

    this.metrics.deploymentExtraction = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      fallbackToLegacy: 0,
      averageResponseTime: 0,
      responseTimes: [],
      maxResponseTime: 0,
      minResponseTime: Infinity,
      operationCounts: {
        cacheHits: 0,
        apiCalls: 0,
        nasVerifications: 0,
        pathGenerations: 0,
        dbSaves: 0,
        legacyFallbacks: 0,
      },
      stepPerformance: {
        cache: { totalTime: 0, count: 0, avgTime: 0 },
        api: { totalTime: 0, count: 0, avgTime: 0 },
        pathGeneration: { totalTime: 0, count: 0, avgTime: 0 },
        nasVerification: { totalTime: 0, count: 0, avgTime: 0 },
        dbSave: { totalTime: 0, count: 0, avgTime: 0 },
        legacy: { totalTime: 0, count: 0, avgTime: 0 },
      },
      errorCounts: {
        dbErrors: 0,
        apiErrors: 0,
        nasErrors: 0,
        timeouts: 0,
        unknownErrors: 0,
      },
      pathCandidates: {
        totalGenerated: 0,
        averageGenerated: 0,
        successfulVerifications: 0,
        failedVerifications: 0,
      },
    };

    this.lastReset = Date.now();
  }

  logPeriodicMetrics() {
    const summary = this.getMetricsSummary();

    logger.info('Metrics: Periodic metrics summary', {
      ...summary,
      operation: 'periodic_metrics_report',
      timestamp: new Date().toISOString(),
    });

    // Log warnings for concerning metrics
    if (parseFloat(this.getSuccessRate()) < 95 && this.metrics.deploymentExtraction.totalRequests > 10) {
      logger.warn('Metrics: Low success rate detected', {
        successRate: this.getSuccessRate(),
        totalRequests: this.metrics.deploymentExtraction.totalRequests,
        failedRequests: this.metrics.deploymentExtraction.failedRequests,
      });
    }

    if (parseFloat(this.getFallbackRate()) > 20 && this.metrics.deploymentExtraction.totalRequests > 10) {
      logger.warn('Metrics: High fallback rate detected', {
        fallbackRate: this.getFallbackRate(),
        totalRequests: this.metrics.deploymentExtraction.totalRequests,
        fallbackCount: this.metrics.deploymentExtraction.fallbackToLegacy,
      });
    }

    if (this.metrics.deploymentExtraction.averageResponseTime > 10000) {
      logger.warn('Metrics: High average response time detected', {
        averageResponseTime: `${this.metrics.deploymentExtraction.averageResponseTime.toFixed(2)}ms`,
        maxResponseTime: `${this.metrics.deploymentExtraction.maxResponseTime}ms`,
      });
    }
  }
}

// Singleton instance
let metricsServiceInstance = null;

function getMetricsService() {
  if (!metricsServiceInstance) {
    metricsServiceInstance = new MetricsService();

    // Set up periodic logging every 5 minutes
    setInterval(() => {
      metricsServiceInstance.logPeriodicMetrics();
    }, 5 * 60 * 1000);

    logger.info('Metrics service initialized with periodic reporting every 5 minutes');
  }
  return metricsServiceInstance;
}

module.exports = {
  MetricsService,
  getMetricsService,
};
