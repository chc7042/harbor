import React, { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, AlertCircle, Info, Download, Clock } from 'lucide-react';

const Toast = ({ toast, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // 애니메이션을 위해 약간의 지연 후 표시
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // 다운로드 진행률 표시
    if (toast.type === 'download-progress' && toast.progress !== undefined) {
      setProgress(toast.progress);
    }
  }, [toast.progress, toast.type]);

  useEffect(() => {
    // 자동 닫기 (에러 메시지는 더 오래 표시)
    if (toast.autoClose !== false) {
      const duration = toast.type === 'error' ? 8000 : 
                      toast.type === 'download-progress' ? 0 : // 진행률 토스트는 자동 닫기 안함
                      5000;
      
      if (duration > 0) {
        const timer = setTimeout(() => {
          handleClose();
        }, duration);
        return () => clearTimeout(timer);
      }
    }
  }, [toast.autoClose, toast.type]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onClose(toast.id), 300);
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      case 'info':
        return <Info className="w-5 h-5 text-blue-600" />;
      case 'download-start':
        return <Download className="w-5 h-5 text-blue-600" />;
      case 'download-progress':
        return <Clock className="w-5 h-5 text-blue-600 animate-spin" />;
      case 'download-complete':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      default:
        return <Info className="w-5 h-5 text-gray-600" />;
    }
  };

  const getBackgroundColor = () => {
    switch (toast.type) {
      case 'success':
      case 'download-complete':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'info':
      case 'download-start':
      case 'download-progress':
        return 'bg-blue-50 border-blue-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div 
      className={`
        relative w-full max-w-sm mx-auto mb-4 p-4 rounded-lg border shadow-lg
        transition-all duration-300 ease-in-out transform
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        ${getBackgroundColor()}
      `}
    >
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          {getIcon()}
        </div>
        
        <div className="flex-1 min-w-0">
          {toast.title && (
            <h4 className="text-sm font-medium text-gray-900 mb-1">
              {toast.title}
            </h4>
          )}
          
          <p className="text-sm text-gray-700">
            {toast.message}
          </p>
          
          {/* 다운로드 진행률 표시 */}
          {toast.type === 'download-progress' && typeof progress === 'number' && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>진행률</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
              {toast.fileSize && (
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{toast.fileName}</span>
                  <span>{toast.fileSize}</span>
                </div>
              )}
            </div>
          )}
        </div>
        
        <button 
          onClick={handleClose}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default Toast;