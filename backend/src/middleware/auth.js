const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const crypto = require('crypto');

/**
 * 인증 관련 로깅 유틸리티
 */
class AuthLogger {
  static logAuthAttempt(requestId, method, url, ip, userAgent) {
    console.log(`[AUTH-${requestId}] =================================`);
    console.log(`[AUTH-${requestId}] NEW REQUEST: ${method} ${url}`);
    console.log(`[AUTH-${requestId}] Client IP: ${ip || 'unknown'}`);
    console.log(`[AUTH-${requestId}] User-Agent: ${userAgent || 'unknown'}`);
    console.log(`[AUTH-${requestId}] Timestamp: ${new Date().toISOString()}`);
  }

  static logTokenSource(requestId, hasHeader, hasQuery) {
    console.log(`[AUTH-${requestId}] Token availability - Header: ${hasHeader ? 'YES' : 'NO'}, Query: ${hasQuery ? 'YES' : 'NO'}`);
  }

  static logTokenExtraction(requestId, source, success, tokenLength, error = null) {
    if (success) {
      console.log(`[AUTH-${requestId}] ✓ Token extracted from ${source}, length: ${tokenLength}`);
    } else {
      console.log(`[AUTH-${requestId}] ✗ Token extraction from ${source} failed: ${error}`);
    }
  }

  static logTokenValidation(requestId, success, user = null, error = null, duration = null) {
    if (success) {
      console.log(`[AUTH-${requestId}] ✓ Token validation SUCCESS in ${duration}ms`);
      console.log(`[AUTH-${requestId}] User authenticated: ${user.username} (ID: ${user.userId})`);
      console.log(`[AUTH-${requestId}] User details: ${user.email}, ${user.department}`);
    } else {
      console.log(`[AUTH-${requestId}] ✗ Token validation FAILED: ${error}`);
    }
  }

  static logAuthResult(requestId, success, duration, username = null) {
    const status = success ? 'SUCCESS' : 'FAILURE';
    const userInfo = username ? ` for user: ${username}` : '';
    console.log(`[AUTH-${requestId}] =================================`);
    console.log(`[AUTH-${requestId}] FINAL RESULT: ${status} in ${duration}ms${userInfo}`);
    console.log(`[AUTH-${requestId}] =================================`);
  }

  static logSecurityEvent(requestId, event, details) {
    console.warn(`[SECURITY-${requestId}] ${event}: ${details}`);
  }
}

/**
 * JWT 토큰 유틸리티 함수들
 */
class JWTUtils {
  static getSecrets() {
    const accessSecret = process.env.JWT_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;

    if (!accessSecret || !refreshSecret) {
      throw new Error('JWT secrets are not configured');
    }

    return { accessSecret, refreshSecret };
  }

  static getExpirationTimes() {
    return {
      accessToken: process.env.JWT_EXPIRES_IN || '1h',
      refreshToken: process.env.JWT_REFRESH_EXPIRES_IN || '8h',
    };
  }

  /**
   * Access 토큰 생성
   */
  static generateAccessToken(payload) {
    const { accessSecret } = this.getSecrets();
    const { accessToken: expiresIn } = this.getExpirationTimes();

    return jwt.sign(
      {
        ...payload,
        type: 'access',
        iat: Math.floor(Date.now() / 1000),
      },
      accessSecret,
      { expiresIn },
    );
  }

  /**
   * Refresh 토큰 생성
   */
  static generateRefreshToken(payload) {
    const { refreshSecret } = this.getSecrets();
    const { refreshToken: expiresIn } = this.getExpirationTimes();

    return jwt.sign(
      {
        ...payload,
        type: 'refresh',
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomUUID(), // JWT ID for revocation
      },
      refreshSecret,
      { expiresIn },
    );
  }

