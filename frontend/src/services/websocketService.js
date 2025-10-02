class WebSocketService {
  constructor() {
    this.ws = null;
    this.url = null;
    this.token = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 5000; // 5초
    this.heartbeatInterval = null;
    this.isConnecting = false;
    this.subscribers = new Map();
    this.messageQueue = [];
    this.connectionState = 'disconnected'; // disconnected, connecting, connected, error
  }

  /**
   * WebSocket 연결 초기화
   */
  connect(token) {
    if (this.isConnecting || this.isConnected()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        this.isConnecting = true;
        this.token = token;

        // WebSocket URL 구성
        const wsUrl = import.meta.env.VITE_WS_URL || 'ws://harbor.roboetech.com';
        this.url = `${wsUrl}/ws?token=${encodeURIComponent(token)}`;

        this.ws = new WebSocket(this.url);
        this.connectionState = 'connecting';

        this.ws.onopen = () => {
          this.isConnecting = false;
          this.connectionState = 'connected';
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.processMessageQueue();

          console.log('WebSocket connected successfully');
          this.emit('connection', { status: 'connected' });
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onclose = (event) => {
          this.isConnecting = false;
          this.connectionState = 'disconnected';
          this.stopHeartbeat();

          console.log(`WebSocket disconnected: ${event.code} - ${event.reason}`);
          this.emit('disconnection', { code: event.code, reason: event.reason });

          if (event.code !== 1000) { // 정상 종료가 아닌 경우 재연결 시도
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (error) => {
          this.isConnecting = false;
          this.connectionState = 'error';
          console.error('WebSocket error:', error);
          this.emit('error', { error });
          reject(error);
        };

        // 연결 타임아웃
        setTimeout(() => {
          if (this.isConnecting) {
            this.isConnecting = false;
            this.ws?.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);

      } catch (error) {
        this.isConnecting = false;
        this.connectionState = 'error';
        console.error('Failed to create WebSocket connection:', error);
        reject(error);
      }
    });
  }

  /**
   * WebSocket 연결 해제
   */
  disconnect() {
    this.stopHeartbeat();
    this.reconnectAttempts = this.maxReconnectAttempts; // 재연결 방지

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.connectionState = 'disconnected';
    this.subscribers.clear();
    this.messageQueue = [];
  }

  /**
   * 메시지 처리
   */
  handleMessage(event) {
    try {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);

      switch (data.type) {
        case 'connection_established':
          this.emit('connection_established', data.data);
          break;
        case 'deployment_update':
          this.emit('deployment_update', data.data);
          break;
        case 'system_notification':
          this.emit('system_notification', data.data);
          break;
        case 'deployment_status':
          this.emit('deployment_status', data);
          break;
        case 'subscribed':
          console.log(`Subscribed to room: ${data.room}`);
          break;
        case 'unsubscribed':
          console.log(`Unsubscribed from room: ${data.room}`);
          break;
        case 'pong':
          // Heartbeat response
          break;
        case 'error':
          console.error('WebSocket server error:', data);
          this.emit('server_error', data);
          break;
        default:
          console.warn('Unknown WebSocket message type:', data.type);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  }

  /**
   * 재연결 시도
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('max_reconnect_attempts');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      if (this.token && !this.isConnected()) {
        this.connect(this.token).catch(error => {
          console.error('Reconnection failed:', error);
        });
      }
    }, this.reconnectInterval * this.reconnectAttempts);
  }

  /**
   * Heartbeat 시작
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'ping' });
      }
    }, 30000); // 30초마다 ping
  }

  /**
   * Heartbeat 중지
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 메시지 전송
   */
  send(message) {
    if (this.isConnected()) {
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        return false;
      }
    } else {
      // 연결되지 않은 경우 큐에 추가
      this.messageQueue.push(message);
      return false;
    }
  }

  /**
   * 큐에 있는 메시지 처리
   */
  processMessageQueue() {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  /**
   * 룸 구독
   */
  subscribe(room) {
    return this.send({
      type: 'subscribe',
      room
    });
  }

  /**
   * 룸 구독 해제
   */
  unsubscribe(room) {
    return this.send({
      type: 'unsubscribe',
      room
    });
  }

  /**
   * 배포 상태 조회
   */
  getDeploymentStatus(deploymentId) {
    return this.send({
      type: 'get_deployment_status',
      deploymentId
    });
  }

  /**
   * 이벤트 리스너 추가
   */
  on(event, callback) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event).add(callback);
  }

  /**
   * 이벤트 리스너 제거
   */
  off(event, callback) {
    const eventSubscribers = this.subscribers.get(event);
    if (eventSubscribers) {
      eventSubscribers.delete(callback);
      if (eventSubscribers.size === 0) {
        this.subscribers.delete(event);
      }
    }
  }

  /**
   * 이벤트 발생
   */
  emit(event, data) {
    const eventSubscribers = this.subscribers.get(event);
    if (eventSubscribers) {
      eventSubscribers.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * 연결 상태 확인
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 연결 상태 반환
   */
  getConnectionState() {
    return this.connectionState;
  }

  /**
   * 연결 정보 반환
   */
  getConnectionInfo() {
    return {
      state: this.connectionState,
      url: this.url,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      readyState: this.ws?.readyState,
      subscribersCount: this.subscribers.size,
      queuedMessages: this.messageQueue.length
    };
  }
}

// 싱글톤 인스턴스
const websocketService = new WebSocketService();

export default websocketService;