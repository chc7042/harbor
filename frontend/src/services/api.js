import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Axios 인스턴스 생성
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000, // 10 seconds timeout for normal API calls
  headers: {
    'Content-Type': 'application/json',
  },
});

// 요청 인터셉터 - 토큰 자동 추가
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 응답 인터셉터 - 간단한 401 처리 (단일 JWT 토큰)
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    // 401 에러 시 로그아웃 처리 (토큰 갱신 없음)
    if (error.response?.status === 401) {
      localStorage.removeItem('token');

      // 로그인 페이지가 아닌 경우에만 리다이렉트
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

// 파일 다운로드 함수
export const downloadFile = async (downloadUrl, fileName, onProgress = null) => {
  try {
    // 다운로드 시작 알림
    if (onProgress) {
      onProgress({ type: 'start', message: '다운로드를 시작합니다...' });
    }

    const response = await api.get(downloadUrl, {
      responseType: 'blob',
      timeout: 600000, // 10분 타임아웃
      onDownloadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress({
            type: 'progress',
            progress: percentCompleted,
            loaded: progressEvent.loaded,
            total: progressEvent.total,
            message: `다운로드 중... ${percentCompleted}%`
          });
        }
      },
    });

    // 다운로드 완료 후 파일 저장
    if (onProgress) {
      onProgress({ type: 'processing', message: '파일을 저장 중...' });
    }

    // Blob을 사용하여 파일 다운로드
    const blob = new Blob([response.data]);
    const url = window.URL.createObjectURL(blob);

    // 다운로드 링크 생성 및 클릭
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'download';
    document.body.appendChild(link);
    link.click();

    // 정리
    window.URL.revokeObjectURL(url);
    document.body.removeChild(link);

    if (onProgress) {
      onProgress({ type: 'complete', message: '다운로드가 완료되었습니다.' });
    }

    return { success: true };
  } catch (error) {
    console.error('File download error:', error);

    const errorMessage = error.code === 'ECONNABORTED' || error.message.includes('timeout')
      ? '다운로드 시간이 초과되었습니다. 파일이 클 수 있으니 잠시 후 다시 시도해주세요.'
      : error.response?.data?.error?.message || '다운로드에 실패했습니다.';

    if (onProgress) {
      onProgress({ type: 'error', message: errorMessage });
    }

    return {
      success: false,
      error: errorMessage
    };
  }
};

// 파일 업로드 함수
export const uploadFile = async (file, path, onProgress = null) => {
  try {

    // 업로드 시작 알림
    if (onProgress) {
      onProgress({ type: 'start', message: '업로드를 시작합니다...' });
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);


    const response = await api.post('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 300000, // 5분 타임아웃
      onUploadProgress: (progressEvent) => {

        if (onProgress && progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress({
            type: 'progress',
            progress: percentCompleted,
            loaded: progressEvent.loaded,
            total: progressEvent.total,
            message: `업로드 중... ${percentCompleted}%`
          });
        }
      },
    });


    if (onProgress) {
      onProgress({ type: 'complete', message: '업로드가 완료되었습니다.' });
    }

    return {
      success: true,
      data: response.data.data
    };
  } catch (error) {

    let errorMessage = '업로드에 실패했습니다.';

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      errorMessage = '업로드 시간이 초과되었습니다. 파일이 클 수 있으니 잠시 후 다시 시도해주세요.';
    } else if (error.response?.data?.error?.code === 'FILE_TOO_LARGE') {
      errorMessage = error.response.data.error.message;
    } else if (error.response?.data?.error?.message) {
      errorMessage = error.response.data.error.message;
    }


    if (onProgress) {
      onProgress({ type: 'error', message: errorMessage });
    }

    return {
      success: false,
      error: errorMessage
    };
  }
};

// 스트리밍 파일 업로드 함수 (대용량 파일용)
export const uploadFileStream = async (file, path, onProgress = null) => {
  try {
    // 업로드 시작 알림
    if (onProgress) {
      onProgress({ type: 'start', message: '스트리밍 업로드를 시작합니다...' });
    }

    const params = new URLSearchParams({
      path: path,
      filename: file.name
    });

    const response = await api.post(`/files/upload/stream?${params}`, file, {
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      timeout: 1800000, // 30분 타임아웃 (대용량 파일용)
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress({
            type: 'progress',
            progress: percentCompleted,
            loaded: progressEvent.loaded,
            total: progressEvent.total,
            message: `스트리밍 업로드 중... ${percentCompleted}%`
          });
        }
      },
    });

    if (onProgress) {
      onProgress({ type: 'complete', message: '스트리밍 업로드가 완료되었습니다.' });
    }

    return {
      success: true,
      data: response.data.data
    };
  } catch (error) {
    console.error('Stream upload error:', error);

    let errorMessage = '스트리밍 업로드에 실패했습니다.';

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      errorMessage = '업로드 시간이 초과되었습니다. 네트워크 상태를 확인하고 다시 시도해주세요.';
    } else if (error.response?.data?.error?.message) {
      errorMessage = error.response.data.error.message;
    }

    if (onProgress) {
      onProgress({ type: 'error', message: errorMessage });
    }

    return {
      success: false,
      error: errorMessage
    };
  }
};

// 지연 로딩을 위한 아티팩트 조회 함수
export const loadArtifacts = async (version, buildNumber) => {
  try {
    const response = await api.get(`/deployments/${version}/${buildNumber}/artifacts`);
    return response.data;
  } catch (error) {
    console.error(`Failed to load artifacts for version ${version}, build ${buildNumber}:`, error);
    throw error;
  }
};

// NAS 파일 검색 함수
export const searchNASFiles = async (searchPath = 'release_version', pattern = '', developer = '') => {
  try {
    const params = new URLSearchParams();
    if (searchPath) params.append('path', searchPath);
    if (pattern) params.append('pattern', pattern);
    if (developer) params.append('developer', developer);


    const response = await api.get(`/nas/search?${params}`);
    

    return response.data;
  } catch (error) {
    console.error('NAS 파일 검색 실패:', error);
    throw error;
  }
};

export default api;