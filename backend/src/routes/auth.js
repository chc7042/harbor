const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { getLDAPService } = require('../services/ldapService');
const { JWTUtils, SessionManager, authenticateToken, auditLog, createErrorResponse } = require('../middleware/auth');

const router = express.Router();

// 로그인 시도 제한 (5분간 5회)
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5분
  max: 5,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_ATTEMPTS',
      message: '너무 많은 로그인 시도입니다. 5분 후에 다시 시도해주세요.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 토큰 갱신 제한 (1분간 10회)
const refreshLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 10,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REFRESH_ATTEMPTS',
      message: '토큰 갱신 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    },
  },
});

// 입력 값 검증 규칙
const loginValidation = [
  body('username')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('사용자명은 1-100자 사이여야 합니다')
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage('사용자명에 유효하지 않은 문자가 포함되어 있습니다'),

  body('password')
    .isLength({ min: 1, max: 255 })
    .withMessage('비밀번호를 입력해주세요'),
];

const refreshTokenValidation = [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh 토큰이 필요합니다')
    .isLength({ max: 1000 })
    .withMessage('유효하지 않은 토큰 형식입니다'),
];

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: 사용자 로그인
 *     description: LDAP 서버를 통한 사용자 인증 및 JWT 토큰 발급
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             username: "nicolas.choi"
 *             password: "password123"
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: 입력값 검증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: 로그인 시도 횟수 초과
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: LDAP 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', loginLimiter, loginValidation, async (req, res) => {
  try {
    // 입력 값 검증
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse(
        'VALIDATION_ERROR',
        errors.array()[0].msg,
      ));
    }

    const { username, password } = req.body;
    const userAgent = req.get('User-Agent') || 'Unknown';
    const ipAddress = req.ip || req.connection.remoteAddress;

    console.log(`Login attempt for user: ${username} from ${ipAddress}`);

    // LDAP 인증
    const ldapService = getLDAPService();
    const user = await ldapService.authenticateUser(username, password);

    // JWT 토큰 생성
    const tokenPayload = {
      userId: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      department: user.department,
    };

    const accessToken = JWTUtils.generateAccessToken(tokenPayload);
    const refreshToken = JWTUtils.generateRefreshToken(tokenPayload);

    // 세션 생성 (개발환경에서는 DB 오류 무시)
    let sessionId = 'dev-session-' + Date.now();
    try {
      sessionId = await SessionManager.createSession(
        user.id,
        refreshToken,
        userAgent,
        ipAddress,
      );
    } catch (dbError) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('데이터베이스 세션 생성 실패 (개발환경에서 무시):', dbError.message);
      } else {
        throw dbError;
      }
    }

    // 감사 로그 생성 (개발환경에서는 DB 오류 무시)
    try {
      const auditLogQuery = `
        INSERT INTO audit_logs (user_id, username, action, ip_address, user_agent)
        VALUES ($1, $2, 'login', $3, $4)
      `;

      const { query } = require('../config/database');
      await query(auditLogQuery, [user.id, user.username, ipAddress, userAgent]);
    } catch (auditError) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('감사 로그 생성 실패 (개발환경에서 무시):', auditError.message);
      } else {
        throw auditError;
      }
    }

    console.log(`User ${username} logged in successfully`);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.full_name,
          department: user.department,
        },
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: JWTUtils.getExpirationTimes().accessToken,
        },
        session: {
          id: sessionId,
        },
      },
    });

  } catch (error) {
    console.error('Login failed:', error.message);

    // 구체적인 에러 메시지 분류
    let errorCode = 'LOGIN_FAILED';
    let statusCode = 401;

    if (error.message.includes('not found')) {
      errorCode = 'USER_NOT_FOUND';
    } else if (error.message.includes('Invalid username or password')) {
      errorCode = 'INVALID_CREDENTIALS';
    } else if (error.message.includes('does not have access')) {
      errorCode = 'ACCESS_DENIED';
    } else if (error.message.includes('LDAP')) {
      errorCode = 'LDAP_ERROR';
      statusCode = 503;
    }

    res.status(statusCode).json(createErrorResponse(
      errorCode,
      error.message,
    ));
  }
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Access 토큰 갱신
 *     description: Refresh 토큰을 사용하여 새로운 Access 토큰 발급
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh 토큰
 *                 example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     responses:
 *       200:
 *         description: 토큰 갱신 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       description: 새로운 Access 토큰
 *                     expiresIn:
 *                       type: integer
 *                       description: 토큰 만료 시간 (초)
 *       401:
 *         description: 토큰이 유효하지 않거나 만료됨
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: 토큰 갱신 요청 횟수 초과
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/refresh', refreshLimiter, refreshTokenValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse(
        'VALIDATION_ERROR',
        errors.array()[0].msg,
      ));
    }

    const { refreshToken } = req.body;
    const userAgent = req.get('User-Agent') || 'Unknown';
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Refresh 토큰 검증 및 JWT 디코딩
    const decoded = JWTUtils.verifyRefreshToken(refreshToken);

    // 세션 검증 및 사용자 정보 조회
    const user = await SessionManager.validateAndUpdateSession(
      refreshToken,
      userAgent,
      ipAddress,
    );

    // 새 Access 토큰 생성
    const tokenPayload = {
      userId: user.userId,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      department: user.department,
    };

    const newAccessToken = JWTUtils.generateAccessToken(tokenPayload);

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        expiresIn: JWTUtils.getExpirationTimes().accessToken,
      },
    });

  } catch (error) {
    console.error('Token refresh failed:', error.message);

    let errorCode = 'TOKEN_REFRESH_FAILED';
    const statusCode = 401;

    if (error.message.includes('Invalid or expired')) {
      errorCode = 'TOKEN_EXPIRED';
    } else if (error.message.includes('Invalid token')) {
      errorCode = 'TOKEN_INVALID';
    }

    res.status(statusCode).json(createErrorResponse(
      errorCode,
      '토큰 갱신에 실패했습니다. 다시 로그인해주세요.',
    ));
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: 사용자 로그아웃
 *     description: 현재 세션을 종료하고 토큰을 무효화
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: 특정 세션만 삭제할 Refresh 토큰 (선택사항)
 *     responses:
 *       200:
 *         description: 로그아웃 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "성공적으로 로그아웃되었습니다."
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/logout', authenticateToken, auditLog('logout'), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = JWTUtils.extractTokenFromHeader(authHeader);

    // Access 토큰에서 정보 추출
    const decoded = JWTUtils.verifyAccessToken(accessToken);

    // Refresh 토큰이 제공된 경우 해당 세션만 삭제
    if (req.body.refreshToken) {
      const deleted = await SessionManager.deleteSession(req.body.refreshToken);
      if (deleted) {
        console.log(`Session deleted for user: ${decoded.username}`);
      }
    } else {
      // 모든 세션 삭제
      const deletedCount = await SessionManager.deleteAllUserSessions(decoded.userId);
      console.log(`${deletedCount} sessions deleted for user: ${decoded.username}`);
    }

    res.json({
      success: true,
      message: '성공적으로 로그아웃되었습니다.',
    });

  } catch (error) {
    console.error('Logout failed:', error.message);
    res.status(500).json(createErrorResponse(
      'LOGOUT_FAILED',
      '로그아웃 처리 중 오류가 발생했습니다.',
    ));
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: 현재 사용자 정보 조회
 *     description: JWT 토큰을 통해 인증된 사용자의 정보와 세션 상태 조회
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 사용자 정보 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     session:
 *                       type: object
 *                       properties:
 *                         activeSessions:
 *                           type: integer
 *                           description: 활성 세션 수
 *                           example: 2
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: 사용자를 찾을 수 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { query } = require('../config/database');

    // 데이터베이스에서 최신 사용자 정보 조회
    const userResult = await query(
      'SELECT id, username, email, full_name, department, last_login, created_at FROM users WHERE id = $1',
      [req.user.id],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json(createErrorResponse(
        'USER_NOT_FOUND',
        '사용자를 찾을 수 없습니다.',
      ));
    }

    const user = userResult.rows[0];

    // 활성 세션 수 조회
    const sessionResult = await query(
      'SELECT COUNT(*) as session_count FROM user_sessions WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP',
      [req.user.id],
    );

    const sessionCount = parseInt(sessionResult.rows[0].session_count, 10);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.full_name,
          department: user.department,
          lastLogin: user.last_login,
          createdAt: user.created_at,
        },
        session: {
          activeSessions: sessionCount,
        },
      },
    });

  } catch (error) {
    console.error('Failed to get user info:', error.message);
    res.status(500).json(createErrorResponse(
      'USER_INFO_ERROR',
      '사용자 정보 조회 중 오류가 발생했습니다.',
    ));
  }
});

