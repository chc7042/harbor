#!/usr/bin/env node

/**
 * 데이터베이스 시드 데이터 생성 스크립트
 * 개발 및 테스트용 샘플 데이터를 생성합니다
 */

require('dotenv').config();

const { initializeDatabase, query, withTransaction, closePool } = require('../src/config/database');
const crypto = require('crypto');

// 시드 데이터 설정
const SEED_CONFIG = {
  users: 10,
  deployments: 100,
  artifactsPerDeployment: 2,
  daysBack: 90, // 90일 전부터 현재까지의 데이터 생성
};

// 랜덤 데이터 생성 헬퍼 함수들
const randomizers = {
  // 랜덤 요소 선택
  choice: (array) => array[Math.floor(Math.random() * array.length)],

  // 랜덤 정수
  integer: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,

  // 랜덤 날짜 (지정된 일수 이전부터 현재까지)
  dateWithinDays: (days) => {
    const now = new Date();
    const past = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
    return new Date(past.getTime() + Math.random() * (now.getTime() - past.getTime()));
  },

  // 랜덤 Git 커밋 해시
  gitCommit: () => crypto.randomBytes(20).toString('hex'),

  // 랜덤 파일 크기 (KB 단위)
  fileSize: () => randomizers.integer(100, 50000) * 1024, // 100KB ~ 50MB
};

// 샘플 데이터 정의
const sampleData = {
  departments: ['Engineering', 'DevOps', 'QA', 'Product', 'Design'],

  usernames: [
    'john.doe', 'jane.smith', 'mike.johnson', 'sarah.wilson', 'david.brown',
    'emily.davis', 'chris.miller', 'lisa.garcia', 'tom.anderson', 'amy.taylor',
  ],

  fullNames: [
    'John Doe', 'Jane Smith', 'Mike Johnson', 'Sarah Wilson', 'David Brown',
    'Emily Davis', 'Chris Miller', 'Lisa Garcia', 'Tom Anderson', 'Amy Taylor',
  ],

  projects: [
    { name: 'web-frontend', displayName: 'Web Frontend', description: 'React 기반 웹 프론트엔드' },
    { name: 'api-backend', displayName: 'API Backend', description: 'Node.js Express API 서버' },
    { name: 'mobile-app', displayName: 'Mobile App', description: 'React Native 모바일 앱' },
    { name: 'data-pipeline', displayName: 'Data Pipeline', description: '데이터 처리 파이프라인' },
    { name: 'admin-dashboard', displayName: 'Admin Dashboard', description: '관리자 대시보드' },
    { name: 'notification-service', displayName: 'Notification Service', description: '알림 서비스' },
  ],

  statuses: ['success', 'failed', 'success', 'success', 'success'], // 80% 성공률

  branches: ['main', 'develop', 'feature/user-auth', 'feature/dashboard', 'hotfix/security-patch'],

  environments: ['production', 'staging', 'development'],

  artifactTypes: [
    { extension: '.war', mimeType: 'application/java-archive' },
    { extension: '.jar', mimeType: 'application/java-archive' },
    { extension: '.zip', mimeType: 'application/zip' },
    { extension: '.tar.gz', mimeType: 'application/gzip' },
    { extension: '.docker', mimeType: 'application/octet-stream' },
  ],

  commitMessages: [
    'Add user authentication feature',
    'Fix database connection issue',
    'Update dependencies to latest versions',
    'Improve error handling in API endpoints',
    'Add unit tests for user service',
    'Optimize database queries for better performance',
    'Fix memory leak in background worker',
    'Add logging for debugging purposes',
    'Implement caching for frequently accessed data',
    'Update documentation and README',
    'Fix cross-browser compatibility issues',
    'Add input validation for form fields',
    'Improve mobile responsive design',
    'Fix security vulnerability in authentication',
    'Add new dashboard widgets',
  ],
};

// 사용자 시드 데이터 생성
async function seedUsers() {
  console.log('👥 Creating users...');

  const users = [];
  for (let i = 0; i < SEED_CONFIG.users; i++) {
    const user = {
      username: sampleData.usernames[i] || `user${i + 1}`,
      email: `${sampleData.usernames[i] || `user${i + 1}`}@company.com`,
      full_name: sampleData.fullNames[i] || `User ${i + 1}`,
      department: randomizers.choice(sampleData.departments),
      last_login: randomizers.dateWithinDays(30),
    };
    users.push(user);
  }

  // 배치 인서트
  const insertQuery = `
    INSERT INTO users (username, email, full_name, department, last_login)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (username) DO NOTHING
    RETURNING id, username
  `;

  const insertedUsers = [];
  for (const user of users) {
    try {
      const result = await query(insertQuery, [
        user.username,
        user.email,
        user.full_name,
        user.department,
        user.last_login,
      ]);

      if (result.rows.length > 0) {
        insertedUsers.push(result.rows[0]);
      }
    } catch (error) {
      console.warn(`Failed to insert user ${user.username}:`, error.message);
    }
  }

  console.log(`✅ Created ${insertedUsers.length} users`);
  return insertedUsers;
}

