import api from './api.js';

/**
 * 통합 다운로드 서비스
 * JWT 토큰 지원 및 향상된 다운로드 기능 제공
 */
class DownloadService {
  constructor() {
    this.activeDownloads = new Map(); // 활성 다운로드 추적
    this.downloadHistory = []; // 다운로드 기록
    this.toastManager = null; // 토스트 매니저 (나중에 설정)
    this.notificationService = null; // 알림 서비스 (나중에 설정)
  }

  /**
   * 토스트 매니저 설정
   */
  setToastManager(toastManager) {
    this.toastManager = toastManager;
  }

  /**
   * 알림 서비스 설정
   */
  setNotificationService(notificationService) {
    this.notificationService = notificationService;
  }

  /**
   * 통합 다운로드 함수 (JWT 토큰 지원)
   * @param {string} filePath - 다운로드할 파일 경로
   * @param {string} fileName - 저장할 파일명
   * @param {object} options - 다운로드 옵션
   */
  async downloadFile(filePath, fileName, options = {}) {
    const downloadId = this.generateDownloadId();
    const startTime = Date.now();
    
    try {
      console.log(`[DOWNLOAD-${downloadId}] =================================`);
      console.log(`[DOWNLOAD-${downloadId}] 통합 다운로드 시작`);
      console.log(`[DOWNLOAD-${downloadId}] 파일 경로: ${filePath}`);
      console.log(`[DOWNLOAD-${downloadId}] 파일명: ${fileName}`);
      console.log(`[DOWNLOAD-${downloadId}] 옵션:`, options);

      // 다운로드 준비 알림
      this.showUserFeedback('preparing', fileName, { downloadId });
      if (options.onProgress) {
        options.onProgress({ 
          type: 'start', 
          downloadId,
          message: '스트리밍 다운로드를 준비 중입니다...' 
        });
      }

      // 활성 다운로드로 등록
      this.activeDownloads.set(downloadId, {
        filePath,
        fileName,
        startTime,
        status: 'preparing'
      });

      // JWT 토큰 가져오기
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('인증 토큰이 없습니다. 다시 로그인해주세요.');
      }

      console.log(`[DOWNLOAD-${downloadId}] JWT 토큰 확인 완료`);

      // 백엔드 리다이렉트 URL 생성 (JWT 토큰 포함)
      const downloadUrl = this.createDownloadUrl(filePath, token, options);
      console.log(`[DOWNLOAD-${downloadId}] 다운로드 URL 생성: ${downloadUrl.substring(0, 100)}...`);

      // 다운로드 전략 선택
      const strategy = options.strategy || this.selectDownloadStrategy(filePath, options);
      console.log(`[DOWNLOAD-${downloadId}] 선택된 전략: ${strategy}`);

      let result;
      switch (strategy) {
        case 'redirect':
          result = await this.downloadViaRedirect(downloadUrl, downloadId, options);
          break;
        case 'proxy':
          result = await this.downloadViaProxy(filePath, fileName, downloadId, options);
          break;
        case 'direct':
          result = await this.downloadViaDirect(downloadUrl, fileName, downloadId, options);
          break;
        default:
          throw new Error(`지원되지 않는 다운로드 전략: ${strategy}`);
      }

      // 다운로드 시작 처리 (redirect 방식은 브라우저가 처리)
      const duration = Date.now() - startTime;
      console.log(`[DOWNLOAD-${downloadId}] ✅ 다운로드 시작됨 (${duration}ms)`);
      console.log(`[DOWNLOAD-${downloadId}] =================================`);

      // redirect 방식의 경우 완료 메시지 표시하지 않음 (브라우저가 직접 처리)
      // 대신 시작 상태만 알림
      if (strategy === 'redirect') {
        this.showUserFeedback('started', fileName, { downloadId, duration });
      } else {
        // proxy나 direct 방식은 실제 완료 시점을 알 수 있으므로 완료 메시지 표시
        this.showUserFeedback('complete', fileName, { downloadId, duration });
      }

      // 다운로드 기록 저장
      this.saveDownloadHistory(downloadId, filePath, fileName, 'success', duration);
      
      // 활성 다운로드에서 제거
      this.activeDownloads.delete(downloadId);

      if (options.onProgress) {
        options.onProgress({ 
          type: 'complete', 
          downloadId,
          duration,
          message: '다운로드가 완료되었습니다.' 
        });
      }

      return { success: true, downloadId, duration };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[DOWNLOAD-${downloadId}] ❌ 다운로드 실패 (${duration}ms):`, error.message);
      console.error(`[DOWNLOAD-${downloadId}] =================================`);

      // 다운로드 실패 알림
      const errorMessage = this.getErrorMessage(error);
      this.showUserFeedback('error', fileName, { downloadId, duration, error: errorMessage });

      // 다운로드 기록 저장
      this.saveDownloadHistory(downloadId, filePath, fileName, 'failed', duration, error.message);
      
      // 활성 다운로드에서 제거
      this.activeDownloads.delete(downloadId);

      if (options.onProgress) {
        options.onProgress({ 
          type: 'error', 
          downloadId,
          duration,
          message: errorMessage 
        });
      }

      return { 
        success: false, 
        downloadId,
        error: errorMessage,
        duration 
      };
    }
  }

  /**
   * 리다이렉트 방식 다운로드 (즉시 다운로드, 스트리밍 지원, 메모리 효율적)
   */
  async downloadViaRedirect(downloadUrl, downloadId, options) {
    console.log(`[DOWNLOAD-${downloadId}] 즉시 스트리밍 다운로드 시작`);
    
    // 다운로드 상태 업데이트
    const downloadInfo = this.activeDownloads.get(downloadId);
    if (downloadInfo) {
      downloadInfo.status = 'streaming';
    }

    if (options.onProgress) {
      options.onProgress({ 
        type: 'redirect', 
        downloadId,
        message: '즉시 다운로드 시작 중...' 
      });
    }

    // 즉시 다운로드를 위한 숨겨진 링크 방식 (백엔드 스트리밍 → 브라우저 직접 처리)
    try {
      // 방법 1: 숨겨진 <a> 태그를 사용한 즉시 다운로드
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = ''; // 브라우저가 파일명을 자동으로 결정
      link.style.display = 'none';
      
      // DOM에 추가하고 즉시 클릭
      document.body.appendChild(link);
      link.click();
      
      // 정리
      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);
      
      console.log(`[DOWNLOAD-${downloadId}] 즉시 다운로드 링크 클릭 완료`);
      
      return { success: true, method: 'instant-download' };
    } catch (error) {
      console.error(`[DOWNLOAD-${downloadId}] 즉시 다운로드 실패, 폴백 시도:`, error);
      
      // 폴백: window.open을 사용한 즉시 다운로드
      try {
        const newWindow = window.open(downloadUrl, '_blank');
        if (newWindow) {
          // 다운로드가 시작되면 새 창을 즉시 닫음
          setTimeout(() => {
            if (newWindow && !newWindow.closed) {
              newWindow.close();
            }
          }, 1000);
        }
        
        console.log(`[DOWNLOAD-${downloadId}] 폴백 다운로드 완료`);
        return { success: true, method: 'instant-download-fallback' };
      } catch (fallbackError) {
        console.error(`[DOWNLOAD-${downloadId}] 모든 즉시 다운로드 방식 실패:`, fallbackError);
        throw new Error('브라우저에서 다운로드를 차단했습니다. 팝업 차단을 해제해주세요.');
      }
    }
  }

  /**
   * 프록시 방식 다운로드 (API를 통한 다운로드) - 레거시/폴백용
   * ⚠️ 메모리 버퍼링 발생 - 대용량 파일에는 사용하지 않음
   */
  async downloadViaProxy(filePath, fileName, downloadId, options) {
    console.log(`[DOWNLOAD-${downloadId}] ⚠️ 프록시 방식 다운로드 시작 (레거시 모드)`);
    console.warn(`[DOWNLOAD-${downloadId}] 프록시 방식은 메모리 버퍼링이 발생합니다. 대용량 파일에는 권장하지 않습니다.`);
    
    // 다운로드 상태 업데이트
    const downloadInfo = this.activeDownloads.get(downloadId);
    if (downloadInfo) {
      downloadInfo.status = 'buffering'; // 버퍼링 상태 표시
    }

    if (options.onProgress) {
      options.onProgress({ 
        type: 'start', 
        downloadId,
        message: '서버에서 파일을 메모리로 로딩 중... (시간이 걸릴 수 있습니다)' 
      });
    }

    const response = await api.get('/files/download', {
      params: { path: filePath },
      responseType: 'blob',
      timeout: 600000, // 10분 타임아웃
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          
          // 토스트 진행률 업데이트
          this.showUserFeedback('progress', fileName, { 
            downloadId, 
            progress: percentCompleted,
            loaded: progressEvent.loaded,
            total: progressEvent.total
          });
          
          if (options.onProgress) {
            options.onProgress({ 
              type: 'progress', 
              downloadId,
              progress: percentCompleted,
              loaded: progressEvent.loaded,
              total: progressEvent.total,
              message: `다운로드 중... ${percentCompleted}%`
            });
          }
        }
      },
    });

    // Blob을 사용하여 파일 다운로드
    const blob = new Blob([response.data]);
    const url = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    
    // 정리
    window.URL.revokeObjectURL(url);
    document.body.removeChild(link);

    return { success: true, method: 'proxy' };
  }

  /**
   * 직접 방식 다운로드 (외부 URL 다운로드)
   */
  async downloadViaDirect(downloadUrl, fileName, downloadId, options) {
    console.log(`[DOWNLOAD-${downloadId}] 직접 방식 다운로드 시작`);
    
    if (options.onProgress) {
      options.onProgress({ 
        type: 'start', 
        downloadId,
        message: '직접 다운로드 중...' 
      });
    }

    // fetch를 사용한 직접 다운로드
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
      throw new Error(`다운로드 실패: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    
    window.URL.revokeObjectURL(url);
    document.body.removeChild(link);

    return { success: true, method: 'direct' };
  }

