const axios = require('axios');
const logger = require('../config/logger');
// Updated multi-path testing logic

class SynologyApiService {
  constructor() {
    this.baseUrl = process.env.SYNOLOGY_BASE_URL || 'http://nas.roboetech.com:5000';
    this.sessionId = null;
    this.sessionExpiry = null;
  }

  /**
   * 시놀로지 NAS에 로그인하여 세션 ID를 획득
   */
  async login() {
    try {
      logger.info(`Attempting Synology login to ${this.baseUrl}`);

      const response = await axios.get(`${this.baseUrl}/webapi/auth.cgi`, {
        params: {
          api: 'SYNO.API.Auth',
          version: 6,
          method: 'login',
          account: process.env.SYNOLOGY_USERNAME || 'nasadmin',
          passwd: process.env.SYNOLOGY_PASSWORD || 'Cmtes123',
          session: process.env.SYNOLOGY_SESSION_NAME || 'FileStation',
          format: process.env.SYNOLOGY_FORMAT || 'sid',
        },
        timeout: 10000,
      });

      logger.info(`Synology API response status: ${response.status}`);
      logger.info('Synology API response data:', response.data);

      if (response.data && response.data.success) {
        this.sessionId = response.data.data.sid;
        this.sessionExpiry = Date.now() + (30 * 60 * 1000); // 30분 후 만료
        logger.info('Synology API login successful');
        return this.sessionId;
      } else {
        const errorCode = response.data?.error?.code;
        const errorMessage = response.data?.error?.message || 'Unknown error';
        logger.error(`Synology API login failed - Error code: ${errorCode}, Message: ${errorMessage}`);
        logger.error('Full response data:', response.data);
        throw new Error(`Login failed: ${errorCode} - ${errorMessage}`);
      }
    } catch (error) {
      if (error.response) {
        logger.error(`Synology API HTTP error: ${error.response.status} - ${error.response.statusText}`);
        logger.error('Response data:', error.response.data);
      } else if (error.request) {
        logger.error('Synology API network error - no response received');
        logger.error('Request details:', error.request);
      } else {
        logger.error('Synology API request setup error:', error.message);
      }
      throw error;
    }
  }

  /**
   * 세션이 유효한지 확인하고 필요시 재로그인
   */
  async ensureValidSession() {
    if (!this.sessionId || Date.now() > this.sessionExpiry) {
      logger.info('Session expired or not found, logging in...');
      await this.login();
    }
    return this.sessionId;
  }

