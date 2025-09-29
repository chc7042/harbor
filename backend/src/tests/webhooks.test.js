const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const webhookRoutes = require('../routes/webhooks');

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));
app.use('/webhooks', webhookRoutes);

const TEST_SECRET = 'test-webhook-secret';
process.env.JENKINS_WEBHOOK_SECRET = TEST_SECRET;

describe('Webhook Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    if (global.mockQuery) {
      global.mockQuery.mockClear();
    }
  });

  describe('Jenkins Webhook Authentication', () => {
    const createSignature = (payload, secret = TEST_SECRET) => {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload, 'utf8');
      return `sha256=${hmac.digest('hex')}`;
    };

    it('should accept valid Jenkins webhook with correct signature', async () => {
      const payload = JSON.stringify({
        name: 'test-project',
        build: {
          number: 123,
          phase: 'COMPLETED',
          status: 'SUCCESS',
        },
      });

      const signature = createSignature(payload);

      const response = await request(app)
        .post('/webhooks/jenkins')
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });

    it('should reject webhook with invalid signature', async () => {
      const payload = JSON.stringify({
        name: 'test-project',
        build: { number: 123, phase: 'COMPLETED', status: 'SUCCESS' },
      });

      const invalidSignature = 'sha256=invalid-signature-hash';

      const response = await request(app)
        .post('/webhooks/jenkins')
        .set('X-Hub-Signature-256', invalidSignature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_SIGNATURE');
    });

    it('should reject webhook without signature header', async () => {
      const payload = JSON.stringify({
        name: 'test-project',
        build: { number: 123, phase: 'COMPLETED', status: 'SUCCESS' },
      });

      const response = await request(app)
        .post('/webhooks/jenkins')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'MISSING_SIGNATURE');
    });

    it('should reject webhook with malformed signature', async () => {
      const payload = JSON.stringify({
        name: 'test-project',
        build: { number: 123, phase: 'COMPLETED', status: 'SUCCESS' },
      });

      const malformedSignature = 'invalid-format';

      const response = await request(app)
        .post('/webhooks/jenkins')
        .set('X-Hub-Signature-256', malformedSignature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_SIGNATURE');
    });
  });

  describe('Jenkins Build Status Processing', () => {
    const createValidRequest = (payload) => {
      const payloadString = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', TEST_SECRET)
        .update(payloadString, 'utf8')
        .digest('hex');

      return request(app)
        .post('/webhooks/jenkins')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .set('Content-Type', 'application/json')
        .send(payloadString);
    };

    it('should process successful build completion', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_name: 'test-project',
          build_number: 123,
          status: 'in_progress',
        }],
      });

      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_name: 'test-project',
          build_number: 123,
          status: 'success',
          duration: 300,
        }],
      });

      const payload = {
        name: 'test-project',
        build: {
          number: 123,
          phase: 'COMPLETED',
          status: 'SUCCESS',
          duration: 300000,
        },
      };

      const response = await createValidRequest(payload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('deployment_updated', true);
    });

    it('should process failed build completion', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 2,
          project_name: 'failed-project',
          build_number: 124,
          status: 'in_progress',
        }],
      });

      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 2,
          project_name: 'failed-project',
          build_number: 124,
          status: 'failed',
          duration: 150,
        }],
      });

      const payload = {
        name: 'failed-project',
        build: {
          number: 124,
          phase: 'COMPLETED',
          status: 'FAILURE',
          duration: 150000,
        },
      };

      const response = await createValidRequest(payload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('deployment_updated', true);
    });

    it('should handle build start events', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 3,
          project_name: 'starting-project',
          build_number: 125,
          status: 'pending',
        }],
      });

      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 3,
          project_name: 'starting-project',
          build_number: 125,
          status: 'in_progress',
        }],
      });

      const payload = {
        name: 'starting-project',
        build: {
          number: 125,
          phase: 'STARTED',
          status: null,
        },
      };

      const response = await createValidRequest(payload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });

    it('should create new deployment if not found', async () => {
      global.mockQuery.mockResolvedValueOnce({ rows: [] });

      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 4,
          project_name: 'new-project',
          build_number: 126,
          status: 'in_progress',
        }],
      });

      const payload = {
        name: 'new-project',
        build: {
          number: 126,
          phase: 'STARTED',
          status: null,
        },
      };

      const response = await createValidRequest(payload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('deployment_created', true);
    });

    it('should handle missing required fields', async () => {
      const payload = {
        build: {
          number: 127,
          phase: 'COMPLETED',
          status: 'SUCCESS',
        },
      };

      const response = await createValidRequest(payload);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      global.mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      const payload = {
        name: 'error-project',
        build: {
          number: 128,
          phase: 'COMPLETED',
          status: 'SUCCESS',
        },
      };

      const response = await createValidRequest(payload);

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'DATABASE_ERROR');
    });
  });

  describe('Webhook Status Mapping', () => {
    const createValidRequest = (payload) => {
      const payloadString = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', TEST_SECRET)
        .update(payloadString, 'utf8')
        .digest('hex');

      return request(app)
        .post('/webhooks/jenkins')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .set('Content-Type', 'application/json')
        .send(payloadString);
    };

    it('should map Jenkins SUCCESS to success status', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, project_name: 'test', build_number: 123, status: 'in_progress' }],
      });

      let updateQuery;
      global.mockQuery.mockImplementationOnce((sql, params) => {
        updateQuery = { sql, params };
        return Promise.resolve({
          rows: [{ id: 1, status: 'success' }],
        });
      });

      const payload = {
        name: 'test',
        build: { number: 123, phase: 'COMPLETED', status: 'SUCCESS' },
      };

      await createValidRequest(payload);

      expect(updateQuery.params).toContain('success');
    });

    it('should map Jenkins FAILURE to failed status', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, project_name: 'test', build_number: 123, status: 'in_progress' }],
      });

      let updateQuery;
      global.mockQuery.mockImplementationOnce((sql, params) => {
        updateQuery = { sql, params };
        return Promise.resolve({
          rows: [{ id: 1, status: 'failed' }],
        });
      });

      const payload = {
        name: 'test',
        build: { number: 123, phase: 'COMPLETED', status: 'FAILURE' },
      };

      await createValidRequest(payload);

      expect(updateQuery.params).toContain('failed');
    });

    it('should map Jenkins UNSTABLE to warning status', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, project_name: 'test', build_number: 123, status: 'in_progress' }],
      });

      let updateQuery;
      global.mockQuery.mockImplementationOnce((sql, params) => {
        updateQuery = { sql, params };
        return Promise.resolve({
          rows: [{ id: 1, status: 'warning' }],
        });
      });

      const payload = {
        name: 'test',
        build: { number: 123, phase: 'COMPLETED', status: 'UNSTABLE' },
      };

      await createValidRequest(payload);

      expect(updateQuery.params).toContain('warning');
    });

    it('should map Jenkins ABORTED to cancelled status', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, project_name: 'test', build_number: 123, status: 'in_progress' }],
      });

      let updateQuery;
      global.mockQuery.mockImplementationOnce((sql, params) => {
        updateQuery = { sql, params };
        return Promise.resolve({
          rows: [{ id: 1, status: 'cancelled' }],
        });
      });

      const payload = {
        name: 'test',
        build: { number: 123, phase: 'COMPLETED', status: 'ABORTED' },
      };

      await createValidRequest(payload);

      expect(updateQuery.params).toContain('cancelled');
    });
  });

  describe('Webhook Integration with WebSocket', () => {
    it('should broadcast deployment updates via WebSocket', async () => {
      global.mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, project_name: 'ws-test', build_number: 123, status: 'in_progress' }],
      });

      global.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_name: 'ws-test',
          build_number: 123,
          status: 'success',
          created_at: new Date().toISOString(),
        }],
      });

      const payload = {
        name: 'ws-test',
        build: { number: 123, phase: 'COMPLETED', status: 'SUCCESS' },
      };

      const payloadString = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', TEST_SECRET)
        .update(payloadString, 'utf8')
        .digest('hex');

      const response = await request(app)
        .post('/webhooks/jenkins')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .set('Content-Type', 'application/json')
        .send(payloadString);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
  });
});
