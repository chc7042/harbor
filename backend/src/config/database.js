const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// 환경변수 검증 함수
function validateDatabaseConfig() {
  const requiredEnvVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // 포트 번호 검증
  const port = parseInt(process.env.DB_PORT, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid port number between 1 and 65535');
  }
}

// 데이터베이스 설정
const dbConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // 연결 풀 설정
  min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 5000,

  // SSL 설정 (프로덕션 환경에서 권장)
  ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false'
    ? {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
        ca: process.env.DB_SSL_CA ? fs.readFileSync(process.env.DB_SSL_CA, 'utf8') : undefined,
        cert: process.env.DB_SSL_CERT ? fs.readFileSync(process.env.DB_SSL_CERT, 'utf8') : undefined,
        key: process.env.DB_SSL_KEY ? fs.readFileSync(process.env.DB_SSL_KEY, 'utf8') : undefined,
      }
    : false,

  // 로그 설정
  log: process.env.NODE_ENV === 'development' ? (msg) => logger.debug(msg) : undefined,

  // 에러 처리
  application_name: 'jenkins-nas-backend',
};

// 연결 풀 생성
let pool = null;

function createPool() {
  if (!pool) {
    try {
      validateDatabaseConfig();
      pool = new Pool(dbConfig);

      // 연결 풀 이벤트 리스너
      pool.on('connect', (client) => {
        logger.debug('New database client connected');
        // 세션별 설정
        client.query('SET timezone=\'UTC\'');
      });

      pool.on('remove', () => {
        logger.debug('Database client removed from pool');
      });

      pool.on('error', (err) => {
        logger.error('Unexpected database pool error', { error: err.message });
        process.exit(1);
      });

      logger.info('Database pool created successfully', {
        host: dbConfig.host, port: dbConfig.port, database: dbConfig.database,
      });
    } catch (error) {
      logger.error('Failed to create database pool', { error: error.message });
      throw error;
    }
  }
  return pool;
}

// 데이터베이스 연결 테스트
async function testConnection() {
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT NOW() as current_time, version() as version');
    console.log('Database connection test successful:', {
      time: result.rows[0].current_time,
      version: result.rows[0].version.split(',')[0], // 버전 정보만 출력
    });
    return true;
  } catch (error) {
    logger.error('Database connection test failed', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

// 연결 풀 반환 함수
function getPool() {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

// 트랜잭션 실행 헬퍼 함수
async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// 쿼리 실행 헬퍼 함수 (로깅 포함)
async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await getPool().query(text, params);
    const duration = Date.now() - start;

    // 개발 환경에서만 쿼리 로깅
    if (process.env.NODE_ENV === 'development' && process.env.DB_QUERY_LOG === 'true') {
      console.log('Query executed:', {
        text: text.length > 100 ? text.substring(0, 100) + '...' : text,
        duration: `${duration}ms`,
        rows: result.rows.length,
      });
    }

    return result;
  } catch (error) {
    const duration = Date.now() - start;
    console.error('Query failed:', {
      error: error.message,
      text: text.length > 100 ? text.substring(0, 100) + '...' : text,
      params: JSON.stringify(params),
      duration: `${duration}ms`,
    });
    throw error;
  }
}

// 연결 풀 상태 정보
function getPoolStatus() {
  if (!pool) {
    return { status: 'not_initialized' };
  }

  return {
    status: 'active',
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    config: {
      max: pool.options.max,
      min: pool.options.min,
      idleTimeoutMillis: pool.options.idleTimeoutMillis,
    },
  };
}

// 연결 풀 종료
async function closePool() {
  if (pool) {
    logger.info('Closing database pool...');
    await pool.end();
    pool = null;
    logger.info('Database pool closed successfully');
  }
}

// 데이터베이스 마이그레이션 실행
async function runMigrations() {
  const migrationsDir = path.join(__dirname, '../../database/migrations');

  if (!fs.existsSync(migrationsDir)) {
    logger.info('No migrations directory found, skipping migrations');
    return;
  }

  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  if (migrationFiles.length === 0) {
    logger.info('No migration files found');
    return;
  }

  logger.info(`Running ${migrationFiles.length} migration(s)...`);

  for (const file of migrationFiles) {
    try {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      await withTransaction(async (client) => {
        await client.query(sql);
      });

      logger.info('Migration completed', { file });
    } catch (error) {
      console.error(`✗ Migration ${file} failed:`, error.message);
      throw error;
    }
  }

  logger.info('All migrations completed successfully');
}

// 데이터베이스 초기화
async function initializeDatabase() {
  try {
    logger.info('Initializing database connection...');

    // 연결 풀 생성
    createPool();

    // 연결 테스트
    await testConnection();

    // 마이그레이션 실행 (개발 환경에서만)
    if (process.env.NODE_ENV === 'development' && process.env.RUN_MIGRATIONS === 'true') {
      await runMigrations();
    }

    console.log('Database initialization completed successfully');
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    throw error;
  }
}

// 헬스체크 함수
async function healthCheck() {
  try {
    const result = await query('SELECT 1 as health_check');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      pool: getPoolStatus(),
      latency: result.duration || 0,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      pool: getPoolStatus(),
    };
  }
}

// Graceful shutdown 처리
process.on('SIGINT', async () => {
  console.log('Received SIGINT, closing database pool...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, closing database pool...');
  await closePool();
  process.exit(0);
});

module.exports = {
  getPool,
  query,
  withTransaction,
  testConnection,
  initializeDatabase,
  closePool,
  getPoolStatus,
  healthCheck,
  runMigrations,
};
