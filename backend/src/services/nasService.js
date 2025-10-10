const path = require('path');
const fs = require('fs').promises;
const logger = require('../config/logger');
const { AppError } = require('../middleware/error');

/**
 * NAS 연결 및 파일 시스템 접근 서비스 (Synology API 기반)
 */
class NASService {
  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.synologyApiService = require('./synologyApiService');
    this.releaseBasePath = process.env.NAS_RELEASE_PATH || 'release_version';

    // 개발환경에서는 mock 디렉토리 사용
    if (this.isDevelopment) {
      this.mockBasePath = process.env.NAS_MOUNT_PATH || path.join(__dirname, '../../mock-nas');
    }
  }

  /**
   * NAS 서버에 연결 (Synology API 사용)
   */
  async connect() {
    // 개발환경에서는 연결 건너뛰기
    if (this.isDevelopment) {
      logger.info('Development mode: Skipping Synology API connection, using local filesystem');
      return true;
    }

    try {
      await this.synologyApiService.login();
      logger.info('NAS connection established via Synology API');
      return true;
    } catch (error) {
      logger.error('Failed to connect to NAS via Synology API:', error.message);
      throw new AppError(`NAS connection failed: ${error.message}`, 503);
    }
  }

  /**
   * NAS 연결 해제
   */
  async disconnect() {
    if (!this.isDevelopment) {
      try {
        await this.synologyApiService.logout();
        logger.info('NAS connection closed');
      } catch (error) {
        logger.error('Error closing NAS connection:', error.message);
      }
    }
  }

  /**
   * 디렉토리 목록 조회
   */
  async listDirectory(dirPath = '') {
    if (this.isDevelopment) {
      // 개발환경에서는 로컬 파일시스템 사용
      try {
        const fullPath = path.join(this.mockBasePath, dirPath);
        logger.info(`개발환경 디렉토리 목록 조회 - mockBasePath: ${this.mockBasePath}, dirPath: ${dirPath}, fullPath: ${fullPath}`);

        const files = await fs.readdir(fullPath, { withFileTypes: true });
        const fileNames = files.map(file => file.name);
        logger.info(`찾은 파일들: ${fileNames.join(', ')}`);
        return fileNames;
      } catch (error) {
        logger.error(`개발환경 디렉토리 조회 실패: ${dirPath}`, error.message);
        throw new AppError(`Directory listing failed: ${error.message}`, 404);
      }
    }

    // 프로덕션에서는 Synology API 사용
    try {
      const result = await this.synologyApiService.listDirectoryFiles(dirPath);
      if (result.success) {
        return result.files.map(file => file.name);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      logger.error(`Failed to list directory ${dirPath}:`, error.message);
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
    if (this.isDevelopment) {
      try {
        const fullPath = path.join(this.mockBasePath, filePath);
        const stats = await fs.stat(fullPath);
        return {
          name: path.basename(filePath),
          path: filePath,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          accessed: stats.atime,
        };
      } catch (error) {
        logger.error(`Failed to get file info ${filePath}:`, error.message);
        throw new AppError(`File info failed: ${error.message}`, 500);
      }
    }

    // 프로덕션에서는 Synology API 사용
    try {
      const result = await this.synologyApiService.getFileInfo(filePath);
      if (result.success && result.data) {
        const fileData = result.data;
        return {
          name: fileData.name,
          path: filePath,
          isDirectory: fileData.isdir,
          isFile: !fileData.isdir,
          size: fileData.size || 0,
          created: new Date(fileData.crtime * 1000),
          modified: new Date(fileData.mtime * 1000),
          accessed: new Date(fileData.atime * 1000),
        };
      } else {
        throw new Error(result.error || 'File not found');
      }
    } catch (error) {
      logger.error(`Failed to get file info ${filePath}:`, error.message);
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

    if (this.isDevelopment) {
      // 개발환경에서는 로컬 파일시스템 사용
      try {
        const fullPath = path.join(this.mockBasePath, filePath);
        logger.info(`개발환경 파일 읽기 - 전체 경로: ${fullPath}`);
        const data = await fs.readFile(fullPath);
        logger.info(`File downloaded successfully: ${filePath}, size: ${data.length} bytes`);
        return data;
      } catch (error) {
        logger.error(`Failed to download file ${filePath}:`, error.message);
        throw new AppError(`File download failed: ${error.message}`, 404);
      }
    }

    // 프로덕션에서는 Synology API 사용
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
    if (this.isDevelopment) {
      // 개발환경에서는 로컬 파일시스템 사용
      try {
        const fullPath = path.join(this.mockBasePath, dirPath);
        logger.info(`개발환경 파일 목록 조회 - mockBasePath: ${this.mockBasePath}, dirPath: ${dirPath}, fullPath: ${fullPath}`);

        const files = await fs.readdir(fullPath, { withFileTypes: true });
        const result = [];

        for (const file of files) {
          try {
            const filePath = path.join(fullPath, file.name);
            const stats = await fs.stat(filePath);

            result.push({
              name: file.name,
              path: path.posix.join(dirPath, file.name),
              isDirectory: file.isDirectory(),
              isFile: file.isFile(),
              size: stats.size,
              modified: stats.mtime,
            });
          } catch (error) {
            logger.warn(`Failed to get info for file ${file.name}:`, error.message);
          }
        }

        return result;
      } catch (error) {
        logger.error(`Failed to list files in development mode - ${dirPath}:`, error.message);
        throw new AppError(`Directory listing failed: ${error.message}`, 404);
      }
    }

    // 프로덕션에서는 Synology API 사용
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
    if (!this.isDevelopment) {
      await this.connect();
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
   * 버전별 NAS 아티팩트 검색
   */
  async searchArtifactsByVersion(version, pattern = null) {
    try {
      await this.ensureConnection();

      // 실제 NAS 구조에 맞는 검색 경로
      const searchPaths = [
        `release/product/${version}`,
        `release/product/mr${version}`,
        `release/${version}`,
        `${version}`,
      ];

      const allArtifacts = [];

      for (const searchPath of searchPaths) {
        try {
          logger.info(`Searching for artifacts in path: ${searchPath}`);

          const allItems = await this.listDirectory(searchPath);

          for (const dirName of allItems) {
            if (dirName.match(/^\d{6}$/)) { // 날짜 형식 디렉토리
              try {
                const datePath = path.posix.join(searchPath, dirName);
                const dirInfo = await this.getFileInfo(datePath);
                if (!dirInfo.isDirectory) continue;

                const buildItems = await this.listDirectory(datePath);

                for (const buildDirName of buildItems) {
                  if (buildDirName.match(/^\d+$/)) { // 빌드 번호 디렉토리
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
          logger.debug(`No artifacts found in path ${searchPath}: ${searchError.message}`);
        }
      }

      logger.info(`Total artifacts found for version ${version}: ${allArtifacts.length}`);
      return allArtifacts;
    } catch (error) {
      logger.error(`Failed to search artifacts by version ${version}:`, error.message);
      throw new Error(`버전별 아티팩트 검색 실패: ${error.message}`);
    }
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
   * 파일 업로드 - Synology API 사용
   */
  async uploadFile(fileBuffer, targetPath, originalName) {
    logger.info(`NAS uploadFile 요청 - 파일: ${originalName}, 경로: ${targetPath}`);

    try {
      // 업로드 경로 검증 및 정규화
      const normalizedPath = this.validateAndNormalizeUploadPath(targetPath);

      logger.info(`파일 업로드 경로 변환:`);
      logger.info(`- 원본 경로: ${targetPath}`);
      logger.info(`- 정규화된 경로: ${normalizedPath}`);

      // Synology API를 통한 파일 업로드
      await this.ensureConnection();
      const uploadResult = await this.synologyApiService.uploadFile(fileBuffer, normalizedPath, originalName);

      if (uploadResult.success) {
        logger.info(`Synology API를 통한 파일 업로드 성공:`);
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
