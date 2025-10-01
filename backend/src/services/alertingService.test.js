const { AlertingService } = require('./alertingService');

// Mock the dependencies
jest.mock('./deploymentPathService', () => ({
  getDeploymentPathService: () => ({
    getRecentPaths: jest.fn().mockResolvedValue([]),
  }),
}));

describe('AlertingService', () => {
  let alertingService;
  let mockHandler;

  beforeEach(() => {
    alertingService = new AlertingService();
    mockHandler = jest.fn();
    alertingService.alertHandlers = [mockHandler]; // Replace default handler
    
    // Reset alert state
    alertingService.resetAlertState();
    
    // Set low thresholds for testing
    alertingService.updateThresholds({
      consecutiveFailures: 2,
      failureRateThreshold: 0.5,
      timeWindowMinutes: 1,
      cooldownMinutes: 1,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordPathDetectionFailure', () => {
    it('should record failures and trigger alert on consecutive failures', async () => {
      const failureData = {
        projectName: 'test-project',
        version: '1.0.0',
        buildNumber: 123,
        reason: 'nas_verification_failed',
        responseTime: 5000,
      };

      // First failure - should not trigger alert
      await alertingService.recordPathDetectionFailure(failureData);
      expect(mockHandler).not.toHaveBeenCalled();
      expect(alertingService.consecutiveFailures).toBe(1);

      // Second failure - should trigger alert
      await alertingService.recordPathDetectionFailure(failureData);
      expect(mockHandler).toHaveBeenCalledWith(
        'consecutive_failures',
        expect.objectContaining({
          type: 'consecutive_failures',
          data: expect.objectContaining({
            consecutiveFailures: 2,
            threshold: 2,
          }),
        })
      );
      expect(alertingService.consecutiveFailures).toBe(2);
    });

    it('should track recent failures for rate calculation', async () => {
      const failureData = {
        projectName: 'test-project',
        version: '1.0.0',
        buildNumber: 123,
        reason: 'api_failed',
        responseTime: 3000,
      };

      await alertingService.recordPathDetectionFailure(failureData);
      
      expect(alertingService.recentFailures).toHaveLength(1);
      expect(alertingService.recentFailures[0]).toMatchObject({
        projectName: 'test-project',
        version: '1.0.0',
        buildNumber: 123,
        reason: 'api_failed',
        responseTime: 3000,
      });
    });
  });

  describe('recordPathDetectionSuccess', () => {
    it('should reset consecutive failures on success', () => {
      alertingService.consecutiveFailures = 5;
      
      alertingService.recordPathDetectionSuccess();
      
      expect(alertingService.consecutiveFailures).toBe(0);
    });

    it('should not affect consecutive failures if already zero', () => {
      alertingService.consecutiveFailures = 0;
      
      alertingService.recordPathDetectionSuccess();
      
      expect(alertingService.consecutiveFailures).toBe(0);
    });
  });

  describe('checkAlertConditions', () => {
    it('should respect cooldown period', async () => {
      const failureData = {
        projectName: 'test-project',
        version: '1.0.0',
        buildNumber: 123,
        reason: 'test_failure',
        responseTime: 5000,
      };

      // Trigger first alert
      await alertingService.recordPathDetectionFailure(failureData);
      await alertingService.recordPathDetectionFailure(failureData);
      expect(mockHandler).toHaveBeenCalledTimes(1);

      // Reset mock call count
      mockHandler.mockClear();

      // Trigger another failure immediately - should be suppressed
      await alertingService.recordPathDetectionFailure(failureData);
      expect(mockHandler).not.toHaveBeenCalled();
      expect(alertingService.alertState.suppressedAlerts).toBe(1);
    });
  });

  describe('registerAlertHandler', () => {
    it('should add new alert handlers', () => {
      const newHandler = jest.fn();
      const initialHandlerCount = alertingService.alertHandlers.length;
      
      alertingService.registerAlertHandler(newHandler);
      
      expect(alertingService.alertHandlers).toHaveLength(initialHandlerCount + 1);
      expect(alertingService.alertHandlers).toContain(newHandler);
    });

    it('should throw error for non-function handlers', () => {
      expect(() => {
        alertingService.registerAlertHandler('not a function');
      }).toThrow('Alert handler must be a function');
    });
  });

  describe('createWebhookAlertHandler', () => {
    it('should create a webhook handler function', () => {
      const webhookUrl = 'https://hooks.slack.com/test';
      const handler = alertingService.createWebhookAlertHandler(webhookUrl);
      
      expect(typeof handler).toBe('function');
    });
  });

  describe('getAlertStatus', () => {
    it('should return current alert status', () => {
      alertingService.consecutiveFailures = 3;
      alertingService.alertState.lastAlertType = 'consecutive_failures';
      alertingService.recentFailures = [{ timestamp: new Date() }];
      
      const status = alertingService.getAlertStatus();
      
      expect(status).toMatchObject({
        thresholds: expect.objectContaining({
          consecutiveFailures: 2,
          failureRateThreshold: 0.5,
        }),
        state: expect.objectContaining({
          lastAlertType: 'consecutive_failures',
        }),
        recentFailures: 1,
        registeredHandlers: 1,
      });
    });
  });

  describe('updateThresholds', () => {
    it('should update alert thresholds', () => {
      const newThresholds = {
        consecutiveFailures: 10,
        failureRateThreshold: 0.9,
      };
      
      alertingService.updateThresholds(newThresholds);
      
      expect(alertingService.alertThresholds.consecutiveFailures).toBe(10);
      expect(alertingService.alertThresholds.failureRateThreshold).toBe(0.9);
      // Should preserve other thresholds
      expect(alertingService.alertThresholds.timeWindowMinutes).toBe(1);
    });
  });

  describe('resetAlertState', () => {
    it('should reset all alert state', () => {
      alertingService.consecutiveFailures = 5;
      alertingService.alertState.lastAlertTime = new Date();
      alertingService.alertState.lastAlertType = 'consecutive_failures';
      alertingService.recentFailures = [{ timestamp: new Date() }];
      
      alertingService.resetAlertState();
      
      expect(alertingService.consecutiveFailures).toBe(0);
      expect(alertingService.alertState.lastAlertTime).toBeNull();
      expect(alertingService.alertState.lastAlertType).toBeNull();
      expect(alertingService.recentFailures).toHaveLength(0);
    });
  });

  describe('alert message formatting', () => {
    it('should format consecutive failures alert correctly', async () => {
      // Mock logger.error instead of console.error
      const logger = require('../config/logger');
      const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation();
      
      // Use the default console handler
      alertingService.alertHandlers = [alertingService.consoleAlertHandler.bind(alertingService)];
      
      const failureData = {
        projectName: 'test-project',
        version: '1.0.0',
        buildNumber: 123,
        reason: 'test_failure',
        responseTime: 5000,
      };

      // Trigger consecutive failures alert
      await alertingService.recordPathDetectionFailure(failureData);
      await alertingService.recordPathDetectionFailure(failureData);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('🚨 ALERT: Consecutive deployment path detection failures detected!'),
        expect.objectContaining({
          consecutiveFailures: 2,
          threshold: 2,
        })
      );

      loggerErrorSpy.mockRestore();
    });
  });
});