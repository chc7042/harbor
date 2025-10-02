#!/usr/bin/env node

/**
 * 데이터베이스 마이그레이션 실행 스크립트
 * Usage: node scripts/migrate.js [options]
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { initializeDatabase, query, withTransaction, closePool } = require('../src/config/database');

// 마이그레이션 테이블 생성
const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL UNIQUE,
    checksum VARCHAR(64) NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    execution_time INTEGER NOT NULL -- 실행시간 (ms)
  );

  CREATE INDEX IF NOT EXISTS idx_migrations_filename ON migrations(filename);
  CREATE INDEX IF NOT EXISTS idx_migrations_executed_at ON migrations(executed_at DESC);
`;

// 파일의 SHA256 체크섬 계산
function calculateChecksum(filePath) {
  const crypto = require('crypto');
  const fileContent = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(fileContent).digest('hex');
}

// 실행된 마이그레이션 목록 조회
async function getExecutedMigrations() {
  try {
    const result = await query('SELECT filename, checksum FROM migrations ORDER BY filename');
    return result.rows.reduce((acc, row) => {
      acc[row.filename] = row.checksum;
      return acc;
    }, {});
  } catch (error) {
    if (error.code === '42P01') { // 테이블이 존재하지 않음
      return {};
    }
    throw error;
  }
}

// 마이그레이션 파일 목록 조회
function getMigrationFiles() {
  const migrationsDir = path.join(__dirname, '../database/migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.log('❌ Migrations directory not found:', migrationsDir);
    return [];
  }

  return fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .map(filename => ({
      filename,
      filepath: path.join(migrationsDir, filename),
      checksum: calculateChecksum(path.join(migrationsDir, filename)),
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

// 단일 마이그레이션 실행
async function executeMigration(migration) {
  const startTime = Date.now();

  try {
    const sql = fs.readFileSync(migration.filepath, 'utf8');

    await withTransaction(async (client) => {
      // SQL 실행
      await client.query(sql);

      // 마이그레이션 기록 저장
      const executionTime = Date.now() - startTime;
      await client.query(
        'INSERT INTO migrations (filename, checksum, execution_time) VALUES ($1, $2, $3)',
        [migration.filename, migration.checksum, executionTime]
      );
    });

    const duration = Date.now() - startTime;
    console.log(`✅ ${migration.filename} (${duration}ms)`);

    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ ${migration.filename} failed after ${duration}ms:`);
    console.error(`   ${error.message}`);

    return { success: false, error: error.message, duration };
  }
}

// 마이그레이션 검증
function validateMigrations(migrationFiles, executedMigrations) {
  const issues = [];

  for (const migration of migrationFiles) {
    const { filename, checksum } = migration;

    if (executedMigrations[filename]) {
      // 이미 실행된 마이그레이션의 체크섬 검증
      if (executedMigrations[filename] !== checksum) {
        issues.push({
          type: 'checksum_mismatch',
          filename,
          message: `Checksum mismatch for ${filename} - file may have been modified after execution`,
        });
      }
    }
  }

  return issues;
}

// 대기 중인 마이그레이션 필터링
function getPendingMigrations(migrationFiles, executedMigrations) {
  return migrationFiles.filter(migration => !executedMigrations[migration.filename]);
}

// 마이그레이션 상태 출력
function printMigrationStatus(migrationFiles, executedMigrations, pendingMigrations) {
  console.log('\n📊 Migration Status:');
  console.log(`   Total migrations: ${migrationFiles.length}`);
  console.log(`   Executed: ${Object.keys(executedMigrations).length}`);
  console.log(`   Pending: ${pendingMigrations.length}`);

  if (pendingMigrations.length > 0) {
    console.log('\n📋 Pending migrations:');
    pendingMigrations.forEach(migration => {
      console.log(`   - ${migration.filename}`);
    });
  }
}

// 메인 마이그레이션 함수
async function runMigrations(options = {}) {
  const { dryRun = false, force = false, target = null } = options;

  try {
    console.log('🚀 Starting database migrations...\n');

    // 데이터베이스 초기화
    await initializeDatabase();

    // 마이그레이션 테이블 생성
    await query(CREATE_MIGRATIONS_TABLE);

    // 마이그레이션 파일 목록 조회
    const migrationFiles = getMigrationFiles();
    if (migrationFiles.length === 0) {
      console.log('📝 No migration files found.');
      return;
    }

    // 실행된 마이그레이션 조회
    const executedMigrations = await getExecutedMigrations();

    // 마이그레이션 검증
    const validationIssues = validateMigrations(migrationFiles, executedMigrations);
    if (validationIssues.length > 0 && !force) {
      console.error('❌ Migration validation failed:');
      validationIssues.forEach(issue => {
        console.error(`   ${issue.message}`);
      });
      console.error('\nUse --force to ignore validation errors');
      process.exit(1);
    }

    // 대기 중인 마이그레이션 필터링
    let pendingMigrations = getPendingMigrations(migrationFiles, executedMigrations);

    // 특정 마이그레이션까지만 실행 (target 옵션)
    if (target) {
      const targetIndex = pendingMigrations.findIndex(m => m.filename === target);
      if (targetIndex === -1) {
        console.error(`❌ Target migration not found: ${target}`);
        process.exit(1);
      }
      pendingMigrations = pendingMigrations.slice(0, targetIndex + 1);
    }

    // 상태 출력
    printMigrationStatus(migrationFiles, executedMigrations, pendingMigrations);

    // Dry run 모드
    if (dryRun) {
      console.log('\n🔍 Dry run mode - no migrations will be executed');
      return;
    }

    if (pendingMigrations.length === 0) {
      console.log('\n✅ All migrations are up to date!');
      return;
    }

    // 마이그레이션 실행
    console.log('\n🔧 Executing migrations...\n');

    let successCount = 0;
    let totalDuration = 0;

    for (const migration of pendingMigrations) {
      const result = await executeMigration(migration);
      totalDuration += result.duration;

      if (result.success) {
        successCount++;
      } else {
        console.error('\n💥 Migration failed, stopping execution');
        process.exit(1);
      }
    }

    console.log(`\n🎉 Successfully executed ${successCount} migration(s) in ${totalDuration}ms`);

  } catch (error) {
    console.error('\n💥 Migration process failed:', error.message);
    process.exit(1);
  }
}

// CLI 명령어 파싱
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--target':
        options.target = args[++i];
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
Database Migration Tool

Usage: node scripts/migrate.js [options]

Options:
  --dry-run     Show pending migrations without executing them
  --force       Ignore validation errors and run migrations
  --target      Run migrations up to a specific file
  --help, -h    Show this help message

Examples:
  node scripts/migrate.js                    # Run all pending migrations
  node scripts/migrate.js --dry-run          # Show pending migrations
  node scripts/migrate.js --target 002_...   # Run up to specific migration
  node scripts/migrate.js --force            # Ignore validation errors

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

  runMigrations(options)
    .then(() => {
      console.log('\n✨ Migration completed successfully');
    })
    .catch((error) => {
      console.error('\n💥 Migration failed:', error.message);
      process.exit(1);
    })
    .finally(async () => {
      await closePool();
    });
}

module.exports = {
  runMigrations,
  getMigrationFiles,
  getExecutedMigrations,
  executeMigration,
};