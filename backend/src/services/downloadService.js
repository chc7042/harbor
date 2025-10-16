const logger = require('../config/logger');

/**
 * 다운로드 서비스 - Synology API 기반
 */
class DownloadService {
  constructor() {
    const SynologyApiService = require('./synologyApiService');
    this.synologyApiService = new SynologyApiService();
  }

  /**
   * 파일 다운로드 URL 생성
   */
  async createDownloadUrl(filePath) {
    try {
      logger.info(`Creating download URL for: ${filePath}`);

      // 1. 원본 파일명으로 시도
      let directResult = await this.synologyApiService.createDirectDownloadUrl(filePath);
      if (directResult.success && directResult.directNasUrl) {
        logger.info(`Direct download URL created: ${directResult.directNasUrl}`);
        return {
          success: true,
          downloadUrl: directResult.directNasUrl,
          method: 'direct',
          actualPath: filePath,
        };
      }

      // 2. 원본 파일이 실패한 경우 다양한 fallback 시도
      if (filePath.endsWith('.tar.gz') && !filePath.includes('.enc.')) {
        // 2a. .enc.tar.gz로 재시도
        const encryptedPath = filePath.replace('.tar.gz', '.enc.tar.gz');
        logger.info(`Original file not found, trying encrypted version: ${encryptedPath}`);
        
        directResult = await this.synologyApiService.createDirectDownloadUrl(encryptedPath);
        if (directResult.success && directResult.directNasUrl) {
          logger.info(`Direct download URL created with encrypted version: ${directResult.directNasUrl}`);
          return {
            success: true,
            downloadUrl: directResult.directNasUrl,
            method: 'direct',
            actualPath: encryptedPath,
            fallbackUsed: true,
          };
        }
        
        // 2b. 시간이 1000인 경우 실제 파일명 찾기
        if (filePath.includes('_1000.tar.gz')) {
          logger.info(`Detected 1000 time pattern, searching for actual file: ${filePath}`);
          const actualFilePath = await this.findActualFileByPattern(filePath);
          if (actualFilePath) {
            logger.info(`Found actual file: ${actualFilePath}`);
            directResult = await this.synologyApiService.createDirectDownloadUrl(actualFilePath);
            if (directResult.success && directResult.directNasUrl) {
              logger.info(`Direct download URL created with actual file: ${directResult.directNasUrl}`);
              return {
                success: true,
                downloadUrl: directResult.directNasUrl,
                method: 'direct',
                actualPath: actualFilePath,
                fallbackUsed: true,
                patternMatched: true,
              };
            }
          }
        }
      }

      // 3. 직접 다운로드 실패 시 공유링크 시도
      const shareResult = await this.synologyApiService.createFileDownloadLink(filePath);
      if (shareResult.success && shareResult.directNasUrl) {
        logger.info(`Share link download URL created: ${shareResult.directNasUrl}`);
        return {
          success: true,
          downloadUrl: shareResult.directNasUrl,
          method: 'share',
          actualPath: filePath,
        };
      }

      // 4. 공유링크도 실패하고 .tar.gz 파일인 경우 .enc.tar.gz로 공유링크 재시도
      if (filePath.endsWith('.tar.gz') && !filePath.includes('.enc.')) {
        const encryptedPath = filePath.replace('.tar.gz', '.enc.tar.gz');
        logger.info(`Share link failed, trying encrypted version: ${encryptedPath}`);
        
        const encryptedShareResult = await this.synologyApiService.createFileDownloadLink(encryptedPath);
        if (encryptedShareResult.success && encryptedShareResult.directNasUrl) {
          logger.info(`Share link download URL created with encrypted version: ${encryptedShareResult.directNasUrl}`);
          return {
            success: true,
            downloadUrl: encryptedShareResult.directNasUrl,
            method: 'share',
            actualPath: encryptedPath,
            fallbackUsed: true,
          };
        }
      }

      throw new Error('All download methods failed');
    } catch (error) {
      logger.error(`Failed to create download URL for ${filePath}:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 1000 패턴 파일명을 실제 파일명으로 변환
   * 예: V1.0.1_250407_1000.tar.gz -> V1.0.1_250407_1318.tar.gz
   */
  async findActualFileByPattern(filePath) {
    try {
      // 파일 경로를 분석해서 디렉토리와 패턴 추출
      const pathParts = filePath.split('/');
      const fileName = pathParts.pop();
      const directoryPath = pathParts.join('/');
      
      // 파일명 패턴 분석 (V1.0.1_250407_1000.tar.gz)
      const fileNameMatch = fileName.match(/^(V\d+\.\d+\.\d+)_(\d{6})_1000(\.tar\.gz)$/);
      if (!fileNameMatch) {
        logger.warn(`Cannot parse filename pattern: ${fileName}`);
        return null;
      }
      
      const [, versionPrefix, dateStr, extension] = fileNameMatch;
      logger.info(`Searching for files matching pattern: ${versionPrefix}_${dateStr}_*${extension}`);
      
      // 디렉토리 내 파일 목록 조회 (경로 정규화 적용)
      const normalizedDirectoryPath = this.synologyApiService.normalizePath(directoryPath);
      logger.info(`Normalized directory path: ${normalizedDirectoryPath}`);
      const listResult = await this.synologyApiService.listDirectoryFiles(normalizedDirectoryPath);
      if (!listResult.success || !listResult.files) {
        logger.warn(`Cannot list directory files: ${directoryPath}`);
        return null;
      }
      
      // 패턴에 맞는 파일 찾기 (V버전 파일 우선)
      const matchingFiles = listResult.files.filter(file => {
        const pattern = new RegExp(`^${versionPrefix}_${dateStr}_\\d{4}${extension.replace('.', '\\.')}$`);
        return pattern.test(file.name);
      });
      
      if (matchingFiles.length > 0) {
        // 가장 적합한 파일 선택 (이름 순으로 정렬 후 첫 번째)
        matchingFiles.sort((a, b) => a.name.localeCompare(b.name));
        const selectedFile = matchingFiles[0];
        const actualFilePath = `${directoryPath}/${selectedFile.name}`;
        
        logger.info(`Found ${matchingFiles.length} matching files, selected: ${selectedFile.name}`);
        return actualFilePath;
      }
      
      logger.warn(`No matching files found for pattern: ${versionPrefix}_${dateStr}_*${extension}`);
      return null;
      
    } catch (error) {
      logger.error(`Error finding actual file by pattern: ${error.message}`);
      return null;
    }
  }

  /**
   * 파일 스트리밍 다운로드
   */
  async streamFile(filePath) {
    try {
      logger.info(`Streaming file: ${filePath}`);

      const result = await this.synologyApiService.downloadFile(filePath);
      if (result.success && result.data) {
        return {
          success: true,
          data: result.data,
          method: 'stream',
        };
      }

      throw new Error(result.error || 'Stream download failed');
    } catch (error) {
      logger.error(`Failed to stream file ${filePath}:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new DownloadService();
