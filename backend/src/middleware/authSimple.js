const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

/**
 * Simplified Authentication Middleware
 * LDAP + Simple JWT only (no refresh tokens, no session management)
 */

/**
 * 인증 관련 로깅 유틸리티
 */
class AuthLogger {
  static logAuthAttempt(requestId, method, url, ip, userAgent) {
    logger.debug(`[AUTH-${requestId}] Authentication attempt`, {
      method, url, ip: ip || 'unknown', userAgent: userAgent || 'unknown',
    });
  }

  static logTokenExtraction(requestId, source, success, tokenLength, error = null) {
    if (success) {
      logger.debug(`[AUTH-${requestId}] Token extracted from ${source}`, { tokenLength });
    } else {
      logger.warn(`[AUTH-${requestId}] Token extraction failed from ${source}`, { error });
    }
  }

  static logTokenValidation(requestId, success, user = null, error = null, duration = null) {
    if (success) {
      logger.info(`[AUTH-${requestId}] Authentication successful`, {
        username: user.username, userId: user.userId, duration,
      });
    } else {
      logger.warn(`[AUTH-${requestId}] Authentication failed`, { error, duration });
    }
  }

  static logSecurityEvent(requestId, event, details) {
    logger.warn(`[SECURITY-${requestId}] ${event}`, details);
  }
}

/**
 * Simplified JWT Utilities
 */
class SimpleJWTUtils {
  static getSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT secret is not configured');
    }
    return secret;
  }

  static getExpirationTime() {
    return process.env.JWT_EXPIRES_IN || '24h'; // Default to 24 hours
  }

  /**
   * Generate a single JWT token (no refresh token)
   */
  static generateToken(payload) {
    const secret = this.getSecret();
    const expiresIn = this.getExpirationTime();

    return jwt.sign(
      {
        ...payload,
        iat: Math.floor(Date.now() / 1000),
      },
      secret,
      { expiresIn },
    );
  }

  /**
   * Verify JWT token
   */
  static verifyToken(token, requestId = 'unknown') {
    const secret = this.getSecret();
    const startTime = Date.now();

    try {
      const decoded = jwt.verify(token, secret);
      const verifyDuration = Date.now() - startTime;

      logger.debug(`[AUTH-${requestId}] Token verification successful`, {
        userId: decoded.userId,
        username: decoded.username,
        duration: verifyDuration,
        expiresAt: new Date(decoded.exp * 1000).toISOString(),
      });

      return decoded;
    } catch (error) {
      const verifyDuration = Date.now() - startTime;
      let errorType = 'UNKNOWN';

      if (error.name === 'TokenExpiredError') {
        errorType = 'EXPIRED';
      } else if (error.name === 'JsonWebTokenError') {
        errorType = 'MALFORMED';
      } else if (error.name === 'NotBeforeError') {
        errorType = 'NOT_ACTIVE';
      }

      logger.error('JWT verification failed', {
        requestId, verifyDuration, errorType, errorName: error.name,
        errorMessage: error.message, tokenLength: token?.length,
      });

      throw new Error(`Invalid token [${errorType}]: ${error.message}`);
    }
  }

  /**
   * Extract token from Bearer header
   */
  static extractTokenFromHeader(authHeader) {
    if (!authHeader) {
      throw new Error('Authorization header missing');
    }

    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      logger.warn('Invalid authorization header format', { authHeader });
      throw new Error('Invalid authorization header format');
    }

    return parts[1];
  }
}

/**
 * Simplified authentication middleware
 * Only validates JWT tokens - no session management
 */
const authenticateToken = async (req, res, next) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const startTime = Date.now();

  try {
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token;

    let token;
    let tokenSource = 'none';

    AuthLogger.logAuthAttempt(
      requestId,
      req.method,
      req.originalUrl,
      req.ip,
      req.get('User-Agent'),
    );

    // Try to extract token from Authorization header first
    if (authHeader) {
      try {
        token = SimpleJWTUtils.extractTokenFromHeader(authHeader);
        tokenSource = 'header';
        AuthLogger.logTokenExtraction(requestId, 'header', true, token.length);
      } catch (error) {
        AuthLogger.logTokenExtraction(requestId, 'header', false, 0, error.message);
      }
    }

    // Fallback to query parameter (for WebSocket connections)
    if (!token && tokenFromQuery) {
      token = tokenFromQuery;
      tokenSource = 'query';
      AuthLogger.logTokenExtraction(requestId, 'query', true, token.length);
    }

    if (!token) {
      logger.warn(`[AUTH-${requestId}] No token found - AuthHeader: ${authHeader ? 'present' : 'missing'}, Query: ${tokenFromQuery ? 'present' : 'missing'}`);
      AuthLogger.logTokenExtraction(requestId, tokenSource, false, 0, 'No token found');
      AuthLogger.logSecurityEvent(requestId, 'AUTH_FAILURE', { reason: 'NO_TOKEN' });
      return res.status(401).json(createErrorResponse('Authentication required', 'AUTH_REQUIRED'));
    }

    // Verify the token
    logger.info(`[AUTH-${requestId}] Token found from ${tokenSource}, length: ${token?.length}, first 10 chars: ${token?.substring(0, 10)}...`);
    const decoded = SimpleJWTUtils.verifyToken(token, requestId);

    // Set user information on request object
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      fullName: decoded.fullName,
      department: decoded.department,
      isActive: decoded.isActive,
    };

    const authDuration = Date.now() - startTime;
    AuthLogger.logTokenValidation(requestId, true, req.user, null, authDuration);

    next();
  } catch (error) {
    const authDuration = Date.now() - startTime;

    logger.error('Authentication failed', error.message);
    AuthLogger.logTokenValidation(requestId, false, null, error.message, authDuration);
    AuthLogger.logSecurityEvent(requestId, 'AUTH_FAILURE', { error: error.message });

    return res.status(401).json(createErrorResponse('Authentication failed', 'INVALID_TOKEN'));
  }
};

/**
 * Audit logging for security events
 */
const auditLog = (req, action, details = {}) => {
  const logEntry = {
    requestId: req.requestId || 'unknown',
    userId: req.user?.userId || null,
    username: req.user?.username || 'anonymous',
    action,
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    details,
  };

  logger.info('AUDIT', logEntry);
};

/**
 * Create standardized error response
 */
const createErrorResponse = (message, code = 'UNKNOWN_ERROR', details = {}) => {
  return {
    success: false,
    error: {
      code,
      message,
      timestamp: new Date().toISOString(),
      ...details,
    },
  };
};

module.exports = {
  SimpleJWTUtils,
  AuthLogger,
  authenticateToken,
  auditLog,
  createErrorResponse,
};
