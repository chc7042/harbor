const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { createServer } = require('http');
const express = require('express');
const websocketManager = require('../services/websocketManager');

describe('WebSocket Manager', () => {
  let server;
  let app;
  let testToken;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';

    app = express();
    server = createServer(app);
    websocketManager.initialize(server);

    testToken = jwt.sign(
      { id: 1, username: 'testuser' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    return new Promise((resolve) => {
      server.listen(0, () => {
        resolve();
      });
    });
  });

  afterAll(() => {
    if (websocketManager) {
      websocketManager.shutdown();
    }
    if (server) {
      server.close();
    }
  });

  describe('WebSocket Connection', () => {
    it('should accept connection with valid JWT token', (done) => {
      const port = server.address().port;
      const ws = new WebSocket(`ws://localhost:${port}?token=${testToken}`);

      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });

      ws.on('error', (error) => {
        done(error);
      });
    });

    it('should reject connection without token', (done) => {
      const port = server.address().port;
      const ws = new WebSocket(`ws://localhost:${port}`);

      ws.on('error', (error) => {
        expect(error.message).toContain('Unexpected server response');
        done();
      });

      ws.on('open', () => {
        done(new Error('Connection should have been rejected'));
      });
    });

    it('should reject connection with invalid token', (done) => {
      const port = server.address().port;
      const invalidToken = 'invalid.jwt.token';
      const ws = new WebSocket(`ws://localhost:${port}?token=${invalidToken}`);

      ws.on('error', (error) => {
        expect(error.message).toContain('Unexpected server response');
        done();
      });

      ws.on('open', () => {
        done(new Error('Connection should have been rejected'));
      });
    });
  });

  describe('Room Management', () => {
    let ws;

    beforeEach((done) => {
      const port = server.address().port;
      ws = new WebSocket(`ws://localhost:${port}?token=${testToken}`);
      ws.on('open', () => done());
    });

    afterEach(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    it('should handle room subscription', (done) => {
      const subscribeMessage = {
        type: 'subscribe',
        room: 'deployments'
      };

      ws.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'subscribed') {
          expect(message.room).toBe('deployments');
          done();
        }
      });

      ws.send(JSON.stringify(subscribeMessage));
    });

    it('should handle room unsubscription', (done) => {
      const subscribeMessage = {
        type: 'subscribe',
        room: 'deployments'
      };

      const unsubscribeMessage = {
        type: 'unsubscribe',
        room: 'deployments'
      };

      let subscribed = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data);

        if (message.type === 'subscribed' && !subscribed) {
          subscribed = true;
          ws.send(JSON.stringify(unsubscribeMessage));
        } else if (message.type === 'unsubscribed') {
          expect(message.room).toBe('deployments');
          done();
        }
      });

      ws.send(JSON.stringify(subscribeMessage));
    });

    it('should handle invalid room names', (done) => {
      const invalidMessage = {
        type: 'subscribe',
        room: 'invalid-room'
      };

      ws.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'error') {
          expect(message.message).toContain('Invalid room');
          done();
        }
      });

      ws.send(JSON.stringify(invalidMessage));
    });
  });

  describe('Message Broadcasting', () => {
    it('should broadcast to specific room subscribers', (done) => {
      const port = server.address().port;

      const ws1 = new WebSocket(`ws://localhost:${port}?token=${testToken}`);
      const ws2 = new WebSocket(`ws://localhost:${port}?token=${testToken}`);

      let connectedCount = 0;
      let subscribedCount = 0;

      const checkReady = () => {
        connectedCount++;
        if (connectedCount === 2) {
          // Both connected, now subscribe to deployments room
          ws1.send(JSON.stringify({ type: 'subscribe', room: 'deployments' }));
          ws2.send(JSON.stringify({ type: 'subscribe', room: 'deployments' }));
        }
      };

      const checkSubscribed = () => {
        subscribedCount++;
        if (subscribedCount === 2) {
          // Both subscribed, now test broadcasting
          const testData = {
            id: 1,
            project_name: 'test-project',
            status: 'success'
          };

          websocketManager.broadcast('deployments', { type: 'deployment_updated', data: testData });
        }
      };

      ws1.on('open', checkReady);
      ws2.on('open', checkReady);

      ws1.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'subscribed') {
          checkSubscribed();
        } else if (message.type === 'deployment_update') {
          expect(message.data.project_name).toBe('test-project');
          ws1.close();
          ws2.close();
          done();
        }
      });

      ws2.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'subscribed') {
          checkSubscribed();
        }
      });
    });
  });

  describe('Heartbeat System', () => {
    it('should respond to ping messages', (done) => {
      const port = server.address().port;
      const ws = new WebSocket(`ws://localhost:${port}?token=${testToken}`);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' }));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'pong') {
          expect(message.timestamp).toBeDefined();
          ws.close();
          done();
        }
      });
    });

    it('should handle connection cleanup on close', (done) => {
      const port = server.address().port;
      const ws = new WebSocket(`ws://localhost:${port}?token=${testToken}`);

      ws.on('open', () => {
        const initialConnections = websocketManager.getConnectedClients().length;

        ws.on('close', () => {
          // Give a moment for cleanup
          setTimeout(() => {
            const finalConnections = websocketManager.getConnectedClients().length;
            expect(finalConnections).toBe(initialConnections - 1);
            done();
          }, 100);
        });

        ws.close();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON messages', (done) => {
      const port = server.address().port;
      const ws = new WebSocket(`ws://localhost:${port}?token=${testToken}`);

      ws.on('open', () => {
        ws.send('invalid-json-message');
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'error') {
          expect(message.message).toContain('Invalid message format');
          ws.close();
          done();
        }
      });
    });

    it('should handle unknown message types', (done) => {
      const port = server.address().port;
      const ws = new WebSocket(`ws://localhost:${port}?token=${testToken}`);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'unknown_type' }));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'error') {
          expect(message.message).toContain('Unknown message type');
          ws.close();
          done();
        }
      });
    });
  });

  describe('Integration with Deployment Updates', () => {
    it('should broadcast deployment status changes', (done) => {
      const port = server.address().port;
      const ws = new WebSocket(`ws://localhost:${port}?token=${testToken}`);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'subscribe', room: 'deployments' }));
      });

      let subscriptionConfirmed = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data);

        if (message.type === 'subscribed' && !subscriptionConfirmed) {
          subscriptionConfirmed = true;

          // Simulate deployment update
          const deploymentUpdate = {
            id: 1,
            project_name: 'test-project',
            status: 'in_progress',
            build_number: 123
          };

          websocketManager.broadcastDeploymentUpdate(deploymentUpdate);
        } else if (message.type === 'deployment_update') {
          expect(message.data.project_name).toBe('test-project');
          expect(message.data.status).toBe('in_progress');
          ws.close();
          done();
        }
      });
    });

    it('should broadcast system notifications', (done) => {
      const port = server.address().port;
      const ws = new WebSocket(`ws://localhost:${port}?token=${testToken}`);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'subscribe', room: 'system' }));
      });

      let subscriptionConfirmed = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data);

        if (message.type === 'subscribed' && !subscriptionConfirmed) {
          subscriptionConfirmed = true;

          // Simulate system notification
          const notification = {
            type: 'warning',
            title: 'System Alert',
            message: 'High memory usage detected'
          };

          websocketManager.broadcastSystemNotification(notification);
        } else if (message.type === 'system_notification') {
          expect(message.data.title).toBe('System Alert');
          expect(message.data.type).toBe('warning');
          ws.close();
          done();
        }
      });
    });
  });
});