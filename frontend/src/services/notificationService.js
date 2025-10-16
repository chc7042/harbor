class NotificationService {
  constructor() {
    this.permission = 'default';
    this.isSupported = 'Notification' in window;
    this.preferences = this.loadPreferences();
  }

  /**
   * 브라우저 알림 지원 여부 확인
   */
  isNotificationSupported() {
    return this.isSupported;
  }

  /**
   * 현재 권한 상태 확인
   */
  getPermission() {
    if (!this.isSupported) return 'unsupported';
    return Notification.permission;
  }

  /**
   * 알림 권한 요청
   */
  async requestPermission() {
    if (!this.isSupported) {
      throw new Error('브라우저가 알림을 지원하지 않습니다.');
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission === 'denied') {
      throw new Error('알림 권한이 거부되었습니다. 브라우저 설정에서 수동으로 허용해주세요.');
    }

    try {
      const permission = await Notification.requestPermission();
      this.permission = permission;
      return permission;
    } catch (error) {
      throw new Error('알림 권한 요청 중 오류가 발생했습니다.');
    }
  }

  /**
   * 브라우저 알림 표시
   */
  show(title, options = {}) {
    if (!this.isSupported) {
      console.warn('Notifications not supported');
      return null;
    }

    if (Notification.permission !== 'granted') {
      console.warn('Notification permission not granted');
      return null;
    }

    const defaultOptions = {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'harbor-notification',
      renotify: false,
      requireInteraction: false,
      silent: false,
      ...options
    };

    try {
      const notification = new Notification(title, defaultOptions);

      // 자동 닫기 (지정된 시간 후)
      if (options.autoClose !== false) {
        setTimeout(() => {
          notification.close();
        }, options.duration || 5000);
      }

      // 클릭 이벤트
      if (options.onClick) {
        notification.onclick = options.onClick;
      }

      // 기본 클릭 동작 (포커스)
      notification.onclick = () => {
        window.focus();
        if (options.onClick) {
          options.onClick();
        }
      };

      return notification;
    } catch (error) {
      console.error('Failed to show notification:', error);
      return null;
    }
  }

  /**
   * 배포 상태 알림
   */
  showDeploymentNotification(deployment) {
    if (!this.preferences.deploymentUpdates) return;

    const { project_name, status, build_number, environment } = deployment;

    let title, body, icon;

    switch (status) {
      case 'success':
        title = '🎉 배포 성공';
        body = `${project_name} #${build_number}이(가) ${environment}에 성공적으로 배포되었습니다.`;
        icon = '✅';
        break;
      case 'failed':
        title = '❌ 배포 실패';
        body = `${project_name} #${build_number} 배포가 실패했습니다.`;
        icon = '❌';
        break;
      case 'in_progress':
        if (!this.preferences.deploymentStart) return;
        title = '⚡ 배포 시작';
        body = `${project_name} #${build_number} 배포가 시작되었습니다.`;
        icon = '⚡';
        break;
      default:
        return;
    }

    this.show(title, {
      body,
      icon: '/favicon.ico',
      tag: `deployment-${deployment.id}`,
      data: {
        type: 'deployment',
        deploymentId: deployment.id,
        projectName: project_name
      },
      actions: status === 'failed' ? [
        {
          action: 'view-logs',
          title: '로그 보기'
        }
      ] : undefined
    });
  }

  /**
   * 시스템 알림
   */
  showSystemNotification(notification) {
    if (!this.preferences.systemNotifications) return;

    const { title, message, type, showBrowserNotification } = notification;

    if (!showBrowserNotification) return;

    let icon;
    switch (type) {
      case 'success':
        icon = '✅';
        break;
      case 'warning':
        icon = '⚠️';
        break;
      case 'error':
        icon = '❌';
        break;
      case 'info':
      default:
        icon = 'ℹ️';
        break;
    }

    this.show(title || 'Harbor 알림', {
      body: message,
      icon: '/favicon.ico',
      tag: 'system-notification',
      data: {
        type: 'system',
        notificationType: type
      }
    });
  }

  /**
   * 사용자 정의 알림
   */
  showCustomNotification(title, message, options = {}) {
    return this.show(title, {
      body: message,
      ...options
    });
  }

  /**
   * 알림 환경설정 불러오기
   */
  loadPreferences() {
    const defaultPreferences = {
      deploymentUpdates: true,
      deploymentStart: false,
      systemNotifications: true,
      soundEnabled: true,
      vibrationEnabled: true
    };

    try {
      const saved = localStorage.getItem('harbor_notification_preferences');
      return saved ? { ...defaultPreferences, ...JSON.parse(saved) } : defaultPreferences;
    } catch (error) {
      console.error('Failed to load notification preferences:', error);
      return defaultPreferences;
    }
  }

  /**
   * 알림 환경설정 저장
   */
  savePreferences(preferences) {
    try {
      this.preferences = { ...this.preferences, ...preferences };
      localStorage.setItem('harbor_notification_preferences', JSON.stringify(this.preferences));
      return true;
    } catch (error) {
      console.error('Failed to save notification preferences:', error);
      return false;
    }
  }

  /**
   * 현재 환경설정 조회
   */
  getPreferences() {
    return { ...this.preferences };
  }

  /**
   * 특정 설정 업데이트
   */
  updatePreference(key, value) {
    return this.savePreferences({ [key]: value });
  }

  /**
   * 모든 알림 비활성화
   */
  disableAll() {
    return this.savePreferences({
      deploymentUpdates: false,
      deploymentStart: false,
      systemNotifications: false
    });
  }

  /**
   * 모든 알림 활성화
   */
  enableAll() {
    return this.savePreferences({
      deploymentUpdates: true,
      deploymentStart: true,
      systemNotifications: true
    });
  }

  /**
   * 알림 상태 정보
   */
  getStatus() {
    return {
      supported: this.isSupported,
      permission: this.getPermission(),
      preferences: this.getPreferences(),
      canShow: this.isSupported && Notification.permission === 'granted'
    };
  }

  /**
   * 테스트 알림
   */
  showTestNotification() {
    return this.show('Harbor 알림 테스트', {
      body: '알림이 정상적으로 설정되었습니다.',
      icon: '/favicon.ico',
      tag: 'test-notification'
    });
  }

  /**
   * 서비스 워커 등록 (향후 확장용)
   */
  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        return registration;
      } catch (error) {
        console.error('Service Worker registration failed:', error);
        throw error;
      }
    } else {
      throw new Error('Service Worker not supported');
    }
  }

  /**
   * 푸시 알림 구독 (향후 확장용)
   */
  async subscribeToPush(registration) {
    try {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(process.env.VITE_VAPID_PUBLIC_KEY)
      });

      return subscription;
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      throw error;
    }
  }

  /**
   * VAPID 키 변환 유틸리티
   */
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

// 싱글톤 인스턴스
const notificationService = new NotificationService();

export default notificationService;