  /**
   * 다운로드 URL 생성 (JWT 토큰 포함)
   */
  createDownloadUrl(filePath, token, options = {}) {
    const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
    // API_BASE_URL이 이미 /api를 포함하고 있으므로 중복 제거
    const baseUrl = API_BASE_URL.endsWith('/api') || API_BASE_URL.includes('/api') 
      ? `${API_BASE_URL}/files/download` 
      : `${API_BASE_URL}/api/files/download`;
    
    const params = new URLSearchParams({
      path: filePath
    });

    // JWT 토큰을 쿼리 파라미터로 추가 (브라우저 직접 다운로드 지원)
    if (options.includeTokenInUrl !== false) {
      params.append('token', token);
    }

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * 다운로드 전략 선택 (스트리밍 최적화)
   */
  selectDownloadStrategy(filePath, options) {
    // 사용자가 지정한 전략이 있으면 사용
    if (options.preferredStrategy) {
      return options.preferredStrategy;
    }

    // 백엔드 스트리밍 구현 후 모든 파일에 대해 redirect 우선 사용
    // redirect 방식은 브라우저가 직접 처리하여 메모리 버퍼링 없음
    
    // 파일 크기에 따른 전략 선택 (스트리밍 최적화)
    if (options.fileSize) {
      const fileSizeMB = options.fileSize / (1024 * 1024);
      
      if (fileSizeMB > 50) {
        return 'redirect'; // 대용량 파일은 무조건 리다이렉트 (메모리 우회)
      } else if (fileSizeMB > 5) {
        return 'redirect'; // 중간 크기도 리다이렉트 우선 (더 빠름)
      } else {
        return 'redirect'; // 소용량도 리다이렉트 (일관성)
      }
    }

    // 기본 전략: 리다이렉트 (스트리밍 지원, 메모리 효율적)
    return 'redirect';
  }

  /**
   * 다운로드 ID 생성
   */
  generateDownloadId() {
    return `dl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * 사용자 피드백 표시 (토스트 + 브라우저 알림)
   */
  showUserFeedback(type, fileName, options = {}) {
    const { downloadId, progress, duration, error, loaded, total } = options;

    // 토스트 알림
    if (this.toastManager) {
      switch (type) {
        case 'preparing':
          this.toastManager.showInfo(`${fileName} 다운로드 준비 중...`, { downloadId });
          break;
        case 'start':
          this.toastManager.showDownloadStart(fileName, { downloadId });
          break;
        case 'started':
          this.toastManager.showInfo(`${fileName} 다운로드를 요청했습니다. 브라우저 다운로드 창을 확인하세요.`, { downloadId });
          break;
        case 'progress':
          if (typeof progress === 'number') {
            const fileSize = total ? this.formatFileSize(total) : null;
            this.toastManager.showDownloadProgress(fileName, progress, { 
              downloadId, 
              fileSize,
              loaded,
              total
            });
          }
          break;
        case 'complete':
          this.toastManager.showDownloadComplete(fileName, { downloadId });
          break;
        case 'error':
          this.toastManager.showDownloadError(fileName, error, { downloadId });
          break;
      }
    }

    // 브라우저 알림 (에러만 표시, redirect 방식은 완료 알림 제외)
    if (this.notificationService && type === 'error') {
      try {
        if (type === 'error') {
          this.notificationService.showCustomNotification(
            '다운로드 실패',
            `${fileName} 다운로드 실패: ${error}`,
            {
              icon: '/favicon.ico',
              tag: `download-error-${downloadId}`,
              duration: 8000
            }
          );
        }
      } catch (notificationError) {
        console.warn('브라우저 알림 표시 실패:', notificationError);
      }
    }
  }

  /**
   * 파일 크기 포맷팅
   */
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 에러 메시지 변환 (향상된 에러 처리)
   */
  getErrorMessage(error) {
    // 네트워크 관련 에러
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return '다운로드 시간이 초과되었습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해주세요.';
    }
    
    if (error.code === 'NETWORK_ERROR' || error.message.includes('Network Error')) {
      return '네트워크 연결에 문제가 있습니다. 인터넷 연결을 확인해주세요.';
    }
    
    // HTTP 상태 코드별 에러 처리
    const status = error.response?.status;
    switch (status) {
      case 400:
        return '잘못된 요청입니다. 파일 경로를 확인해주세요.';
      case 401:
        return '인증이 만료되었습니다. 다시 로그인해주세요.';
      case 403:
        return '파일에 접근할 권한이 없습니다. 관리자에게 문의하세요.';
      case 404:
        return '파일을 찾을 수 없습니다. 파일이 이동되었거나 삭제되었을 수 있습니다.';
      case 413:
        return '파일이 너무 큽니다. 서버 설정으로 인해 다운로드할 수 없습니다.';
      case 429:
        return '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.';
      case 500:
        return '서버에 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      case 502:
      case 503:
      case 504:
        return '서버가 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';
    }
    
    // 서버에서 제공한 구체적인 에러 메시지 우선 사용
    if (error.response?.data?.error?.message) {
      return error.response.data.error.message;
    }
    
    if (error.response?.data?.message) {
      return error.response.data.message;
    }
    
    // 브라우저 관련 에러
    if (error.message.includes('popup') || error.message.includes('blocked')) {
      return '팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용해주세요.';
    }
    
    if (error.message.includes('CORS')) {
      return '보안 정책으로 인해 다운로드할 수 없습니다. 관리자에게 문의하세요.';
    }
    
    // 디스크 공간 관련 에러 (일부 브라우저에서 감지 가능)
    if (error.message.includes('disk') || error.message.includes('space')) {
      return '디스크 공간이 부족합니다. 저장 공간을 확보한 후 다시 시도해주세요.';
    }
    
    // 기타 에러의 경우 원본 메시지 사용하되 사용자 친화적으로 변환
    const originalMessage = error.message || '알 수 없는 오류';
    
    // 일반적인 개발자 용어를 사용자 친화적으로 변환
    let userFriendlyMessage = originalMessage
      .replace(/fetch/gi, '요청')
      .replace(/request/gi, '요청')
      .replace(/response/gi, '응답')
      .replace(/server/gi, '서버')
      .replace(/client/gi, '클라이언트');
    
    return `다운로드에 실패했습니다: ${userFriendlyMessage}`;
  }

  /**
   * 다운로드 기록 저장
   */
  saveDownloadHistory(downloadId, filePath, fileName, status, duration, error = null) {
    const record = {
      downloadId,
      filePath,
      fileName,
      status,
      duration,
      error,
      timestamp: new Date().toISOString()
    };

    this.downloadHistory.push(record);
    
    // 최대 100개 기록만 유지
    if (this.downloadHistory.length > 100) {
      this.downloadHistory = this.downloadHistory.slice(-100);
    }

    console.log(`[DOWNLOAD-${downloadId}] 다운로드 기록 저장:`, record);
  }

  /**
   * 활성 다운로드 목록 조회
   */
  getActiveDownloads() {
    return Array.from(this.activeDownloads.entries()).map(([id, info]) => ({
      downloadId: id,
      ...info
    }));
  }

  /**
   * 다운로드 기록 조회
   */
  getDownloadHistory(limit = 20) {
    return this.downloadHistory.slice(-limit).reverse();
  }

  /**
   * 다운로드 취소
   */
  cancelDownload(downloadId) {
    if (this.activeDownloads.has(downloadId)) {
      this.activeDownloads.delete(downloadId);
      console.log(`[DOWNLOAD-${downloadId}] 다운로드 취소됨`);
      return true;
    }
    return false;
  }

  /**
   * 모든 활성 다운로드 취소
   */
  cancelAllDownloads() {
    const count = this.activeDownloads.size;
    this.activeDownloads.clear();
    console.log(`모든 활성 다운로드 취소됨: ${count}개`);
    return count;
  }
}

// 싱글톤 인스턴스 생성
const downloadService = new DownloadService();

export default downloadService;

// 편의를 위한 개별 함수 export
export const downloadFile = (filePath, fileName, options) => 
  downloadService.downloadFile(filePath, fileName, options);

export const getActiveDownloads = () => 
  downloadService.getActiveDownloads();

export const getDownloadHistory = (limit) => 
  downloadService.getDownloadHistory(limit);

export const cancelDownload = (downloadId) => 
  downloadService.cancelDownload(downloadId);