import React from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';

const ConnectionStatus = ({ className = '' }) => {
  const { isConnected, connectionState, connect } = useWebSocket();

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

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <div
        className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border text-xs font-medium ${config.color} ${config.bgColor} ${config.borderColor}`}
        title={`연결 상태: ${config.text}`}
      >
        <IconComponent
          className={`w-3 h-3 ${config.animate ? 'animate-spin' : ''}`}
        />
        <span className="hidden sm:inline">{config.text}</span>
      </div>

      {!isConnected && (connectionState === 'error' || connectionState === 'failed') && (
        <button
          onClick={connect}
          className="text-xs text-primary-600 hover:text-primary-800 underline"
          title="다시 연결"
        >
          재연결
        </button>
      )}
    </div>
  );
};

export default ConnectionStatus;