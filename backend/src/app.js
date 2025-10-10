const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const authRoutes = require('./routes/auth');
const deploymentRoutes = require('./routes/deployments');
const dashboardRoutes = require('./routes/dashboard');
const webhookRoutes = require('./routes/webhooks');
const websocketRoutes = require('./routes/websocket');
const healthRoutes = require('./routes/health');
const nasRoutes = require('./routes/nas');
const nasArchiveRoutes = require('./routes/nas-archive');
const projectRoutes = require('./routes/projects');
const fileRoutes = require('./routes/files');
const metricsRoutes = require('./routes/metrics');
const { errorHandler } = require('./middleware/error');
const { initializeDatabase } = require('./config/database');
const logger = require('./config/logger');
const { setupSwagger } = require('./config/swagger');
const websocketManager = require('./services/websocketManager');
const { getNASScanner } = require('./services/nasScanner');

const app = express();
const PORT = process.env.BACKEND_PORT || process.env.PORT || 3001;

// Trust proxy for proper client IP handling behind reverse proxy
app.set('trust proxy', true);

// 보안 미들웨어
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws://localhost:3001", "wss://localhost:3001", "ws://localhost:5173", "wss://localhost:5173"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "https://www.gravatar.com"],
      scriptSrc: ["'self'"]
    }
  }
}));

// Rate limiting - Check if disabled
const isRateLimitingDisabled = process.env.DISABLE_RATE_LIMITING === 'true';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: isRateLimitingDisabled ? 999999 : 1000, // 최대 1000 요청 또는 무제한
  message: '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.',
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true, // Required when behind reverse proxy
});

if (!isRateLimitingDisabled) {
  app.use(limiter);
}

// 로그인 특별 제한 (환경변수 우선)
const loginRateLimit = parseInt(process.env.RATE_LIMIT_LOGIN) || 
  (process.env.NODE_ENV === 'development' ? 100 : 5);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: loginRateLimit,
  message: '로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.',
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true, // Required when behind reverse proxy
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

// JSON 파서를 커스텀 에러 핸들러와 함께 사용 (multipart 요청 제외)
app.use((req, res, next) => {
  // multipart/form-data 요청은 JSON 파서를 건너뛰기
  if (req.headers['content-type'] && req.headers['content-type'].startsWith('multipart/form-data')) {
    return next();
  }
  
  express.json({ 
    limit: '10mb',
    verify: (req, res, buf, encoding) => {
      try {
        JSON.parse(buf);
      } catch (err) {
        logger.warn(`클라이언트 에러: ${err.message}`);
        throw err;
      }
    }
  })(req, res, next);
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// JSON 파싱 에러 핸들러
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    logger.warn(`JSON 파싱 에러: ${error.message}`);
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: '잘못된 JSON 형식입니다. 특수문자가 포함된 경우 적절히 이스케이프해주세요.'
      }
    });
  }
  next(error);
});

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

// Health check routes (before other routes for faster response)
app.use('/api/health', healthRoutes);

