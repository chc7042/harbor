#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// 환경변수 로드
require('dotenv').config();

// 데이터베이스 연결 설정
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'jenkins_nas_deployment',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('🔄 Running migration 004_create_deployment_paths.sql...');

    // 마이그레이션 파일 읽기
    const migrationPath = path.join(__dirname, '../../database/migrations/004_create_deployment_paths.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // 마이그레이션 실행
    await client.query(migrationSQL);

    console.log('✅ Migration 004 completed successfully!');

    // 테이블 생성 확인
    console.log('🔍 Verifying table creation...');

    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'deployment_paths'
      );
    `);

    if (tableExists.rows[0].exists) {
      console.log('✅ Table deployment_paths created successfully!');

      // 테이블 구조 확인
      const tableInfo = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'deployment_paths'
        ORDER BY ordinal_position;
      `);

      console.log('📋 Table structure:');
      tableInfo.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });

      // 인덱스 확인
      const indexes = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'deployment_paths';
      `);

      console.log('🔗 Created indexes:');
      indexes.rows.forEach(row => {
        console.log(`  - ${row.indexname}`);
      });

      // 제약조건 확인
      const constraints = await client.query(`
        SELECT constraint_name, constraint_type
        FROM information_schema.table_constraints
        WHERE table_name = 'deployment_paths';
      `);

      console.log('🔒 Constraints:');
      constraints.rows.forEach(row => {
        console.log(`  - ${row.constraint_name}: ${row.constraint_type}`);
      });

    } else {
      console.log('❌ Table deployment_paths was not created!');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// 마이그레이션 실행
runMigration().catch(console.error);