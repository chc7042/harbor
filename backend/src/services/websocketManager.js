const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map<websocket, {userId, username, subscriptions}>
    this.roomSubscriptions = new Map(); // Map<room, Set<websocket>>
    this.heartbeatInterval = null;
  }

  /**
   * WebSocket 서버 초기화
   */
  initialize(server) {
    try {
      this.wss = new WebSocket.Server({
        server,
        path: '/ws',
        verifyClient: this.verifyClient.bind(this)
      });

      this.wss.on('connection', this.handleConnection.bind(this));
      this.startHeartbeat();

      logger.info('WebSocket server initialized');
      return this.wss;
    } catch (error) {
      logger.error('Failed to initialize WebSocket server:', error);
      throw error;
    }
  }

  /**
   * 클라이언트 인증 확인
   */
  verifyClient(info) {
    try {
      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        logger.warn('WebSocket connection rejected: No token provided');
        return false;
      }

      // JWT 토큰 검증
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      info.req.user = decoded;
      return true;
    } catch (error) {
      logger.warn('WebSocket connection rejected: Invalid token', error.message);
      return false;
    }
  }

  /**
   * 새 연결 처리
   */
  handleConnection(ws, req) {
    const user = req.user;
    const clientId = this.generateClientId();

    // 클라이언트 정보 저장
    this.clients.set(ws, {
      id: clientId,
      userId: user.id,
      username: user.username,
      subscriptions: new Set(),
      lastPong: Date.now(),
      connectedAt: new Date()
    });

    logger.info(`WebSocket client connected: ${user.username} (${clientId})`);

    // 연결 확인 메시지 전송
    this.sendToClient(ws, {
      type: 'connection_established',
      data: {
        clientId,
        serverTime: new Date().toISOString(),
        message: 'WebSocket connection established successfully'
      }
    });

    // 이벤트 리스너 등록
    ws.on('message', (message) => this.handleMessage(ws, message));
    ws.on('close', () => this.handleDisconnection(ws));
    ws.on('error', (error) => this.handleError(ws, error));
    ws.on('pong', () => this.handlePong(ws));

    // 초기 구독 설정 (사용자별 알림)
    this.subscribe(ws, `user:${user.id}`);
    this.subscribe(ws, 'global'); // 전역 알림
  }

  /**
   * 메시지 처리
   */
  handleMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      const client = this.clients.get(ws);

      if (!client) {
        logger.warn('Received message from unknown client');
        return;
      }

      logger.debug(`WebSocket message from ${client.username}:`, data);

      switch (data.type) {
        case 'subscribe':
          this.handleSubscribe(ws, data);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(ws, data);
          break;
        case 'ping':
          this.sendToClient(ws, { type: 'pong', timestamp: Date.now() });
          break;
        case 'get_deployment_status':
          this.handleGetDeploymentStatus(ws, data);
          break;
        default:
          logger.warn(`Unknown WebSocket message type: ${data.type}`);
          this.sendToClient(ws, {
            type: 'error',
            message: 'Unknown message type',
            code: 'UNKNOWN_MESSAGE_TYPE'
          });
      }
    } catch (error) {
      logger.error('Error handling WebSocket message:', error);
      this.sendToClient(ws, {
        type: 'error',
        message: 'Invalid message format',
        code: 'INVALID_MESSAGE'
      });
    }
  }

  /**
   * 구독 처리
   */
  handleSubscribe(ws, data) {
    const { room } = data;
    if (!room) {
      this.sendToClient(ws, {
        type: 'error',
        message: 'Room name is required',
        code: 'MISSING_ROOM'
      });
      return;
    }

    this.subscribe(ws, room);
    this.sendToClient(ws, {
      type: 'subscribed',
      room,
      timestamp: Date.now()
    });
  }

  /**
   * 구독 해제 처리
   */
  handleUnsubscribe(ws, data) {
    const { room } = data;
    if (!room) {
      this.sendToClient(ws, {
        type: 'error',
        message: 'Room name is required',
        code: 'MISSING_ROOM'
      });
      return;
    }

    this.unsubscribe(ws, room);
    this.sendToClient(ws, {
      type: 'unsubscribed',
      room,
      timestamp: Date.now()
    });
  }

  /**
   * 배포 상태 조회 처리
   */
  async handleGetDeploymentStatus(ws, data) {
    try {
      // 실제 구현에서는 데이터베이스에서 조회
      const { deploymentId } = data;

      // Mock 데이터
      const status = {
        id: deploymentId,
        status: 'in_progress',
        progress: 45,
        step: 'Building application',
        logs: ['Starting build process...', 'Installing dependencies...', 'Building assets...']
      };

      this.sendToClient(ws, {
        type: 'deployment_status',
        deploymentId,
        data: status,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Error getting deployment status:', error);
      this.sendToClient(ws, {
        type: 'error',
        message: 'Failed to get deployment status',
        code: 'DEPLOYMENT_STATUS_ERROR'
      });
    }
  }

  /**
   * 연결 해제 처리
   */
  handleDisconnection(ws) {
    const client = this.clients.get(ws);
    if (client) {
      logger.info(`WebSocket client disconnected: ${client.username} (${client.id})`);

      // 모든 구독 해제
      client.subscriptions.forEach(room => {
        this.unsubscribe(ws, room);
      });

      this.clients.delete(ws);
    }
  }

  /**
   * 에러 처리
   */
  handleError(ws, error) {
    const client = this.clients.get(ws);
    logger.error(`WebSocket error for client ${client?.username || 'unknown'}:`, error);
  }

  /**
   * Pong 처리 (Heartbeat)
   */
  handlePong(ws) {
    const client = this.clients.get(ws);
    if (client) {
      client.lastPong = Date.now();
    }
  }

  /**
   * 구독 추가
   */
  subscribe(ws, room) {
    const client = this.clients.get(ws);
    if (!client) return;

    client.subscriptions.add(room);

    if (!this.roomSubscriptions.has(room)) {
      this.roomSubscriptions.set(room, new Set());
    }
    this.roomSubscriptions.get(room).add(ws);

    logger.debug(`Client ${client.username} subscribed to room: ${room}`);
  }

  /**
   * 구독 해제
   */
  unsubscribe(ws, room) {
    const client = this.clients.get(ws);
    if (!client) return;

    client.subscriptions.delete(room);

    const roomClients = this.roomSubscriptions.get(room);
    if (roomClients) {
      roomClients.delete(ws);
      if (roomClients.size === 0) {
        this.roomSubscriptions.delete(room);
      }
    }

    logger.debug(`Client ${client.username} unsubscribed from room: ${room}`);
  }

  /**
   * 특정 클라이언트에게 메시지 전송
   */
  sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error('Error sending message to client:', error);
      }
    }
  }

  /**
   * 룸의 모든 클라이언트에게 브로드캐스트
   */
  broadcast(room, message, excludeWs = null) {
    const roomClients = this.roomSubscriptions.get(room);
    if (!roomClients) {
      logger.debug(`No clients subscribed to room: ${room}`);
      return 0;
    }

    let sentCount = 0;
    roomClients.forEach(ws => {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        this.sendToClient(ws, {
          ...message,
          room,
          timestamp: Date.now()
        });
        sentCount++;
      }
    });

    logger.debug(`Broadcasted message to ${sentCount} clients in room: ${room}`);
    return sentCount;
  }

  /**
   * 전체 클라이언트에게 브로드캐스트
   */
  broadcastToAll(message, excludeWs = null) {
    let sentCount = 0;
    this.clients.forEach((client, ws) => {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        this.sendToClient(ws, {
          ...message,
          timestamp: Date.now()
        });
        sentCount++;
      }
    });

    logger.debug(`Broadcasted message to ${sentCount} clients`);
    return sentCount;
  }

  /**
   * 배포 상태 업데이트 브로드캐스트
   */
  broadcastDeploymentUpdate(deploymentData) {
    const message = {
      type: 'deployment_update',
      data: deploymentData
    };

    // 전역 브로드캐스트
    this.broadcast('global', message);

    // 프로젝트별 브로드캐스트
    if (deploymentData.project_name) {
      this.broadcast(`project:${deploymentData.project_name}`, message);
    }

    // 환경별 브로드캐스트
    if (deploymentData.environment) {
      this.broadcast(`environment:${deploymentData.environment}`, message);
    }

    logger.info(`Broadcasted deployment update: ${deploymentData.project_name} #${deploymentData.build_number}`);
  }

  /**
   * 시스템 알림 브로드캐스트
   */
  broadcastSystemNotification(notification) {
    const message = {
      type: 'system_notification',
      data: notification
    };

    this.broadcast('global', message);
    logger.info(`Broadcasted system notification: ${notification.title}`);
  }

  /**
   * Heartbeat 시작
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 30000; // 30초

      this.clients.forEach((client, ws) => {
        if (now - client.lastPong > timeout) {
          logger.warn(`Client ${client.username} heartbeat timeout, terminating connection`);
          ws.terminate();
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      });
    }, 15000); // 15초마다 ping
  }

  /**
   * 클라이언트 ID 생성
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 연결된 클라이언트 정보 조회
   */
  getConnectedClients() {
    const clients = [];
    this.clients.forEach((client, ws) => {
      clients.push({
        id: client.id,
        userId: client.userId,
        username: client.username,
        subscriptions: Array.from(client.subscriptions),
        connectedAt: client.connectedAt,
        status: ws.readyState === WebSocket.OPEN ? 'connected' : 'disconnected'
      });
    });
    return clients;
  }

  /**
   * 룸별 구독자 수 조회
   */
  getRoomStats() {
    const stats = {};
    this.roomSubscriptions.forEach((clients, room) => {
      stats[room] = clients.size;
    });
    return stats;
  }

  /**
   * WebSocket 서버 종료
   */
  shutdown() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.wss) {
      this.wss.clients.forEach(ws => {
        ws.close(1000, 'Server shutting down');
      });
      this.wss.close();
    }

    this.clients.clear();
    this.roomSubscriptions.clear();
    logger.info('WebSocket server shut down');
  }
}

// 싱글톤 인스턴스
const websocketManager = new WebSocketManager();

module.exports = websocketManager;