// 프로젝트 시드 데이터 생성
async function seedProjects() {
  console.log('📦 Creating projects...');

  const insertQuery = `
    INSERT INTO projects (name, display_name, description)
    VALUES ($1, $2, $3)
    ON CONFLICT (name) DO NOTHING
    RETURNING id, name
  `;

  const insertedProjects = [];
  for (const project of sampleData.projects) {
    try {
      const result = await query(insertQuery, [
        project.name,
        project.displayName,
        project.description,
      ]);

      if (result.rows.length > 0) {
        insertedProjects.push(result.rows[0]);
      }
    } catch (error) {
      console.warn(`Failed to insert project ${project.name}:`, error.message);
    }
  }

  console.log(`✅ Created ${insertedProjects.length} projects`);
  return insertedProjects;
}

// 배포 시드 데이터 생성
async function seedDeployments(projects, users) {
  console.log('🚀 Creating deployments...');

  let deploymentCount = 0;

  for (let i = 0; i < SEED_CONFIG.deployments; i++) {
    const project = randomizers.choice(projects);
    const user = randomizers.choice(users);
    const status = randomizers.choice(sampleData.statuses);
    const deployedAt = randomizers.dateWithinDays(SEED_CONFIG.daysBack);

    const deployment = {
      project_id: project.id,
      project_name: project.name,
      build_number: randomizers.integer(1, 500),
      status,
      deployed_at: deployedAt,
      jenkins_job_name: project.name,
      jenkins_job_url: `https://jenkins.company.com/job/${project.name}/`,
      git_commit: randomizers.gitCommit(),
      git_branch: randomizers.choice(sampleData.branches),
      git_commit_message: randomizers.choice(sampleData.commitMessages),
      git_author: user.username,
      build_duration: randomizers.integer(30, 300), // 30초 ~ 5분
      triggered_by: user.username,
      environment: randomizers.choice(sampleData.environments),
      version: `1.${randomizers.integer(0, 9)}.${randomizers.integer(0, 99)}`,
    };

    // 실패한 배포의 경우 에러 메시지 추가
    if (status === 'failed') {
      deployment.error_message = 'Build failed due to compilation errors';
    }

    try {
      const insertQuery = `
        INSERT INTO deployments (
          project_id, project_name, build_number, status, deployed_at,
          jenkins_job_name, jenkins_job_url, git_commit, git_branch,
          git_commit_message, git_author, build_duration, triggered_by,
          environment, version, error_message
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        )
        ON CONFLICT (project_name, build_number) DO NOTHING
        RETURNING id
      `;

      const result = await query(insertQuery, [
        deployment.project_id,
        deployment.project_name,
        deployment.build_number,
        deployment.status,
        deployment.deployed_at,
        deployment.jenkins_job_name,
        deployment.jenkins_job_url,
        deployment.git_commit,
        deployment.git_branch,
        deployment.git_commit_message,
        deployment.git_author,
        deployment.build_duration,
        deployment.triggered_by,
        deployment.environment,
        deployment.version,
        deployment.error_message || null,
      ]);

      if (result.rows.length > 0) {
        const deploymentId = result.rows[0].id;
        deploymentCount++;

        // 아티팩트 생성 (성공한 배포만)
        if (status === 'success') {
          await createArtifacts(deploymentId, deployment);
        }
      }
    } catch (error) {
      console.warn(`Failed to insert deployment for ${project.name}:`, error.message);
    }
  }

  console.log(`✅ Created ${deploymentCount} deployments`);
}

