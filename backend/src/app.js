const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config({ path: '../../.env' });

const authRoutes = require('./routes/auth');
const deploymentRoutes = require('./routes/deployments');
const dashboardRoutes = require('./routes/dashboard');
const webhookRoutes = require('./routes/webhooks');
// const nasRoutes = require('./routes/nas'); // 임시 비활성화
const { errorHandler } = require('./middleware/error');
const { initializeDatabase } = require('./config/database');
const logger = require('./config/logger');
const { setupSwagger } = require('./config/swagger');
// const { getNASScanner } = require('./services/nasScanner'); // 임시 비활성화

const app = express();
const PORT = process.env.PORT || 3001;

// 보안 미들웨어
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"]
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 1000, // 최대 1000 요청
  message: '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// 로그인 특별 제한
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5, // 최대 5회 로그인 시도
  message: '로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.',
  standardHeaders: true,
  legacyHeaders: false,
});

// CORS 설정
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 미들웨어
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Swagger API 문서화 설정
setupSwagger(app);

/**
 * @swagger
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: 서버 상태 확인
 *     description: 서버의 현재 상태와 시스템 정보 조회
 *     responses:
 *       200:
 *         description: 서버 정상 상태
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "OK"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-09-26T13:30:00.000Z"
 *                 uptime:
 *                   type: number
 *                   description: 서버 가동 시간 (초)
 *                   example: 3600
 *                 environment:
 *                   type: string
 *                   example: "development"
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// API 라우트
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/deployments', deploymentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/webhooks', webhookRoutes);
// app.use('/api/nas', nasRoutes); // 임시 비활성화

// 404 핸들러
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: '요청한 리소스를 찾을 수 없습니다.'
    }
  });
});

// 에러 핸들러
app.use(errorHandler);

// 서버 시작
async function startServer() {
  try {
    // 데이터베이스 초기화 (개발 환경에서는 에러 무시)
    try {
      await initializeDatabase();
      logger.info('데이터베이스 연결 성공');
    } catch (dbError) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn('데이터베이스 연결 실패 (개발 환경에서 무시):', dbError.message);
      } else {
        throw dbError;
      }
    }

    // NAS 스캐너 초기화 (개발환경에서는 비활성화)
    if (process.env.NODE_ENV !== 'development') {
      try {
        const { getNASScanner } = require('./services/nasScanner');
        const nasScanner = getNASScanner();

        // 파일 감시 시작
        if (process.env.NAS_WATCH_ENABLED !== 'false') {
          nasScanner.startFileWatcher();
          logger.info('NAS file watcher started');
        }

        // 스케줄러 시작
        if (process.env.NAS_SCHEDULER_ENABLED !== 'false') {
          nasScanner.startScheduler();
          logger.info('NAS scan scheduler started');
        }
      } catch (error) {
        logger.warn('NAS scanner initialization failed:', error.message);
      }
    } else {
      logger.info('NAS scanner disabled in development mode');
    }

    // 서버 시작
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Jenkins NAS 배포 이력 서버 시작`);
      logger.info(`포트: ${PORT}`);
      logger.info(`환경: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`프론트엔드 URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
    });
  } catch (error) {
    logger.error('서버 시작 실패:', error);
    process.exit(1);
  }
}

// Graceful shutdown
function gracefulShutdown(signal) {
  logger.info(`${signal} 수신, 서버 종료 중...`);

  if (process.env.NODE_ENV !== 'development') {
    try {
      // NAS 스캐너 정리
      const { getNASScanner } = require('./services/nasScanner');
      const nasScanner = getNASScanner();
      nasScanner.cleanup();
      logger.info('NAS scanner cleanup completed');
    } catch (error) {
      logger.error('NAS scanner cleanup failed:', error.message);
    }
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('처리되지 않은 Promise 거부:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('처리되지 않은 예외:', error);
  process.exit(1);
});

startServer();