import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import websocketService from '../services/websocketService';
import toast from 'react-hot-toast';

export const useWebSocket = () => {
  const { user } = useAuth();
  const [connectionState, setConnectionState] = useState('disconnected');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState(null);
  const reconnectTimeoutRef = useRef(null);

  // WebSocket 연결
  const connect = useCallback(async () => {
    if (!user) return;

    const token = localStorage.getItem('accessToken');
    if (!token) return;

    try {
      setConnectionState('connecting');
      await websocketService.connect(token);
      setIsConnected(true);
      setConnectionState('connected');
    } catch (error) {
      console.error('WebSocket connection failed:', error);
      setIsConnected(false);
      setConnectionState('error');
    }
  }, [user]);

  // WebSocket 연결 해제
  const disconnect = useCallback(() => {
    websocketService.disconnect();
    setIsConnected(false);
    setConnectionState('disconnected');
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
  }, []);

  // 이벤트 리스너 설정
  useEffect(() => {
    if (!user) return;

    // 연결 이벤트
    const handleConnection = () => {
      setIsConnected(true);
      setConnectionState('connected');
      console.log('WebSocket connected');
    };

    // 연결 해제 이벤트
    const handleDisconnection = (data) => {
      setIsConnected(false);
      setConnectionState('disconnected');
      console.log('WebSocket disconnected:', data);

      // 비정상 종료인 경우 토스트 알림 (세션당 한 번만)
      if (data.code !== 1000) {
        const disconnectToastShown = sessionStorage.getItem('ws_disconnect_toast_shown');
        if (!disconnectToastShown) {
          toast.error('실시간 연결이 끊어졌습니다. 재연결을 시도합니다.');
          sessionStorage.setItem('ws_disconnect_toast_shown', 'true');
        }
      }
    };

    // 에러 이벤트
    const handleError = (data) => {
      setIsConnected(false);
      setConnectionState('error');
      console.error('WebSocket error:', data);
      
      // 에러 토스트 중복 방지
      const errorToastShown = sessionStorage.getItem('ws_error_toast_shown');
      if (!errorToastShown) {
        toast.error('실시간 연결에 오류가 발생했습니다.');
        sessionStorage.setItem('ws_error_toast_shown', 'true');
      }
    };

    // 최대 재연결 시도 도달
    const handleMaxReconnectAttempts = () => {
      setConnectionState('failed');
      
      // 최대 재연결 토스트 중복 방지
      const maxReconnectToastShown = sessionStorage.getItem('ws_max_reconnect_toast_shown');
      if (!maxReconnectToastShown) {
        toast.error('실시간 연결을 복구할 수 없습니다. 페이지를 새로고침해주세요.');
        sessionStorage.setItem('ws_max_reconnect_toast_shown', 'true');
      }
    };

    // 연결 확립
    const handleConnectionEstablished = (data) => {
      console.log('WebSocket connection established:', data);
      
      // 세션당 한 번만 토스트 표시
      const toastShown = sessionStorage.getItem('ws_connection_toast_shown');
      if (!toastShown) {
        toast.success('실시간 업데이트가 활성화되었습니다.');
        sessionStorage.setItem('ws_connection_toast_shown', 'true');
      }
    };

    // 이벤트 리스너 등록
    websocketService.on('connection', handleConnection);
    websocketService.on('disconnection', handleDisconnection);
    websocketService.on('error', handleError);
    websocketService.on('max_reconnect_attempts', handleMaxReconnectAttempts);
    websocketService.on('connection_established', handleConnectionEstablished);

    // 초기 연결
    connect();

    // 정리
    return () => {
      websocketService.off('connection', handleConnection);
      websocketService.off('disconnection', handleDisconnection);
      websocketService.off('error', handleError);
      websocketService.off('max_reconnect_attempts', handleMaxReconnectAttempts);
      websocketService.off('connection_established', handleConnectionEstablished);
    };
  }, [user, connect]);

  // 사용자 로그아웃 시 연결 해제
  useEffect(() => {
    if (!user) {
      disconnect();
    }
  }, [user, disconnect]);

  // 연결 정보 업데이트
  useEffect(() => {
    const interval = setInterval(() => {
      setConnectionInfo(websocketService.getConnectionInfo());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // 룸 구독
  const subscribe = useCallback((room) => {
    return websocketService.subscribe(room);
  }, []);

  // 룸 구독 해제
  const unsubscribe = useCallback((room) => {
    return websocketService.unsubscribe(room);
  }, []);

  // 배포 상태 조회
  const getDeploymentStatus = useCallback((deploymentId) => {
    return websocketService.getDeploymentStatus(deploymentId);
  }, []);

  return {
    isConnected,
    connectionState,
    connectionInfo,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    getDeploymentStatus,
    websocketService
  };
};

// 실시간 배포 업데이트 훅
export const useDeploymentUpdates = (initialDeployments = []) => {
  const [deployments, setDeployments] = useState(initialDeployments);
  const { isConnected } = useWebSocket();

  useEffect(() => {
    setDeployments(initialDeployments);
  }, [initialDeployments]);

  useEffect(() => {
    if (!isConnected) return;

    // 배포 업데이트 리스너
    const handleDeploymentUpdate = (deploymentData) => {
      console.log('Deployment update received:', deploymentData);

      setDeployments(prevDeployments => {
        const existingIndex = prevDeployments.findIndex(
          d => d.id === deploymentData.id
        );

        if (existingIndex >= 0) {
          // 기존 배포 업데이트
          const updated = [...prevDeployments];
          updated[existingIndex] = { ...updated[existingIndex], ...deploymentData };
          return updated;
        } else {
          // 새 배포 추가 (맨 앞에)
          return [deploymentData, ...prevDeployments];
        }
      });

      // 상태별 토스트 알림
      if (deploymentData.status === 'success') {
        toast.success(`${deploymentData.project_name} 배포가 성공했습니다!`);
      } else if (deploymentData.status === 'failed') {
        toast.error(`${deploymentData.project_name} 배포가 실패했습니다.`);
      } else if (deploymentData.status === 'in_progress') {
        toast(`${deploymentData.project_name} 배포가 시작되었습니다.`, {
          icon: '⚡',
        });
      }
    };

    websocketService.on('deployment_update', handleDeploymentUpdate);

    return () => {
      websocketService.off('deployment_update', handleDeploymentUpdate);
    };
  }, [isConnected]);

  return deployments;
};

// 시스템 알림 훅
export const useSystemNotifications = () => {
  const { isConnected } = useWebSocket();

  useEffect(() => {
    if (!isConnected) return;

    const handleSystemNotification = (notification) => {
      console.log('System notification received:', notification);

      // 알림 타입별 처리
      switch (notification.type) {
        case 'info':
          toast(notification.message, {
            icon: 'ℹ️',
            duration: 6000,
          });
          break;
        case 'warning':
          toast(notification.message, {
            icon: '⚠️',
            duration: 8000,
            style: {
              background: '#fef3cd',
              color: '#664d03',
              border: '1px solid #ffeaa7',
            },
          });
          break;
        case 'error':
          toast.error(notification.message, {
            duration: 10000,
          });
          break;
        case 'success':
          toast.success(notification.message, {
            duration: 5000,
          });
          break;
        default:
          toast(notification.message);
      }

      // 브라우저 알림 (권한이 있는 경우)
      if (notification.showBrowserNotification && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(notification.title || 'Harbor 알림', {
          body: notification.message,
          icon: '/favicon.ico',
          tag: 'harbor-notification'
        });
      }
    };

    websocketService.on('system_notification', handleSystemNotification);

    return () => {
      websocketService.off('system_notification', handleSystemNotification);
    };
  }, [isConnected]);
};

// 특정 배포 상태 추적 훅
export const useDeploymentStatus = (deploymentId) => {
  const [deployment, setDeployment] = useState(null);
  const [loading, setLoading] = useState(true);
  const { isConnected, getDeploymentStatus } = useWebSocket();

  useEffect(() => {
    if (!isConnected || !deploymentId) return;

    // 초기 상태 조회
    getDeploymentStatus(deploymentId);

    // 상태 업데이트 리스너
    const handleDeploymentStatus = (data) => {
      if (data.deploymentId === deploymentId) {
        setDeployment(data.data);
        setLoading(false);
      }
    };

    const handleDeploymentUpdate = (deploymentData) => {
      if (deploymentData.id === deploymentId) {
        setDeployment(prevDeployment => ({
          ...prevDeployment,
          ...deploymentData
        }));
        setLoading(false);
      }
    };

    websocketService.on('deployment_status', handleDeploymentStatus);
    websocketService.on('deployment_update', handleDeploymentUpdate);

    return () => {
      websocketService.off('deployment_status', handleDeploymentStatus);
      websocketService.off('deployment_update', handleDeploymentUpdate);
    };
  }, [isConnected, deploymentId, getDeploymentStatus]);

  return { deployment, loading };
};