  /**
   * 파일/폴더의 공유 링크를 생성
   * @param {string} path - 공유할 파일/폴더 경로 (예: "/release/product/mr3.0.0/250310/26")
   */
  async createShareLink(path) {
    try {
      await this.ensureValidSession();

      logger.info(`Creating share link for path: ${path}`);
      logger.info(`Using session ID: ${this.sessionId ? 'Present' : 'Missing'}`);

      const response = await axios.post(`${this.baseUrl}/webapi/entry.cgi`,
        new URLSearchParams({
          api: 'SYNO.FileStation.Sharing',
          version: 3,
          method: 'create',
          path: path,
          _sid: this.sessionId,
          password: '',
          enable_download: 'true',
          enable_upload: 'false',
          enable_browse: 'true',
          date_expired: '',
          date_available: '',
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        });

      logger.info(`Share creation response status: ${response.status}`);
      logger.info('Share creation response data:', JSON.stringify(response.data, null, 2));

      if (response.data && response.data.success) {
        const shareData = response.data.data;
        logger.info('Share data object:', JSON.stringify(shareData, null, 2));

        // Check if share already exists or was newly created
        if (shareData && shareData.links && shareData.links.length > 0) {
          const linkInfo = shareData.links[0];
          logger.info('Share link info:', JSON.stringify(linkInfo, null, 2));

          const shareUrl = linkInfo.url;
          const shareId = linkInfo.id;

          logger.info(`Share link created for ${path}: ${shareUrl}`);
          return {
            success: true,
            shareUrl: shareUrl,
            shareId: shareId,
            path: path,
          };
        } else {
          logger.error('Share creation succeeded but no links returned. Full response:', JSON.stringify(response.data, null, 2));
          throw new Error('Share creation succeeded but no links in response');
        }
      } else {
        const errorCode = response.data?.error?.code;
        const errorMessage = response.data?.error?.message || 'Unknown error';
        logger.error(`Share creation failed - Error code: ${errorCode}, Message: ${errorMessage}`);
        logger.error('Full response data:', response.data);
        throw new Error(`Share creation failed: ${errorCode} - ${errorMessage}`);
      }
    } catch (error) {
      if (error.response) {
        logger.error(`Share creation HTTP error: ${error.response.status} - ${error.response.statusText}`);
        logger.error('Response data:', error.response.data);
      } else if (error.request) {
        logger.error('Share creation network error - no response received');
      }
      logger.error(`Failed to create share link for ${path}:`, error.message);
      return {
        success: false,
        error: error.message,
        path: path,
      };
    }
  }

  /**
   * 경로가 존재하는지 확인
   * @param {string} path - 확인할 경로
   */
  async checkPathExists(path) {
    try {
      await this.ensureValidSession();

      logger.info(`Checking if path exists: ${path}`);

      const response = await axios.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: {
          api: 'SYNO.FileStation.List',
          version: 2,
          method: 'list',
          folder_path: path,
          additional: '["size","time","type"]',
          _sid: this.sessionId,
        },
        timeout: 10000,
      });

      logger.info(`Path check response status: ${response.status}`);
      logger.info('Path check response data:', response.data);

      if (response.data && response.data.success) {
        logger.info(`Path exists: ${path}`);
        return { success: true, exists: true };
      } else {
        const errorCode = response.data?.error?.code;
        logger.warn(`Path does not exist or access denied: ${path} - Error code: ${errorCode}`);
        return { success: false, exists: false, error: errorCode };
      }
    } catch (error) {
      logger.error(`Failed to check path existence for ${path}:`, error.message);
      return { success: false, exists: false, error: error.message };
    }
  }

  /**
   * 폴더 생성 (Synology FileStation API 사용)
   * @param {string} folderPath - 생성할 폴더 경로
   */
  async createFolder(folderPath) {
    try {
      await this.ensureValidSession();

      logger.info(`Creating folder: ${folderPath}`);

      // 상위 폴더들을 재귀적으로 생성하기 위해 경로를 분해
      const pathParts = folderPath.split('/').filter(part => part.length > 0);
      let currentPath = '';

      for (let i = 0; i < pathParts.length; i++) {
        currentPath += '/' + pathParts[i];
        
        // 각 레벨의 폴더가 존재하는지 확인
        const existsCheck = await this.checkPathExists(currentPath);
        if (existsCheck.exists) {
          logger.info(`Folder already exists: ${currentPath}`);
          continue;
        }

        // 폴더 생성
        logger.info(`Creating folder: ${currentPath}`);
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
        const folderName = pathParts[i];

        const response = await axios.post(`${this.baseUrl}/webapi/entry.cgi`, 
          new URLSearchParams({
            api: 'SYNO.FileStation.CreateFolder',
            version: 2,
            method: 'create',
            folder_path: parentPath,
            name: folderName,
            force_parent: 'true',
            _sid: this.sessionId,
          }), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 30000,
          });

        logger.info(`Folder creation response for ${currentPath}:`, JSON.stringify(response.data, null, 2));

        if (!response.data || !response.data.success) {
          const errorCode = response.data?.error?.code;
          const errorMessage = response.data?.error?.message || 'Unknown error';
          
          // 폴더가 이미 존재하는 경우는 성공으로 처리
          if (errorCode === 1006) { // Folder already exists
            logger.info(`Folder already exists (error 1006): ${currentPath}`);
            continue;
          }
          
          logger.error(`Failed to create folder ${currentPath}: ${errorCode} - ${errorMessage}`);
          throw new Error(`Folder creation failed: ${errorCode} - ${errorMessage}`);
        }

        logger.info(`Successfully created folder: ${currentPath}`);
      }

      return {
        success: true,
        path: folderPath,
        message: 'Folder created successfully'
      };

    } catch (error) {
      logger.error(`Failed to create folder ${folderPath}:`, error.message);
      return {
        success: false,
        error: error.message,
        path: folderPath
      };
    }
  }

  /**
   * 기존 공유 링크 조회
   * @param {string} path - 조회할 경로
   */
  async getShareLinks(path = null) {
    try {
      await this.ensureValidSession();

      const params = {
        api: 'SYNO.FileStation.Sharing',
        version: 3,
        method: 'list',
        _sid: this.sessionId,
      };

      if (path) {
        params.path = path;
      }

      const response = await axios.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: params,
        timeout: 10000,
      });

      if (response.data && response.data.success) {
        return {
          success: true,
          shares: response.data.data.shares || [],
        };
      } else {
        throw new Error(`Failed to get share links: ${response.data?.error?.code || 'Unknown error'}`);
      }
    } catch (error) {
      logger.error('Failed to get share links:', error.message);
      return {
        success: false,
        error: error.message,
        shares: [],
      };
    }
  }

  /**
   * 디렉토리 내 파일 목록을 조회
   * @param {string} folderPath - 폴더 경로 (예: "/release_version/release/product/mr3.0.0/250310/26")
   */
  async listDirectoryFiles(folderPath) {
    try {
      await this.ensureValidSession();

      logger.info(`Listing files in directory: ${folderPath}`);

      const response = await axios.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: {
          api: 'SYNO.FileStation.List',
          version: 2,
          method: 'list',
          folder_path: folderPath,
          additional: '["size","time","type"]',
          _sid: this.sessionId,
        },
        timeout: 10000,
      });

      if (response.data && response.data.success) {
        const files = response.data.data.files || [];
        logger.info(`Found ${files.length} files in directory: ${folderPath}`);
        // 첫 번째 파일의 구조를 로그로 확인
        if (files.length > 0) {
          logger.info('Sample file structure:', JSON.stringify(files[0], null, 2));
          logger.info('Full response data:', JSON.stringify(response.data, null, 2));
        }
        return {
          success: true,
          files: files.map(file => ({
            name: file.name,
            path: file.path,
            isDir: file.isdir,
            size: file.additional?.size || file.size || 0,
            mtime: file.additional?.time?.mtime || file.time?.mtime || file.mtime || null,
            type: file.additional?.type || file.type || null,
            additional: file.additional, // 원본 additional 데이터도 포함
          })),
        };
      } else {
        throw new Error(`Failed to list directory files: ${response.data?.error?.code || 'Unknown error'}`);
      }
    } catch (error) {
      logger.error('Failed to list directory files:', error.message);
      return {
        success: false,
        error: error.message,
        files: [],
      };
    }
  }

  /**
   * 실제 파일명을 기반으로 배포 파일 매핑 찾기
   * @param {string} folderPath - 폴더 경로
   * @param {string} version - 버전 (예: "3.0.0")
   * @param {string} date - 날짜 (예: "250310")
   */
  async findActualFileNames(folderPath, version, date) {
    try {
      const listResult = await this.listDirectoryFiles(folderPath);
      if (!listResult.success) {
        return { success: false, error: listResult.error };
      }

      const files = listResult.files.filter(f => !f.isDir);
      const fileMap = {};
      const fileInfoMap = {}; // 파일 정보 (크기, 수정일) 저장

      // 파일명 패턴 매칭
      files.forEach(file => {
        const fileName = file.name;

        // 파일 정보 저장 (additional 데이터 확인)
        logger.info(`Processing file: ${fileName}, full file object:`, JSON.stringify(file, null, 2));
        fileInfoMap[fileName] = {
          size: file.additional?.size || file.size || 0,
          mtime: file.additional?.time?.mtime || file.time?.mtime || file.mtime || null,
          type: file.additional?.type || file.type || null,
        };
        logger.info(`File info for ${fileName}:`, fileInfoMap[fileName]);

        // 메인 파일 패턴: V{version}_{date}_*.tar.gz
        if (fileName.match(new RegExp(`^V${version.replace(/\./g, '\\.')}_${date}_\\d+\\.tar\\.gz$`))) {
          fileMap.main = fileName;
        }

        // Morow 파일 패턴: mr{version}_{date}_*_*.enc.tar.gz
        if (fileName.match(new RegExp(`^mr${version.replace(/\./g, '\\.')}_${date}_\\d+_\\d+\\.enc\\.tar\\.gz$`))) {
          fileMap.morow = fileName;
        }

        // Backend 파일 패턴: be{version}_{date}_*_*.enc.tar.gz
        if (fileName.match(new RegExp(`^be${version.replace(/\./g, '\\.')}_${date}_\\d+_\\d+\\.enc\\.tar\\.gz$`))) {
          fileMap.backend = fileName;
        }

        // Frontend 파일 패턴: fe{version}_{date}_*_*.enc.tar.gz
        if (fileName.match(new RegExp(`^fe${version.replace(/\./g, '\\.')}_${date}_\\d+_\\d+\\.enc\\.tar\\.gz$`))) {
          fileMap.frontend = fileName;
        }
      });

      logger.info(`Found actual file names for version ${version}, date ${date}:`, fileMap);

      return {
        success: true,
        fileMap: fileMap,
        fileInfoMap: fileInfoMap, // 파일 정보 추가
        allFiles: files.map(f => f.name),
      };
    } catch (error) {
      logger.error('Failed to find actual file names:', error.message);
      return {
        success: false,
        error: error.message,
        fileMap: {},
      };
    }
  }

  /**
   * NAS 직접 다운로드 URL 생성 (개선된 로직)
   * @param {string} filePath - 파일 경로
   * @param {object} options - 추가 옵션
   */
  async createDirectDownloadUrl(filePath, options = {}) {
    const requestId = Math.random().toString(36).substr(2, 9);
    const startTime = Date.now();

    try {
      logger.info(`[SYNOLOGY-${requestId}] =================================`);
      logger.info(`[SYNOLOGY-${requestId}] 직접 다운로드 URL 생성 시작`);
      logger.info(`[SYNOLOGY-${requestId}] 파일 경로: ${filePath}`);
      logger.info(`[SYNOLOGY-${requestId}] 옵션:`, options);

      // URL 생성 전략들
      const urlStrategies = [
        {
          name: 'Session-based URL',
          method: this.createSessionBasedUrl.bind(this),
          requiresSession: true,
        },
        {
          name: 'Public Download URL',
          method: this.createPublicUrl.bind(this),
          requiresSession: false,
        },
        {
          name: 'Alternative API URL',
          method: this.createAlternativeUrl.bind(this),
          requiresSession: false,
        },
      ];

      // 각 전략을 순서대로 시도
      for (let i = 0; i < urlStrategies.length; i++) {
        const strategy = urlStrategies[i];

        try {
          logger.info(`[SYNOLOGY-${requestId}] 🚀 전략 ${i + 1}: ${strategy.name} 시도 중...`);
          const strategyStartTime = Date.now();

          // 세션이 필요한 전략인 경우 세션 확인
          if (strategy.requiresSession) {
            await this.ensureValidSession();
            logger.info(`[SYNOLOGY-${requestId}] 세션 확인 완료: ${this.sessionId ? 'OK' : 'FAILED'}`);
          }

          const result = await strategy.method(filePath, requestId, options);
          const strategyDuration = Date.now() - strategyStartTime;

          if (result.success) {
            const totalDuration = Date.now() - startTime;
            logger.info(`[SYNOLOGY-${requestId}] ✅ ${strategy.name} 성공! (${strategyDuration}ms)`);
            logger.info(`[SYNOLOGY-${requestId}] 생성된 URL: ${result.directNasUrl}`);
            logger.info(`[SYNOLOGY-${requestId}] =================================`);
            logger.info(`[SYNOLOGY-${requestId}] 전체 처리 시간: ${totalDuration}ms`);

            return {
              ...result,
              strategy: strategy.name,
              duration: totalDuration,
            };
          }
        } catch (strategyError) {
          logger.warn(`[SYNOLOGY-${requestId}] ⚠ ${strategy.name} 실패: ${strategyError.message}`);
        }
      }

      // 모든 전략이 실패한 경우
      throw new Error('모든 URL 생성 전략이 실패했습니다.');

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      logger.error(`[SYNOLOGY-${requestId}] ❌ 직접 다운로드 URL 생성 최종 실패 (${totalDuration}ms): ${error.message}`);
      logger.error(`[SYNOLOGY-${requestId}] =================================`);

      return {
        success: false,
        error: error.message,
        path: filePath,
        duration: totalDuration,
      };
    }
  }

  /**
   * 세션 기반 다운로드 URL 생성
   */
  async createSessionBasedUrl(filePath, requestId, options = {}) {
    if (!this.sessionId) {
      throw new Error('세션이 없습니다.');
    }

    // 경로 정규화
    const normalizedPath = this.normalizePath(filePath);
    logger.info(`[SYNOLOGY-${requestId}] 정규화된 경로: ${normalizedPath}`);

    // 세션 기반 다운로드 URL 생성
    const downloadUrl = `${this.baseUrl}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&path=${encodeURIComponent(normalizedPath)}&mode=download&_sid=${this.sessionId}`;

    // URL 검증 (선택적)
    if (options.validateUrl) {
      await this.validateDownloadUrl(downloadUrl, requestId);
    }

    return {
      success: true,
      downloadUrl: downloadUrl,
      directNasUrl: downloadUrl,
      path: normalizedPath,
      isDirectDownload: true,
      sessionBased: true,
    };
  }

  /**
   * 공개 다운로드 URL 생성 (세션 없이)
   */
  async createPublicUrl(filePath, requestId, _options) {
    const normalizedPath = this.normalizePath(filePath);

    // 공개 접근 가능한 URL 패턴들 시도
    const publicPatterns = [
      `${this.baseUrl}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&path=${encodeURIComponent(normalizedPath)}&mode=download`,
      `${this.baseUrl}/webapi/DownloadStation/Download.cgi?path=${encodeURIComponent(normalizedPath)}`,
      `${this.baseUrl}/fbdownload/${encodeURIComponent(normalizedPath.replace(/^\//, ''))}`,
    ];

    for (const url of publicPatterns) {
      try {
        logger.info(`[SYNOLOGY-${requestId}] 공개 URL 패턴 시도: ${url.substring(0, 100)}...`);

        return {
          success: true,
          downloadUrl: url,
          directNasUrl: url,
          path: normalizedPath,
          isDirectDownload: true,
          sessionBased: false,
        };
      } catch (error) {
        logger.warn(`[SYNOLOGY-${requestId}] 공개 URL 패턴 실패: ${error.message}`);
      }
    }

    throw new Error('공개 URL 생성 실패');
  }

  /**
   * 대안 API URL 생성
   */
  async createAlternativeUrl(filePath, requestId, options) {
    const normalizedPath = this.normalizePath(filePath);

    // Synology의 다른 API 엔드포인트들 시도
    const alternativeUrls = [
      `${this.baseUrl}/webapi/AudioStation/stream.cgi?method=stream&id=${encodeURIComponent(normalizedPath)}`,
      `${this.baseUrl}/webapi/VideoStation/vtestreaming.cgi?path=${encodeURIComponent(normalizedPath)}`,
      `${this.baseUrl}/sharing/download/${encodeURIComponent(normalizedPath.replace(/^\//, ''))}`,
    ];

    const url = alternativeUrls[0]; // 첫 번째 대안 URL만 시도

    return {
      success: true,
      downloadUrl: url,
      directNasUrl: url,
      path: normalizedPath,
      isDirectDownload: true,
      sessionBased: false,
      alternative: true,
    };
  }

  /**
   * 경로 정규화
   */
  normalizePath(filePath) {
    // 경로 앞의 /nas/release_version/ 제거 (이미 제거되었을 수도 있음)
    let normalized = filePath;

    if (normalized.startsWith('/nas/release_version/')) {
      normalized = '/' + normalized.replace('/nas/release_version/', '');
    }

    // 중복 슬래시 제거
    normalized = normalized.replace(/\/+/g, '/');

    // 시작 슬래시 확인
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }

    return normalized;
  }

  /**
   * 다운로드 URL 검증 (선택적)
   */
  async validateDownloadUrl(url, requestId) {
    try {
      logger.info(`[SYNOLOGY-${requestId}] URL 검증 중...`);

      // HEAD 요청으로 URL 유효성 확인
      const response = await axios.head(url, {
        timeout: 5000,
        validateStatus: (status) => status < 500, // 4xx는 허용 (인증 문제일 수 있음)
      });

      logger.info(`[SYNOLOGY-${requestId}] URL 검증 결과: ${response.status}`);
      return response.status < 400;
    } catch (error) {
      logger.warn(`[SYNOLOGY-${requestId}] URL 검증 실패: ${error.message}`);
      return false; // 검증 실패해도 URL은 사용 가능할 수 있음
    }
  }

  /**
   * 특정 파일의 직접 다운로드 링크를 생성
   * @param {string} filePath - 파일 경로 (예: "/release_version/release/product/mr3.0.0/250310/26/V3.0.0_250310_0830.tar.gz")
   */
  async createFileDownloadLink(filePath) {
    try {
      await this.ensureValidSession();

      logger.info(`Creating direct download link for file: ${filePath}`);

      // 먼저 직접 다운로드 URL 시도
      const directResult = await this.createDirectDownloadUrl(filePath);
      if (directResult.success) {
        logger.info(`Direct download URL created for ${filePath}: ${directResult.downloadUrl}`);
        return directResult;
      }

      // 직접 다운로드가 안 되면 공유 링크 생성을 시도
      logger.info(`Falling back to share link creation for ${filePath}`);
      const response = await axios.post(`${this.baseUrl}/webapi/entry.cgi`,
        new URLSearchParams({
          api: 'SYNO.FileStation.Sharing',
          version: 3,
          method: 'create',
          path: filePath,
          _sid: this.sessionId,
          password: '',
          enable_download: 'true',
          enable_upload: 'false',
          enable_browse: 'false',  // 파일 공유는 브라우징 비활성화
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        });

      logger.info(`File share creation response status: ${response.status}`);
      logger.info('File share creation response:', JSON.stringify(response.data, null, 2));

      if (response.data && !response.data.success) {
        logger.error('Synology API error:', response.data.error);
      }

      if (response.data && response.data.success) {
        const shareData = response.data.data;

        if (shareData && shareData.links && shareData.links.length > 0) {
          const linkInfo = shareData.links[0];

          // 파일 공유 링크는 직접 다운로드 URL로 변환 (즉시 다운로드)
          const directDownloadUrl = `${linkInfo.url}?mode=download`;

          logger.info(`File share created for ${filePath}, returning direct download URL: ${directDownloadUrl}`);
          return {
            success: true,
            downloadUrl: directDownloadUrl,
            directNasUrl: directDownloadUrl,
            shareUrl: linkInfo.url,
            shareId: linkInfo.id,
            path: filePath,
            isDirectDownload: true,
          };
        }
      }

      // 파일별 공유 링크 생성 실패 시 세션 기반 다운로드 URL 생성
      logger.warn('File share creation failed, using session-based download URL');
      const sessionDownloadUrl = `${this.baseUrl}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&path=${encodeURIComponent(filePath)}&mode=download&_sid=${this.sessionId}`;

      return {
        success: true,
        downloadUrl: sessionDownloadUrl,
        path: filePath,
        isDirectDownload: true,
        sessionBased: true,
        warning: 'Using session-based download URL',
      };

    } catch (error) {
      logger.error(`Failed to create download link for ${filePath}:`, error.message);
      return {
        success: false,
        error: error.message,
        path: filePath,
      };
    }
  }

  /**
   * 버전별 공유 링크를 가져오거나 생성
   * @param {string} version - 버전 (예: "3.0.0", "2.0.0")
   * @param {string} date - 날짜 (예: "250310")
   * @param {string} buildNumber - 빌드 번호 (예: "26")
   */
  async getOrCreateVersionShareLink(version, date, buildNumber) {
    // 여러 가능한 경로들을 시도 (가장 가능성 높은 순서대로)
    // 기본 smbclient 경로가 작동하므로 해당 경로 기준으로 시놀로지 절대경로 추측

    // mr 접두어가 있는 버전과 없는 버전 모두 지원
    const versionPatterns = [
      `mr${version}`,  // mr2.0.0, mr1.2.0 등
      version,         // 2.0.0, 1.2.0 등
      `${version.replace('mr', '')}`, // mr1.1.0 -> 1.1.0
    ];

    const possiblePaths = [
      '/',  // 루트 테스트
      '/volume1',  // 볼륨 테스트
      '/volume1/release_version',  // 공유 폴더 테스트
    ];

    // 각 버전 패턴에 대해 경로 생성
    for (const versionPattern of versionPatterns) {
      possiblePaths.push(
        `/volume1/release_version/release/product/${versionPattern}/${date}/${buildNumber}`,
        `/volume1/release_version/product/${versionPattern}/${date}/${buildNumber}`,
        `/release_version/release/product/${versionPattern}/${date}/${buildNumber}`,
        `/volume1/shared/release_version/release/product/${versionPattern}/${date}/${buildNumber}`,
        `/volume1/shared/release/product/${versionPattern}/${date}/${buildNumber}`,
        `/volume1/release/product/${versionPattern}/${date}/${buildNumber}`,
        `/release/product/${versionPattern}/${date}/${buildNumber}`,
        `/volume1/nas/release/product/${versionPattern}/${date}/${buildNumber}`,
        `/volume1/public/release/product/${versionPattern}/${date}/${buildNumber}`,
        `/nas/release/product/${versionPattern}/${date}/${buildNumber}`,
        `/shared/release/product/${versionPattern}/${date}/${buildNumber}`,
      );
    }

    let workingPath = null;

    try {
      // 각 경로를 순서대로 확인
      for (const testPath of possiblePaths) {
        logger.info(`Testing path: ${testPath}`);
        const pathCheck = await this.checkPathExists(testPath);

        if (pathCheck.success && pathCheck.exists) {
          logger.info(`Found working path: ${testPath}`);
          workingPath = testPath;
          break;
        } else {
          logger.warn(`Path not accessible: ${testPath} - Error: ${pathCheck.error}`);
        }
      }

      if (!workingPath) {
        logger.error(`None of the possible paths are accessible for version ${version}, date ${date}, build ${buildNumber}`);
        return {
          success: false,
          error: 'No accessible path found for the specified version',
          path: possiblePaths[0],
        };
      }

      // 기존 공유 링크가 있는지 확인
      const existingShares = await this.getShareLinks(workingPath);

      if (existingShares.success && existingShares.shares.length > 0) {
        const share = existingShares.shares[0];
        const shareUrl = `${this.baseUrl}/sharing/${share.id}`;

        logger.info(`Found existing share link for ${workingPath}: ${shareUrl}`);
        return {
          success: true,
          shareUrl: shareUrl,
          shareId: share.id,
          path: workingPath,
          isNew: false,
        };
      }

      // 기존 공유 링크가 없으면 새로 생성
      logger.info(`No existing share found for ${workingPath}, creating new one...`);
      const newShare = await this.createShareLink(workingPath);

      if (newShare.success) {
        newShare.isNew = true;
      }

      return newShare;
    } catch (error) {
      logger.error(`Failed to get or create share link for ${version}:`, error.message);
      return {
        success: false,
        error: error.message,
        path: possiblePaths[0],
      };
    }
  }

  /**
   * 특정 파일에 대한 다운로드 링크 생성 (버전 정보 기반)
   * @param {string} version - 버전 (예: "3.0.0")
   * @param {string} date - 날짜 (예: "250310")
   * @param {string} buildNumber - 빌드 번호 (예: "26")
   * @param {string} fileName - 다운로드할 파일명 (예: "V3.0.0_250310_0830.tar.gz")
   */
  async getOrCreateFileDownloadLink(version, date, buildNumber, fileName) {
    // 가능한 경로들을 시도 (폴더 경로에 파일명 추가)
    const basePaths = [
      `/release_version/release/product/mr${version}/${date}/${buildNumber}`,
      `/volume1/release_version/release/product/mr${version}/${date}/${buildNumber}`,
      `/release/product/mr${version}/${date}/${buildNumber}`,
    ];

    let workingPath = null;

    try {
      // 먼저 폴더가 존재하는지 확인
      for (const testPath of basePaths) {
        const pathCheck = await this.checkPathExists(testPath);

        if (pathCheck.success && pathCheck.exists) {
          workingPath = testPath;
          logger.info(`Found working directory: ${testPath}`);
          break;
        }
      }

      if (!workingPath) {
        return {
          success: false,
          error: `No accessible directory found for version ${version}`,
          path: null,
        };
      }

      // 파일 전체 경로 생성
      const fullFilePath = `${workingPath}/${fileName}`;
      logger.info(`Creating download link for file: ${fullFilePath}`);

      // 직접 다운로드 링크 생성 시도
      const downloadResult = await this.createFileDownloadLink(fullFilePath);

      if (downloadResult.success) {
        return {
          success: true,
          downloadUrl: downloadResult.downloadUrl,
          path: downloadResult.path,
          fileName: fileName,
          isDirectDownload: true,
        };
      } else {
        // 직접 다운로드가 실패하면 폴더 공유 링크 생성 (fallback)
        logger.warn('Direct download failed, creating folder share link as fallback');
        const folderShareResult = await this.getOrCreateVersionShareLink(version, date, buildNumber);

        if (folderShareResult.success) {
          return {
            success: true,
            shareUrl: folderShareResult.shareUrl,
            shareId: folderShareResult.shareId,
            path: folderShareResult.path,
            fileName: fileName,
            isDirectDownload: false,
            fallbackReason: downloadResult.error,
          };
        } else {
          return folderShareResult;
        }
      }
    } catch (error) {
      logger.error(`Failed to create file download link for ${fileName}:`, error.message);
      return {
        success: false,
        error: error.message,
        path: workingPath,
        fileName: fileName,
      };
    }
  }

  /**
   * 파일 목록 조회 (files API용) - 기존 호환성을 위한 메서드
   * @param {string} dirPath - 디렉토리 경로
   */
  async listFiles(dirPath = '') {
    return await this.listDirectoryFiles(dirPath);
  }

  /**
   * 로그아웃
   */
  async logout() {
    if (!this.sessionId) return;

    try {
      await axios.get(`${this.baseUrl}/webapi/auth.cgi`, {
        params: {
          api: 'SYNO.API.Auth',
          version: 6,
          method: 'logout',
          session: 'FileStation',
          _sid: this.sessionId,
        },
        timeout: 5000,
      });

      logger.info('Synology API logout successful');
    } catch (error) {
      logger.error('Synology API logout failed:', error.message);
    } finally {
      this.sessionId = null;
      this.sessionExpiry = null;
    }
  }

  /**
   * 단일 파일/폴더의 정보를 조회
   * @param {string} filePath - 파일/폴더 경로
   */
  async getFileInfo(filePath) {
    try {
      await this.ensureValidSession();

      logger.info(`Getting file info for path: ${filePath}`);

      const response = await axios.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: {
          api: 'SYNO.FileStation.List',
          version: 2,
          method: 'getinfo',
          path: filePath,
          additional: '["size","time","type"]',
          _sid: this.sessionId,
        },
        timeout: 10000,
      });

      logger.info(`File info response status: ${response.status}`);
      logger.info('File info response data:', response.data);

      if (response.data && response.data.success) {
        const {files} = response.data.data;
        if (files && files.length > 0) {
          const fileData = files[0];
          logger.info(`File info retrieved for ${filePath}:`, JSON.stringify(fileData, null, 2));
          return {
            success: true,
            data: fileData,
          };
        } else {
          logger.warn(`No file data returned for ${filePath}`);
          return { success: false, error: 'File not found' };
        }
      } else {
        const errorCode = response.data?.error?.code;
        const errorMessage = response.data?.error?.message || 'Unknown error';
        logger.warn(`File info request failed for ${filePath} - Error code: ${errorCode}, Message: ${errorMessage}`);
        return { success: false, error: `${errorCode} - ${errorMessage}` };
      }
    } catch (error) {
      logger.error(`Failed to get file info for ${filePath}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 파일 다운로드 (바이너리 데이터)
   */
  async downloadFile(filePath) {
    try {
      await this.ensureValidSession();

      logger.info(`Downloading file: ${filePath}`);

      const response = await axios.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: {
          api: 'SYNO.FileStation.Download',
          version: 2,
          method: 'download',
          path: filePath,
          mode: 'download',
          _sid: this.sessionId,
        },
        responseType: 'arraybuffer', // 바이너리 데이터로 받기
        timeout: 300000, // 5분 타임아웃
      });

      if (response.status === 200) {
        logger.info(`File downloaded successfully: ${filePath}, size: ${response.data.length} bytes`);
        return {
          success: true,
          data: Buffer.from(response.data),
          filename: filePath.split('/').pop(),
          size: response.data.length,
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error) {
      logger.error(`Failed to download file ${filePath}:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 파일 업로드 (Synology FileStation API 사용)
   */
  async uploadFile(fileBuffer, targetPath, originalName) {
    try {
      await this.ensureValidSession();

      logger.info(`Synology API 파일 업로드 시작: ${originalName}`);
      logger.info(`업로드 경로: ${targetPath}`);
      logger.info(`세션 ID: ${this.sessionId ? 'Present' : 'Missing'}`);

      // Synology API 경로 정규화 (공유 폴더 기준)
      let dirPath = targetPath;
      
      // 백슬래시를 슬래시로 변환
      dirPath = dirPath.replace(/\\/g, '/');
      
      // /volume1/ 접두어 제거 (Synology API에서는 공유 폴더명으로 시작)
      if (dirPath.startsWith('/volume1/')) {
        dirPath = dirPath.replace('/volume1/', '/');
      }
      
      // 연속된 슬래시 제거
      dirPath = dirPath.replace(/\/+/g, '/');
      
      // 시작 슬래시 확인
      if (!dirPath.startsWith('/')) {
        dirPath = '/' + dirPath;
      }
      
      if (!dirPath.endsWith('/')) {
        dirPath += '/';
      }
      
      logger.info(`원본 경로: ${targetPath}`);
      logger.info(`정규화된 업로드 디렉토리: ${dirPath}`);

      // 업로드 디렉토리 경로 (마지막 슬래시 제거)
      const parentPath = dirPath.slice(0, -1);
      logger.info(`최종 업로드 대상 디렉토리: ${parentPath}`);

      // API 파라미터 정의
      const apiParams = {
        api: 'SYNO.FileStation.Upload',
        version: '2',
        method: 'upload',
        path: parentPath,
        overwrite: 'true',
        _sid: this.sessionId
      };

      // FormData 생성
      const FormData = require('form-data');
      const form = new FormData();
      
      // API 파라미터를 FormData에 추가
      Object.entries(apiParams).forEach(([key, value]) => {
        form.append(key, value);
      });
      
      // 파일을 FormData에 추가
      form.append('file', fileBuffer, {
        filename: originalName,
        contentType: 'application/octet-stream'
      });

      // URL에도 파라미터 추가 (Error 119 해결)
      const urlParams = new URLSearchParams(apiParams);
      const uploadUrl = `${this.baseUrl}/webapi/entry.cgi?${urlParams}`;
      
      logger.info(`업로드 URL: ${uploadUrl}`);
      logger.info(`업로드 디렉토리: ${parentPath}`);
      logger.info(`세션 ID: ${this.sessionId ? this.sessionId.substring(0, 10) + '...' : 'MISSING'}`);
      logger.info(`파일 크기: ${fileBuffer.length} bytes`);
      logger.info(`파일명: ${originalName}`);

      // 업로드 전 경로 존재 여부 확인 (공유 폴더 기반 경로)
      logger.info('업로드 경로 단계별 확인 중...');
      
      // Synology FileStation API는 공유 폴더 경로를 사용 (/volume1 접두어 없음)
      const pathsToCheck = [
        '/release_version',
        '/release_version/release',
        '/release_version/release/upload'
      ];
      
      for (const checkPath of pathsToCheck) {
        const pathResult = await this.checkPathExists(checkPath);
        logger.info(`경로 ${checkPath}: ${JSON.stringify(pathResult)}`);
        
        if (!pathResult.exists) {
          // 경로가 없으면 생성 시도
          logger.warn(`경로가 존재하지 않음, 생성 시도: ${checkPath}`);
          const createResult = await this.createFolder(checkPath);
          
          if (!createResult.success) {
            logger.error(`경로 생성 실패: ${checkPath} - ${createResult.error}`);
            throw new Error(`Path does not exist and cannot be created: ${checkPath}. Upload target: ${parentPath}`);
          } else {
            logger.info(`경로 생성 성공: ${checkPath}`);
          }
        }
      }

      logger.info('업로드 요청 시작...');
      
      // 업로드 요청 (Content-Length 자동 처리)
      const response = await axios.post(uploadUrl, form, {
        headers: {
          ...form.getHeaders(),
          // Content-Length를 수동으로 설정하지 않음 (자동 처리)
        },
        timeout: 300000, // 5분 타임아웃으로 조정
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            logger.info(`업로드 진행률: ${percentCompleted}% (${progressEvent.loaded}/${progressEvent.total} bytes)`);
          }
        }
      });
      
      logger.info('업로드 요청 완료');

      logger.info(`Synology 업로드 응답 상태: ${response.status}`);
      logger.info('Synology 업로드 응답 데이터:', JSON.stringify(response.data, null, 2));

      if (response.data && response.data.success) {
        logger.info(`파일 업로드 성공: ${originalName} -> ${dirPath}`);
        return {
          success: true,
          filename: originalName,
          path: dirPath + originalName,
          size: fileBuffer.length,
        };
      } else {
        const errorCode = response.data?.error?.code;
        const errorMessage = response.data?.error?.message || 'Unknown upload error';
        logger.error(`Synology 업로드 실패 - Error code: ${errorCode}, Message: ${errorMessage}`);
        logger.error(`전체 응답: ${JSON.stringify(response.data, null, 2)}`);
        throw new Error(`Upload failed: ${errorCode} - ${errorMessage}`);
      }

    } catch (error) {
      if (error.response) {
        logger.error(`Synology 업로드 HTTP 오류: ${error.response.status} - ${error.response.statusText}`);
        logger.error('응답 데이터:', error.response.data);
      }
      logger.error(`Synology 파일 업로드 실패: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new SynologyApiService();
