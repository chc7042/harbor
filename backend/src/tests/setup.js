const { initializeDatabase } = require('../config/database');
require('dotenv').config({ path: '../../../.env' });

// Jest 설정
global.console = {
  ...console,
  // Jest에서 불필요한 로그 숨기기
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// 테스트 환경 설정
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-key-for-testing-only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

// LDAP 테스트 설정
process.env.LDAP_URL = 'ldap://test-ldap-server';
process.env.LDAP_BIND_DN = 'cn=admin,dc=test,dc=com';
process.env.LDAP_BIND_CREDENTIALS = 'test-password';
process.env.LDAP_SEARCH_BASE = 'ou=users,dc=test,dc=com';

// 데이터베이스 테스트 설정 (모킹)
const mockQuery = jest.fn();
jest.mock('../config/database', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(true),
  query: mockQuery,
  pool: {
    connect: jest.fn(),
    query: mockQuery,
    end: jest.fn()
  }
}));

// 전역에서 접근 가능한 mock 함수 설정
global.mockQuery = mockQuery;

// LDAP 모킹
jest.mock('ldapjs', () => ({
  createClient: jest.fn(() => ({
    bind: jest.fn(),
    search: jest.fn(),
    unbind: jest.fn(),
    on: jest.fn()
  }))
}));

// 테스트 전/후 설정
beforeAll(async () => {
  // 테스트 데이터베이스 초기화 (모킹)
  await initializeDatabase();
});

afterAll(async () => {
  // 리소스 정리
  jest.clearAllMocks();
});

beforeEach(() => {
  // 각 테스트 전 모킹 초기화
  jest.clearAllMocks();
  mockQuery.mockClear();
});

afterEach(() => {
  // 각 테스트 후 정리
  jest.clearAllTimers();
});

// 테스트 유틸리티 함수들
global.testUtils = {
  // 테스트용 JWT 토큰 생성
  createTestToken: (payload = { id: 1, username: 'testuser' }) => {
    const jwt = require('jsonwebtoken');
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
  },

  // 테스트용 사용자 데이터
  testUser: {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user'
  },

  // 테스트용 배포 데이터
  testDeployment: {
    id: 1,
    project_name: 'test-project',
    build_number: 123,
    status: 'success',
    environment: 'production',
    deployed_by: 'testuser',
    branch: 'main',
    created_at: new Date().toISOString(),
    duration: 300
  },

  // API 응답 검증 헬퍼
  expectSuccessResponse: (response, expectedData = null) => {
    expect(response.body).toHaveProperty('success', true);
    if (expectedData) {
      expect(response.body).toHaveProperty('data');
      if (typeof expectedData === 'object') {
        expect(response.body.data).toMatchObject(expectedData);
      }
    }
  },

  expectErrorResponse: (response, expectedCode = null, expectedMessage = null) => {
    expect(response.body).toHaveProperty('success', false);
    expect(response.body).toHaveProperty('error');
    if (expectedCode) {
      expect(response.body.error).toHaveProperty('code', expectedCode);
    }
    if (expectedMessage) {
      expect(response.body.error).toHaveProperty('message', expectedMessage);
    }
  }
};