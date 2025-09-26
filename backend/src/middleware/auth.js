const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const crypto = require('crypto');

/**
 * JWT 토큰 유틸리티 함수들
 */
class JWTUtils {
  static getSecrets() {
    const accessSecret = process.env.JWT_SECRET;
    const refreshSecret = process.env.REFRESH_TOKEN_SECRET;

    if (!accessSecret || !refreshSecret) {
      throw new Error('JWT secrets are not configured');
    }

    return { accessSecret, refreshSecret };
  }

  static getExpirationTimes() {
    return {
      accessToken: process.env.JWT_EXPIRES_IN || '1h',
      refreshToken: process.env.REFRESH_TOKEN_EXPIRES_IN || '8h',
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
      { expiresIn }
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
      { expiresIn }
    );
  }

  /**
   * Access 토큰 검증
   */
  static verifyAccessToken(token) {
    const { accessSecret } = this.getSecrets();
    try {
      const decoded = jwt.verify(token, accessSecret);
      if (decoded.type !== 'access') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch (error) {
      throw new Error(`Invalid access token: ${error.message}`);
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

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new Error('Invalid authorization header format');
    }

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
      [session.id]
    );

    // 사용자 최종 로그인 시간 업데이트
    await query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [session.user_id]
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
      [refreshTokenHash]
    );

    return result.rowCount > 0;
  }

  /**
   * 사용자의 모든 세션 삭제
   */
  static async deleteAllUserSessions(userId) {
    const result = await query(
      'DELETE FROM user_sessions WHERE user_id = $1',
      [userId]
    );

    return result.rowCount;
  }

  /**
   * 만료된 세션 정리
   */
  static async cleanupExpiredSessions() {
    const result = await query(
      'DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP'
    );

    console.log(`Cleaned up ${result.rowCount} expired sessions`);
    return result.rowCount;
  }

  /**
   * 토큰 만료 시간 계산
   */
  static calculateExpirationTime() {
    const expiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '8h';
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
  try {
    const authHeader = req.headers.authorization;
    const token = JWTUtils.extractTokenFromHeader(authHeader);

    const decoded = JWTUtils.verifyAccessToken(token);

    // 사용자 정보를 request 객체에 추가
    req.user = {
      id: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      fullName: decoded.fullName,
      department: decoded.department,
    };

    next();
  } catch (error) {
    console.error('Token authentication failed:', error.message);
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
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return next();
    }

    const token = JWTUtils.extractTokenFromHeader(authHeader);
    const decoded = JWTUtils.verifyAccessToken(token);

    req.user = {
      id: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      fullName: decoded.fullName,
      department: decoded.department,
    };

    next();
  } catch (error) {
    // 토큰이 유효하지 않아도 계속 진행
    console.warn('Optional token authentication failed:', error.message);
    next();
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
              ]
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
  authenticateToken,
  optionalAuthentication,
  auditLog,
  createErrorResponse,
};