  /**
   * Access 토큰 검증
   */
  static verifyAccessToken(token, requestId = null) {
    const verifyStartTime = Date.now();
    const { accessSecret } = this.getSecrets();
    const logPrefix = requestId ? `[AUTH-${requestId}]` : '[JWT]';
    
    try {
      console.log(`${logPrefix} Starting token verification...`);
      console.log(`${logPrefix} Secret configured: ${accessSecret ? 'YES' : 'NO'}, length: ${accessSecret ? accessSecret.length : 'null'}`);
      console.log(`${logPrefix} Token length: ${token ? token.length : 'null'}`);
      console.log(`${logPrefix} Token preview: ${token ? token.substring(0, 20) + '...' : 'null'}`);
      
      const decoded = jwt.verify(token, accessSecret);
      const verifyDuration = Date.now() - verifyStartTime;
      
      console.log(`${logPrefix} Token structure validation...`);
      if (decoded.type !== 'access') {
        throw new Error(`Invalid token type: ${decoded.type}, expected: access`);
      }
      
      const now = Math.floor(Date.now() / 1000);
      const tokenAge = now - decoded.iat;
      const expiresIn = decoded.exp - now;
      
      console.log(`${logPrefix} ✓ Token verification completed in ${verifyDuration}ms`);
      console.log(`${logPrefix} Token age: ${tokenAge}s, expires in: ${expiresIn}s`);
      console.log(`${logPrefix} Token issued at: ${new Date(decoded.iat * 1000).toISOString()}`);
      console.log(`${logPrefix} Token expires at: ${new Date(decoded.exp * 1000).toISOString()}`);
      
      return decoded;
    } catch (error) {
      const verifyDuration = Date.now() - verifyStartTime;
      console.error(`${logPrefix} JWT verification FAILED in ${verifyDuration}ms: ${error.message}`);
      console.error(`${logPrefix} Error type: ${error.name}`);
      console.error(`${logPrefix} Failed token preview: ${token ? token.substring(0, 50) + '...' : 'null'}`);
      
      // JWT 라이브러리 에러를 더 구체적으로 분류
      let errorType = 'UNKNOWN';
      if (error.name === 'TokenExpiredError') {
        errorType = 'EXPIRED';
        console.error(`${logPrefix} Token expired at: ${error.expiredAt}`);
      } else if (error.name === 'JsonWebTokenError') {
        errorType = 'MALFORMED';
      } else if (error.name === 'NotBeforeError') {
        errorType = 'NOT_ACTIVE';
      }
      
      throw new Error(`Invalid access token [${errorType}]: ${error.message}`);
    }
  }

  /**
   * Refresh 토큰 검증
   */
  static verifyRefreshToken(token) {
    const { refreshSecret } = this.getSecrets();
    try {
      const decoded = jwt.verify(token, refreshSecret);
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch (error) {
      throw new Error(`Invalid refresh token: ${error.message}`);
    }
  }

  /**
   * 토큰에서 Bearer 접두사 제거
   */
  static extractTokenFromHeader(authHeader) {
    if (!authHeader) {
      throw new Error('Authorization header missing');
    }

    console.log('Full auth header:', JSON.stringify(authHeader));
    const parts = authHeader.split(' ');
    console.log('Header parts:', parts.length, JSON.stringify(parts));
    
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      console.error('Invalid header format. Expected "Bearer <token>", got:', authHeader);
      throw new Error('Invalid authorization header format');
    }

    console.log('Extracted token preview:', parts[1].substring(0, 20) + '...');
    return parts[1];
  }
}

/**
 * 세션 관리 클래스
 */
