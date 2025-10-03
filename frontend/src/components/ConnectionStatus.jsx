import React, { useState } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, Info } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';

const ConnectionStatus = ({ className = '' }) => {
  const { isConnected, connectionState, manualReconnect, connectionInfo, lastError } = useWebSocket();
  const [showDetails, setShowDetails] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const getStatusConfig = () => {
    switch (connectionState) {
      case 'connected':
        return {
          icon: Wifi,
          text: '실시간 연결됨',
          color: 'text-green-600',
          bgColor: 'bg-green-100',
          borderColor: 'border-green-200'
        };
      case 'connecting':
        return {
          icon: RefreshCw,
          text: '연결 중...',
          color: 'text-blue-600',
          bgColor: 'bg-blue-100',
          borderColor: 'border-blue-200',
          animate: true
        };
      case 'error':
        return {
          icon: AlertTriangle,
          text: '연결 오류',
          color: 'text-red-600',
          bgColor: 'bg-red-100',
          borderColor: 'border-red-200'
        };
      case 'failed':
        return {
          icon: WifiOff,
          text: '연결 실패',
          color: 'text-red-600',
          bgColor: 'bg-red-100',
          borderColor: 'border-red-200'
        };
      case 'disconnected':
      default:
        return {
          icon: WifiOff,
          text: '연결 끊김',
          color: 'text-gray-600',
          bgColor: 'bg-gray-100',
          borderColor: 'border-gray-200'
        };
    }
  };

  const config = getStatusConfig();
  const IconComponent = config.icon;

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const result = await manualReconnect();
      if (!result.success) {
        // 에러 상세 정보 표시
        console.error('Reconnection failed:', result);
      }
    } catch (error) {
      console.error('Manual reconnect error:', error);
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <div className={`relative flex items-center space-x-2 ${className}`}>
      <div
        className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border text-xs font-medium ${config.color} ${config.bgColor} ${config.borderColor}`}
        title={`연결 상태: ${config.text}`}
      >
        <IconComponent
          className={`w-3 h-3 ${config.animate || reconnecting ? 'animate-spin' : ''}`}
        />
        <span className="hidden sm:inline">{config.text}</span>
      </div>

      {/* 재연결 버튼 */}
      {!isConnected && (connectionState === 'error' || connectionState === 'failed') && (
        <button
          onClick={handleReconnect}
          disabled={reconnecting}
          className="text-xs text-primary-600 hover:text-primary-800 underline disabled:opacity-50 disabled:cursor-not-allowed"
          title="다시 연결"
        >
          {reconnecting ? '연결 중...' : '재연결'}
        </button>
      )}

      {/* 진단 정보 버튼 */}
      {(connectionState === 'error' || connectionState === 'failed' || lastError) && (
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-gray-500 hover:text-gray-700"
          title="연결 진단 정보 보기"
        >
          <Info className="w-3 h-3" />
        </button>
      )}

      {/* 상세 정보 패널 */}
      {showDetails && (
        <div className="absolute top-full left-0 mt-2 p-4 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-80 text-xs">
          <div className="font-medium text-gray-900 mb-2">연결 진단 정보</div>
          
          {lastError && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded">
              <div className="font-medium text-red-800 mb-1">마지막 오류</div>
              <div className="text-red-700">{lastError.userMessage || lastError.error}</div>
              {lastError.details && (
                <div className="text-red-600 mt-1 text-xs">{lastError.details}</div>
              )}
              {lastError.errorCode && (
                <div className="text-red-500 mt-1 text-xs font-mono">코드: {lastError.errorCode}</div>
              )}
            </div>
          )}
          
          <div className="space-y-2 text-gray-600">
            <div><strong>상태:</strong> {connectionState}</div>
            {connectionInfo?.reconnectAttempts > 0 && (
              <div><strong>재연결 시도:</strong> {connectionInfo.reconnectAttempts}/{connectionInfo.maxReconnectAttempts}</div>
            )}
            <div><strong>WebSocket URL:</strong> <span className="font-mono break-all">{connectionInfo?.url}</span></div>
            <div><strong>온라인:</strong> {navigator.onLine ? '예' : '아니오'}</div>
            {connectionInfo?.readyStateText && (
              <div><strong>WebSocket 상태:</strong> {connectionInfo.readyStateText}</div>
            )}
            {connectionInfo?.totalMessagesSent > 0 && (
              <div><strong>메시지:</strong> 송신 {connectionInfo.totalMessagesSent}, 수신 {connectionInfo.totalMessagesReceived}</div>
            )}
          </div>
          
          <div className="mt-3 pt-2 border-t border-gray-200">
            <button
              onClick={() => setShowDetails(false)}
              className="text-primary-600 hover:text-primary-800 underline"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionStatus;