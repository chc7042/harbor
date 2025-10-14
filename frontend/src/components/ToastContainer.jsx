import React, { createContext, useContext, useState, useCallback } from 'react';
import Toast from './Toast';

// Toast 컨텍스트 생성
const ToastContext = createContext();

// Toast 훅
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

let toastIdCounter = 0;

// Toast Provider
export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((toastData) => {
    const id = ++toastIdCounter;
    const toast = {
      id,
      timestamp: Date.now(),
      autoClose: true,
      ...toastData
    };

    setToasts(prev => {
      // 같은 타입의 다운로드 진행률 토스트가 이미 있다면 업데이트
      if (toast.type === 'download-progress' && toast.downloadId) {
        const existing = prev.find(t => 
          t.type === 'download-progress' && 
          t.downloadId === toast.downloadId
        );
        
        if (existing) {
          return prev.map(t => 
            t.id === existing.id 
              ? { ...t, ...toast, id: existing.id }
              : t
          );
        }
      }

      // 최대 5개의 토스트만 유지
      const newToasts = [...prev, toast];
      return newToasts.slice(-5);
    });

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  // 편의 메서드들
  const showSuccess = useCallback((message, options = {}) => {
    return addToast({
      type: 'success',
      message,
      ...options
    });
  }, [addToast]);

  const showError = useCallback((message, options = {}) => {
    return addToast({
      type: 'error',
      message,
      autoClose: false, // 에러는 수동으로 닫기
      ...options
    });
  }, [addToast]);

  const showWarning = useCallback((message, options = {}) => {
    return addToast({
      type: 'warning',
      message,
      ...options
    });
  }, [addToast]);

  const showInfo = useCallback((message, options = {}) => {
    return addToast({
      type: 'info',
      message,
      ...options
    });
  }, [addToast]);

  // 다운로드 관련 토스트 메서드들
  const showDownloadStart = useCallback((fileName, options = {}) => {
    return addToast({
      type: 'download-start',
      title: '다운로드 시작',
      message: `${fileName} 다운로드를 시작합니다.`,
      ...options
    });
  }, [addToast]);

  const showDownloadProgress = useCallback((fileName, progress, options = {}) => {
    return addToast({
      type: 'download-progress',
      title: '다운로드 중',
      message: `${fileName} 다운로드 중...`,
      progress,
      fileName,
      autoClose: false,
      ...options
    });
  }, [addToast]);

  const showDownloadComplete = useCallback((fileName, options = {}) => {
    return addToast({
      type: 'download-complete',
      title: '다운로드 완료',
      message: `${fileName} 다운로드가 완료되었습니다.`,
      ...options
    });
  }, [addToast]);

  const showDownloadError = useCallback((fileName, error, options = {}) => {
    return addToast({
      type: 'error',
      title: '다운로드 실패',
      message: `${fileName} 다운로드 실패: ${error}`,
      autoClose: false,
      ...options
    });
  }, [addToast]);

  const value = {
    addToast,
    removeToast,
    clearAllToasts,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showDownloadStart,
    showDownloadProgress,
    showDownloadComplete,
    showDownloadError
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

// Toast Container 컴포넌트
const ToastContainer = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map(toast => (
        <Toast 
          key={toast.id} 
          toast={toast} 
          onClose={onRemove}
        />
      ))}
    </div>
  );
};

export default ToastContainer;