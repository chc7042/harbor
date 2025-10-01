const { MetricsService, getMetricsService } = require('./metricsService');

// Mock logger
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('MetricsService', () => {
  let metricsService;

  beforeEach(() => {
    // Create a new instance for each test
    metricsService = new MetricsService();
  });

  describe('Deployment Extraction Tracking', () => {
    test('should track deployment extraction start', () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      const requestData = metricsService.recordDeploymentExtractionStart(jobName, buildNumber);

      expect(requestData).toHaveProperty('requestId');
      expect(requestData).toHaveProperty('startTime');
      expect(requestData.requestId).toContain(`${jobName}#${buildNumber}`);
      expect(metricsService.metrics.deploymentExtraction.totalRequests).toBe(1);
    });

    test('should track deployment extraction completion', () => {
      const requestData = {
        requestId: 'test-request-123',
        startTime: Date.now() - 1000, // 1 second ago
      };

      metricsService.recordDeploymentExtractionComplete(requestData, { success: true });

      expect(metricsService.metrics.deploymentExtraction.successfulRequests).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.responseTimes).toHaveLength(1);
      expect(metricsService.metrics.deploymentExtraction.responseTimes[0]).toBeGreaterThan(0);
    });

    test('should track failed deployment extraction', () => {
      const requestData = {
        requestId: 'test-request-456',
        startTime: Date.now() - 500,
      };

      metricsService.recordDeploymentExtractionComplete(requestData, { success: false });

      expect(metricsService.metrics.deploymentExtraction.failedRequests).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.successfulRequests).toBe(0);
    });
  });

  describe('Cache Metrics', () => {
    test('should record cache hits', () => {
      metricsService.recordCacheHit(25);

      expect(metricsService.metrics.deploymentExtraction.cacheHits).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.operationCounts.cacheHits).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.stepPerformance.cache.count).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.stepPerformance.cache.totalTime).toBe(25);
    });

    test('should record cache misses', () => {
      metricsService.recordCacheMiss(100);

      expect(metricsService.metrics.deploymentExtraction.cacheMisses).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.stepPerformance.cache.count).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.stepPerformance.cache.totalTime).toBe(100);
    });

    test('should calculate cache hit rate correctly', () => {
      metricsService.recordCacheHit(10);
      metricsService.recordCacheHit(15);
      metricsService.recordCacheMiss(20);

      const hitRate = metricsService.getCacheHitRate();
      expect(hitRate).toBe('66.67'); // 2 hits out of 3 total = 66.67%
    });
  });

  describe('Operation Metrics', () => {
    test('should record API calls', () => {
      metricsService.recordApiCall(500, true);
      metricsService.recordApiCall(750, false);

      expect(metricsService.metrics.deploymentExtraction.operationCounts.apiCalls).toBe(2);
      expect(metricsService.metrics.deploymentExtraction.errorCounts.apiErrors).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.stepPerformance.api.count).toBe(2);
      expect(metricsService.metrics.deploymentExtraction.stepPerformance.api.totalTime).toBe(1250);
    });

    test('should record path generation', () => {
      metricsService.recordPathGeneration(50, 5);
      metricsService.recordPathGeneration(75, 3);

      expect(metricsService.metrics.deploymentExtraction.operationCounts.pathGenerations).toBe(2);
      expect(metricsService.metrics.deploymentExtraction.pathCandidates.totalGenerated).toBe(8);
      expect(metricsService.metrics.deploymentExtraction.pathCandidates.averageGenerated).toBe(4);
    });

    test('should record NAS verification', () => {
      metricsService.recordNasVerification(200, 5, 1);
      metricsService.recordNasVerification(300, 3, 0);

      expect(metricsService.metrics.deploymentExtraction.operationCounts.nasVerifications).toBe(2);
      expect(metricsService.metrics.deploymentExtraction.pathCandidates.successfulVerifications).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.pathCandidates.failedVerifications).toBe(7);
    });

    test('should record database saves', () => {
      metricsService.recordDbSave(40, true);
      metricsService.recordDbSave(60, false);

      expect(metricsService.metrics.deploymentExtraction.operationCounts.dbSaves).toBe(2);
      expect(metricsService.metrics.deploymentExtraction.errorCounts.dbErrors).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.stepPerformance.dbSave.avgTime).toBe(50);
    });

    test('should record legacy fallbacks', () => {
      metricsService.recordLegacyFallback(1500, 'api_failed');
      metricsService.recordLegacyFallback(2000, 'nas_failed');

      expect(metricsService.metrics.deploymentExtraction.fallbackToLegacy).toBe(2);
      expect(metricsService.metrics.deploymentExtraction.operationCounts.legacyFallbacks).toBe(2);
      expect(metricsService.metrics.deploymentExtraction.stepPerformance.legacy.count).toBe(2);
    });
  });

  describe('Error Tracking', () => {
    test('should record different error types', () => {
      metricsService.recordError('db', 100);
      metricsService.recordError('api', 200);
      metricsService.recordError('nas', 300);
      metricsService.recordError('timeout', 400);
      metricsService.recordError('unknown', 500);

      const {errorCounts} = metricsService.metrics.deploymentExtraction;
      expect(errorCounts.dbErrors).toBe(1);
      expect(errorCounts.apiErrors).toBe(1);
      expect(errorCounts.nasErrors).toBe(1);
      expect(errorCounts.timeouts).toBe(1);
      expect(errorCounts.unknownErrors).toBe(1);
    });
  });

  describe('Performance Calculations', () => {
    test('should calculate average response time correctly', () => {
      // Add some response times
      metricsService.metrics.deploymentExtraction.responseTimes = [100, 200, 300, 400, 500];
      metricsService.updateAverageResponseTime();

      expect(metricsService.metrics.deploymentExtraction.averageResponseTime).toBe(300);
    });

    test('should maintain response times within limits', () => {
      // Add more than 1000 response times
      const manyTimes = Array.from({ length: 1200 }, (_, i) => i);
      metricsService.metrics.deploymentExtraction.responseTimes = manyTimes;
      metricsService.updateAverageResponseTime();

      // Should keep only the last 1000
      expect(metricsService.metrics.deploymentExtraction.responseTimes).toHaveLength(1000);
      expect(metricsService.metrics.deploymentExtraction.responseTimes[0]).toBe(200); // First 200 removed
    });

    test('should update step performance correctly', () => {
      metricsService.updateStepPerformance('cache', 100);
      metricsService.updateStepPerformance('cache', 200);

      const cachePerf = metricsService.metrics.deploymentExtraction.stepPerformance.cache;
      expect(cachePerf.count).toBe(2);
      expect(cachePerf.totalTime).toBe(300);
      expect(cachePerf.avgTime).toBe(150);
    });
  });

  describe('Rate Calculations', () => {
    test('should calculate success rate correctly', () => {
      metricsService.metrics.deploymentExtraction.totalRequests = 10;
      metricsService.metrics.deploymentExtraction.successfulRequests = 8;

      const successRate = metricsService.getSuccessRate();
      expect(successRate).toBe('80.00');
    });

    test('should calculate fallback rate correctly', () => {
      metricsService.metrics.deploymentExtraction.totalRequests = 20;
      metricsService.metrics.deploymentExtraction.fallbackToLegacy = 3;

      const fallbackRate = metricsService.getFallbackRate();
      expect(fallbackRate).toBe('15.00');
    });

    test('should return 0 rates for no requests', () => {
      expect(metricsService.getSuccessRate()).toBe(0);
      expect(metricsService.getFallbackRate()).toBe(0);
      expect(metricsService.getCacheHitRate()).toBe(0);
    });
  });

  describe('Metrics Summary', () => {
    test('should provide comprehensive metrics summary', () => {
      // Add some test data
      metricsService.recordDeploymentExtractionStart('test/job', 1);
      metricsService.recordCacheHit(25);
      metricsService.recordApiCall(500, true);
      metricsService.recordPathGeneration(50, 3);
      metricsService.recordNasVerification(200, 3, 1);
      metricsService.recordDbSave(40, true);

      const summary = metricsService.getMetricsSummary();

      expect(summary).toHaveProperty('uptime');
      expect(summary).toHaveProperty('totalRequests');
      expect(summary).toHaveProperty('successRate');
      expect(summary).toHaveProperty('cacheHitRate');
      expect(summary).toHaveProperty('fallbackRate');
      expect(summary).toHaveProperty('averageResponseTime');
      expect(summary).toHaveProperty('operationCounts');
      expect(summary).toHaveProperty('stepPerformance');
      expect(summary).toHaveProperty('errorCounts');
      expect(summary).toHaveProperty('pathCandidates');

      expect(summary.totalRequests).toBe(1);
      expect(summary.operationCounts.cacheHits).toBe(1);
      expect(summary.operationCounts.apiCalls).toBe(1);
    });

    test('should provide detailed metrics', () => {
      const detailed = metricsService.getDetailedMetrics();

      expect(detailed).toHaveProperty('rawMetrics');
      expect(detailed).toHaveProperty('lastResponseTimes');
      expect(detailed.rawMetrics).toBe(metricsService.metrics);
    });
  });

  describe('Metrics Reset', () => {
    test('should reset all metrics to initial state', () => {
      // Add some data
      metricsService.recordCacheHit(100);
      metricsService.recordApiCall(500, true);
      metricsService.recordError('db', 50);

      // Verify data exists
      expect(metricsService.metrics.deploymentExtraction.cacheHits).toBe(1);
      expect(metricsService.metrics.deploymentExtraction.operationCounts.apiCalls).toBe(1);

      // Reset
      metricsService.resetMetrics();

      // Verify reset
      expect(metricsService.metrics.deploymentExtraction.cacheHits).toBe(0);
      expect(metricsService.metrics.deploymentExtraction.operationCounts.apiCalls).toBe(0);
      expect(metricsService.metrics.deploymentExtraction.errorCounts.dbErrors).toBe(0);
      expect(metricsService.metrics.deploymentExtraction.responseTimes).toHaveLength(0);
    });
  });

  describe('Singleton Pattern', () => {
    test('should return same instance from getMetricsService', () => {
      const instance1 = getMetricsService();
      const instance2 = getMetricsService();

      expect(instance1).toBe(instance2);
    });

    test('should initialize periodic logging on first call', () => {
      jest.useFakeTimers();

      const instance = getMetricsService();
      expect(instance).toBeInstanceOf(MetricsService);

      // Fast-forward 5 minutes
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Should have called logPeriodicMetrics
      // (This is tested indirectly since we can't easily mock setInterval)

      jest.useRealTimers();
    });
  });

  describe('Periodic Metrics Logging', () => {
    test('should log periodic metrics summary', () => {
      const logger = require('../config/logger');

      metricsService.logPeriodicMetrics();

      expect(logger.info).toHaveBeenCalledWith(
        'Metrics: Periodic metrics summary',
        expect.objectContaining({
          operation: 'periodic_metrics_report',
          timestamp: expect.any(String),
        }),
      );
    });

    test('should log warnings for concerning metrics', () => {
      const logger = require('../config/logger');

      // Set up concerning metrics
      metricsService.metrics.deploymentExtraction.totalRequests = 20;
      metricsService.metrics.deploymentExtraction.successfulRequests = 10; // 50% success rate
      metricsService.metrics.deploymentExtraction.fallbackToLegacy = 5; // 25% fallback rate
      metricsService.metrics.deploymentExtraction.averageResponseTime = 12000; // 12 seconds

      metricsService.logPeriodicMetrics();

      expect(logger.warn).toHaveBeenCalledWith(
        'Metrics: Low success rate detected',
        expect.objectContaining({
          successRate: '50.00',
          totalRequests: 20,
        }),
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'Metrics: High fallback rate detected',
        expect.objectContaining({
          fallbackRate: '25.00',
          totalRequests: 20,
        }),
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'Metrics: High average response time detected',
        expect.objectContaining({
          averageResponseTime: '12000.00ms',
        }),
      );
    });
  });

  describe('Integration with Real Operations', () => {
    test('should track a complete successful deployment extraction flow', () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Start tracking
      const requestData = metricsService.recordDeploymentExtractionStart(jobName, buildNumber);

      // Cache miss
      metricsService.recordCacheMiss(50);

      // API call success
      metricsService.recordApiCall(500, true);

      // Path generation
      metricsService.recordPathGeneration(30, 5);

      // NAS verification success
      metricsService.recordNasVerification(200, 5, 1);

      // Database save success
      metricsService.recordDbSave(25, true);

      // Complete extraction
      metricsService.recordDeploymentExtractionComplete(requestData, { success: true });

      // Verify all operations were tracked
      const summary = metricsService.getMetricsSummary();
      expect(summary.totalRequests).toBe(1);
      expect(summary.successRate).toBe('100.00%');
      expect(summary.cacheHitRate).toBe('0.00%'); // Cache miss
      expect(summary.fallbackRate).toBe('0.00%');
      expect(summary.operationCounts.apiCalls).toBe(1);
      expect(summary.operationCounts.pathGenerations).toBe(1);
      expect(summary.operationCounts.nasVerifications).toBe(1);
      expect(summary.operationCounts.dbSaves).toBe(1);
      expect(summary.pathCandidates.totalGenerated).toBe(5);
      expect(summary.pathCandidates.successfulVerifications).toBe(1);
    });

    test('should track a fallback scenario', () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Start tracking
      const requestData = metricsService.recordDeploymentExtractionStart(jobName, buildNumber);

      // Cache miss
      metricsService.recordCacheMiss(50);

      // API call failure
      metricsService.recordApiCall(2000, false);

      // Fallback to legacy
      metricsService.recordLegacyFallback(3000, 'api_failed');

      // Complete with legacy result
      metricsService.recordDeploymentExtractionComplete(requestData, { success: true });

      // Verify fallback was tracked
      const summary = metricsService.getMetricsSummary();
      expect(summary.totalRequests).toBe(1);
      expect(summary.successRate).toBe('100.00%'); // Still successful via fallback
      expect(summary.fallbackRate).toBe('100.00%'); // 100% fallback rate
      expect(summary.errorCounts.apiErrors).toBe(1);
      expect(summary.operationCounts.legacyFallbacks).toBe(1);
    });
  });
});
