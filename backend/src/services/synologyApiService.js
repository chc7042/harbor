const axios = require('axios');
const logger = require('../config/logger');
// Updated multi-path testing logic

class SynologyApiService {
  constructor() {
    this.baseUrl = 'https://nas.roboetech.com:5001';
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
          account: 'nasadmin',
          passwd: 'Cmtes123',
          session: 'FileStation',
          format: 'sid'
        },
        timeout: 10000
      });

      logger.info(`Synology API response status: ${response.status}`);
      logger.info(`Synology API response data:`, response.data);

      if (response.data && response.data.success) {
        this.sessionId = response.data.data.sid;
        this.sessionExpiry = Date.now() + (30 * 60 * 1000); // 30분 후 만료
        logger.info('Synology API login successful');
        return this.sessionId;
      } else {
        const errorCode = response.data?.error?.code;
        const errorMessage = response.data?.error?.message || 'Unknown error';
        logger.error(`Synology API login failed - Error code: ${errorCode}, Message: ${errorMessage}`);
        logger.error(`Full response data:`, response.data);
        throw new Error(`Login failed: ${errorCode} - ${errorMessage}`);
      }
    } catch (error) {
      if (error.response) {
        logger.error(`Synology API HTTP error: ${error.response.status} - ${error.response.statusText}`);
        logger.error(`Response data:`, error.response.data);
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
          date_available: ''
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        });

      logger.info(`Share creation response status: ${response.status}`);
      logger.info(`Share creation response data:`, JSON.stringify(response.data, null, 2));

      if (response.data && response.data.success) {
        const shareData = response.data.data;
        logger.info(`Share data object:`, JSON.stringify(shareData, null, 2));
        
        // Check if share already exists or was newly created
        if (shareData && shareData.links && shareData.links.length > 0) {
          const linkInfo = shareData.links[0];
          logger.info(`Share link info:`, JSON.stringify(linkInfo, null, 2));
          
          const shareUrl = linkInfo.url;
          const shareId = linkInfo.id;
          
          logger.info(`Share link created for ${path}: ${shareUrl}`);
          return {
            success: true,
            shareUrl: shareUrl,
            shareId: shareId,
            path: path
          };
        } else {
          logger.error(`Share creation succeeded but no links returned. Full response:`, JSON.stringify(response.data, null, 2));
          throw new Error(`Share creation succeeded but no links in response`);
        }
      } else {
        const errorCode = response.data?.error?.code;
        const errorMessage = response.data?.error?.message || 'Unknown error';
        logger.error(`Share creation failed - Error code: ${errorCode}, Message: ${errorMessage}`);
        logger.error(`Full response data:`, response.data);
        throw new Error(`Share creation failed: ${errorCode} - ${errorMessage}`);
      }
    } catch (error) {
      if (error.response) {
        logger.error(`Share creation HTTP error: ${error.response.status} - ${error.response.statusText}`);
        logger.error(`Response data:`, error.response.data);
      } else if (error.request) {
        logger.error('Share creation network error - no response received');
      }
      logger.error(`Failed to create share link for ${path}:`, error.message);
      return {
        success: false,
        error: error.message,
        path: path
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
          _sid: this.sessionId
        },
        timeout: 10000
      });

      logger.info(`Path check response status: ${response.status}`);
      logger.info(`Path check response data:`, response.data);

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
        _sid: this.sessionId
      };

      if (path) {
        params.path = path;
      }

      const response = await axios.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: params,
        timeout: 10000
      });

      if (response.data && response.data.success) {
        return {
          success: true,
          shares: response.data.data.shares || []
        };
      } else {
        throw new Error(`Failed to get share links: ${response.data?.error?.code || 'Unknown error'}`);
      }
    } catch (error) {
      logger.error('Failed to get share links:', error.message);
      return {
        success: false,
        error: error.message,
        shares: []
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
          _sid: this.sessionId
        },
        timeout: 10000
      });

      if (response.data && response.data.success) {
        const files = response.data.data.files || [];
        logger.info(`Found ${files.length} files in directory: ${folderPath}`);
        // 첫 번째 파일의 구조를 로그로 확인
        if (files.length > 0) {
          logger.info(`Sample file structure:`, JSON.stringify(files[0], null, 2));
          logger.info(`Full response data:`, JSON.stringify(response.data, null, 2));
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
            additional: file.additional // 원본 additional 데이터도 포함
          }))
        };
      } else {
        throw new Error(`Failed to list directory files: ${response.data?.error?.code || 'Unknown error'}`);
      }
    } catch (error) {
      logger.error('Failed to list directory files:', error.message);
      return {
        success: false,
        error: error.message,
        files: []
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
          type: file.additional?.type || file.type || null
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
        allFiles: files.map(f => f.name)
      };
    } catch (error) {
      logger.error('Failed to find actual file names:', error.message);
      return {
        success: false,
        error: error.message,
        fileMap: {}
      };
    }
  }

  /**
   * Synology FileStation Download API를 사용한 직접 다운로드 URL 생성
   * @param {string} filePath - 파일 경로
   */
  async createDirectDownloadUrl(filePath) {
    try {
      await this.ensureValidSession();

      logger.info(`Creating direct download URL for file: ${filePath}`);

      // FileStation Download API 사용
      const downloadUrl = `${this.baseUrl}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&path=${encodeURIComponent(filePath)}&mode=download&_sid=${this.sessionId}`;
      
      // URL 테스트
      const testResponse = await axios.head(downloadUrl, { 
        timeout: 5000,
        validateStatus: function (status) {
          return status < 500; // 400 이상도 허용하여 상세한 응답 확인
        }
      });
      
      logger.info(`Direct download URL test status: ${testResponse.status}`);
      logger.info(`Direct download URL content-type: ${testResponse.headers['content-type']}`);
      
      if (testResponse.status === 200 && testResponse.headers['content-type'] !== 'text/html') {
        return {
          success: true,
          downloadUrl: downloadUrl,
          path: filePath,
          isDirectDownload: true
        };
      } else {
        throw new Error(`Direct download not available (status: ${testResponse.status}, content-type: ${testResponse.headers['content-type']})`);
      }
    } catch (error) {
      logger.warn(`Direct download URL creation failed for ${filePath}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
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
          enable_browse: 'false'  // 파일 공유는 브라우징 비활성화
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        });

      logger.info(`File share creation response status: ${response.status}`);
      logger.info(`File share creation response:`, JSON.stringify(response.data, null, 2));
      
      if (response.data && !response.data.success) {
        logger.error(`Synology API error:`, response.data.error);
      }

      if (response.data && response.data.success) {
        const shareData = response.data.data;
        
        if (shareData && shareData.links && shareData.links.length > 0) {
          const linkInfo = shareData.links[0];
          
          // 파일 공유 링크는 직접 다운로드 URL로 변환
          const directDownloadUrl = `${linkInfo.url}?mode=download`;
          
          logger.info(`File share link created for ${filePath}: ${directDownloadUrl}`);
          return {
            success: true,
            downloadUrl: directDownloadUrl,
            shareUrl: linkInfo.url,
            shareId: linkInfo.id,
            path: filePath,
            isDirectDownload: true
          };
        }
      }
      
      // 파일별 공유 링크 생성 실패 시 세션 기반 다운로드 URL 생성
      logger.warn(`File share creation failed, using session-based download URL`);
      const sessionDownloadUrl = `${this.baseUrl}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&path=${encodeURIComponent(filePath)}&mode=download&_sid=${this.sessionId}`;
      
      return {
        success: true,
        downloadUrl: sessionDownloadUrl,
        path: filePath,
        isDirectDownload: true,
        sessionBased: true,
        warning: 'Using session-based download URL'
      };

    } catch (error) {
      logger.error(`Failed to create download link for ${filePath}:`, error.message);
      return {
        success: false,
        error: error.message,
        path: filePath
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
    const possiblePaths = [
      `/`,  // 루트 테스트
      `/volume1`,  // 볼륨 테스트
      `/volume1/release_version`,  // 공유 폴더 테스트
      `/volume1/release_version/release/product/mr${version}/${date}/${buildNumber}`,
      `/volume1/release_version/product/mr${version}/${date}/${buildNumber}`,
      `/release_version/release/product/mr${version}/${date}/${buildNumber}`,
      `/volume1/shared/release_version/release/product/mr${version}/${date}/${buildNumber}`,
      `/volume1/shared/release/product/mr${version}/${date}/${buildNumber}`,
      `/volume1/release/product/mr${version}/${date}/${buildNumber}`,
      `/release/product/mr${version}/${date}/${buildNumber}`,
      `/volume1/nas/release/product/mr${version}/${date}/${buildNumber}`,
      `/volume1/public/release/product/mr${version}/${date}/${buildNumber}`,
      `/nas/release/product/mr${version}/${date}/${buildNumber}`,
      `/shared/release/product/mr${version}/${date}/${buildNumber}`
    ];
    
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
          error: `No accessible path found for the specified version`,
          path: possiblePaths[0]
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
          isNew: false
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
        path: possiblePaths[0]
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
          path: null
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
          isDirectDownload: true
        };
      } else {
        // 직접 다운로드가 실패하면 폴더 공유 링크 생성 (fallback)
        logger.warn(`Direct download failed, creating folder share link as fallback`);
        const folderShareResult = await this.getOrCreateVersionShareLink(version, date, buildNumber);
        
        if (folderShareResult.success) {
          return {
            success: true,
            shareUrl: folderShareResult.shareUrl,
            shareId: folderShareResult.shareId,
            path: folderShareResult.path,
            fileName: fileName,
            isDirectDownload: false,
            fallbackReason: downloadResult.error
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
        fileName: fileName
      };
    }
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
          _sid: this.sessionId
        },
        timeout: 5000
      });

      logger.info('Synology API logout successful');
    } catch (error) {
      logger.error('Synology API logout failed:', error.message);
    } finally {
      this.sessionId = null;
      this.sessionExpiry = null;
    }
  }
}

module.exports = new SynologyApiService();