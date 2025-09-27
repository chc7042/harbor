const request = require('supertest');
const express = require('express');
const dashboardRoutes = require('../routes/dashboard');
const { requireAuth } = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = global.testUtils.testUser;
  next();
});
app.use('/api/dashboard', dashboardRoutes);

describe('Dashboard Routes', () => {
  beforeEach(() => {
    if (global.mockQuery) {
      global.mockQuery.mockClear();
    }
  });

  describe('GET /api/dashboard/stats', () => {
    it('should return deployment statistics', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '50' }] });
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '45' }] });
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });
      global.mockQuery.mockResolvedValueOnce({ rows: [{ avg: '285' }] });

      const response = await request(app)
        .get('/api/dashboard/stats');

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toHaveProperty('total_deployments', 50);
      expect(response.body.data).toHaveProperty('successful_deployments', 45);
      expect(response.body.data).toHaveProperty('failed_deployments', 3);
      expect(response.body.data).toHaveProperty('in_progress_deployments', 2);
      expect(response.body.data).toHaveProperty('average_duration', 285);
    });

    it('should handle database errors gracefully', async () => {
      global.mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/dashboard/stats');

      expect(response.status).toBe(500);
      global.testUtils.expectErrorResponse(response, 'DATABASE_ERROR');
    });
  });

  describe('GET /api/dashboard/recent-activity', () => {
    it('should return recent deployment activity', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_name: 'project-1',
            status: 'success',
            created_at: new Date().toISOString(),
            deployed_by: 'testuser'
          },
          {
            id: 2,
            project_name: 'project-2',
            status: 'failed',
            created_at: new Date(Date.now() - 3600000).toISOString(),
            deployed_by: 'testuser2'
          }
        ]
      });

      const response = await request(app)
        .get('/api/dashboard/recent-activity')
        .query({ limit: 10 });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toHaveProperty('project_name', 'project-1');
      expect(response.body.data[0]).toHaveProperty('status', 'success');
    });

    it('should limit results correctly', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, project_name: 'project-1', status: 'success' },
          { id: 2, project_name: 'project-2', status: 'failed' },
          { id: 3, project_name: 'project-3', status: 'success' }
        ]
      });

      const response = await request(app)
        .get('/api/dashboard/recent-activity')
        .query({ limit: 3 });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toHaveLength(3);
    });
  });

  describe('GET /api/dashboard/project-stats', () => {
    it('should return project deployment statistics', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          {
            project_name: 'project-alpha',
            total_deployments: '25',
            successful_deployments: '23',
            failed_deployments: '2',
            success_rate: '92.00'
          },
          {
            project_name: 'project-beta',
            total_deployments: '15',
            successful_deployments: '14',
            failed_deployments: '1',
            success_rate: '93.33'
          }
        ]
      });

      const response = await request(app)
        .get('/api/dashboard/project-stats');

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toHaveProperty('project_name', 'project-alpha');
      expect(response.body.data[0]).toHaveProperty('success_rate', '92.00');
    });

    it('should handle empty project data', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/project-stats');

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('GET /api/dashboard/timeline', () => {
    it('should return deployment timeline data', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [
          {
            date: '2024-01-01',
            total_deployments: '5',
            successful_deployments: '4',
            failed_deployments: '1'
          },
          {
            date: '2024-01-02',
            total_deployments: '8',
            successful_deployments: '7',
            failed_deployments: '1'
          }
        ]
      });

      const response = await request(app)
        .get('/api/dashboard/timeline')
        .query({ days: 30 });

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toHaveProperty('date', '2024-01-01');
      expect(response.body.data[0]).toHaveProperty('total_deployments', '5');
    });

    it('should use default days when not specified', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/timeline');

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
    });

    it('should validate days parameter', async () => {
      const response = await request(app)
        .get('/api/dashboard/timeline')
        .query({ days: 'invalid' });

      expect(response.status).toBe(400);
      global.testUtils.expectErrorResponse(response, 'VALIDATION_ERROR');
    });
  });

  describe('GET /api/dashboard/system-health', () => {
    it('should return system health status', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const response = await request(app)
        .get('/api/dashboard/system-health');

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toHaveProperty('database_status', 'healthy');
      expect(response.body.data).toHaveProperty('api_status', 'healthy');
      expect(response.body.data).toHaveProperty('timestamp');
    });

    it('should detect database issues', async () => {
      global.mockQuery.mockRejectedValueOnce(new Error('Connection timeout'));

      const response = await request(app)
        .get('/api/dashboard/system-health');

      expect(response.status).toBe(200);
      global.testUtils.expectSuccessResponse(response);
      expect(response.body.data).toHaveProperty('database_status', 'unhealthy');
    });
  });
});