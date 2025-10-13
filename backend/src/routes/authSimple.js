const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { getLDAPService } = require('../services/ldapService');
const { SimpleJWTUtils, authenticateToken, auditLog, createErrorResponse } = require('../middleware/authSimple');
const { query } = require('../config/database');
const logger = require('../config/logger');

const router = express.Router();

// Login rate limiting
const isRateLimitingDisabled = process.env.DISABLE_RATE_LIMITING === 'true';
const loginRateLimit = parseInt(process.env.RATE_LIMIT_LOGIN) || 5;

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: isRateLimitingDisabled ? 999999 : loginRateLimit,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_ATTEMPTS',
      message: '너무 많은 로그인 시도입니다. 5분 후에 다시 시도해주세요.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
});

// Input validation
const loginValidation = [
  body('username')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('사용자명은 1-100자 사이여야 합니다')
    .matches(/^[a-zA-Z0-9._\-\s가-힣ㄱ-ㅎㅏ-ㅣ]+$/)
    .withMessage('사용자명에 유효하지 않은 문자가 포함되어 있습니다'),

  body('password')
    .isLength({ min: 1, max: 255 })
    .withMessage('비밀번호를 입력해주세요'),
];

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: 사용자 로그인 (간소화된 버전)
 *     description: LDAP 인증 후 단일 JWT 토큰을 발급합니다 (세션 관리 없음)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: 사용자명
 *                 example: "nicolas.choi"
 *               password:
 *                 type: string
 *                 description: 비밀번호
 *                 format: password
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: integer
 *                       example: 1
 *                     username:
 *                       type: string
 *                       example: "nicolas.choi"
 *                     email:
 *                       type: string
 *                       example: "nicolas.choi@roboetech.com"
 *                     fullName:
 *                       type: string
 *                       example: "최현창"
 *                     department:
 *                       type: string
 *                       example: "Development"
 *                 token:
 *                   type: string
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 expiresIn:
 *                   type: string
 *                   example: "24h"
 */
router.post('/login', loginLimiter, loginValidation, async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();

  try {
    // Input validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(`[AUTH-${requestId}] Validation failed`, { errors: errors.array() });
      return res.status(400).json(createErrorResponse(
        '입력값이 올바르지 않습니다.',
        'VALIDATION_ERROR',
        { errors: errors.array() }
      ));
    }

    const { username, password } = req.body;
    const clientIP = req.ip;
    const userAgent = req.get('User-Agent');

    logger.info(`Login attempt for user: ${username} from ${clientIP}`);

    // LDAP authentication
    const ldapService = getLDAPService();
    const authResult = await ldapService.authenticateUser(username, password);

    if (!authResult.success) {
      logger.warn(`[AUTH-${requestId}] LDAP authentication failed for ${username}`);
      auditLog(req, 'LOGIN_FAILED', { 
        username,
        reason: 'INVALID_CREDENTIALS',
        ip: clientIP,
      });

      return res.status(401).json(createErrorResponse(
        '사용자명 또는 비밀번호가 올바르지 않습니다.',
        'INVALID_CREDENTIALS'
      ));
    }

    const userData = authResult.user;

    // Check if user exists in database, create if not
    let dbUser = await findOrCreateUser(userData);

    // Generate single JWT token
    const tokenPayload = {
      userId: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      fullName: dbUser.full_name,
      department: dbUser.department,
      isActive: dbUser.is_active,
    };

    const token = SimpleJWTUtils.generateToken(tokenPayload);
    const expiresIn = SimpleJWTUtils.getExpirationTime();

    const authDuration = Date.now() - startTime;
    
    logger.info(`User ${username} authenticated successfully in ${authDuration}ms`);
    logger.info(`User ${username} logged in successfully`);

    auditLog(req, 'LOGIN_SUCCESS', { 
      username,
      userId: dbUser.id,
      ip: clientIP,
      duration: authDuration,
    });

    res.json({
      success: true,
      user: {
        userId: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        fullName: dbUser.full_name,
        department: dbUser.department,
      },
      token,
      expiresIn,
      message: `${expiresIn} 동안 로그인이 유지됩니다.`,
    });

  } catch (error) {
    const authDuration = Date.now() - startTime;
    logger.error(`[AUTH-${requestId}] Login error:`, error);
    
    auditLog(req, 'LOGIN_ERROR', { 
      username: req.body?.username,
      error: error.message,
      duration: authDuration,
    });

    res.status(500).json(createErrorResponse(
      '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      'INTERNAL_SERVER_ERROR'
    ));
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: 사용자 로그아웃 (간소화된 버전)
 *     description: 클라이언트에서 토큰을 제거하도록 안내 (서버에서는 별도 처리 없음)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 로그아웃 성공
 */
router.post('/logout', authenticateToken, async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);

  logger.info(`User ${req.user.username} logged out`);
  auditLog(req, 'LOGOUT_SUCCESS', { 
    userId: req.user.userId,
    username: req.user.username,
  });

  res.json({
    success: true,
    message: '로그아웃되었습니다. 클라이언트에서 토큰을 제거해주세요.',
  });
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: 현재 사용자 정보 조회
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 사용자 정보 조회 성공
 */
router.get('/me', authenticateToken, async (req, res) => {
  res.json({
    success: true,
    user: {
      userId: req.user.userId,
      username: req.user.username,
      email: req.user.email,
      fullName: req.user.fullName,
      department: req.user.department,
    },
  });
});

/**
 * Find or create user in database
 */
async function findOrCreateUser(userData) {
  try {
    // Check if user exists
    const findQuery = 'SELECT * FROM users WHERE username = $1';
    const findResult = await query(findQuery, [userData.username]);

    if (findResult.rows.length > 0) {
      // Update existing user
      const updateQuery = `
        UPDATE users 
        SET email = $2, full_name = $3, department = $4, last_login = NOW(), updated_at = NOW()
        WHERE username = $1
        RETURNING *
      `;
      const updateResult = await query(updateQuery, [
        userData.username,
        userData.email,
        userData.fullName,
        userData.department,
      ]);

      logger.info(`Updated existing user: ${userData.username}`);
      return updateResult.rows[0];
    } else {
      // Create new user
      const insertQuery = `
        INSERT INTO users (username, email, full_name, department, is_active, created_at, updated_at, last_login)
        VALUES ($1, $2, $3, $4, true, NOW(), NOW(), NOW())
        RETURNING *
      `;
      const insertResult = await query(insertQuery, [
        userData.username,
        userData.email,
        userData.fullName,
        userData.department,
      ]);

      logger.info(`Created new user: ${userData.username}`);
      return insertResult.rows[0];
    }
  } catch (error) {
    logger.error('Database error in findOrCreateUser:', error);
    throw error;
  }
}

module.exports = router;