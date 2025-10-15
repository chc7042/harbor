import React, { useState } from 'react';
import { RefreshCw, Pause, Play, Info, Clock } from 'lucide-react';
import { usePollingStatus, useDeploymentPolling } from '../hooks/usePolling';
import pollingService from '../services/pollingService';

const PollingStatus = ({ className = '', lastUpdate = null }) => {
  const { isActive, activePolling } = usePollingStatus();
  const [showDetails, setShowDetails] = useState(false);

  const getStatusConfig = () => {
    if (isActive) {
      return {
        icon: RefreshCw,
        text: '실시간 업데이트 대기',
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
        borderColor: 'border-blue-200',
        animate: false
      };
    } else {
      return {
        icon: Pause,
        text: '업데이트 중지',
        color: 'text-gray-600',
        bgColor: 'bg-gray-100',
        borderColor: 'border-gray-200'
      };
    }
  };

  const config = getStatusConfig();
  const IconComponent = config.icon;

  const handleTogglePolling = () => {
    if (isActive) {
      pollingService.stopAll();
    } else {
      // 폴링 재시작은 Dashboard 컴포넌트에서 자동으로 처리됨
      window.location.reload(); // 간단한 방법으로 페이지 새로고침
    }
  };

  return (
    <div className={`relative flex items-center space-x-2 ${className}`}>
      <div
        className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border text-xs font-medium ${config.color} ${config.bgColor} ${config.borderColor}`}
        title={`업데이트 상태: ${config.text}`}
      >
        <IconComponent
          className={`w-3 h-3 ${config.animate ? 'animate-spin' : ''}`}
        />
        <div className="flex flex-col leading-tight">
          <span className="hidden sm:inline">{config.text}</span>
          {lastUpdate && (
            <span className="text-xs text-gray-500">
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* 토글 버튼 */}
      <button
        onClick={handleTogglePolling}
        className="text-xs text-primary-600 hover:text-primary-800 underline"
        title={isActive ? '자동 업데이트 중지' : '자동 업데이트 시작'}
      >
        {isActive ? '중지' : '시작'}
      </button>

      {/* 상세 정보 버튼 */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="text-xs text-gray-500 hover:text-gray-700"
        title="업데이트 상태 보기"
      >
        <Info className="w-3 h-3" />
      </button>

      {/* 상세 정보 패널 */}
      {showDetails && (
        <div className="absolute top-full left-0 mt-2 p-4 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-80 text-xs">
          <div className="font-medium text-gray-900 mb-2">자동 업데이트 상태</div>

          <div className="space-y-2 text-gray-600">
            <div><strong>상태:</strong> {isActive ? '활성' : '비활성'}</div>
            <div><strong>활성 폴링:</strong> {activePolling.length}개</div>
            {activePolling.length > 0 && (
              <div className="ml-4">
                {activePolling.map((polling, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <Clock className="w-3 h-3 text-green-500" />
                    <span>{polling}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-blue-800">
            <div className="font-medium mb-1">자동 업데이트 정보</div>
            <div className="text-xs">
              • 배포 이력: 30초마다 업데이트<br />
              • 프로젝트 목록: 1분마다 업데이트<br />
              • 새로운 배포나 상태 변경 시 알림 표시
            </div>
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

export default PollingStatus;