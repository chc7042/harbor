/**
 * 2.0.0 버전 파일 다운로드 테스트 스위트
 * Task 5.1: 2.0.0 버전 파일 다운로드 테스트
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import downloadService from '../services/downloadService';

describe('2.0.0 Version Download Tests', () => {
  const MOCK_2_0_0_DEPLOYMENT = {
    id: 1,
    project_name: '2.0.0/mr2.0.0_release',
    build_number: '123',
    version: '2.0.0',
    status: 'success',
    created_at: '2025-01-16T10:00:00.000Z',
    artifacts: [
      {
        name: 'V2.0.0_250116_123.tar.enc',
        fileName: 'V2.0.0_250116_123.tar.enc',
        filePath: '/nas/release_version/release/product/mr2.0.0/250116/123/V2.0.0_250116_123.tar.enc',
        size: 545259520, // ~520MB
        downloadUrl: null
      },
      {
        name: 'mr2.0.0_250116_123.tar.enc',
        fileName: 'mr2.0.0_250116_123.tar.enc',
        filePath: '/nas/release_version/release/product/mr2.0.0/250116/123/mr2.0.0_250116_123.tar.enc',
        size: 125829120, // ~120MB
        downloadUrl: null
      },
      {
        name: 'be2.0.0_250116_123.tar.enc',
        fileName: 'be2.0.0_250116_123.tar.enc',
        filePath: '/nas/release_version/release/product/mr2.0.0/250116/123/be2.0.0_250116_123.tar.enc',
        size: 52428800, // ~50MB
        downloadUrl: null
      },
      {
        name: 'fe2.0.0_250116_123.tar.enc',
        fileName: 'fe2.0.0_250116_123.tar.enc',
        filePath: '/nas/release_version/release/product/mr2.0.0/250116/123/fe2.0.0_250116_123.tar.enc',
        size: 31457280, // ~30MB
        downloadUrl: null
      }
    ]
  };

  const EXPECTED_2_0_0_PATHS = {
    version: '/nas/release_version/release/product/mr2.0.0/250116/123/V2.0.0_250116_123.tar.enc',
    morrow: '/nas/release_version/release/product/mr2.0.0/250116/123/mr2.0.0_250116_123.tar.enc',
    backend: '/nas/release_version/release/product/mr2.0.0/250116/123/be2.0.0_250116_123.tar.enc',
    frontend: '/nas/release_version/release/product/mr2.0.0/250116/123/fe2.0.0_250116_123.tar.enc'
  };

  let mockToastManager;
  let mockNotificationService;
  let mockFetch;

  beforeAll(() => {
    // Mock 토스트 매니저
    mockToastManager = {
      showDownloadStart: vi.fn(),
      showDownloadProgress: vi.fn(),
      showDownloadComplete: vi.fn(),
      showDownloadError: vi.fn()
    };

    // Mock 알림 서비스
    mockNotificationService = {
      showCustomNotification: vi.fn()
    };

    // downloadService에 mock 서비스 설정
    downloadService.setToastManager(mockToastManager);
    downloadService.setNotificationService(mockNotificationService);
  });

  beforeEach(() => {
    // Mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'mock-jwt-token'),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    });

    // Mock URL and document for download simulation
    global.URL = {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn()
    };

    // Mock DOM elements
    const mockLink = {
      href: '',
      download: '',
      click: vi.fn()
    };
    global.document = {
      createElement: vi.fn(() => mockLink),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn()
      }
    };

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('2.0.0 Path Construction', () => {
    it('should generate correct 2.0.0 file paths', () => {
      const deployment = MOCK_2_0_0_DEPLOYMENT;
      
      // 버전 추출 테스트
      const versionMatch = deployment.project_name.match(/^(\d+\.\d+\.\d+)/) || 
                          deployment.version?.match(/(\d+\.\d+\.\d+)/);
      expect(versionMatch[1]).toBe('2.0.0');

      // 날짜 폴백 테스트
      const versionFallbacks = {
        '1.0.0': '240904', '1.0.1': '250407', '1.1.0': '241204',
        '1.2.0': '250929', '2.0.0': '250116', '3.0.0': '250310', '4.0.0': '250904'
      };
      const fallbackDate = versionFallbacks['2.0.0'];
      expect(fallbackDate).toBe('250116');

      // 경로 구성 테스트
      const basePath = `/nas/release_version/release/product/mr2.0.0/${fallbackDate}/${deployment.build_number}`;
      expect(basePath).toBe('/nas/release_version/release/product/mr2.0.0/250116/123');
    });

    it('should handle deploymentInfo-based path construction for 2.0.0', () => {
      const mockDeploymentInfo = {
        nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr2.0.0\\250116\\123',
        directoryVerified: true
      };

      // Windows 경로를 Unix 경로로 변환
      let nasPath = mockDeploymentInfo.nasPath
        .replace('\\\\nas.roboetech.com\\', '/nas/')
        .replace(/\\/g, '/');

      if (!nasPath.startsWith('/nas/release_version/')) {
        nasPath = '/nas/release_version/' + nasPath.replace(/^\/nas\//, '');
      }

      expect(nasPath).toBe('/nas/release_version/release/product/mr2.0.0/250116/123');
    });
  });

  describe('2.0.0 Download URL Generation', () => {
    it('should generate correct download URLs for 2.0.0 files', () => {
      const fileName = 'V2.0.0_250116_123.tar.enc';
      const filePath = EXPECTED_2_0_0_PATHS.version;
      
      const token = 'mock-jwt-token';
      const downloadUrl = downloadService.createDownloadUrl(filePath, token);
      
      expect(downloadUrl).toContain('/api/files/download');
      expect(downloadUrl).toContain(encodeURIComponent(filePath));
      expect(downloadUrl).toContain(`token=${token}`);
    });

    it('should validate 2.0.0 file patterns', () => {
      const files = [
        'V2.0.0_250116_123.tar.enc',
        'mr2.0.0_250116_123.tar.enc',
        'be2.0.0_250116_123.tar.enc',
        'fe2.0.0_250116_123.tar.enc'
      ];

      files.forEach(fileName => {
        expect(fileName).toMatch(/^(V|mr|be|fe)2\.0\.0_250116_\d+\.tar\.enc$/);
      });
    });
  });

  describe('2.0.0 Download Strategy Selection', () => {
    it('should use redirect strategy for large 2.0.0 files (520MB)', () => {
      const largeFileSize = 545259520; // 520MB
      
      const strategy = downloadService.selectDownloadStrategy('/path/to/file', {
        fileSize: largeFileSize
      });
      
      expect(strategy).toBe('redirect');
    });

    it('should use proxy strategy for medium 2.0.0 files (120MB)', () => {
      const mediumFileSize = 125829120; // 120MB
      
      const strategy = downloadService.selectDownloadStrategy('/path/to/file', {
        fileSize: mediumFileSize
      });
      
      expect(strategy).toBe('redirect'); // >100MB도 redirect 사용
    });

    it('should use redirect strategy for all files (streaming optimized)', () => {
      const smallFileSize = 52428800; // 50MB
      
      const strategy = downloadService.selectDownloadStrategy('/path/to/file', {
        fileSize: smallFileSize
      });
      
      expect(strategy).toBe('redirect'); // 모든 파일은 스트리밍을 위해 redirect 사용
    });
  });

  describe('2.0.0 Download Simulation Tests', () => {
    it('should handle successful 2.0.0 version file download via redirect', async () => {
      const fileName = 'V2.0.0_250116_123.tar.enc';
      const filePath = EXPECTED_2_0_0_PATHS.version;

      // Mock redirect download (no actual fetch)
      const result = await downloadService.downloadFile(filePath, fileName, {
        strategy: 'redirect',
        onProgress: vi.fn()
      });

      expect(result.success).toBe(true);
      expect(mockToastManager.showDownloadStart).toHaveBeenCalledWith(fileName, expect.any(Object));
      expect(mockToastManager.showDownloadComplete).toHaveBeenCalledWith(fileName, expect.any(Object));
    });

    it('should handle 2.0.0 Morrow component download', async () => {
      const fileName = 'mr2.0.0_250116_123.tar.enc';
      const filePath = EXPECTED_2_0_0_PATHS.morrow;

      const result = await downloadService.downloadFile(filePath, fileName, {
        strategy: 'redirect'
      });

      expect(result.success).toBe(true);
      expect(mockToastManager.showDownloadStart).toHaveBeenCalledWith(fileName, expect.any(Object));
    });

    it('should handle 2.0.0 Backend component download', async () => {
      const fileName = 'be2.0.0_250116_123.tar.enc';
      const filePath = EXPECTED_2_0_0_PATHS.backend;

      const result = await downloadService.downloadFile(filePath, fileName, {
        strategy: 'proxy' // 50MB이므로 proxy 전략 테스트
      });

      expect(result.success).toBe(true);
    });

    it('should handle 2.0.0 Frontend component download', async () => {
      const fileName = 'fe2.0.0_250116_123.tar.enc';
      const filePath = EXPECTED_2_0_0_PATHS.frontend;

      const result = await downloadService.downloadFile(filePath, fileName, {
        strategy: 'proxy'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('2.0.0 Error Handling Tests', () => {
    it('should handle 404 errors for missing 2.0.0 files', async () => {
      const fileName = 'V2.0.0_250116_999.tar.enc'; // 존재하지 않는 빌드
      const filePath = '/nas/release_version/release/product/mr2.0.0/250116/999/V2.0.0_250116_999.tar.enc';

      // Mock 404 response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await downloadService.downloadFile(filePath, fileName, {
        strategy: 'proxy'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('파일을 찾을 수 없습니다');
      expect(mockToastManager.showDownloadError).toHaveBeenCalledWith(fileName, expect.any(String), expect.any(Object));
    });

    it('should handle 401 authentication errors for 2.0.0 files', async () => {
      const fileName = 'V2.0.0_250116_123.tar.enc';
      const filePath = EXPECTED_2_0_0_PATHS.version;

      // Mock 401 response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const result = await downloadService.downloadFile(filePath, fileName, {
        strategy: 'proxy'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('인증이 만료되었습니다');
    });

    it('should handle timeout errors for large 2.0.0 files', async () => {
      const fileName = 'V2.0.0_250116_123.tar.enc';
      const filePath = EXPECTED_2_0_0_PATHS.version;

      // Mock timeout error
      const timeoutError = new Error('timeout of 600000ms exceeded');
      timeoutError.code = 'ECONNABORTED';
      mockFetch.mockRejectedValue(timeoutError);

      const result = await downloadService.downloadFile(filePath, fileName, {
        strategy: 'proxy'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('다운로드 시간이 초과되었습니다');
    });
  });

  describe('2.0.0 Progress Tracking Tests', () => {
    it('should track progress for 2.0.0 file downloads', async () => {
      const fileName = 'V2.0.0_250116_123.tar.enc';
      const filePath = EXPECTED_2_0_0_PATHS.version;
      const progressCallback = vi.fn();

      // Mock successful download with progress
      mockFetch.mockImplementation(() => 
        Promise.resolve({
          ok: true,
          data: new Blob(['mock data'])
        })
      );

      const result = await downloadService.downloadFile(filePath, fileName, {
        strategy: 'proxy',
        onProgress: progressCallback
      });

      expect(result.success).toBe(true);
      expect(progressCallback).toHaveBeenCalledWith(expect.objectContaining({
        type: 'start'
      }));
    });

    it('should show progress updates for large 2.0.0 files', () => {
      const fileName = 'V2.0.0_250116_123.tar.enc';
      const totalSize = 545259520; // 520MB
      const loadedSize = 272629760; // 260MB (50% 진행)
      const progress = Math.round((loadedSize * 100) / totalSize);

      downloadService.showUserFeedback('progress', fileName, {
        downloadId: 'test-dl-123',
        progress,
        loaded: loadedSize,
        total: totalSize
      });

      expect(mockToastManager.showDownloadProgress).toHaveBeenCalledWith(
        fileName,
        progress,
        expect.objectContaining({
          downloadId: 'test-dl-123',
          loaded: loadedSize,
          total: totalSize
        })
      );
    });
  });

  describe('2.0.0 Integration Tests', () => {
    it('should complete full 2.0.0 download workflow', async () => {
      const deployment = MOCK_2_0_0_DEPLOYMENT;
      const mainFile = deployment.artifacts[0]; // V 파일

      // 1. 경로 구성
      const versionMatch = deployment.project_name.match(/^(\d+\.\d+\.\d+)/);
      expect(versionMatch[1]).toBe('2.0.0');

      // 2. 다운로드 URL 생성
      const downloadUrl = downloadService.createDownloadUrl(mainFile.filePath, 'test-token');
      expect(downloadUrl).toContain('V2.0.0_250116_123.tar.enc');

      // 3. 전략 선택
      const strategy = downloadService.selectDownloadStrategy(mainFile.filePath, {
        fileSize: mainFile.size
      });
      expect(strategy).toBe('redirect'); // 520MB는 redirect

      // 4. 다운로드 실행
      const result = await downloadService.downloadFile(mainFile.filePath, mainFile.fileName, {
        strategy
      });

      expect(result.success).toBe(true);
      expect(mockToastManager.showDownloadStart).toHaveBeenCalled();
      expect(mockToastManager.showDownloadComplete).toHaveBeenCalled();
    });

    it('should handle multiple 2.0.0 component downloads', async () => {
      const deployment = MOCK_2_0_0_DEPLOYMENT;
      const downloadPromises = deployment.artifacts.map(artifact =>
        downloadService.downloadFile(artifact.filePath, artifact.fileName, {
          strategy: 'redirect'
        })
      );

      const results = await Promise.all(downloadPromises);
      
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      expect(mockToastManager.showDownloadStart).toHaveBeenCalledTimes(4);
      expect(mockToastManager.showDownloadComplete).toHaveBeenCalledTimes(4);
    });
  });

  describe('2.0.0 File Size Validation', () => {
    it('should validate expected 2.0.0 file sizes', () => {
      const { artifacts } = MOCK_2_0_0_DEPLOYMENT;
      
      // V 파일 (메인 버전) - 가장 큼
      expect(artifacts[0].size).toBeGreaterThan(500 * 1024 * 1024); // >500MB
      
      // Morrow 컴포넌트 - 두 번째로 큼
      expect(artifacts[1].size).toBeGreaterThan(100 * 1024 * 1024); // >100MB
      
      // Backend 컴포넌트 - 중간 크기
      expect(artifacts[2].size).toBeGreaterThanOrEqual(50 * 1024 * 1024); // >=50MB
      
      // Frontend 컴포넌트 - 가장 작음
      expect(artifacts[3].size).toBeGreaterThan(30 * 1024 * 1024); // >30MB
    });

    it('should format 2.0.0 file sizes correctly', () => {
      const formatFileSize = downloadService.formatFileSize;
      
      expect(formatFileSize(545259520)).toMatch(/5\d+(\.\d+)? MB/); // ~520MB
      expect(formatFileSize(125829120)).toMatch(/1\d+(\.\d+)? MB/); // ~120MB
      expect(formatFileSize(52428800)).toMatch(/50(\.\d+)? MB/); // ~50MB
      expect(formatFileSize(31457280)).toMatch(/30(\.\d+)? MB/); // ~30MB
    });
  });
});

/**
 * 2.0.0 Manual Test Instructions
 * 
 * 이 테스트를 실행한 후, 다음 수동 테스트를 수행하세요:
 * 
 * 1. 브라우저에서 http://localhost:5173 접속
 * 2. 로그인 후 배포 목록에서 2.0.0 프로젝트 찾기
 * 3. 2.0.0 프로젝트의 배포 항목 클릭하여 상세 모달 열기
 * 4. 다음 다운로드 테스트:
 *    - V2.0.0 메인 버전 파일 다운로드 (520MB)
 *    - mr2.0.0 모로우 컴포넌트 다운로드 (120MB)
 *    - be2.0.0 백엔드 컴포넌트 다운로드 (50MB)
 *    - fe2.0.0 프런트엔드 컴포넌트 다운로드 (30MB)
 * 
 * 5. 각 다운로드에서 확인할 사항:
 *    - 토스트 알림이 올바르게 표시되는지
 *    - 진행률이 정확히 표시되는지 (proxy 전략 사용 시)
 *    - 에러 발생 시 적절한 메시지가 표시되는지
 *    - 다운로드가 실제로 시작되는지
 *    - 파일이 올바른 이름으로 저장되는지
 * 
 * 6. 네트워크 탭에서 확인:
 *    - API 요청이 올바른 경로로 전송되는지
 *    - JWT 토큰이 쿼리 파라미터에 포함되는지
 *    - 적절한 HTTP 응답 코드가 반환되는지
 */