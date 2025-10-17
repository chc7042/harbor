const path = require('path');
const logger = require('../config/logger');
const { AppError } = require('../middleware/error');
const { getCacheService } = require('./cacheService');

/**
 * NAS 연결 및 파일 시스템 접근 서비스 (Synology API 기반)
 */
class NASService {
  constructor() {
    const SynologyApiService = require('./synologyApiService');
    this.synologyApiService = new SynologyApiService();
    this.releaseBasePath = process.env.NAS_RELEASE_PATH || 'release_version';
    this.cacheService = getCacheService();
  }

  /**
   * NAS 서버에 연결 (Synology API 사용)
   */
  async connect() {
    try {
      logger.info('🔍 [NAS-CONNECTION] Attempting Synology API login...');
      
      if (!this.synologyApiService) {
        throw new AppError('Synology API service not initialized', 500);
      }
      
      const loginResult = await this.synologyApiService.login();
      logger.info(`🔍 [NAS-CONNECTION] Login result: ${JSON.stringify(loginResult)}`);
      logger.info('🔍 [NAS-CONNECTION] Synology API login successful');
      return true;
    } catch (error) {
      logger.error(`🔍 [NAS-CONNECTION] Failed to connect to NAS via Synology API: ${error.message}`);
      
      // Network-related errors
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        throw new AppError(`NAS server unreachable: ${error.message}`, 503);
      }
      
      // Authentication errors
      if (error.message.includes('login failed') || error.message.includes('401') || error.message.includes('403')) {
        throw new AppError(`NAS authentication failed: ${error.message}`, 401);
      }
      
      // Timeout errors
      if (error.code === 'ECONNRESET' || error.message.includes('timeout')) {
        throw new AppError(`NAS connection timeout: ${error.message}`, 504);
      }
      
      // Generic connection error
      throw new AppError(`NAS connection failed: ${error.message}`, 503);
    }
  }

  /**
   * NAS 연결 해제
   */
  async disconnect() {
    try {
      if (!this.synologyApiService) {
        logger.warn('🔍 [NAS-DISCONNECT] Synology API service not initialized');
        return;
      }
      
      await this.synologyApiService.logout();
      logger.info('🔍 [NAS-DISCONNECT] NAS connection closed successfully');
    } catch (error) {
      logger.error('🔍 [NAS-DISCONNECT] Error closing NAS connection:', error.message);
      // Don't throw error on disconnect - log and continue
    }
  }

  /**
   * 디렉토리 목록 조회 (캐시 지원)
   */
  async listDirectory(dirPath = '') {
    try {
      if (!this.synologyApiService) {
        throw new AppError('Synology API service not initialized', 500);
      }
      
      // Validate directory path
      if (typeof dirPath !== 'string') {
        throw new AppError('Directory path must be a string', 400);
      }
      
      // 캐시에서 먼저 확인
      return await this.cacheService.getNASFiles(dirPath, async () => {
        const result = await this.synologyApiService.listDirectoryFiles(dirPath);
        
        if (!result) {
          throw new AppError('No response from NAS service', 500);
        }
        
        if (result.success) {
          if (!Array.isArray(result.files)) {
            logger.warn('NAS API returned non-array files:', result.files);
            return [];
          }
          return result.files;
        } else {
          throw new AppError(`NAS API error: ${result.error || 'Unknown error'}`, 500);
        }
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      
      logger.error(`🔍 [LIST-DIRECTORY] Failed to list directory ${dirPath}:`, error.message);
      
      // Handle specific error types
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new AppError(`NAS server unreachable while listing ${dirPath}`, 503);
      }
      if (error.code === 'ETIMEDOUT') {
        throw new AppError(`Timeout while listing directory ${dirPath}`, 504);
      }
      
      throw new AppError(`Directory listing failed: ${error.message}`, 500);
    }
  }

  /**
   * 디렉토리 파일 목록 조회 (기존 호환성을 위한 메서드)
   */
  async getDirectoryFiles(dirPath = '') {
    return this.listDirectory(dirPath);
  }

  /**
   * 파일 정보 조회
   */
  async getFileInfo(filePath) {
    try {
      if (!this.synologyApiService) {
        throw new AppError('Synology API service not initialized', 500);
      }
      
      // Validate file path
      if (!filePath || typeof filePath !== 'string') {
        throw new AppError('File path is required and must be a string', 400);
      }
      
      const result = await this.synologyApiService.getFileInfo(filePath);
      
      if (!result) {
        throw new AppError('No response from NAS service', 500);
      }
      
      if (result.success && result.data) {
        const fileData = result.data;
        
        // Validate file data structure
        if (!fileData || typeof fileData !== 'object') {
          throw new AppError('Invalid file data structure', 500);
        }
        
        return {
          name: fileData.name || path.basename(filePath),
          path: filePath,
          isDirectory: Boolean(fileData.isdir),
          isFile: !Boolean(fileData.isdir),
          size: parseInt(fileData.size) || 0,
          created: fileData.crtime ? new Date(fileData.crtime * 1000) : new Date(),
          modified: fileData.mtime ? new Date(fileData.mtime * 1000) : new Date(),
          accessed: fileData.atime ? new Date(fileData.atime * 1000) : new Date(),
        };
      } else {
        const errorMsg = result.error || 'File not found';
        logger.warn(`🔍 [FILE-INFO] Failed to get info for ${filePath}: ${errorMsg}`);
        
        // Handle specific error cases
        if (errorMsg.includes('not found') || errorMsg.includes('408')) {
          throw new AppError(`File not found: ${filePath}`, 404);
        }
        if (errorMsg.includes('permission') || errorMsg.includes('403')) {
          throw new AppError(`Access denied to file: ${filePath}`, 403);
        }
        
        throw new AppError(`File info failed: ${errorMsg}`, 500);
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      
      logger.error(`🔍 [FILE-INFO] Failed to get file info ${filePath}:`, error.message);
      
      // Handle specific error types
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new AppError(`NAS server unreachable while getting file info for ${filePath}`, 503);
      }
      if (error.code === 'ETIMEDOUT') {
        throw new AppError(`Timeout while getting file info for ${filePath}`, 504);
      }
      
      throw new AppError(`File info failed: ${error.message}`, 500);
    }
  }

  /**
   * 파일 검색
   */
  async searchFiles(searchPath, pattern) {
    try {
      const files = await this.listDirectory(searchPath);
      const matchedFiles = [];

      for (const fileName of files) {
        if (pattern && !fileName.toLowerCase().includes(pattern.toLowerCase())) {
          continue;
        }

        try {
          const filePath = path.posix.join(searchPath, fileName);
          const fileInfo = await this.getFileInfo(filePath);

          if (fileInfo.isFile) {
            matchedFiles.push({
              name: fileName,
              path: filePath,
              size: fileInfo.size,
              modified: fileInfo.modified,
              buildNumber: this.extractBuildNumber(fileName),
            });
          }
        } catch (error) {
          logger.warn(`Failed to process search file ${fileName}:`, error.message);
        }
      }

      return matchedFiles.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    } catch (error) {
      logger.error(`Failed to search files in ${searchPath}:`, error.message);
      throw error;
    }
  }

  /**
   * 파일명에서 빌드 번호 추출
   */
  extractBuildNumber(fileName) {
    const patterns = [
      /build[-_]?(\d+)/i,
      /v(\d+\.\d+\.\d+)/i,
      /version[-_]?(\d+)/i,
      /(\d+)\.tar\.gz$/i,
      /(\d+)\.zip$/i,
    ];

    for (const pattern of patterns) {
      const match = fileName.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * 파일 다운로드
   */
  async downloadFile(filePath) {
    logger.info(`NAS downloadFile 요청 - 파일 경로: ${filePath}`);

    try {
      const result = await this.synologyApiService.downloadFile(filePath);
      if (result.success && result.data) {
        logger.info(`File downloaded successfully via Synology API: ${filePath}`);
        return result.data;
      } else {
        throw new Error(result.error || 'Download failed');
      }
    } catch (error) {
      logger.error(`Failed to download file ${filePath}:`, error.message);
      throw new AppError(`File download failed: ${error.message}`, 404);
    }
  }

  /**
   * 파일 목록 조회 (files API용)
   */
  async listFiles(dirPath = '') {
    const fullPath = this.releaseBasePath ? path.posix.join(this.releaseBasePath, dirPath) : dirPath;

    try {
      const result = await this.synologyApiService.listDirectoryFiles(fullPath);
      if (result.success && result.data && result.data.files) {
        return result.data.files.map(file => ({
          name: file.name,
          path: path.posix.join(fullPath, file.name),
          isDirectory: file.isdir,
          isFile: !file.isdir,
          size: file.size || 0,
          modified: new Date(file.mtime * 1000),
        }));
      } else {
        throw new Error(result.error || 'Failed to list files');
      }
    } catch (error) {
      logger.error(`Failed to list files in ${fullPath}:`, error.message);
      throw new AppError(`Directory listing failed: ${error.message}`, 404);
    }
  }

  /**
   * 연결 상태 확인 및 재연결
   */
  async ensureConnection() {
    try {
      await this.connect();
    } catch (error) {
      logger.error('🔍 [ENSURE-CONNECTION] Failed to ensure NAS connection:', error.message);
      throw error; // Re-throw to maintain error context
    }
  }

  /**
   * 연결 상태 조회
   */
  getConnectionStatus() {
    return {
      isConnected: true,
      type: 'Synology API',
      config: {
        baseUrl: process.env.SYNOLOGY_BASE_URL,
        releaseBasePath: this.releaseBasePath,
      },
    };
  }

  /**
   * 버전별 NAS 아티팩트 검색 - 중앙화된 PathResolver 사용
   */
  async searchArtifactsByVersion(version, pattern = null, jenkinsInfo = null) {
    try {
      await this.ensureConnection();

      // 중앙화된 경로 해결 서비스 사용
      const { getPathResolver } = require('./pathResolver');
      const pathResolver = getPathResolver();

      logger.info(`🔍 [NAS-SEARCH] Delegating to central PathResolver for version: ${version}`);

      // 중앙 서비스로 아티팩트 검색 위임
      const artifacts = await pathResolver.findArtifactsByVersion(version, null, pattern);

      logger.info(`🔍 [NAS-SEARCH] Central service found ${artifacts.length} artifacts for version ${version}`);
      return artifacts;

    } catch (error) {
      logger.error(`Failed to search artifacts by version ${version}:`, error.message);
      // 폴백: 기존 검색 방식
      return this.fallbackArtifactSearch(version, pattern);
    }
  }

  /**
   * 폴백 아티팩트 검색 (기존 방식)
   */
  async fallbackArtifactSearch(version, pattern = null) {
    logger.info(`🔍 [FALLBACK-SEARCH] Starting fallback search for version: ${version}`);
    
    // 기존 검색 로직을 그대로 사용
    const cleanVersion = version.startsWith('mr') ? version.substring(2) : version;
    const searchPaths = [
      `release_version/release/product/mr${cleanVersion}`,
      `release_version/release/product/${version}`,
      `release_version/release/product/${cleanVersion}`,
      `release/product/mr${cleanVersion}`,
      `release/product/${version}`,    
      `release/${version}`,
      `${version}`,
    ];

    const allArtifacts = [];

    for (const searchPath of searchPaths) {
      try {
        const allItems = await this.listDirectory(searchPath);

        for (const dirName of allItems) {
          if (dirName.match(/^\d{6}$/)) {
            try {
              const datePath = path.posix.join(searchPath, dirName);
              const dirInfo = await this.getFileInfo(datePath);
              if (!dirInfo.isDirectory) continue;

              const buildItems = await this.listDirectory(datePath);

              for (const buildDirName of buildItems) {
                if (buildDirName.match(/^\d+$/)) {
                  try {
                    const buildPath = path.posix.join(datePath, buildDirName);
                    const buildDirInfo = await this.getFileInfo(buildPath);
                    if (!buildDirInfo.isDirectory) continue;

                    const artifactFiles = await this.searchFiles(buildPath);

                    const compressedFiles = artifactFiles.filter(file => {
                      if (!file.name.match(/\.(tar\.gz|zip|7z|enc\.tar\.gz)$/i)) {
                        return false;
                      }

                      if (pattern) {
                        return file.name.toLowerCase().startsWith(pattern.toLowerCase());
                      }

                      return true;
                    });

                    for (const file of compressedFiles) {
                      allArtifacts.push({
                        filename: file.name,
                        filePath: file.path,
                        nasPath: file.path,
                        fileSize: file.size,
                        lastModified: file.modified,
                        buildNumber: buildDirName,
                        version: version,
                        searchPath: buildPath,
                        verified: true,
                      });
                    }
                  } catch (error) {
                    logger.warn(`Failed to process build directory ${buildDirName}:`, error.message);
                  }
                }
              }
            } catch (error) {
              logger.warn(`Failed to process date directory ${dirName}:`, error.message);
            }
          }
        }
      } catch (searchError) {
        logger.warn(`🔍 [FALLBACK-SEARCH] No artifacts found in path ${searchPath}: ${searchError.message}`);
      }
    }

    logger.info(`🔍 [FALLBACK-SEARCH] Fallback search completed. Found ${allArtifacts.length} artifacts`);
    return allArtifacts;
  }

  /**
   * 디렉토리 존재 여부 확인
   */
  async directoryExists(dirPath) {
    try {
      const fileInfo = await this.getFileInfo(dirPath);
      return fileInfo.isDirectory;
    } catch (error) {
      return false;
    }
  }

  /**
   * 업로드 경로 검증 및 정규화
   */
  validateAndNormalizeUploadPath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
      return '/release_version/release/upload';
    }

    let normalizedPath = targetPath.trim();

    // UNC 경로 처리 (\\nas.roboetech.com\release_version -> /release_version)
    if (normalizedPath.startsWith('\\\\nas.roboetech.com\\')) {
      // UNC 경로에서 공유 폴더 부분만 추출
      normalizedPath = normalizedPath.replace('\\\\nas.roboetech.com\\', '/');
      normalizedPath = normalizedPath.replace(/\\/g, '/');
    } else {
      // 백슬래시를 슬래시로 변환
      normalizedPath = normalizedPath.replace(/\\/g, '/');
    }

    // 경로 정리
    normalizedPath = normalizedPath.replace(/\/+/g, '/'); // 연속된 슬래시 제거

    // 허용되지 않는 경로 패턴 체크
    const forbiddenPatterns = [
      /\.\./,           // 상위 디렉토리 접근
      /\/etc\//,        // 시스템 디렉토리
      /\/usr\//,        // 시스템 디렉토리
      /\/var\//,        // 시스템 디렉토리
      /\/root\//,       // 루트 디렉토리
      /\/volume\d+\//,  // volume 경로 직접 접근 금지
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(normalizedPath)) {
        throw new AppError('업로드 경로가 허용되지 않습니다.', 400);
      }
    }

    // Synology FileStation API는 공유 폴더명으로 시작하는 경로 사용
    // /volume1/ 접두어가 있으면 제거 (API에서는 사용하지 않음)
    if (normalizedPath.startsWith('/volume1/')) {
      normalizedPath = normalizedPath.replace('/volume1/', '/');
    }

    // release_version 공유 폴더가 기본 경로
    if (!normalizedPath.startsWith('/release_version/')) {
      if (normalizedPath.startsWith('/')) {
        // 다른 절대경로인 경우 release_version 하위로 이동
        normalizedPath = '/release_version' + normalizedPath;
      } else {
        // 상대경로인 경우 기본 업로드 디렉토리에 추가
        normalizedPath = '/release_version/release/upload/' + normalizedPath;
      }
    }

    // 기본 업로드 경로 설정 (경로가 공유 폴더만 지정된 경우)
    if (normalizedPath === '/release_version' || normalizedPath === '/release_version/') {
      normalizedPath = '/release_version/release/upload';
    }

    // 끝에 슬래시가 있으면 제거 (파일명이 붙을 것이므로)
    if (normalizedPath.endsWith('/')) {
      normalizedPath = normalizedPath.slice(0, -1);
    }

    return normalizedPath;
  }

  /**
   * 다운로드 URL 생성 (다운로드 서비스 지원)
   */
  async createDirectDownloadUrl(filePath, options = {}) {
    try {
      await this.ensureConnection();
      return await this.synologyApiService.createDirectDownloadUrl(filePath, options);
    } catch (error) {
      logger.error(`Failed to create direct download URL for ${filePath}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 파일 다운로드 링크 생성 (다운로드 서비스 지원)
   */
  async createFileDownloadLink(filePath) {
    try {
      await this.ensureConnection();
      return await this.synologyApiService.createFileDownloadLink(filePath);
    } catch (error) {
      logger.error(`Failed to create file download link for ${filePath}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 경로 정규화 (다운로드 서비스 지원)
   */
  normalizePath(path) {
    return this.synologyApiService.normalizePath(path);
  }

  /**
   * Product 하위 전체 스캔 - 모든 배포 파일 검색
   */
  async fullProductScan() {
    const startTime = Date.now();
    let scannedVersions = 0;
    let errorCount = 0;
    
    try {
      logger.info('🔍 [FULL-SCAN] Starting full product scan...');
      await this.ensureConnection();

      const basePath = '/release_version/release/product';
      const allArtifacts = [];
      const scanErrors = [];

      // 1. product 하위 모든 버전 폴더 스캔
      logger.info(`🔍 [FULL-SCAN] Listing directories in: ${basePath}`);
      const versionFolders = await this.synologyApiService.listDirectoryFiles(basePath);
      
      if (!versionFolders.success) {
        const errorMsg = `Failed to list product directories: ${versionFolders.error || 'Unknown error'}`;
        logger.error(`🔍 [FULL-SCAN] ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      if (!versionFolders.files || versionFolders.files.length === 0) {
        logger.warn(`🔍 [FULL-SCAN] No version folders found in ${basePath}`);
        return {
          success: true,
          artifacts: [],
          scannedAt: new Date(),
          totalCount: 0,
          scanDuration: Date.now() - startTime,
          scannedVersions: 0,
          errors: ['No version folders found']
        };
      }

      logger.info(`🔍 [FULL-SCAN] Found ${versionFolders.files.length} items in product directory`);
      const validVersionFolders = versionFolders.files.filter(f => f.name.startsWith('mr'));
      logger.info(`🔍 [FULL-SCAN] Found ${validVersionFolders.length} valid version folders`);

      if (validVersionFolders.length === 0) {
        logger.warn('🔍 [FULL-SCAN] No valid version folders (starting with "mr") found');
        return {
          success: true,
          artifacts: [],
          scannedAt: new Date(),
          totalCount: 0,
          scanDuration: Date.now() - startTime,
          scannedVersions: 0,
          errors: ['No valid version folders found']
        };
      }

      for (const versionFolder of validVersionFolders) {
        const versionPath = `${basePath}/${versionFolder.name}`;
        logger.info(`🔍 [FULL-SCAN] Scanning version folder: ${versionFolder.name}`);
        scannedVersions++;

        try {
          // 2. 버전 폴더 하위 날짜 폴더들 스캔
          const dateFolders = await this.synologyApiService.listDirectoryFiles(versionPath);
          
          if (!dateFolders.success) {
            const error = `Failed to list date folders in ${versionPath}: ${dateFolders.error || 'Unknown error'}`;
            logger.warn(`🔍 [FULL-SCAN] ${error}`);
            scanErrors.push(error);
            errorCount++;
            continue;
          }
          
          if (dateFolders.success && dateFolders.files && dateFolders.files.length > 0) {
            const validDateFolders = dateFolders.files.filter(f => f.name.match(/^\d{6}$/));
            logger.info(`🔍 [FULL-SCAN] Found ${validDateFolders.length} valid date folders in ${versionFolder.name}`);
            
            for (const dateFolder of validDateFolders) {
              const datePath = `${versionPath}/${dateFolder.name}`;

              try {
                // 3. 날짜 폴더 하위 빌드번호 폴더들 스캔
                const buildFolders = await this.synologyApiService.listDirectoryFiles(datePath);
                
                if (!buildFolders.success) {
                  const error = `Failed to list build folders in ${datePath}: ${buildFolders.error || 'Unknown error'}`;
                  logger.warn(`🔍 [FULL-SCAN] ${error}`);
                  scanErrors.push(error);
                  errorCount++;
                  continue;
                }
                
                if (buildFolders.success && buildFolders.files && buildFolders.files.length > 0) {
                  const validBuildFolders = buildFolders.files.filter(f => f.name.match(/^\d+$/));
                  logger.debug(`🔍 [FULL-SCAN] Found ${validBuildFolders.length} valid build folders in ${dateFolder.name}`);
                  
                  for (const buildFolder of validBuildFolders) {
                    const buildPath = `${datePath}/${buildFolder.name}`;

                    try {
                      // 4. 빌드 폴더 내 파일들 스캔
                      const buildFiles = await this.synologyApiService.listDirectoryFiles(buildPath);
                      
                      if (!buildFiles.success) {
                        const error = `Failed to list files in ${buildPath}: ${buildFiles.error || 'Unknown error'}`;
                        logger.warn(`🔍 [FULL-SCAN] ${error}`);
                        scanErrors.push(error);
                        errorCount++;
                        continue;
                      }
                      
                      if (buildFiles.success && buildFiles.files && buildFiles.files.length > 0) {
                        const artifactFiles = buildFiles.files.filter(f => 
                          !f.isdir && f.name.match(/\.(tar\.gz|enc\.tar\.gz)$/i)
                        );
                        
                        for (const file of artifactFiles) {
                          try {
                            const { getPathResolver } = require('./pathResolver');
                            const pathResolver = getPathResolver();
                            const fileType = pathResolver.classifyFileType(file.name);

                            if (fileType) {
                              // 파일 정보 검증
                              if (!file.name || typeof file.name !== 'string') {
                                logger.warn(`🔍 [FULL-SCAN] Invalid file name in ${buildPath}`);
                                continue;
                              }
                              
                              if (!file.mtime || isNaN(file.mtime)) {
                                logger.warn(`🔍 [FULL-SCAN] Invalid mtime for file ${file.name}`);
                              }

                              const artifact = {
                                filename: file.name,
                                fullPath: `/${buildPath}/${file.name}`,
                                version: pathResolver.extractVersion(versionFolder.name) || versionFolder.name.replace('mr', ''),
                                fileType: fileType,
                                fileSize: file.size || 0,
                                modifiedTime: file.mtime ? new Date(file.mtime * 1000) : new Date(),
                                buildDate: dateFolder.name,
                                buildNumber: buildFolder.name,
                                versionFolder: versionFolder.name,
                                nasPath: `${buildPath}/${file.name}`,
                                scannedAt: new Date(),
                              };

                              allArtifacts.push(artifact);
                              logger.debug(`🔍 [FULL-SCAN] Added artifact: ${file.name} (${fileType})`);
                            } else {
                              logger.debug(`🔍 [FULL-SCAN] Unclassified file: ${file.name}`);
                            }
                          } catch (artifactError) {
                            const error = `Failed to process artifact ${file.name}: ${artifactError.message}`;
                            logger.warn(`🔍 [FULL-SCAN] ${error}`);
                            scanErrors.push(error);
                            errorCount++;
                          }
                        }
                      }
                    } catch (error) {
                      const errorMsg = `Failed to scan build folder ${buildPath}: ${error.message}`;
                      logger.warn(`🔍 [FULL-SCAN] ${errorMsg}`);
                      scanErrors.push(errorMsg);
                      errorCount++;
                    }
                  }
                }
              } catch (error) {
                const errorMsg = `Failed to scan date folder ${datePath}: ${error.message}`;
                logger.warn(`🔍 [FULL-SCAN] ${errorMsg}`);
                scanErrors.push(errorMsg);
                errorCount++;
              }
            }
          }
        } catch (error) {
          const errorMsg = `Failed to scan version folder ${versionPath}: ${error.message}`;
          logger.error(`🔍 [FULL-SCAN] ${errorMsg}`);
          scanErrors.push(errorMsg);
          errorCount++;
        }
      }

      const scanDuration = Date.now() - startTime;
      logger.info(`🔍 [FULL-SCAN] Scan completed in ${scanDuration}ms`);
      logger.info(`🔍 [FULL-SCAN] Results: ${allArtifacts.length} artifacts, ${scannedVersions} versions, ${errorCount} errors`);
      
      if (scanErrors.length > 0) {
        logger.warn(`🔍 [FULL-SCAN] Scan completed with ${scanErrors.length} errors:`);
        scanErrors.slice(0, 5).forEach(error => logger.warn(`  - ${error}`));
        if (scanErrors.length > 5) {
          logger.warn(`  ... and ${scanErrors.length - 5} more errors`);
        }
      }
      
      return {
        success: true,
        artifacts: allArtifacts,
        scannedAt: new Date(),
        totalCount: allArtifacts.length,
        scanDuration,
        scannedVersions,
        errorCount,
        errors: scanErrors.length > 0 ? scanErrors : undefined
      };

    } catch (error) {
      const scanDuration = Date.now() - startTime;
      logger.error(`🔍 [FULL-SCAN] Full product scan failed after ${scanDuration}ms:`, {
        error: error.message,
        stack: error.stack,
        scannedVersions,
        errorCount
      });
      
      return {
        success: false,
        error: error.message,
        artifacts: [],
        scannedAt: new Date(),
        totalCount: 0,
        scanDuration,
        scannedVersions,
        errorCount
      };
    }
  }

  /**
   * 증분 스캔 - 특정 버전만 재스캔
   */
  async incrementalScan(version) {
    try {
      logger.info(`🔍 [INCREMENTAL-SCAN] Starting incremental scan for version: ${version}`);
      await this.ensureConnection();

      const versionPath = `/release_version/release/product/mr${version}`;
      const artifacts = [];

      // 해당 버전 폴더만 스캔 (fullProductScan의 로직을 재사용)
      const dateFolders = await this.synologyApiService.listDirectoryFiles(versionPath);
      
      if (dateFolders.success && dateFolders.files) {
        for (const dateFolder of dateFolders.files) {
          // 날짜 폴더명 패턴으로 판단 (YYMMDD 형식)
          if (!dateFolder.name.match(/^\d{6}$/)) continue;

          const datePath = `${versionPath}/${dateFolder.name}`;
          const buildFolders = await this.synologyApiService.listDirectoryFiles(datePath);
          
          if (buildFolders.success && buildFolders.files) {
            for (const buildFolder of buildFolders.files) {
              // 빌드번호 폴더명 패턴으로 판단 (숫자로만 구성)
              if (!buildFolder.name.match(/^\d+$/)) continue;

              const buildPath = `${datePath}/${buildFolder.name}`;
              const buildFiles = await this.synologyApiService.listDirectoryFiles(buildPath);
              
              if (buildFiles.success && buildFiles.files) {
                for (const file of buildFiles.files) {
                  if (file.isdir || !file.name.match(/\.(tar\.gz|enc\.tar\.gz)$/i)) continue;

                  const { getPathResolver } = require('./pathResolver');
                  const pathResolver = getPathResolver();
                  const fileType = pathResolver.classifyFileType(file.name);

                  if (fileType) {
                    const artifact = {
                      filename: file.name,
                      fullPath: `/${buildPath}/${file.name}`,
                      version: version,
                      fileType: fileType,
                      fileSize: file.size || 0,
                      modifiedTime: new Date(file.mtime * 1000),
                      buildDate: dateFolder.name,
                      buildNumber: buildFolder.name,
                      versionFolder: `mr${version}`,
                      nasPath: `${buildPath}/${file.name}`,
                      scannedAt: new Date(),
                    };

                    artifacts.push(artifact);
                  }
                }
              }
            }
          }
        }
      }

      logger.info(`🔍 [INCREMENTAL-SCAN] Found ${artifacts.length} artifacts for version ${version}`);
      return {
        success: true,
        artifacts: artifacts,
        version: version,
        scannedAt: new Date(),
      };

    } catch (error) {
      logger.error(`🔍 [INCREMENTAL-SCAN] Incremental scan failed for version ${version}:`, error.message);
      return {
        success: false,
        error: error.message,
        artifacts: [],
      };
    }
  }

  /**
   * 파일 업로드 - Synology API 사용
   */
  async uploadFile(fileBuffer, targetPath, originalName) {
    logger.info(`NAS uploadFile 요청 - 파일: ${originalName}, 경로: ${targetPath}`);

    try {
      // 업로드 경로 검증 및 정규화
      const normalizedPath = this.validateAndNormalizeUploadPath(targetPath);

      logger.info('파일 업로드 경로 변환:');
      logger.info(`- 원본 경로: ${targetPath}`);
      logger.info(`- 정규화된 경로: ${normalizedPath}`);

      // Synology API를 통한 파일 업로드
      await this.ensureConnection();
      const uploadResult = await this.synologyApiService.uploadFile(fileBuffer, normalizedPath, originalName);

      if (uploadResult.success) {
        logger.info('Synology API를 통한 파일 업로드 성공:');
        logger.info(`- 파일명: ${uploadResult.filename}`);
        logger.info(`- 업로드 경로: ${uploadResult.path}`);
        logger.info(`- 파일 크기: ${uploadResult.size} bytes`);

        return {
          success: true,
          path: uploadResult.path,
          filename: uploadResult.filename,
          size: uploadResult.size,
          method: 'synology-api',
        };
      } else {
        throw new Error(`Synology API 업로드 실패: ${uploadResult.error}`);
      }

    } catch (error) {
      logger.error(`파일 업로드 실패: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      throw new AppError(`File upload failed: ${error.message}`, 500);
    }
  }

  /**
   * 스캔 결과를 데이터베이스에 저장
   */
  async saveArtifactsToDatabase(artifacts, scanType = 'full') {
    try {
      const { query } = require('../config/database');
      
      // 스캔 로그 생성
      const scanLogResult = await query(`
        INSERT INTO nas_scan_logs (scan_type, scan_status, total_count, started_at)
        VALUES ($1, 'running', $2, CURRENT_TIMESTAMP)
        RETURNING id
      `, [scanType, artifacts.length]);
      
      const scanLogId = scanLogResult.rows[0].id;
      let newCount = 0;
      let updatedCount = 0;
      let errorCount = 0;
      
      for (const artifact of artifacts) {
        try {
          // UPSERT 작업
          const result = await query(`
            INSERT INTO nas_artifacts (
              filename, full_path, nas_path, file_size, version, version_folder,
              build_date, build_number, file_type, modified_time, scanned_at,
              scan_type, search_path, verified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (full_path) DO UPDATE SET
              file_size = EXCLUDED.file_size,
              modified_time = EXCLUDED.modified_time,
              scanned_at = EXCLUDED.scanned_at,
              last_verified_at = CURRENT_TIMESTAMP,
              scan_type = EXCLUDED.scan_type,
              verified = EXCLUDED.verified,
              updated_at = CURRENT_TIMESTAMP
            RETURNING (xmax = 0) as is_new
          `, [
            artifact.filename,
            artifact.fullPath,
            artifact.nasPath,
            artifact.fileSize,
            artifact.version,
            artifact.versionFolder,
            artifact.buildDate,
            artifact.buildNumber,
            artifact.fileType,
            artifact.modifiedTime,
            artifact.scannedAt,
            scanType,
            artifact.searchPath || null,
            artifact.verified || true
          ]);
          
          if (result.rows[0].is_new) {
            newCount++;
          } else {
            updatedCount++;
          }
          
        } catch (error) {
          logger.error(`Failed to save artifact ${artifact.filename}:`, error.message);
          errorCount++;
        }
      }
      
      // 스캔 로그 업데이트
      await query(`
        UPDATE nas_scan_logs 
        SET scan_status = 'completed',
            new_files_count = $1,
            updated_files_count = $2,
            error_count = $3,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [newCount, updatedCount, errorCount, scanLogId]);
      
      logger.info(`🔍 [DB-SAVE] Saved ${artifacts.length} artifacts: ${newCount} new, ${updatedCount} updated, ${errorCount} errors`);
      
      return {
        scanLogId,
        newCount,
        updatedCount,
        errorCount,
        totalCount: artifacts.length
      };
      
    } catch (error) {
      logger.error('Failed to save artifacts to database:', error.message);
      throw error;
    }
  }

  /**
   * 증분 스캔 - 최근 변경된 파일만 스캔
   */
  async incrementalScan(options = {}) {
    const startTime = Date.now();
    const {
      sinceHours = 24,
      specificVersions = null,
      forceRescan = false
    } = options;
    
    try {
      logger.info(`🔍 [INCREMENTAL-SCAN] Starting incremental scan (since ${sinceHours}h ago)`);
      await this.ensureConnection();

      // 기준 시간 계산
      const cutoffTime = new Date(Date.now() - (sinceHours * 60 * 60 * 1000));
      logger.info(`🔍 [INCREMENTAL-SCAN] Cutoff time: ${cutoffTime.toISOString()}`);

      const basePath = '/release_version/release/product';
      const newArtifacts = [];
      const scanErrors = [];
      let scannedVersions = 0;
      let errorCount = 0;

      // 버전 폴더 목록 가져오기
      const versionFolders = await this.synologyApiService.listDirectoryFiles(basePath);
      
      if (!versionFolders.success) {
        throw new Error(`Failed to list product directories: ${versionFolders.error}`);
      }

      let targetVersions = versionFolders.files.filter(f => f.name.startsWith('mr'));
      
      // 특정 버전만 스캔
      if (specificVersions && specificVersions.length > 0) {
        targetVersions = targetVersions.filter(f => 
          specificVersions.some(v => f.name === `mr${v}` || f.name === v)
        );
      }

      logger.info(`🔍 [INCREMENTAL-SCAN] Scanning ${targetVersions.length} versions`);

      for (const versionFolder of targetVersions) {
        const versionPath = `${basePath}/${versionFolder.name}`;
        scannedVersions++;

        try {
          // 날짜 폴더들 검사
          const dateFolders = await this.synologyApiService.listDirectoryFiles(versionPath);
          
          if (!dateFolders.success) {
            const error = `Failed to list date folders in ${versionPath}: ${dateFolders.error}`;
            scanErrors.push(error);
            errorCount++;
            continue;
          }

          // 최근 날짜 폴더만 필터링 (YYMMDD 형식)
          const recentDateFolders = dateFolders.files
            .filter(f => f.name.match(/^\d{6}$/))
            .filter(f => {
              if (forceRescan) return true;
              
              // 날짜 폴더 수정 시간 확인
              return f.mtime && new Date(f.mtime * 1000) > cutoffTime;
            });

          logger.info(`🔍 [INCREMENTAL-SCAN] ${versionFolder.name}: ${recentDateFolders.length} recent date folders`);

          for (const dateFolder of recentDateFolders) {
            const datePath = `${versionPath}/${dateFolder.name}`;

            try {
              const buildFolders = await this.synologyApiService.listDirectoryFiles(datePath);
              
              if (buildFolders.success && buildFolders.files) {
                const validBuildFolders = buildFolders.files.filter(f => f.name.match(/^\d+$/));
                
                for (const buildFolder of validBuildFolders) {
                  const buildPath = `${datePath}/${buildFolder.name}`;

                  try {
                    const buildFiles = await this.synologyApiService.listDirectoryFiles(buildPath);
                    
                    if (buildFiles.success && buildFiles.files) {
                      const artifactFiles = buildFiles.files.filter(f => 
                        !f.isdir && f.name.match(/\.(tar\.gz|enc\.tar\.gz)$/i)
                      );
                      
                      for (const file of artifactFiles) {
                        // 파일 수정 시간 확인
                        const fileModTime = new Date(file.mtime * 1000);
                        if (!forceRescan && fileModTime <= cutoffTime) {
                          continue;
                        }

                        const { getPathResolver } = require('./pathResolver');
                        const pathResolver = getPathResolver();
                        const fileType = pathResolver.classifyFileType(file.name);

                        if (fileType) {
                          const artifact = {
                            filename: file.name,
                            fullPath: `/${buildPath}/${file.name}`,
                            version: pathResolver.extractVersion(versionFolder.name) || versionFolder.name.replace('mr', ''),
                            fileType: fileType,
                            fileSize: file.size || 0,
                            modifiedTime: fileModTime,
                            buildDate: dateFolder.name,
                            buildNumber: buildFolder.name,
                            versionFolder: versionFolder.name,
                            nasPath: `${buildPath}/${file.name}`,
                            scannedAt: new Date(),
                          };

                          newArtifacts.push(artifact);
                        }
                      }
                    }
                  } catch (error) {
                    const errorMsg = `Failed to scan build folder ${buildPath}: ${error.message}`;
                    scanErrors.push(errorMsg);
                    errorCount++;
                  }
                }
              }
            } catch (error) {
              const errorMsg = `Failed to scan date folder ${datePath}: ${error.message}`;
              scanErrors.push(errorMsg);
              errorCount++;
            }
          }
        } catch (error) {
          const errorMsg = `Failed to scan version folder ${versionPath}: ${error.message}`;
          scanErrors.push(errorMsg);
          errorCount++;
        }
      }

      const scanDuration = Date.now() - startTime;
      
      logger.info(`🔍 [INCREMENTAL-SCAN] Completed in ${scanDuration}ms`);
      logger.info(`🔍 [INCREMENTAL-SCAN] Results: ${newArtifacts.length} new artifacts, ${scannedVersions} versions, ${errorCount} errors`);

      return {
        success: true,
        artifacts: newArtifacts,
        scannedAt: new Date(),
        totalCount: newArtifacts.length,
        scanDuration,
        scannedVersions,
        errorCount,
        scanType: 'incremental',
        cutoffTime: cutoffTime.toISOString(),
        errors: scanErrors.length > 0 ? scanErrors : undefined
      };

    } catch (error) {
      const scanDuration = Date.now() - startTime;
      logger.error(`🔍 [INCREMENTAL-SCAN] Failed after ${scanDuration}ms:`, error.message);
      
      return {
        success: false,
        error: error.message,
        artifacts: [],
        scannedAt: new Date(),
        totalCount: 0,
        scanDuration,
        scannedVersions,
        errorCount: errorCount + 1,
        scanType: 'incremental'
      };
    }
  }

  /**
   * 전체 스캔 후 DB 저장
   */
  async fullProductScanAndSave() {
    try {
      // 전체 스캔 실행
      const scanResult = await this.fullProductScan();
      
      if (scanResult.success && scanResult.artifacts.length > 0) {
        // DB에 저장
        const saveResult = await this.saveArtifactsToDatabase(scanResult.artifacts, 'full');
        
        return {
          ...scanResult,
          database: saveResult
        };
      }
      
      return scanResult;
    } catch (error) {
      logger.error('Full scan and save failed:', error.message);
      throw error;
    }
  }

  /**
   * 증분 스캔 후 DB 저장
   */
  async incrementalScanAndSave(options = {}) {
    try {
      // 증분 스캔 실행
      const scanResult = await this.incrementalScan(options);
      
      if (scanResult.success && scanResult.artifacts.length > 0) {
        // DB에 저장
        const saveResult = await this.saveArtifactsToDatabase(scanResult.artifacts, 'incremental');
        
        return {
          ...scanResult,
          database: saveResult
        };
      }
      
      return scanResult;
    } catch (error) {
      logger.error('Incremental scan and save failed:', error.message);
      throw error;
    }
  }
}

// 싱글톤 인스턴스
let nasServiceInstance = null;

/**
 * NAS 서비스 인스턴스 가져오기
 */
function getNASService() {
  if (!nasServiceInstance) {
    nasServiceInstance = new NASService();
  }
  return nasServiceInstance;
}

module.exports = {
  NASService,
  getNASService,
};
