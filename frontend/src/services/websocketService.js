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
    
    // 연결 이벤트 추적을 위한 속성들
    this.lastConnectionAttempt = null;
    this.lastSuccessfulConnection = null;
    this.lastDisconnection = null;
    this.lastError = null;
    this.totalMessagesSent = 0;
    this.totalMessagesReceived = 0;
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
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        
        // 환경변수에서 WebSocket URL 가져오기 (빈 문자열도 fallback 처리)
        const envWsUrl = import.meta.env.VITE_WS_URL;
        const wsUrl = (envWsUrl && envWsUrl.trim() !== '') ? envWsUrl : `${protocol}//${host}`;
        
        console.log('WebSocket configuration:', {
          envWsUrl,
          fallbackUrl: `${protocol}//${host}`,
          finalWsUrl: wsUrl
        });
        
        this.url = `${wsUrl}/ws?token=${encodeURIComponent(token)}`;

        // 연결 시도 추적
        this.trackConnectionEvent('connection_attempt', { url: this.url });

        this.ws = new WebSocket(this.url);
        this.connectionState = 'connecting';

        this.ws.onopen = () => {
          this.isConnecting = false;
          this.connectionState = 'connected';
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.processMessageQueue();

          // 성공적인 연결 추적
          this.trackConnectionEvent('connection_success', { url: this.url });

          console.log('WebSocket connected successfully');
          this.emit('connection', { status: 'connected' });
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.totalMessagesReceived++;
          this.handleMessage(event);
        };

        this.ws.onclose = (event) => {
          this.isConnecting = false;
          this.connectionState = 'disconnected';
          this.stopHeartbeat();

          // 연결 해제 추적
          this.trackConnectionEvent('disconnection', { 
            code: event.code, 
            reason: event.reason,
            wasClean: event.wasClean
          });

          console.log(`WebSocket disconnected: ${event.code} - ${event.reason}`);
          this.emit('disconnection', { code: event.code, reason: event.reason });

          if (event.code !== 1000) { // 정상 종료가 아닌 경우 재연결 시도
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (error) => {
          this.isConnecting = false;
          this.connectionState = 'error';
          
          // 에러 추적
          this.trackConnectionEvent('error', { error: error.message || 'Unknown WebSocket error' });
          
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
      const errorInfo = {
        message: '최대 재연결 시도 횟수에 도달했습니다.',
        details: '자동 재연결을 중단합니다. 수동으로 재연결을 시도하거나 페이지를 새로고침해주세요.',
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        finalAttemptAt: new Date().toISOString()
      };
      this.emit('max_reconnect_attempts', errorInfo);
      return;
    }

    this.reconnectAttempts++;
    const attemptInfo = {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delay: this.reconnectInterval * this.reconnectAttempts,
      timestamp: new Date().toISOString()
    };
    
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    this.emit('reconnect_attempt', attemptInfo);

    setTimeout(() => {
      if (this.token && !this.isConnected()) {
        this.connect(this.token).catch(error => {
          console.error('Reconnection failed:', error);
          
          const errorInfo = this.categorizeConnectionError(error);
          const failureInfo = {
            ...errorInfo,
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            nextAttemptIn: this.reconnectAttempts < this.maxReconnectAttempts 
              ? this.reconnectInterval * (this.reconnectAttempts + 1) 
              : null,
            technicalError: error.message,
            failedAt: new Date().toISOString()
          };
          
          this.emit('reconnect_failed', failureInfo);
          
          // 재연결이 계속 실패할 경우 다음 시도까지의 대기 시간을 늘림
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => this.attemptReconnect(), 1000);
          }
        });
      }
    }, this.reconnectInterval * this.reconnectAttempts);
  }

  /**
   * 수동 재연결
   */
  async manualReconnect() {
    if (this.isConnecting) {
      return { 
        success: false, 
        error: '이미 연결 시도 중입니다.',
        errorCode: 'ALREADY_CONNECTING',
        details: '다른 연결 시도가 진행 중입니다. 잠시 후 다시 시도해주세요.'
      };
    }

    if (this.isConnected()) {
      return { 
        success: false, 
        error: '이미 연결되어 있습니다.',
        errorCode: 'ALREADY_CONNECTED',
        details: 'WebSocket 연결이 이미 활성화되어 있습니다.'
      };
    }

    if (!this.token) {
      return { 
        success: false, 
        error: '인증 토큰이 없습니다. 다시 로그인해주세요.',
        errorCode: 'NO_AUTH_TOKEN',
        details: '세션이 만료되었거나 로그인이 필요합니다.'
      };
    }

    try {
      // 재연결 시도 카운터 리셋
      this.reconnectAttempts = 0;
      this.connectionState = 'connecting';
      
      // 연결 시도 로그
      console.log('Manual reconnection attempt started...');
      this.emit('manual_reconnect_start', {
        timestamp: new Date().toISOString(),
        url: this.url
      });
      
      await this.connect(this.token);
      
      const result = { 
        success: true, 
        message: '연결이 복구되었습니다.',
        details: '실시간 업데이트가 다시 활성화되었습니다.',
        reconnectedAt: new Date().toISOString()
      };
      
      this.emit('manual_reconnect_success', result);
      return result;
      
    } catch (error) {
      console.error('Manual reconnect failed:', error);
      
      const errorInfo = this.categorizeConnectionError(error);
      const result = { 
        success: false, 
        error: errorInfo.userMessage,
        errorCode: errorInfo.code,
        details: errorInfo.details,
        technicalError: error.message,
        failedAt: new Date().toISOString()
      };
      
      this.emit('manual_reconnect_failed', result);
      return result;
    }
  }

  /**
   * 연결 에러 분류 및 사용자 친화적 메시지 생성
   */
  categorizeConnectionError(error) {
    const errorMessage = error.message?.toLowerCase() || '';
    
    if (errorMessage.includes('timeout')) {
      return {
        code: 'CONNECTION_TIMEOUT',
        userMessage: '서버 연결 시간이 초과되었습니다.',
        details: '네트워크가 느리거나 서버가 응답하지 않고 있습니다. 네트워크 상태를 확인하고 다시 시도해주세요.'
      };
    }
    
    if (errorMessage.includes('refused') || errorMessage.includes('econnrefused')) {
      return {
        code: 'CONNECTION_REFUSED',
        userMessage: '서버에 연결할 수 없습니다.',
        details: '서버가 중지되었거나 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해주세요.'
      };
    }
    
    if (errorMessage.includes('network') || errorMessage.includes('offline')) {
      return {
        code: 'NETWORK_ERROR',
        userMessage: '네트워크 연결에 문제가 있습니다.',
        details: '인터넷 연결을 확인하고 다시 시도해주세요.'
      };
    }
    
    if (errorMessage.includes('unauthorized') || errorMessage.includes('403') || errorMessage.includes('401')) {
      return {
        code: 'AUTHENTICATION_ERROR',
        userMessage: '인증에 실패했습니다.',
        details: '로그인이 필요하거나 세션이 만료되었습니다. 페이지를 새로고침하거나 다시 로그인해주세요.'
      };
    }
    
    if (errorMessage.includes('websocket') || errorMessage.includes('upgrade')) {
      return {
        code: 'WEBSOCKET_ERROR',
        userMessage: 'WebSocket 연결에 실패했습니다.',
        details: '브라우저나 네트워크에서 WebSocket을 지원하지 않거나 차단하고 있습니다.'
      };
    }
    
    // 기본 에러
    return {
      code: 'UNKNOWN_ERROR',
      userMessage: '연결에 실패했습니다.',
      details: '알 수 없는 오류가 발생했습니다. 페이지를 새로고침하거나 잠시 후 다시 시도해주세요.'
    };
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
        this.totalMessagesSent++;
        return true;
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        this.trackConnectionEvent('error', { error: `Send failed: ${error.message}` });
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
      readyStateText: this.getReadyStateText(),
      subscribersCount: this.subscribers.size,
      queuedMessages: this.messageQueue.length,
      isConnecting: this.isConnecting,
      hasToken: !!this.token,
      heartbeatActive: !!this.heartbeatInterval,
      reconnectInterval: this.reconnectInterval
    };
  }

  /**
   * WebSocket readyState를 텍스트로 변환
   */
  getReadyStateText() {
    if (!this.ws) return 'NO_WEBSOCKET';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return 'CONNECTING';
      case WebSocket.OPEN: return 'OPEN';
      case WebSocket.CLOSING: return 'CLOSING';
      case WebSocket.CLOSED: return 'CLOSED';
      default: return 'UNKNOWN';
    }
  }

  /**
   * 연결 진단 정보 반환
   */
  getDiagnostics() {
    const now = new Date();
    const connectionInfo = this.getConnectionInfo();
    
    return {
      ...connectionInfo,
      timestamp: now.toISOString(),
      browserSupportsWebSocket: typeof WebSocket !== 'undefined',
      currentURL: this.url,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      port: window.location.port,
      isSecure: window.location.protocol === 'https:',
      userAgent: navigator.userAgent,
      onLine: navigator.onLine,
      connectionEvents: {
        lastConnectionAttempt: this.lastConnectionAttempt || null,
        lastSuccessfulConnection: this.lastSuccessfulConnection || null,
        lastDisconnection: this.lastDisconnection || null,
        lastError: this.lastError || null
      },
      performance: {
        averageLatency: this.averageLatency || null,
        totalMessagesSent: this.totalMessagesSent || 0,
        totalMessagesReceived: this.totalMessagesReceived || 0
      }
    };
  }

  /**
   * 연결 상태 이벤트 추적을 위한 헬퍼 메서드들
   */
  trackConnectionEvent(eventType, data = {}) {
    const event = {
      type: eventType,
      timestamp: new Date().toISOString(),
      ...data
    };

    switch (eventType) {
      case 'connection_attempt':
        this.lastConnectionAttempt = event;
        break;
      case 'connection_success':
        this.lastSuccessfulConnection = event;
        break;
      case 'disconnection':
        this.lastDisconnection = event;
        break;
      case 'error':
        this.lastError = event;
        break;
    }
  }
}

// 싱글톤 인스턴스
const websocketService = new WebSocketService();

export default websocketService;