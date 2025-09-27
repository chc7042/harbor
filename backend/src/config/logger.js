const winston = require('winston');
const path = require('path');

// 로그 레벨 정의
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// 환경별 로그 레벨 설정
const logLevel = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// 로그 색상 설정
winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
});

// 로그 포맷 설정
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

// 파일 로그 포맷 (색상 제거)
const fileLogFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// Transport 설정
const transports = [
  // 콘솔 출력
  new winston.transports.Console({
    format: logFormat,
  }),

  // 에러 로그 파일
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/error.log'),
    level: 'error',
    format: fileLogFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),

  // 모든 로그 파일
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/combined.log'),
    format: fileLogFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
];

// 개발 환경에서는 디버그 로그 파일 추가
if (process.env.NODE_ENV === 'development') {
  transports.push(
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/debug.log'),
      level: 'debug',
      format: fileLogFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 3,
    })
  );
}

// 로거 생성
const logger = winston.createLogger({
  level: logLevel(),
  levels: logLevels,
  format: logFormat,
  transports,
  exitOnError: false,
});

// HTTP 요청 로깅을 위한 Morgan 스트림
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

// 로그 디렉토리 생성
const fs = require('fs');
const logsDir = path.join(__dirname, '../../logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

module.exports = logger;