// 아티팩트 시드 데이터 생성
async function createArtifacts(deploymentId, deployment) {
  const artifactCount = randomizers.integer(1, SEED_CONFIG.artifactsPerDeployment);

  for (let j = 0; j < artifactCount; j++) {
    const artifactType = randomizers.choice(sampleData.artifactTypes);
    const filename = `${deployment.project_name}-${deployment.version}${artifactType.extension}`;
    const fileSize = randomizers.fileSize();
    const checksum = crypto.createHash('sha256').update(filename + Date.now()).digest('hex');

    const artifact = {
      deployment_id: deploymentId,
      filename,
      file_path: `/nas/${deployment.project_name}/${deployment.build_number}/${filename}`,
      file_size: fileSize,
      file_checksum: checksum,
      mime_type: artifactType.mimeType,
      nas_path: `/mnt/nas/${deployment.project_name}/${deployment.build_number}/${filename}`,
      is_available: Math.random() > 0.1, // 90% 확률로 사용 가능
    };

    try {
      const insertQuery = `
        INSERT INTO artifacts (
          deployment_id, filename, file_path, file_size,
          file_checksum, mime_type, nas_path, is_available
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;

      await query(insertQuery, [
        artifact.deployment_id,
        artifact.filename,
        artifact.file_path,
        artifact.file_size,
        artifact.file_checksum,
        artifact.mime_type,
        artifact.nas_path,
        artifact.is_available,
      ]);
    } catch (error) {
      console.warn(`Failed to insert artifact ${filename}:`, error.message);
    }
  }
}

// 시스템 설정 시드 데이터 생성
async function seedSystemSettings() {
  console.log('⚙️ Creating system settings...');

  const settings = [
    { key: 'nas_mount_path', value: '/mnt/nas', description: 'NAS 마운트 경로' },
    { key: 'scan_interval', value: '300', description: 'NAS 스캔 주기 (초)' },
    { key: 'max_log_retention_days', value: '90', description: '로그 보관 기간 (일)' },
    { key: 'webhook_secret', value: 'dev-webhook-secret-123', description: 'Jenkins Webhook 비밀키' },
    { key: 'jwt_expires_in', value: '3600', description: 'JWT 토큰 만료 시간 (초)' },
    { key: 'refresh_token_expires_in', value: '28800', description: 'Refresh 토큰 만료 시간 (초)' },
  ];

  const insertQuery = `
    INSERT INTO system_settings (key, value, description, updated_by)
    VALUES ($1, $2, $3, 'seed-script')
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = CURRENT_TIMESTAMP,
      updated_by = 'seed-script'
  `;

  let settingsCount = 0;
  for (const setting of settings) {
    try {
      await query(insertQuery, [setting.key, setting.value, setting.description]);
      settingsCount++;
    } catch (error) {
      console.warn(`Failed to insert setting ${setting.key}:`, error.message);
    }
  }

  console.log(`✅ Created/updated ${settingsCount} system settings`);
}

// 데이터베이스 통계 출력
async function printDatabaseStats() {
  console.log('\n📊 Database Statistics:');

  const tables = ['users', 'projects', 'deployments', 'artifacts', 'system_settings'];

  for (const table of tables) {
    try {
      const result = await query(`SELECT COUNT(*) as count FROM ${table}`);
      const count = parseInt(result.rows[0].count, 10);
      console.log(`   ${table}: ${count.toLocaleString()} records`);
    } catch (error) {
      console.log(`   ${table}: Error getting count`);
    }
  }

  // 성공률 통계
  try {
    const result = await query(`
      SELECT
        status,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER()), 2) as percentage
      FROM deployments
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log('\n📈 Deployment Success Rate:');
    result.rows.forEach(row => {
      console.log(`   ${row.status}: ${row.count} (${row.percentage}%)`);
    });
  } catch (error) {
    console.log('   Error calculating success rate');
  }
}

// 메인 시드 함수
async function seedDatabase(options = {}) {
  const { force = false } = options;

  try {
    console.log('🌱 Starting database seeding...\n');

    // 데이터베이스 초기화
    await initializeDatabase();

    // 기존 데이터 확인
    const existingUsers = await query('SELECT COUNT(*) as count FROM users WHERE username LIKE $1', ['%user%']);
    const userCount = parseInt(existingUsers.rows[0].count, 10);

    if (userCount > 0 && !force) {
      console.log(`⚠️  Database already contains ${userCount} seed users.`);
      console.log('Use --force to recreate seed data');
      return;
    }

    // 트랜잭션 내에서 시드 데이터 생성
    await withTransaction(async () => {
      // 기존 시드 데이터 삭제 (force 모드)
      if (force) {
        console.log('🗑️  Clearing existing seed data...');
        await query("DELETE FROM audit_logs WHERE username LIKE '%user%'");
        await query("DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE '%user%')");
        await query("DELETE FROM artifacts WHERE deployment_id IN (SELECT id FROM deployments WHERE triggered_by LIKE '%user%')");
        await query("DELETE FROM deployment_parameters WHERE deployment_id IN (SELECT id FROM deployments WHERE triggered_by LIKE '%user%')");
        await query("DELETE FROM deployments WHERE triggered_by LIKE '%user%'");
        await query("DELETE FROM users WHERE username LIKE '%user%'");
        console.log('✅ Existing seed data cleared\n');
      }

      // 시드 데이터 생성
      const users = await seedUsers();
      const projects = await seedProjects();
      await seedDeployments(projects, users);
      await seedSystemSettings();
    });

    // 통계 출력
    await printDatabaseStats();

    console.log('\n🎉 Database seeding completed successfully!');

  } catch (error) {
    console.error('\n💥 Database seeding failed:', error.message);
    throw error;
  }
}

// CLI 실행
if (require.main === module) {
  const force = process.argv.includes('--force');

  seedDatabase({ force })
    .then(() => {
      console.log('\n✨ Seeding completed successfully');
    })
    .catch((error) => {
      console.error('\n💥 Seeding failed:', error.message);
      process.exit(1);
    })
    .finally(async () => {
      await closePool();
    });
}

module.exports = {
  seedDatabase,
  SEED_CONFIG,
};