/**
 * POST /auth/refresh-user-info
 * LDAP에서 사용자 정보 갱신
 */
router.post('/refresh-user-info', authenticateToken, auditLog('refresh_user_info', 'user'), async (req, res) => {
  try {
    const ldapService = getLDAPService();
    const updatedUser = await ldapService.refreshUserInfo(req.user.username);

    res.json({
      success: true,
      data: {
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          name: updatedUser.full_name,
          department: updatedUser.department,
          updatedAt: updatedUser.updated_at,
        },
      },
      message: '사용자 정보가 성공적으로 갱신되었습니다.',
    });

  } catch (error) {
    console.error('Failed to refresh user info:', error.message);
    res.status(500).json(createErrorResponse(
      'USER_REFRESH_ERROR',
      '사용자 정보 갱신 중 오류가 발생했습니다.',
    ));
  }
});

/**
 * GET /auth/sessions
 * 현재 사용자의 활성 세션 목록 조회
 */
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const { query } = require('../config/database');

    const sessionsResult = await query(`
      SELECT
        id,
        created_at,
        last_accessed,
        expires_at,
        user_agent,
        ip_address
      FROM user_sessions
      WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
      ORDER BY last_accessed DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: {
        sessions: sessionsResult.rows.map(session => ({
          id: session.id,
          createdAt: session.created_at,
          lastAccessed: session.last_accessed,
          expiresAt: session.expires_at,
          userAgent: session.user_agent,
          ipAddress: session.ip_address,
        })),
      },
    });

  } catch (error) {
    console.error('Failed to get user sessions:', error.message);
    res.status(500).json(createErrorResponse(
      'SESSIONS_ERROR',
      '세션 정보 조회 중 오류가 발생했습니다.',
    ));
  }
});

/**
 * DELETE /auth/sessions/:sessionId
 * 특정 세션 삭제
 */
router.delete('/sessions/:sessionId', authenticateToken, auditLog('delete_session', 'session'), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { query } = require('../config/database');

    // 해당 세션이 현재 사용자의 것인지 확인 후 삭제
    const result = await query(
      'DELETE FROM user_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, req.user.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json(createErrorResponse(
        'SESSION_NOT_FOUND',
        '세션을 찾을 수 없습니다.',
      ));
    }

    res.json({
      success: true,
      message: '세션이 성공적으로 삭제되었습니다.',
    });

  } catch (error) {
    console.error('Failed to delete session:', error.message);
    res.status(500).json(createErrorResponse(
      'SESSION_DELETE_ERROR',
      '세션 삭제 중 오류가 발생했습니다.',
    ));
  }
});

module.exports = router;
