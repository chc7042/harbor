import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Volume2, VolumeX, Smartphone, Check, X } from 'lucide-react';
import notificationService from '../services/notificationService';
import toast from 'react-hot-toast';

const NotificationSettings = ({ isOpen, onClose, className = '' }) => {
  const [preferences, setPreferences] = useState({});
  const [notificationStatus, setNotificationStatus] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = () => {
    const prefs = notificationService.getPreferences();
    const status = notificationService.getStatus();
    setPreferences(prefs);
    setNotificationStatus(status);
  };

  const handleRequestPermission = async () => {
    setIsLoading(true);
    try {
      const permission = await notificationService.requestPermission();
      if (permission === 'granted') {
        toast.success('브라우저 알림이 활성화되었습니다!');
        loadSettings();
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreferenceChange = (key, value) => {
    const updated = { ...preferences, [key]: value };
    setPreferences(updated);
    notificationService.savePreferences(updated);

    toast.success('알림 설정이 저장되었습니다.');
  };

  const handleTestNotification = () => {
    if (notificationStatus.canShow) {
      notificationService.showTestNotification();
      toast.success('테스트 알림을 전송했습니다.');
    } else {
      toast.error('브라우저 알림 권한이 필요합니다.');
    }
  };

  const handleEnableAll = () => {
    notificationService.enableAll();
    loadSettings();
    toast.success('모든 알림이 활성화되었습니다.');
  };

  const handleDisableAll = () => {
    notificationService.disableAll();
    loadSettings();
    toast.success('모든 알림이 비활성화되었습니다.');
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-content max-w-lg ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <Bell className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary-900">알림 설정</h2>
              <p className="text-sm text-gray-600">실시간 알림 환경설정</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 컨텐츠 */}
        <div className="p-6 space-y-6">
          {/* 브라우저 알림 상태 */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-primary-900">브라우저 알림 상태</h3>

            <div className={`p-4 rounded-lg border ${
              notificationStatus.canShow
                ? 'bg-green-50 border-green-200'
                : notificationStatus.permission === 'denied'
                ? 'bg-red-50 border-red-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}>
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-1">
                  {notificationStatus.canShow ? (
                    <Check className="w-5 h-5 text-green-600" />
                  ) : notificationStatus.permission === 'denied' ? (
                    <X className="w-5 h-5 text-red-600" />
                  ) : (
                    <Bell className="w-5 h-5 text-yellow-600" />
                  )}
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-medium ${
                    notificationStatus.canShow
                      ? 'text-green-800'
                      : notificationStatus.permission === 'denied'
                      ? 'text-red-800'
                      : 'text-yellow-800'
                  }`}>
                    {notificationStatus.canShow
                      ? '브라우저 알림이 활성화되었습니다'
                      : notificationStatus.permission === 'denied'
                      ? '브라우저 알림이 차단되었습니다'
                      : '브라우저 알림 권한이 필요합니다'}
                  </p>
                  <p className={`text-xs mt-1 ${
                    notificationStatus.canShow
                      ? 'text-green-600'
                      : notificationStatus.permission === 'denied'
                      ? 'text-red-600'
                      : 'text-yellow-600'
                  }`}>
                    {notificationStatus.canShow
                      ? '배포 상태 변경 시 브라우저 알림을 받을 수 있습니다.'
                      : notificationStatus.permission === 'denied'
                      ? '브라우저 설정에서 수동으로 알림을 허용해주세요.'
                      : '알림을 받으려면 브라우저 권한을 허용해주세요.'}
                  </p>
                </div>
              </div>

              {notificationStatus.permission !== 'granted' && notificationStatus.permission !== 'denied' && (
                <div className="mt-3">
                  <button
                    onClick={handleRequestPermission}
                    disabled={isLoading}
                    className="btn-primary text-sm"
                  >
                    {isLoading ? '요청 중...' : '브라우저 알림 허용'}
                  </button>
                </div>
              )}

              {notificationStatus.canShow && (
                <div className="mt-3">
                  <button
                    onClick={handleTestNotification}
                    className="btn-secondary text-sm"
                  >
                    테스트 알림 보내기
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 알림 설정 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-primary-900">알림 설정</h3>
              <div className="flex space-x-2">
                <button
                  onClick={handleEnableAll}
                  className="text-xs text-green-600 hover:text-green-800 underline"
                >
                  모두 켜기
                </button>
                <button
                  onClick={handleDisableAll}
                  className="text-xs text-red-600 hover:text-red-800 underline"
                >
                  모두 끄기
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {/* 배포 완료 알림 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Bell className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-primary-900">배포 완료 알림</p>
                    <p className="text-xs text-gray-500">배포 성공/실패 시 알림</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.deploymentUpdates || false}
                    onChange={(e) => handlePreferenceChange('deploymentUpdates', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* 배포 시작 알림 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <BellOff className="w-4 h-4 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-primary-900">배포 시작 알림</p>
                    <p className="text-xs text-gray-500">배포 시작 시 알림</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.deploymentStart || false}
                    onChange={(e) => handlePreferenceChange('deploymentStart', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* 시스템 알림 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Smartphone className="w-4 h-4 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-primary-900">시스템 알림</p>
                    <p className="text-xs text-gray-500">시스템 공지사항 및 중요 알림</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.systemNotifications || false}
                    onChange={(e) => handlePreferenceChange('systemNotifications', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* 사운드 알림 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    {preferences.soundEnabled ? (
                      <Volume2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-green-600" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-primary-900">사운드 알림</p>
                    <p className="text-xs text-gray-500">알림 시 사운드 재생</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.soundEnabled || false}
                    onChange={(e) => handlePreferenceChange('soundEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>

          {/* 추가 정보 */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <h4 className="text-sm font-medium text-primary-900 mb-2">알림에 대해</h4>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>• 실시간 배포 상태 변경 시 즉시 알림을 받습니다</li>
              <li>• 브라우저가 백그라운드에 있어도 알림을 받을 수 있습니다</li>
              <li>• 알림은 현재 탭에서만 유효하며, 탭을 닫으면 중지됩니다</li>
              <li>• 브라우저 설정에서 언제든지 알림을 차단할 수 있습니다</li>
            </ul>
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationSettings;