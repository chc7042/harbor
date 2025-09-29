const request = require('supertest');
const express = require('express');
const deploymentRoutes = require('../routes/deployments');
const { requireAuth } = require('../middleware/auth');

// 테스트용 Express 앱 설정
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  // 테스트용 사용자 정보 주입
  req.user = global.testUtils.testUser;
  next();
});
app.use('/api/deployments', deploymentRoutes);

describe('Deployment Routes', () => {
  beforeEach(() => {
    // 데이터베이스 모킹 초기화
    if (global.mockQuery) {
      global.mockQuery.mockClear();
    }
  });

  describe('GET /api/deployments', () => {
    it('should return paginated deployments list', async () => {
      // 총 개수 조회 모킹
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '25' }] });

      // 배포 목록 조회 모킹
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_name: 'test-project-1',
            build_number: 123,
            status: 'success',
            environment: 'production',
            deployed_by: 'testuser',
            branch: 'main',
            created_at: new Date().toISOString(),
            duration: 300,
          },
          {
            id: 2,
            project_name: 'test-project-2',
            build_number: 124,
            status: 'failed',
            environment: 'staging',
            deployed_by: 'testuser2',
            branch: 'develop',
            created_at: new Date().toISOString(),
            duration: 180,
          },
        ],
      });

      const response = await request(app)
        .get('/api/deployments')
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toHaveProperty('deployments');
      expect(response.body.data).toHaveProperty('pagination');
      expect(response.body.data.deployments).toHaveLength(2);
      expect(response.body.data.pagination).toHaveProperty('total', 25);
      expect(response.body.data.pagination).toHaveProperty('page', 1);
      expect(response.body.data.pagination).toHaveProperty('limit', 10);
    });

    it('should filter deployments by status', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_name: 'test-project',
            status: 'success',
            build_number: 123,
          },
        ],
      });

      const response = await request(app)
        .get('/api/deployments')
        .query({ status: 'success' });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data.deployments[0]).toHaveProperty('status', 'success');
    });

    it('should filter deployments by project name', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_name: 'specific-project',
            status: 'success',
            build_number: 123,
          },
        ],
      });

      const response = await request(app)
        .get('/api/deployments')
        .query({ project: 'specific-project' });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data.deployments[0]).toHaveProperty('project_name', 'specific-project');
    });

    it('should search deployments by keyword', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_name: 'search-test-project',
            status: 'success',
            build_number: 123,
          },
        ],
      });

      const response = await request(app)
        .get('/api/deployments')
        .query({ search: 'search-test' });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data.deployments[0].project_name).toContain('search-test');
    });

    it('should sort deployments', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            project_name: 'project-b',
            created_at: new Date().toISOString(),
          },
          {
            id: 1,
            project_name: 'project-a',
            created_at: new Date(Date.now() - 60000).toISOString(),
          },
        ],
      });

      const response = await request(app)
        .get('/api/deployments')
        .query({ sort: 'created_at', order: 'desc' });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data.deployments).toHaveLength(2);
    });

    it('should handle database errors gracefully', async () => {
      global.mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/deployments');

      expect(response.status).toBe(500);
      global.testUtils.expectErrorResponse(response, 'DATABASE_ERROR');
    });
  });

  describe('GET /api/deployments/:id', () => {
    it('should return deployment details for valid ID', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_name: 'test-project',
          build_number: 123,
          status: 'success',
          environment: 'production',
          deployed_by: 'testuser',
          branch: 'main',
          created_at: new Date().toISOString(),
          duration: 300,
          description: 'Test deployment',
        }],
      });

      const response = await request(app)
        .get('/api/deployments/1');

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data.deployment).toHaveProperty('id', 1);
      expect(response.body.data.deployment).toHaveProperty('project_name', 'test-project');
    });

    it('should return 404 for non-existent deployment', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/deployments/999');

      expect(response.status).toBe(404);
      global.testUtils.expectErrorResponse(response, 'DEPLOYMENT_NOT_FOUND');
    });

    it('should return 400 for invalid ID format', async () => {
      const response = await request(app)
        .get('/api/deployments/invalid-id');

      expect(response.status).toBe(400);
      global.testUtils.expectErrorResponse(response, 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/deployments', () => {
    it('should create new deployment with valid data', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_name: 'new-project',
          build_number: 125,
          status: 'pending',
          created_at: new Date().toISOString(),
        }],
      });

      const newDeployment = {
        project_name: 'new-project',
        build_number: 125,
        environment: 'production',
        branch: 'main',
        description: 'New deployment test',
      };

      const response = await request(app)
        .post('/api/deployments')
        .send(newDeployment);

      expect(response.status).toBe(201);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data.deployment).toHaveProperty('project_name', 'new-project');
      expect(response.body.data.deployment).toHaveProperty('build_number', 125);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/deployments')
        .send({
          // Missing project_name and build_number
          environment: 'production',
        });

      expect(response.status).toBe(400);
      global.testUtils.expectErrorResponse(response, 'VALIDATION_ERROR');
    });

    it('should return 400 for invalid data types', async () => {
      const response = await request(app)
        .post('/api/deployments')
        .send({
          project_name: 'test-project',
          build_number: 'invalid-number', // Should be number
          environment: 'production',
        });

      expect(response.status).toBe(400);
      global.testUtils.expectErrorResponse(response, 'VALIDATION_ERROR');
    });
  });

  describe('PUT /api/deployments/:id', () => {
    it('should update deployment status', async () => {
      // 기존 배포 조회
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_name: 'test-project',
          status: 'in_progress',
        }],
      });

      // 업데이트 실행
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_name: 'test-project',
          status: 'success',
          duration: 300,
        }],
      });

      const response = await request(app)
        .put('/api/deployments/1')
        .send({
          status: 'success',
          duration: 300,
        });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data.deployment).toHaveProperty('status', 'success');
    });

    it('should return 404 for non-existent deployment', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/api/deployments/999')
        .send({ status: 'success' });

      expect(response.status).toBe(404);
      global.testUtils.expectErrorResponse(response, 'DEPLOYMENT_NOT_FOUND');
    });
  });

  describe('DELETE /api/deployments/:id', () => {
    it('should delete deployment for valid ID', async () => {
      // 기존 배포 조회
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_name: 'test-project',
        }],
      });

      // 삭제 실행
      global.mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const response = await request(app)
        .delete('/api/deployments/1');

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
    });

    it('should return 404 for non-existent deployment', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .delete('/api/deployments/999');

      expect(response.status).toBe(404);
      global.testUtils.expectErrorResponse(response, 'DEPLOYMENT_NOT_FOUND');
    });
  });

  describe('GET /api/deployments/recent', () => {
    it('should return recent deployments within specified hours', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_name: 'recent-project',
            created_at: new Date().toISOString(),
            status: 'success',
          },
        ],
      });

      const response = await request(app)
        .get('/api/deployments/recent')
        .query({ hours: 24, limit: 10 });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toBeInstanceOf(Array);
    });

    it('should use default parameters when not specified', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/deployments/recent');

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
    });
  });
});