class SessionManager {
  /**
   * 새 세션 생성
   */
  static async createSession(userId, refreshToken, userAgent, ipAddress) {
    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const expirationTime = this.calculateExpirationTime();

    const insertQuery = `
      INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at, user_agent, ip_address)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;

    const result = await query(insertQuery, [
      userId,
      refreshTokenHash,
      expirationTime,
      userAgent,
      ipAddress,
    ]);

    return result.rows[0].id;
  }

  /**
   * 세션 검증 및 갱신
   */
  static async validateAndUpdateSession(refreshToken, userAgent, ipAddress) {
    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    // 세션 조회 및 사용자 정보 함께 가져오기
    const sessionQuery = `
      SELECT us.*, u.username, u.email, u.full_name, u.department, u.is_active
      FROM user_sessions us
      JOIN users u ON us.user_id = u.id
      WHERE us.refresh_token_hash = $1
        AND us.expires_at > CURRENT_TIMESTAMP
        AND u.is_active = true
    `;

    const result = await query(sessionQuery, [refreshTokenHash]);

    if (result.rows.length === 0) {
      throw new Error('Invalid or expired refresh token');
    }

    const session = result.rows[0];

    // 세션 정보 업데이트
    await query(
      'UPDATE user_sessions SET last_accessed = CURRENT_TIMESTAMP WHERE id = $1',
      [session.id],
    );

    // 사용자 최종 로그인 시간 업데이트
    await query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [session.user_id],
    );

    return {
      userId: session.user_id,
      username: session.username,
      email: session.email,
      fullName: session.full_name,
      department: session.department,
    };
  }

  /**
   * 세션 삭제 (로그아웃)
   */
  static async deleteSession(refreshToken) {
    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const result = await query(
      'DELETE FROM user_sessions WHERE refresh_token_hash = $1',
      [refreshTokenHash],
    );

    return result.rowCount > 0;
  }

  /**
   * 사용자의 모든 세션 삭제
   */
  static async deleteAllUserSessions(userId) {
    const result = await query(
      'DELETE FROM user_sessions WHERE user_id = $1',
      [userId],
    );

    return result.rowCount;
  }

  /**
   * 만료된 세션 정리
   */
  static async cleanupExpiredSessions() {
    const result = await query(
      'DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP',
    );

    console.log(`Cleaned up ${result.rowCount} expired sessions`);
    return result.rowCount;
  }

  /**
   * 토큰 만료 시간 계산
   */
  static calculateExpirationTime() {
    const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '8h';
    let milliseconds;

    if (expiresIn.endsWith('h')) {
      milliseconds = parseInt(expiresIn) * 60 * 60 * 1000;
    } else if (expiresIn.endsWith('m')) {
      milliseconds = parseInt(expiresIn) * 60 * 1000;
    } else if (expiresIn.endsWith('s')) {
      milliseconds = parseInt(expiresIn) * 1000;
    } else {
      milliseconds = parseInt(expiresIn) * 1000; // 기본: 초
    }

    return new Date(Date.now() + milliseconds);
  }
}

/**
 * JWT 인증 미들웨어
 */
function authenticateToken(req, res, next) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  let tokenValidationStart;
  
  try {
    // 요청 정보 로깅
    AuthLogger.logAuthAttempt(
      requestId, 
      req.method, 
      req.originalUrl, 
      req.ip || req.connection.remoteAddress, 
      req.get('User-Agent')
    );
    
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token;
    
    // 토큰 소스 가용성 로깅
    AuthLogger.logTokenSource(requestId, !!authHeader, !!queryToken);
    
    let token;
    let tokenSource = 'none';
    
    // 1. 헤더에서 토큰 추출 시도
    if (authHeader) {
      try {
        token = JWTUtils.extractTokenFromHeader(authHeader);
        tokenSource = 'header';
        AuthLogger.logTokenExtraction(requestId, 'header', true, token.length);
      } catch (headerError) {
        AuthLogger.logTokenExtraction(requestId, 'header', false, null, headerError.message);
        AuthLogger.logSecurityEvent(requestId, 'MALFORMED_AUTH_HEADER', headerError.message);
      }
    }
    
    // 2. 헤더에서 실패했거나 없으면 쿼리 파라미터에서 시도
    if (!token && queryToken) {
      token = queryToken;
      tokenSource = 'query';
      AuthLogger.logTokenExtraction(requestId, 'query', true, token.length);
      
      // 쿼리 파라미터 사용 보안 이벤트 기록
      AuthLogger.logSecurityEvent(requestId, 'QUERY_PARAM_AUTH', 'Token provided via query parameter');
    }
    
    // 3. 토큰이 없으면 에러
    if (!token) {
      AuthLogger.logTokenExtraction(requestId, 'none', false, null, 'No token in header or query parameter');
      throw new Error('No token provided in header or query parameter');
    }

    console.log(`[AUTH-${requestId}] Token source: ${tokenSource}, preview: ${token.substring(0, 20)}...`);

    // 토큰 검증 시작
    tokenValidationStart = Date.now();
    const decoded = JWTUtils.verifyAccessToken(token, requestId);
    const validationDuration = Date.now() - tokenValidationStart;
    
    // 사용자 정보 로깅
    AuthLogger.logTokenValidation(requestId, true, decoded, null, validationDuration);

    // 사용자 정보를 request 객체에 추가
    req.user = {
      id: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      fullName: decoded.fullName,
      department: decoded.department,
    };
    
    // 추가 보안 검증 로깅
    const now = Math.floor(Date.now() / 1000);
    const tokenAge = now - decoded.iat;
    const remainingTime = decoded.exp - now;
    
    if (remainingTime < 300) { // 5분 미만 남은 토큰
      AuthLogger.logSecurityEvent(requestId, 'TOKEN_NEAR_EXPIRY', `Token expires in ${remainingTime}s`);
    }
    
    if (tokenAge > 3600) { // 1시간 이상 된 토큰
      AuthLogger.logSecurityEvent(requestId, 'OLD_TOKEN_USAGE', `Token age: ${tokenAge}s`);
    }
    
    // 인증 성공 로그
    const totalDuration = Date.now() - startTime;
    AuthLogger.logAuthResult(requestId, true, totalDuration, decoded.username);
    
    // 성능 메트릭 기록
    AuthPerformanceMonitor.recordAuth(true, totalDuration, tokenSource);

    next();
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    const validationDuration = tokenValidationStart ? Date.now() - tokenValidationStart : null;
    
    // 실패 로깅
    AuthLogger.logTokenValidation(requestId, false, null, error.message, validationDuration);
    AuthLogger.logAuthResult(requestId, false, totalDuration);
    
    // 보안 이벤트로 기록
    AuthLogger.logSecurityEvent(requestId, 'AUTH_FAILURE', error.message);
    
    // 에러 타입 분류
    let errorType = 'UNKNOWN';
    if (error.message.includes('[EXPIRED]')) errorType = 'EXPIRED';
    else if (error.message.includes('[MALFORMED]')) errorType = 'MALFORMED';
    else if (error.message.includes('No token provided')) errorType = 'MISSING';
    
    // 성능 메트릭 기록
    AuthPerformanceMonitor.recordAuth(false, totalDuration, tokenSource, errorType);
    
    console.error(`[AUTH-${requestId}] Authentication failed: ${error.message}`);
    return res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_INVALID',
        message: 'Invalid or expired token',
      },
    });
  }
}

/**
 * 선택적 인증 미들웨어 (토큰이 있으면 검증, 없어도 통과)
 */
function optionalAuthentication(req, res, next) {
  const requestId = Math.random().toString(36).substr(2, 9);
  const startTime = Date.now();
  
  try {
    console.log(`[OPT-AUTH-${requestId}] Optional authentication started for ${req.method} ${req.originalUrl}`);
    
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token;
    
    if (!authHeader && !queryToken) {
      console.log(`[OPT-AUTH-${requestId}] No auth token provided, proceeding without authentication`);
      return next();
    }

    let token;
    if (authHeader) {
      token = JWTUtils.extractTokenFromHeader(authHeader);
      console.log(`[OPT-AUTH-${requestId}] Token extracted from header`);
    } else if (queryToken) {
      token = queryToken;
      console.log(`[OPT-AUTH-${requestId}] Token extracted from query parameter`);
    }

    const decoded = JWTUtils.verifyAccessToken(token, requestId);

    req.user = {
      id: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      fullName: decoded.fullName,
      department: decoded.department,
    };

    const duration = Date.now() - startTime;
    console.log(`[OPT-AUTH-${requestId}] ✓ Optional authentication successful in ${duration}ms for user: ${decoded.username}`);
    next();
  } catch (error) {
    const duration = Date.now() - startTime;
    // 토큰이 유효하지 않아도 계속 진행
    console.warn(`[OPT-AUTH-${requestId}] Optional authentication failed in ${duration}ms: ${error.message}`);
    console.log(`[OPT-AUTH-${requestId}] Proceeding without authentication`);
    next();
  }
}

/**
 * 인증 성능 모니터링 유틸리티
 */
class AuthPerformanceMonitor {
  static metrics = {
    totalRequests: 0,
    successfulAuths: 0,
    failedAuths: 0,
    avgResponseTime: 0,
    slowRequests: 0, // >100ms
    tokenSources: { header: 0, query: 0 },
    errorTypes: new Map()
  };

  static recordAuth(success, duration, tokenSource, errorType = null) {
    this.metrics.totalRequests++;
    
    if (success) {
      this.metrics.successfulAuths++;
    } else {
      this.metrics.failedAuths++;
      if (errorType) {
        const count = this.metrics.errorTypes.get(errorType) || 0;
        this.metrics.errorTypes.set(errorType, count + 1);
      }
    }
    
    // 평균 응답 시간 업데이트 (이동 평균)
    this.metrics.avgResponseTime = (this.metrics.avgResponseTime * (this.metrics.totalRequests - 1) + duration) / this.metrics.totalRequests;
    
    if (duration > 100) {
      this.metrics.slowRequests++;
    }
    
    if (tokenSource) {
      this.metrics.tokenSources[tokenSource]++;
    }
  }

  static getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRequests > 0 ? (this.metrics.successfulAuths / this.metrics.totalRequests) * 100 : 0,
      errorTypes: Object.fromEntries(this.metrics.errorTypes)
    };
  }

  static logMetrics() {
    const metrics = this.getMetrics();
    console.log('=== AUTH PERFORMANCE METRICS ===');
    console.log(`Total Requests: ${metrics.totalRequests}`);
    console.log(`Success Rate: ${metrics.successRate.toFixed(2)}%`);
    console.log(`Average Response Time: ${metrics.avgResponseTime.toFixed(2)}ms`);
    console.log(`Slow Requests (>100ms): ${metrics.slowRequests}`);
    console.log(`Token Sources - Header: ${metrics.tokenSources.header}, Query: ${metrics.tokenSources.query}`);
    console.log(`Error Types:`, metrics.errorTypes);
    console.log('================================');
  }
}

/**
 * 감사 로그 미들웨어
 */
function auditLog(action, resourceType = null) {
  return (req, res, next) => {
    // 원본 json 메서드 저장
    const originalJson = res.json;

    // json 응답을 가로채서 감사 로그 생성
    res.json = function(data) {
      // 성공적인 응답에 대해서만 로그 생성
      if (res.statusCode < 400 && req.user) {
        const logData = {
          user_id: req.user.id,
          username: req.user.username,
          action,
          resource_type: resourceType,
          resource_id: req.params.id || null,
          ip_address: req.ip || req.connection.remoteAddress,
          user_agent: req.get('User-Agent'),
        };

        // 비동기로 감사 로그 생성 (응답 지연 방지)
        process.nextTick(async () => {
          try {
            await query(
              `INSERT INTO audit_logs (user_id, username, action, resource_type, resource_id, ip_address, user_agent)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                logData.user_id,
                logData.username,
                logData.action,
                logData.resource_type,
                logData.resource_id,
                logData.ip_address,
                logData.user_agent,
              ],
            );
          } catch (error) {
            console.error('Failed to create audit log:', error.message);
          }
        });
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * 에러 응답 헬퍼
 */
function createErrorResponse(code, message, statusCode = 400) {
  return {
    success: false,
    error: {
      code,
      message,
    },
  };
}

module.exports = {
  JWTUtils,
  SessionManager,
  AuthLogger,
  AuthPerformanceMonitor,
  authenticateToken,
  optionalAuthentication,
  auditLog,
  createErrorResponse,
};