// API 라우트
if (isRateLimitingDisabled) {
  app.use('/api/auth', authRoutes);
} else {
  app.use('/api/auth', authLimiter, authRoutes);
}
app.use('/api/deployments', deploymentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/ws', websocketRoutes);
app.use('/api/nas', nasRoutes);
app.use('/api/nas-archive', nasArchiveRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/metrics', metricsRoutes);

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
  let server = null;

  try {
    // 데이터베이스 초기화 (개발 환경에서는 에러 무시)
    let dbConnected = false;
    try {
      await initializeDatabase();
      logger.info('데이터베이스 연결 성공');
      dbConnected = true;
    } catch (dbError) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn('데이터베이스 연결 실패 (개발 환경에서 무시):', dbError.message);
      } else {
        throw dbError;
      }
    }

    // 서버 시작
    server = await new Promise((resolve, reject) => {
      const serverInstance = app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Jenkins NAS 배포 이력 서버 시작`);
        logger.info(`포트: ${PORT}`);
        logger.info(`환경: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`프론트엔드 URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
        resolve(serverInstance);
      });

      serverInstance.on('error', (error) => {
        logger.error('서버 시작 에러:', error);
        reject(error);
      });

      // 서버 시작 타임아웃 (10초)
      setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, 10000);
    });

    // WebSocket 서버 초기화 (서버 시작 직후, 재시도 로직 포함)
    logger.info('WebSocket 서버 초기화 시작...');
    try {
      await initializeWebSocketWithRetry(server, 3);
      logger.info('WebSocket 서버 초기화 성공');
    } catch (wsError) {
      logger.error('WebSocket 서버 초기화 실패, 서버는 HTTP만 지원합니다:', wsError.message);
    }
    
    logger.info('서버 초기화 진행 중...');

    // NAS 스캐너 초기화 (비동기적으로 백그라운드에서 진행)
    initializeNASScanner(dbConnected);

    logger.info('서버 초기화 완료');
    return server;

  } catch (error) {
    logger.error('서버 시작 실패:', error);
    
    // 서버가 생성되었다면 정리
    if (server) {
      try {
        server.close();
      } catch (closeError) {
        logger.error('서버 종료 중 에러:', closeError);
      }
    }

    throw error;
  }
}

// WebSocket 초기화 재시도 로직
async function initializeWebSocketWithRetry(server, maxRetries = 3) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      websocketManager.initialize(server);
      logger.info('WebSocket server initialized successfully');
      return;
    } catch (error) {
      attempt++;
      logger.error(`WebSocket 초기화 실패 (시도 ${attempt}/${maxRetries}):`, error.message);

      if (attempt >= maxRetries) {
        logger.error('WebSocket 서버 초기화를 포기합니다. 서버는 HTTP만 지원합니다.');
        throw new Error(`WebSocket initialization failed after ${maxRetries} attempts`);
      }

      // 재시도 전 대기 (지수 백오프)
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      logger.info(`${delay}ms 후 WebSocket 초기화 재시도...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// NAS 스캐너 초기화
function initializeNASScanner(dbConnected) {
  setImmediate(async () => {
    try {
      logger.info('Starting NAS scanner initialization...');
      const nasScanner = getNASScanner();

      // 개발환경에서는 mock 디렉토리 생성
      if (process.env.NODE_ENV === 'development') {
        await nasScanner.ensureMockDirectory();
        logger.info('NAS mock directory created');
      }

      // 파일 감시 시작 (개발환경에서도 활성화)
      if (process.env.NAS_WATCH_ENABLED !== 'false') {
        try {
          const watcherStarted = nasScanner.startFileWatcher();
          if (watcherStarted) {
            logger.info('NAS file watcher started');
          } else {
            logger.warn('NAS file watcher failed to start');
          }
        } catch (watchError) {
          logger.error('NAS file watcher initialization failed:', watchError.message);
        }
      }

      // 스케줄러 시작 (개발환경에서는 비활성화, DB 연결 필요)
      if (process.env.NAS_SCHEDULER_ENABLED !== 'false' &&
          process.env.NODE_ENV !== 'development' &&
          dbConnected) {
        try {
          nasScanner.startScheduler();
          logger.info('NAS scan scheduler started');
        } catch (schedulerError) {
          logger.error('NAS scheduler initialization failed:', schedulerError.message);
        }
      }

      logger.info('NAS scanner initialization completed');
    } catch (error) {
      logger.error('NAS scanner initialization failed:', error.message);
      logger.error('NAS scanner error stack:', error.stack);
      logger.info('Server will continue running without NAS scanner functionality');
    }
  });
}

// Graceful shutdown
function gracefulShutdown(signal) {
  logger.info(`${signal} 수신, 서버 종료 중...`);

  // WebSocket 서버 정리
  try {
    websocketManager.shutdown();
    logger.info('WebSocket server cleanup completed');
  } catch (error) {
    logger.error('WebSocket server cleanup failed:', error.message);
  }

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

process.on('unhandledRejection', (reason) => {
  logger.error('처리되지 않은 Promise 거부:', reason);
  throw new Error(`Unhandled rejection: ${reason}`);
});

process.on('uncaughtException', (error) => {
  logger.error('처리되지 않은 예외:', error);
  throw error;
});

startServer().catch(error => {
  logger.error('서버 초기화 실패:', error);
  process.exit(1);
}); // Force restart for unlimited fix
