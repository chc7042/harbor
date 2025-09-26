#!/usr/bin/env node

/**
 * 데이터베이스 리셋 스크립트
 * 모든 테이블을 삭제하고 다시 생성한 후 시드 데이터를 삽입합니다
 *
 * 경고: 이 스크립트는 모든 데이터를 삭제합니다!
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { initializeDatabase, query, withTransaction, closePool } = require('../src/config/database');
const { seedDatabase } = require('./seed');

// 테이블 삭제 순서 (외래키 제약조건 고려)
const DROP_TABLES_ORDER = [
  'audit_logs',
  'user_sessions',
  'deployment_parameters',
  'artifacts',
  'deployments',
  'projects',
  'users',
  'system_settings',
  'migrations',
];

// 확장 기능 및 함수 삭제
const DROP_EXTENSIONS_AND_FUNCTIONS = `
  -- 뷰 삭제
  DROP VIEW IF EXISTS deployment_stats CASCADE;
  DROP VIEW IF EXISTS recent_deployments CASCADE;
  DROP VIEW IF EXISTS active_user_sessions CASCADE;
  DROP VIEW IF EXISTS user_activity_stats CASCADE;
  DROP VIEW IF EXISTS database_performance_stats CASCADE;
  DROP VIEW IF EXISTS index_usage_stats CASCADE;
  DROP VIEW IF EXISTS table_size_stats CASCADE;

  -- 함수 삭제
  DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
  DROP FUNCTION IF EXISTS cleanup_expired_sessions() CASCADE;
  DROP FUNCTION IF EXISTS update_user_last_login(UUID) CASCADE;
  DROP FUNCTION IF EXISTS create_audit_log(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, JSONB, INET, TEXT) CASCADE;

  -- 트리거 삭제 (CASCADE로 자동 삭제되지만 명시적으로)
  DROP TRIGGER IF EXISTS update_users_updated_at ON users;
  DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
  DROP TRIGGER IF EXISTS update_deployments_updated_at ON deployments;
  DROP TRIGGER IF EXISTS update_artifacts_updated_at ON artifacts;
`;

// 데이터베이스 백업 생성
async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupFile = `backup_${timestamp}.sql`;
  const backupPath = path.join(__dirname, '../backups', backupFile);

  // 백업 디렉토리 생성
  const backupDir = path.dirname(backupPath);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log('💾 Creating database backup...');

  try {
    // pg_dump을 사용한 백업 (Docker 환경에서는 별도 처리 필요)
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const dumpCommand = `pg_dump -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -f ${backupPath}`;

    await execAsync(dumpCommand, {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD }
    });

    console.log(`✅ Backup created: ${backupPath}`);
    return backupPath;
  } catch (error) {
    console.warn('⚠️  Failed to create backup:', error.message);
    console.log('   Continuing without backup...');
    return null;
  }
}

// 모든 테이블 삭제
async function dropAllTables() {
  console.log('🗑️  Dropping all tables and objects...');

  try {
    // 확장 기능 및 함수 삭제
    await query(DROP_EXTENSIONS_AND_FUNCTIONS);

    // 테이블 삭제
    for (const table of DROP_TABLES_ORDER) {
      try {
        await query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`   ✓ Dropped table: ${table}`);
      } catch (error) {
        console.warn(`   ⚠️  Failed to drop table ${table}:`, error.message);
      }
    }

    console.log('✅ All tables and objects dropped');
  } catch (error) {
    console.error('❌ Failed to drop tables:', error.message);
    throw error;
  }
}

// 초기화 스크립트 실행
async function runInitScript() {
  console.log('🏗️  Running database initialization script...');

  const initScriptPath = path.join(__dirname, '../../database/init.sql');

  if (!fs.existsSync(initScriptPath)) {
    throw new Error('Database init.sql script not found');
  }

  try {
    const sql = fs.readFileSync(initScriptPath, 'utf8');

    await withTransaction(async (client) => {
      await client.query(sql);
    });

    console.log('✅ Database initialization completed');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  }
}

// 데이터베이스 상태 확인
async function checkDatabaseState() {
  console.log('🔍 Checking database state...');

  try {
    // 테이블 목록 조회
    const tablesResult = await query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    const tables = tablesResult.rows.map(row => row.tablename);
    console.log(`   Found ${tables.length} tables:`, tables.join(', '));

    // 각 테이블의 레코드 수 확인
    for (const table of tables) {
      try {
        const countResult = await query(`SELECT COUNT(*) as count FROM ${table}`);
        const count = parseInt(countResult.rows[0].count, 10);
        console.log(`   ${table}: ${count} records`);
      } catch (error) {
        console.log(`   ${table}: Error getting count`);
      }
    }

  } catch (error) {
    console.error('Failed to check database state:', error.message);
  }
}

// 확인 프롬프트
function confirmReset() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('⚠️  This will DELETE ALL DATA in the database. Continue? (type "yes" to confirm): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

// 메인 리셋 함수
async function resetDatabase(options = {}) {
  const { skipConfirmation = false, skipBackup = false, skipSeed = false } = options;

  try {
    console.log('🔄 Database Reset Process Started\n');

    // 확인 프롬프트
    if (!skipConfirmation) {
      const confirmed = await confirmReset();
      if (!confirmed) {
        console.log('❌ Reset cancelled by user');
        return;
      }
    }

    // 데이터베이스 초기화
    await initializeDatabase();

    // 현재 상태 확인
    console.log('\n📋 Current database state:');
    await checkDatabaseState();

    // 백업 생성
    if (!skipBackup && process.env.NODE_ENV !== 'development') {
      await createBackup();
    }

    // 전체 프로세스를 트랜잭션으로 실행
    await withTransaction(async () => {
      // 모든 테이블 삭제
      await dropAllTables();

      // 초기화 스크립트 실행
      await runInitScript();
    });

    // 시드 데이터 생성
    if (!skipSeed) {
      console.log('\n🌱 Creating seed data...');
      await seedDatabase({ force: true });
    }

    // 최종 상태 확인
    console.log('\n📋 Final database state:');
    await checkDatabaseState();

    console.log('\n🎉 Database reset completed successfully!');

  } catch (error) {
    console.error('\n💥 Database reset failed:', error.message);
    throw error;
  }
}

// CLI 명령어 파싱
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {};

  for (const arg of args) {
    switch (arg) {
      case '--yes':
      case '-y':
        options.skipConfirmation = true;
        break;
      case '--no-backup':
        options.skipBackup = true;
        break;
      case '--no-seed':
        options.skipSeed = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return options;
}

// 도움말 출력
function printHelp() {
  console.log(`
Database Reset Tool

Usage: node scripts/reset.js [options]

⚠️  WARNING: This script will DELETE ALL DATA in the database!

Options:
  --yes, -y         Skip confirmation prompt
  --no-backup       Skip creating backup
  --no-seed         Skip creating seed data
  --help, -h        Show this help message

Examples:
  node scripts/reset.js                    # Interactive reset with backup and seed
  node scripts/reset.js --yes              # Auto-confirm reset
  node scripts/reset.js --yes --no-backup  # Reset without backup
  node scripts/reset.js --no-seed          # Reset without seed data

Environment Variables:
  DB_HOST                Database host (required)
  DB_PORT                Database port (required)
  DB_NAME                Database name (required)
  DB_USER                Database user (required)
  DB_PASSWORD            Database password (required)
`);
}

// 스크립트 실행
if (require.main === module) {
  const options = parseArguments();

  resetDatabase(options)
    .then(() => {
      console.log('\n✨ Database reset completed successfully');
    })
    .catch((error) => {
      console.error('\n💥 Database reset failed:', error.message);
      process.exit(1);
    })
    .finally(async () => {
      await closePool();
    });
}

module.exports = {
  resetDatabase,
  dropAllTables,
  runInitScript,
};