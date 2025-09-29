const logger = require('../config/logger');

class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (error, req, res, next) => {
  // 기본 에러 정보 설정
  let statusCode = error.statusCode || 500;
  let message = error.message || '서버 오류가 발생했습니다.';
  let details = error.details || null;

  // 에러 타입별 처리
  switch (error.name) {
    case 'ValidationError':
      statusCode = 400;
      message = '유효하지 않은 데이터입니다.';
      details = error.errors;
      break;

    case 'CastError':
      statusCode = 400;
      message = '유효하지 않은 ID 형식입니다.';
      break;

    case 'MongoError':
    case 'MongoServerError':
      if (error.code === 11000) {
        statusCode = 409;
        message = '중복된 데이터입니다.';
        details = Object.keys(error.keyPattern);
      }
      break;

    case 'JsonWebTokenError':
      statusCode = 401;
      message = '유효하지 않은 토큰입니다.';
      break;

    case 'TokenExpiredError':
      statusCode = 401;
      message = '만료된 토큰입니다.';
      break;

    case 'MulterError':
      statusCode = 400;
      if (error.code === 'LIMIT_FILE_SIZE') {
        message = '파일 크기가 너무 큽니다.';
      } else if (error.code === 'LIMIT_FILE_COUNT') {
        message = '파일 개수가 제한을 초과했습니다.';
      } else {
        message = '파일 업로드 중 오류가 발생했습니다.';
      }
      break;

    default:
      // 운영 환경이 아닌 경우에만 스택 트레이스 포함
      if (process.env.NODE_ENV !== 'production') {
        details = error.stack;
      }
      break;
  }

  // 에러 로깅
  const errorLog = {
    message: error.message,
    statusCode,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    user: req.user ? req.user.username : 'anonymous',
    timestamp: new Date().toISOString(),
  };

  if (statusCode >= 500) {
    logger.error('서버 에러:', errorLog);
    logger.error('스택 트레이스:', error.stack);
  } else {
    logger.warn('클라이언트 에러:', errorLog);
  }

  // 응답 전송
  res.status(statusCode).json({
    success: false,
    error: {
      code: error.name || 'INTERNAL_SERVER_ERROR',
      message,
      details: process.env.NODE_ENV === 'production' ? null : details,
      timestamp: new Date().toISOString(),
    },
  });
};

// 404 에러 핸들러
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: '요청한 리소스를 찾을 수 없습니다.',
      timestamp: new Date().toISOString(),
    },
  });
};

// 처리되지 않은 Promise 거부 핸들러
process.on('unhandledRejection', (reason, promise) => {
  logger.error('처리되지 않은 Promise 거부:', {
    reason: reason.message || reason,
    stack: reason.stack,
    promise,
  });

  // Graceful shutdown
  process.exit(1);
});

// 처리되지 않은 예외 핸들러
process.on('uncaughtException', (error) => {
  logger.error('처리되지 않은 예외:', {
    message: error.message,
    stack: error.stack,
  });

  // Graceful shutdown
  process.exit(1);
});

module.exports = {
  AppError,
  errorHandler,
  notFoundHandler,
};
