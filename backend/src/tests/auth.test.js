const request = require('supertest');
const express = require('express');
const authRoutes = require('../routes/auth');
const { authenticateToken } = require('../middleware/auth');

// 테스트용 Express 앱 설정
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

// 테스트용 보호된 라우트
app.get('/protected', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

describe('Authentication Routes', () => {
  describe('POST /api/auth/login', () => {
    beforeEach(() => {
      // LDAP 클라이언트 모킹
      const ldap = require('ldapjs');
      const mockClient = {
        bind: jest.fn(),
        search: jest.fn(),
        unbind: jest.fn(),
        on: jest.fn(),
      };
      ldap.createClient.mockReturnValue(mockClient);
    });

    it('should return 400 if username is missing', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'password' });

      expect(response.status).toBe(400);
      global.testUtils.expectErrorResponse(response, 'VALIDATION_ERROR');
    });

    it('should return 400 if password is missing', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser' });

      expect(response.status).toBe(400);
      global.testUtils.expectErrorResponse(response, 'VALIDATION_ERROR');
    });

    it('should return 400 if both username and password are missing', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(response.status).toBe(400);
      global.testUtils.expectErrorResponse(response, 'VALIDATION_ERROR');
    });

    it('should return 401 for invalid credentials', async () => {
      // LDAP 인증 실패 모킹
      const ldap = require('ldapjs');
      const mockClient = ldap.createClient();
      mockClient.bind.mockImplementation((dn, password, callback) => {
        callback(new Error('Invalid credentials'));
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
      global.testUtils.expectErrorResponse(response, 'AUTHENTICATION_FAILED');
    });

    it('should return 200 and tokens for valid credentials', async () => {
      // LDAP 인증 성공 모킹
      const ldap = require('ldapjs');
      const mockClient = ldap.createClient();

      // bind 성공
      mockClient.bind.mockImplementation((dn, password, callback) => {
        callback(null);
      });

      // search 성공
      mockClient.search.mockImplementation((base, options, callback) => {
        const mockSearchResult = {
          on: jest.fn((event, handler) => {
            if (event === 'searchEntry') {
              handler({
                object: {
                  cn: 'Test User',
                  mail: 'test@example.com',
                  uid: 'testuser',
                },
              });
            } else if (event === 'end') {
              handler();
            }
          }),
        };
        callback(null, mockSearchResult);
      });

      // 데이터베이스 사용자 조회 모킹
      global.mockQuery.mockResolvedValueOnce({ rows: [] }); // 사용자 없음
      global.mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // 사용자 생성
      global.mockQuery.mockResolvedValueOnce({}); // 세션 생성
      global.mockQuery.mockResolvedValueOnce({}); // 감사 로그

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'correctpassword',
        });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user).toHaveProperty('username', 'testuser');
    });

    it('should handle LDAP connection errors', async () => {
      // LDAP 연결 오류 모킹
      const ldap = require('ldapjs');
      ldap.createClient.mockImplementation(() => {
        throw new Error('LDAP connection failed');
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'password',
        });

      expect(response.status).toBe(500);
      global.testUtils.expectErrorResponse(response, 'LDAP_ERROR');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should return 400 if refresh token is missing', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      global.testUtils.expectErrorResponse(response, 'VALIDATION_ERROR');
    });

    it('should return 401 for invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(response.status).toBe(401);
      global.testUtils.expectErrorResponse(response, 'INVALID_TOKEN');
    });

    it('should return new access token for valid refresh token', async () => {
      // 유효한 리프레시 토큰 생성
      const jwt = require('jsonwebtoken');
      const refreshToken = jwt.sign(
        { id: 1, username: 'testuser', type: 'refresh' },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '7d' },
      );

      // 데이터베이스 세션 조회 모킹
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          user_id: 1,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24시간 후
        }],
      });

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toHaveProperty('accessToken');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({});

      expect(response.status).toBe(401);
      global.testUtils.expectErrorResponse(response, 'NO_TOKEN');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer invalid-token')
        .send({});

      expect(response.status).toBe(401);
      global.testUtils.expectErrorResponse(response, 'INVALID_TOKEN');
    });

    it('should logout successfully with valid token', async () => {
      const token = global.testUtils.createTestToken();

      // 데이터베이스 세션 삭제 모킹
      global.mockQuery.mockResolvedValueOnce({}); // 세션 삭제
      global.mockQuery.mockResolvedValueOnce({}); // 감사 로그

      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(401);
      global.testUtils.expectErrorResponse(response, 'NO_TOKEN');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      global.testUtils.expectErrorResponse(response, 'INVALID_TOKEN');
    });

    it('should return user info with valid token', async () => {
      const token = global.testUtils.createTestToken();

      // 데이터베이스 사용자 조회 모킹
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          username: 'testuser',
          email: 'test@example.com',
          name: 'Test User',
        }],
      });

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data.user).toHaveProperty('username', 'testuser');
    });
  });
});

describe('Authentication Middleware', () => {
  describe('authenticateToken middleware', () => {
    it('should block requests without token', async () => {
      const response = await request(app)
        .get('/protected');

      expect(response.status).toBe(401);
      global.testUtils.expectErrorResponse(response, 'TOKEN_INVALID');
    });

    it('should block requests with invalid token', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      global.testUtils.expectErrorResponse(response, 'TOKEN_INVALID');
    });

    it('should allow requests with valid token', async () => {
      const token = global.testUtils.createTestToken();

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.user).toHaveProperty('username', 'testuser');
    });

    it('should handle expired tokens', async () => {
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { id: 1, username: 'testuser' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }, // 1시간 전 만료
      );

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      global.testUtils.expectErrorResponse(response, 'TOKEN_INVALID');
    });
  });
});
