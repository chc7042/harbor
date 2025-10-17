import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import PollingStatus from './PollingStatus';
import NotificationSettings from './NotificationSettings';
import UserAvatar from './UserAvatar';
import toast from 'react-hot-toast';

const Header = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // localStorage에서 마지막 업데이트 시간 가져오기
  useEffect(() => {
    const interval = setInterval(() => {
      const stored = localStorage.getItem('harbor_last_update');
      if (stored) {
        setLastUpdate(new Date(stored));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);


  const handleLogout = async () => {
    try {
      await logout();
      toast.success('로그아웃되었습니다.');
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('로그아웃 중 오류가 발생했습니다.');
    }
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleProfileClick = () => {
    setIsDropdownOpen(false);
    setIsProfileModalOpen(true);
  };


  return (
    <header className="bg-white border-b border-primary-200">
      <div className="container-max">
        <div className="flex items-center justify-between h-16">
          {/* 로고 */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-primary-900 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-primary-900">
                  Jenkins NAS 배포 이력
                </h1>
              </div>
            </div>
          </div>

          {/* 네비게이션 */}
          <nav className="hidden md:flex items-center">
            <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
              <a
                href="/dashboard"
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                  location.pathname === '/dashboard' || location.pathname === '/'
                    ? 'bg-white text-primary-900 shadow-sm'
                    : 'text-gray-600 hover:text-primary-900 hover:bg-white/50'
                }`}
              >
                📊 대시보드
              </a>
              <a
                href="/projects"
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                  location.pathname === '/projects'
                    ? 'bg-white text-primary-900 shadow-sm'
                    : 'text-gray-600 hover:text-primary-900 hover:bg-white/50'
                }`}
              >
                📁 프로젝트
              </a>
            </div>
          </nav>

          {/* 사용자 메뉴 */}
          <div className="flex items-center space-x-4">
            {/* 연결 상태 */}
            <PollingStatus lastUpdate={lastUpdate} />
            {/* 알림 버튼 */}
            <button
              onClick={() => setIsNotificationSettingsOpen(true)}
              className="relative p-2 text-primary-400 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-900 rounded-lg"
              title="알림 설정"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </button>

            {/* 사용자 드롭다운 */}
            <div className="relative">
              <button
                onClick={toggleDropdown}
                className="flex items-center space-x-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-900 rounded-lg p-2"
              >
                <UserAvatar user={user} size={32} />
                <div className="hidden md:block text-left">
                  <p className="text-primary-900 font-medium">
                    {user?.full_name || user?.name || user?.username}
                  </p>
                  <p className="text-primary-500 text-xs">
                    {user?.department || 'Development'}
                  </p>
                </div>
                <svg className="w-4 h-4 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* 드롭다운 메뉴 */}
              {isDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setIsDropdownOpen(false)}
                  ></div>
                  <div className="dropdown-menu z-20">
                    <div className="px-4 py-3 border-b border-primary-200">
                      <p className="text-sm font-medium text-primary-900">
                        {user?.full_name || user?.name || user?.username}
                      </p>
                      <p className="text-xs text-primary-500">
                        {user?.email}
                      </p>
                    </div>
                    <div className="py-1">
                      <button
                        className="dropdown-item"
                        onClick={handleProfileClick}
                      >
                        <div className="flex items-center">
                          <UserAvatar user={user} size={20} className="mr-3" />
                          <span>프로필</span>
                        </div>
                      </button>
                      <div className="border-t border-primary-200 my-1"></div>
                      <button
                        className="dropdown-item text-error-700 hover:bg-error-50"
                        onClick={handleLogout}
                      >
                        <div className="flex items-center">
                          <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          <span>로그아웃</span>
                        </div>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 알림 설정 모달 */}
      <NotificationSettings
        isOpen={isNotificationSettingsOpen}
        onClose={() => setIsNotificationSettingsOpen(false)}
      />

      {/* 프로필 모달 */}
      {isProfileModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-primary-900">프로필</h2>
              <button
                onClick={() => setIsProfileModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center space-x-4">
                <UserAvatar user={user} size={64} />
                <div>
                  <h3 className="text-lg font-medium text-primary-900">
                    {user?.full_name || user?.name || user?.username}
                  </h3>
                  <p className="text-sm text-primary-500">
                    {user?.department || 'Development'}
                  </p>
                  <p className="text-sm text-primary-400">
                    {user?.email}
                  </p>
                </div>
              </div>
              <div className="border-t pt-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">사용자 ID:</span>
                    <span className="text-sm font-medium">{user?.username}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">부서:</span>
                    <span className="text-sm font-medium">{user?.department || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">이메일:</span>
                    <span className="text-sm font-medium">{user?.email || '-'}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setIsProfileModalOpen(false)}
                className="px-4 py-2 bg-primary-900 text-white rounded-md hover:bg-primary-800 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

    </header>
  );
};

export default Header;