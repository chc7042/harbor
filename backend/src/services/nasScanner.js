const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { AppError } = require('../middleware/error');
const logger = require('../config/logger');
const { query } = require('../config/database');

/**
 * NAS 파일 스캔 시스템 - 단순 폴링 방식
 */
class NASScanner {
  constructor() {
    // NAS 스캔 기본 경로
    const nasReleasePath = process.env.NAS_RELEASE_PATH || 'release_version';
    this.nasBasePath = process.env.NAS_BASE_PATH || `/nas/${nasReleasePath}`;
    // 폴링 간격 (기본: 15분)
    this.scanInterval = parseInt(process.env.NAS_SCAN_INTERVAL) || 15 * 60 * 1000; // 15분
    this.maxFileSize = parseInt(process.env.NAS_MAX_FILE_SIZE, 10) || 1024 * 1024 * 1024; // 1GB
    this.allowedExtensions = (process.env.NAS_ALLOWED_EXTENSIONS || '.tar.gz,.zip,.jar,.war,.tgz').split(',');

    this.isScanning = false;
    this.pollingTimer = null;
    this.scanStats = {
      lastScan: null,
      totalFiles: 0,
      processedFiles: 0,
      errors: 0,
      duration: 0,
    };
  }

  /**
   * NAS 스캐너 시작 - 단순 폴링 시작
   */
  async start() {
    try {
      logger.info('Starting NAS Scanner with simple polling', {
        nasBasePath: this.nasBasePath,
        scanInterval: `${this.scanInterval / 1000}s`,
        maxFileSize: `${this.maxFileSize / (1024 * 1024)}MB`,
        allowedExtensions: this.allowedExtensions,
      });

      // 초기 스캔 실행
      await this.performScan();

      // 폴링 시작
      this.startPolling();

      logger.info('NAS Scanner started successfully');
    } catch (error) {
      logger.error('Failed to start NAS Scanner:', error.message);
      throw new AppError('Failed to start NAS Scanner', 500);
    }
  }

  /**
   * 폴링 시작
   */
  startPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }

    this.pollingTimer = setInterval(async () => {
      if (!this.isScanning) {
        await this.performScan();
      }
    }, this.scanInterval);

    logger.info(`Polling started with ${this.scanInterval / 1000}s interval`);
  }

  /**
   * NAS 스캔 수행
   */
  async performScan() {
    if (this.isScanning) {
      logger.warn('Scan already in progress, skipping');
      return;
    }

    const startTime = Date.now();
    this.isScanning = true;

    try {
      logger.info('Starting NAS scan', { path: this.nasBasePath });

      // NAS 경로 존재 확인
      if (!await fs.pathExists(this.nasBasePath)) {
        logger.warn(`NAS path does not exist: ${this.nasBasePath}`);
        return;
      }

      const stats = {
        totalFiles: 0,
        processedFiles: 0,
        errors: 0,
      };

      await this.scanDirectory(this.nasBasePath, stats);

      const duration = Date.now() - startTime;
      this.scanStats = {
        lastScan: new Date(),
        totalFiles: stats.totalFiles,
        processedFiles: stats.processedFiles,
        errors: stats.errors,
        duration,
      };

      logger.info('NAS scan completed', {
        duration: `${duration}ms`,
        totalFiles: stats.totalFiles,
        processedFiles: stats.processedFiles,
        errors: stats.errors,
      });

    } catch (error) {
      logger.error('NAS scan failed:', error.message);
      this.scanStats.errors++;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * 디렉토리 스캔
   */
  async scanDirectory(dirPath, stats) {
    try {
      const items = await fs.readdir(dirPath);

      for (const item of items) {
        const fullPath = path.join(dirPath, item);

        try {
          const stat = await fs.stat(fullPath);

          if (stat.isDirectory()) {
            await this.scanDirectory(fullPath, stats);
          } else if (stat.isFile()) {
            stats.totalFiles++;
            await this.processFile(fullPath, stat, stats);
          }
        } catch (error) {
          logger.warn(`Failed to process ${fullPath}:`, error.message);
          stats.errors++;
        }
      }
    } catch (error) {
      logger.error(`Failed to scan directory ${dirPath}:`, error.message);
      stats.errors++;
    }
  }

  /**
   * 파일 처리
   */
  async processFile(filePath, stat, stats) {
    try {
      // 파일 크기 체크
      if (stat.size > this.maxFileSize) {
        logger.debug(`File too large, skipping: ${filePath}`);
        return;
      }

      // 확장자 체크
      if (!this.allowedExtensions.some(allowed => filePath.toLowerCase().endsWith(allowed.toLowerCase()))) {
        return;
      }

      // 파일 해시 계산
      const hash = await this.calculateFileHash(filePath);

      // 데이터베이스에 저장 또는 업데이트
      await this.saveFileInfo(filePath, stat, hash);

      stats.processedFiles++;

      logger.debug(`Processed file: ${filePath}`);
    } catch (error) {
      logger.warn(`Failed to process file ${filePath}:`, error.message);
      stats.errors++;
    }
  }

  /**
   * 파일 해시 계산
   */
  async calculateFileHash(filePath) {
    try {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      for await (const chunk of stream) {
        hash.update(chunk);
      }

      return hash.digest('hex');
    } catch (error) {
      logger.warn(`Failed to calculate hash for ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * 파일 정보를 데이터베이스에 저장
   */
  async saveFileInfo(filePath, stat, hash) {
    try {
      const relativePath = path.relative(this.nasBasePath, filePath);

      await query(`
        INSERT INTO nas_files (file_path, size, modified_time, hash, created_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (file_path) 
        DO UPDATE SET 
          size = EXCLUDED.size,
          modified_time = EXCLUDED.modified_time,
          hash = EXCLUDED.hash,
          updated_at = NOW()
        WHERE nas_files.hash != EXCLUDED.hash OR nas_files.modified_time != EXCLUDED.modified_time
      `, [relativePath, stat.size, stat.mtime, hash]);

    } catch (error) {
      logger.error(`Failed to save file info for ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * NAS 스캐너 중지
   */
  async stop() {
    try {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }

      logger.info('NAS Scanner stopped');
    } catch (error) {
      logger.error('Failed to stop NAS Scanner:', error.message);
    }
  }

  /**
   * 스캐너 상태 조회
   */
  getStatus() {
    return {
      isRunning: !!this.pollingTimer,
      isScanning: this.isScanning,
      scanInterval: `${this.scanInterval / 1000}s`,
      nasBasePath: this.nasBasePath,
      lastScan: this.scanStats.lastScan,
      totalFiles: this.scanStats.totalFiles,
      processedFiles: this.scanStats.processedFiles,
      errors: this.scanStats.errors,
      lastScanDuration: `${this.scanStats.duration}ms`,
    };
  }

  /**
   * 수동 스캔 트리거
   */
  async triggerScan() {
    logger.info('Manual scan triggered');
    await this.performScan();
  }
}

// 싱글톤 인스턴스
let nasScannerInstance = null;

function getNASScanner() {
  if (!nasScannerInstance) {
    nasScannerInstance = new NASScanner();
  }
  return nasScannerInstance;
}

module.exports = {
  NASScanner,
  getNASScanner,
};
