const {
  withRetry,
  withNASRetry,
  withJenkinsRetry,
  calculateDelay,
  isRetryableError,
  DEFAULT_CONFIG,
} = require('./retryMechanism');

describe('RetryMechanism', () => {
  describe('calculateDelay', () => {
    it('should calculate exponential backoff delay', () => {
      const config = {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 10000,
        jitterMaxMs: 0,
      };

      expect(calculateDelay(0, config)).toBe(1000);
      expect(calculateDelay(1, config)).toBe(2000);
      expect(calculateDelay(2, config)).toBe(4000);
      expect(calculateDelay(3, config)).toBe(8000);
      expect(calculateDelay(4, config)).toBe(10000); // Capped at maxDelayMs
    });

    it('should add jitter to delay', () => {
      const config = {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 10000,
        jitterMaxMs: 100,
      };

      const delay = calculateDelay(0, config);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1100);
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable error codes', () => {
      const retryableErrors = [
        { code: 'ECONNREFUSED', message: 'Connection refused' },
        { code: 'ENOTFOUND', message: 'Host not found' },
        { code: 'ECONNRESET', message: 'Connection reset' },
        { code: 'ETIMEDOUT', message: 'Timeout' },
        { code: 'EHOSTUNREACH', message: 'Host unreachable' },
        { code: 'EAI_AGAIN', message: 'DNS lookup failed' },
      ];

      retryableErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should identify retryable error messages', () => {
      const retryableErrors = [
        new Error('timeout occurred'),
        new Error('connection refused by server'),
        new Error('network error detected'),
        new Error('socket hang up'),
        new Error('econnreset'),
        new Error('enotfound'),
        new Error('ehostunreach'),
      ];

      retryableErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should identify non-retryable errors', () => {
      const nonRetryableErrors = [
        new Error('Invalid input'),
        new Error('Permission denied'),
        { code: 'EACCES', message: 'Access denied' },
        new Error('File not found'),
        null,
        undefined,
      ];

      nonRetryableErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });

    it('should handle NAS-specific errors', () => {
      const nasConfig = {
        retryableErrors: [
          ...DEFAULT_CONFIG.retryableErrors,
          'EACCES',
          'EBUSY',
          'EMFILE',
          'ENFILE',
        ],
      };

      const nasErrors = [
        { code: 'EACCES', message: 'Permission denied' },
        { code: 'EBUSY', message: 'Resource busy' },
        { code: 'EMFILE', message: 'Too many open files' },
        { code: 'ENFILE', message: 'File table overflow' },
      ];

      nasErrors.forEach(error => {
        expect(isRetryableError(error, nasConfig)).toBe(true);
      });
    });

    it('should handle Jenkins-specific errors', () => {
      const jenkinsConfig = {
        retryableErrors: [
          ...DEFAULT_CONFIG.retryableErrors,
          'ECONNABORTED',
        ],
      };

      const jenkinsErrors = [
        { code: 'ECONNABORTED', message: 'Request timeout' },
      ];

      jenkinsErrors.forEach(error => {
        expect(isRetryableError(error, jenkinsConfig)).toBe(true);
      });
    });

    it('should handle database-specific errors', () => {
      const dbConfig = {
        retryableErrors: [
          ...DEFAULT_CONFIG.retryableErrors,
          'connection terminated',
          'server closed the connection',
        ],
      };

      const dbErrors = [
        new Error('connection terminated'),
        new Error('server closed the connection'),
        { code: 'ECONNREFUSED', message: 'Connection refused' },
      ];

      dbErrors.forEach(error => {
        expect(isRetryableError(error, dbConfig)).toBe(true);
      });
    });
  });

  describe('withRetry - synchronous behavior tests', () => {
    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await withRetry(operation, DEFAULT_CONFIG, 'test operation');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should not retry on non-retryable errors', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Invalid input'));

      await expect(withRetry(operation, DEFAULT_CONFIG, 'test operation'))
        .rejects.toThrow('Invalid input');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors (with minimal delay)', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');

      const config = {
        maxRetries: 1,
        initialDelayMs: 1, // Very short delay for testing
        jitterMaxMs: 0,
      };

      const result = await withRetry(operation, config, 'test operation');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('timeout'));

      const config = {
        maxRetries: 1,
        initialDelayMs: 1, // Very short delay for testing
        jitterMaxMs: 0,
      };

      await expect(withRetry(operation, config, 'test operation'))
        .rejects.toThrow('timeout');

      expect(operation).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });
  });

  describe('specialized retry wrappers', () => {
    it('should use withNASRetry for NAS operations', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce({ code: 'EACCES', message: 'Permission denied' })
        .mockResolvedValue('success');

      const config = {
        maxRetries: 1,
        initialDelayMs: 1,
        jitterMaxMs: 0,
      };

      const result = await withNASRetry(operation, config, 'NAS test');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should use withJenkinsRetry for Jenkins operations', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'Request timeout' })
        .mockResolvedValue('success');

      const config = {
        maxRetries: 1,
        initialDelayMs: 1,
        jitterMaxMs: 0,
      };

      const result = await withJenkinsRetry(operation, config, 'Jenkins test');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('configuration validation', () => {
    it('should use default configuration when none provided', async () => {
      const operation = jest.fn().mockResolvedValue('test');

      const result = await withRetry(operation);

      expect(result).toBe('test');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should merge custom config with defaults', () => {
      const customConfig = { maxRetries: 5 };
      const mergedConfig = { ...DEFAULT_CONFIG, ...customConfig };

      expect(mergedConfig.maxRetries).toBe(5);
      expect(mergedConfig.initialDelayMs).toBe(DEFAULT_CONFIG.initialDelayMs);
    });

    it('should validate default config structure', () => {
      expect(DEFAULT_CONFIG).toHaveProperty('maxRetries');
      expect(DEFAULT_CONFIG).toHaveProperty('initialDelayMs');
      expect(DEFAULT_CONFIG).toHaveProperty('maxDelayMs');
      expect(DEFAULT_CONFIG).toHaveProperty('backoffMultiplier');
      expect(DEFAULT_CONFIG).toHaveProperty('jitterMaxMs');
      expect(DEFAULT_CONFIG).toHaveProperty('retryableErrors');
      expect(Array.isArray(DEFAULT_CONFIG.retryableErrors)).toBe(true);
    });
  });

  describe('error handling edge cases', () => {
    it('should handle null/undefined errors gracefully', () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError({})).toBe(false);
    });

    it('should handle errors without message property', () => {
      const errorWithoutMessage = { code: 'ECONNREFUSED' };
      expect(isRetryableError(errorWithoutMessage)).toBe(true);
    });

    it('should handle errors with empty message', () => {
      const errorWithEmptyMessage = { message: '' };
      expect(isRetryableError(errorWithEmptyMessage)).toBe(false);
    });
  });

  describe('retry mechanism integration', () => {
    it('should handle mixed error types correctly', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('timeout')) // Retryable
        .mockRejectedValueOnce(new Error('Invalid input')); // Non-retryable

      const config = {
        maxRetries: 2,
        initialDelayMs: 1,
        jitterMaxMs: 0,
      };

      await expect(withRetry(operation, config, 'mixed errors'))
        .rejects.toThrow('Invalid input');

      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should respect max retries limit', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('timeout'));

      const config = {
        maxRetries: 3,
        initialDelayMs: 1,
        jitterMaxMs: 0,
      };

      await expect(withRetry(operation, config, 'max retries test'))
        .rejects.toThrow('timeout');

      expect(operation).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });
  });
});
