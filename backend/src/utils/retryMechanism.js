const logger = require('../config/logger');

/**
 * Retry mechanism with exponential backoff
 * NAS 작업 및 Jenkins API 호출의 안정성을 위한 재시도 메커니즘
 */

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitterMaxMs: 100,
  retryableErrors: [
    'ECONNREFUSED',
    'ENOTFOUND',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'EAI_AGAIN',
  ],
};

/**
 * Calculate delay with exponential backoff and jitter
 * @param {number} attempt - Current attempt number (0-based)
 * @param {Object} config - Retry configuration
 * @returns {number} Delay in milliseconds
 */
function calculateDelay(attempt, config = DEFAULT_CONFIG) {
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter to prevent thundering herd
  const jitter = Math.random() * config.jitterMaxMs;

  return Math.floor(cappedDelay + jitter);
}

/**
 * Check if error is retryable
 * @param {Error} error - Error to check
 * @param {Object} config - Retry configuration
 * @returns {boolean} True if error is retryable
 */
function isRetryableError(error, config = DEFAULT_CONFIG) {
  if (!error) return false;

  // Check error code
  if (error.code && config.retryableErrors.includes(error.code)) {
    return true;
  }

  // Check error message for common patterns
  const errorMessage = error.message?.toLowerCase() || '';

  // Check against config retryableErrors (for custom error messages)
  const configPatterns = config.retryableErrors.filter(pattern => typeof pattern === 'string');
  if (configPatterns.some(pattern => errorMessage.includes(pattern.toLowerCase()))) {
    return true;
  }
  const retryablePatterns = [
    'timeout',
    'connection refused',
    'network error',
    'socket hang up',
    'econnreset',
    'enotfound',
    'ehostunreach',
  ];

  return retryablePatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 * @param {Function} operation - Async operation to retry
 * @param {Object} config - Retry configuration
 * @param {string} operationName - Name for logging purposes
 * @returns {Promise} Promise resolving to operation result
 */
async function withRetry(operation, config = {}, operationName = 'operation') {
  const retryConfig = { ...DEFAULT_CONFIG, ...config };
  let lastError;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const startTime = Date.now();
      const result = await operation();
      const duration = Date.now() - startTime;

      if (attempt > 0) {
        logger.info(`${operationName} succeeded on attempt ${attempt + 1} after ${duration}ms`);
      }

      return result;
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt === retryConfig.maxRetries) {
        logger.error(`${operationName} failed after ${attempt + 1} attempts: ${error.message}`);
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error, retryConfig)) {
        logger.warn(`${operationName} failed with non-retryable error: ${error.message}`);
        throw error;
      }

      // Calculate delay and log retry attempt
      const delay = calculateDelay(attempt, retryConfig);
      logger.warn(`${operationName} failed on attempt ${attempt + 1}, retrying in ${delay}ms: ${error.message}`);

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Retry wrapper specifically for NAS operations
 * @param {Function} nasOperation - NAS operation function
 * @param {Object} customConfig - Custom retry configuration
 * @param {string} operationName - Operation name for logging
 * @returns {Promise} Promise resolving to operation result
 */
async function withNASRetry(nasOperation, customConfig = {}, operationName = 'NAS operation') {
  const nasConfig = {
    maxRetries: 3,
    initialDelayMs: 1500,
    maxDelayMs: 15000,
    backoffMultiplier: 2.5,
    jitterMaxMs: 200,
    retryableErrors: [
      ...DEFAULT_CONFIG.retryableErrors,
      'EACCES',  // Permission denied (temporary)
      'EBUSY',   // Resource busy
      'EMFILE',  // Too many open files
      'ENFILE',  // File table overflow
    ],
    ...customConfig,
  };

  return withRetry(nasOperation, nasConfig, operationName);
}

/**
 * Retry wrapper specifically for Jenkins API operations
 * @param {Function} jenkinsOperation - Jenkins API operation function
 * @param {Object} customConfig - Custom retry configuration
 * @param {string} operationName - Operation name for logging
 * @returns {Promise} Promise resolving to operation result
 */
async function withJenkinsRetry(jenkinsOperation, customConfig = {}, operationName = 'Jenkins API operation') {
  const jenkinsConfig = {
    maxRetries: 2,
    initialDelayMs: 1000,
    maxDelayMs: 8000,
    backoffMultiplier: 2,
    jitterMaxMs: 100,
    retryableErrors: [
      ...DEFAULT_CONFIG.retryableErrors,
      'ECONNABORTED', // Request timeout
    ],
    ...customConfig,
  };

  return withRetry(jenkinsOperation, jenkinsConfig, operationName);
}

/**
 * Retry wrapper for database operations
 * @param {Function} dbOperation - Database operation function
 * @param {Object} customConfig - Custom retry configuration
 * @param {string} operationName - Operation name for logging
 * @returns {Promise} Promise resolving to operation result
 */
async function withDatabaseRetry(dbOperation, customConfig = {}, operationName = 'Database operation') {
  const dbConfig = {
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterMaxMs: 50,
    retryableErrors: [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ECONNRESET',
      'ETIMEDOUT',
      'connection terminated',
      'server closed the connection',
    ],
    ...customConfig,
  };

  return withRetry(dbOperation, dbConfig, operationName);
}

/**
 * Create a retry wrapper with custom configuration
 * @param {Object} config - Retry configuration
 * @returns {Function} Configured retry wrapper function
 */
function createRetryWrapper(config) {
  return (operation, operationName = 'operation') => {
    return withRetry(operation, config, operationName);
  };
}

module.exports = {
  withRetry,
  withNASRetry,
  withJenkinsRetry,
  withDatabaseRetry,
  createRetryWrapper,
  calculateDelay,
  isRetryableError,
  sleep,
  DEFAULT_CONFIG,
};
