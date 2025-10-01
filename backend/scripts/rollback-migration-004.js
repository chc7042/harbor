#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function rollbackMigration() {
  const client = await pool.connect();
  
  try {
    // 테이블 존재 여부 확인
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'deployment_paths'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('ℹ️  Table deployment_paths does not exist. Nothing to rollback.');
      return;
    }
    
    // 데이터 존재 여부 확인
    const dataCount = await client.query('SELECT COUNT(*) FROM deployment_paths');
    const recordCount = parseInt(dataCount.rows[0].count, 10);
    
    console.log(`ℹ️  Table deployment_paths exists with ${recordCount} records.`);
    
    if (recordCount > 0) {
      console.log(`⚠️  WARNING: deployment_paths table contains ${recordCount} records.`);
      console.log('⚠️  Rolling back will permanently delete all cached path data.');
    }
    
    const confirm = await askConfirmation(`Are you sure you want to rollback migration 004? (yes/no): `);
    if (!confirm) {
      console.log('❌ Rollback cancelled by user.');
      return;
    }
    
    console.log('🔄 Rolling back migration 004_create_deployment_paths.sql...');
    
    // 롤백 파일 읽기
    const rollbackPath = path.join(__dirname, '../../database/migrations/004_create_deployment_paths_rollback.sql');
    const rollbackSQL = fs.readFileSync(rollbackPath, 'utf8');
    
    // 롤백 실행
    const result = await client.query(rollbackSQL);
    
    console.log('✅ Rollback completed successfully!');
    
    // 롤백 확인
    const tableExistsAfter = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'deployment_paths'
      );
    `);
    
    if (!tableExistsAfter.rows[0].exists) {
      console.log('✅ Table deployment_paths has been successfully removed!');
      
      // 관련 인덱스들도 삭제되었는지 확인
      const indexes = await client.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'deployment_paths';
      `);
      
      if (indexes.rows.length === 0) {
        console.log('✅ All related indexes have been removed!');
      } else {
        console.log('⚠️  Some indexes may still exist:', indexes.rows.map(r => r.indexname));
      }
      
    } else {
      console.log('❌ Table deployment_paths still exists after rollback!');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Rollback failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// 롤백 실행
rollbackMigration().catch(console.error);