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

      // Synology API 직접 다운로드 URL 생성 시도
      const directResult = await this.synologyApiService.createDirectDownloadUrl(filePath);
      if (directResult.success && directResult.directNasUrl) {
        logger.info(`Direct download URL created: ${directResult.directNasUrl}`);
        return {
          success: true,
          downloadUrl: directResult.directNasUrl,
          method: 'direct',
        };
      }

      // 직접 다운로드 실패 시 공유링크 시도
      const shareResult = await this.synologyApiService.createFileDownloadLink(filePath);
      if (shareResult.success && shareResult.directNasUrl) {
        logger.info(`Share link download URL created: ${shareResult.directNasUrl}`);
        return {
          success: true,
          downloadUrl: shareResult.directNasUrl,
          method: 'share',
        };
      }

      throw new Error('Both direct and share link methods failed');
    } catch (error) {
      logger.error(`Failed to create download URL for ${filePath}:`, error.message);
      return {
        success: false,
        error: error.message,
      };
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
