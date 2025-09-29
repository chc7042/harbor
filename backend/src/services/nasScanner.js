const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const chokidar = require('chokidar');
const cron = require('node-cron');
const { AppError } = require('../middleware/error');
const logger = require('../config/logger');
const { query } = require('../config/database');

/**
 * NAS 파일 스캔 시스템
 */
class NASScanner {
  constructor() {
    this.nasBasePath = process.env.NAS_BASE_PATH || '/nas/deployments';
    // 개발환경에서는 간단한 스케줄 사용 (실제로는 비활성화됨)
    this.scanInterval = process.env.NODE_ENV === 'development'
      ? '0 0 * * *'  // 매일 자정 (개발환경에서는 실행되지 않음)
      : process.env.NAS_SCAN_INTERVAL || '*/15 * * * *'; // 15분마다
    this.watchEnabled = process.env.NAS_WATCH_ENABLED !== 'false';
    this.maxFileSize = parseInt(process.env.NAS_MAX_FILE_SIZE, 10) || 1024 * 1024 * 1024; // 1GB
    this.allowedExtensions = (process.env.NAS_ALLOWED_EXTENSIONS || '.tar.gz,.zip,.jar,.war,.tgz').split(',');

    this.isScanning = false;
    this.watchers = new Map();
    this.scanStats = {
      lastScan: null,
      totalFiles: 0,
      processedFiles: 0,
      errors: 0,
      duration: 0,
    };

    // 개발환경에서는 실제 NAS 경로 대신 mock 경로 사용
    if (process.env.NODE_ENV === 'development') {
      this.nasBasePath = path.join(__dirname, '../../mock-nas');
      this.ensureMockDirectory();
    }
  }

  /**
   * 개발환경 mock 디렉토리 생성
   */
  async ensureMockDirectory() {
    try {
      await fs.ensureDir(this.nasBasePath);

      // 샘플 파일들 생성
      const sampleProjects = ['harbor-frontend', 'harbor-backend', 'mobile-app'];
      for (const project of sampleProjects) {
        const projectDir = path.join(this.nasBasePath, project);
        await fs.ensureDir(projectDir);

        // 샘플 배포 파일들 생성
        for (let i = 1; i <= 3; i++) {
          const fileName = `build-${i}.tar.gz`;
          const filePath = path.join(projectDir, fileName);

          if (!await fs.pathExists(filePath)) {
            const content = `Mock deployment file for ${project} build ${i}\nCreated: ${new Date().toISOString()}`;
            await fs.writeFile(filePath, content);
          }
        }
      }

      logger.info(`Mock NAS directory initialized: ${this.nasBasePath}`);
    } catch (error) {
      logger.error('Failed to create mock NAS directory:', error.message);
    }
  }

  /**
   * 파일 정보 수집
   */
  async collectFileInfo(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const relativePath = path.relative(this.nasBasePath, filePath);
      const ext = path.extname(filePath);

      // 허용된 확장자인지 확인
      if (!this.allowedExtensions.includes(ext)) {
        return null;
      }

      // 파일 크기 제한 확인
      if (stats.size > this.maxFileSize) {
        logger.warn(`File too large, skipping: ${filePath} (${stats.size} bytes)`);
        return null;
      }

      // 파일 해시 계산
      const hash = await this.calculateFileHash(filePath);

      // 프로젝트명과 빌드 정보 추출
      const pathParts = relativePath.split(path.sep);
      const projectName = pathParts[0] || 'unknown';
      const fileName = path.basename(filePath);

      // 빌드 번호 추출 (파일명에서)
      const buildMatch = fileName.match(/(?:build|v|version)[-_]?(\d+)/i);
      const buildNumber = buildMatch ? parseInt(buildMatch[1], 10) : null;

      return {
        file_path: relativePath,
        absolute_path: filePath,
        project_name: projectName,
        file_name: fileName,
        file_size: stats.size,
        file_hash: hash,
        build_number: buildNumber,
        file_extension: ext,
        created_at: stats.birthtime,
        modified_at: stats.mtime,
        scanned_at: new Date(),
      };

    } catch (error) {
      logger.error(`Failed to collect file info for ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * 파일 해시 계산 (SHA-256)
   */
  async calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
      stream.on('error', reject);
    });
  }

  /**
   * 디렉토리 재귀 스캔
   */
  async scanDirectory(dirPath, results = []) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // 숨김 디렉토리나 시스템 디렉토리 건너뛰기
          if (entry.name.startsWith('.') || entry.name === 'lost+found') {
            continue;
          }

          await this.scanDirectory(fullPath, results);
        } else if (entry.isFile()) {
          try {
            const fileInfo = await this.collectFileInfo(fullPath);
            if (fileInfo) {
              results.push(fileInfo);
            }
          } catch (error) {
            logger.error(`Error processing file ${fullPath}:`, error.message);
            this.scanStats.errors++;
          }
        }
      }

      return results;
    } catch (error) {
      logger.error(`Failed to scan directory ${dirPath}:`, error.message);
      throw error;
    }
  }

  /**
   * 데이터베이스와 동기화
   */
  async syncToDatabase(fileInfoList) {
    if (process.env.NODE_ENV === 'development') {
      logger.info(`Would sync ${fileInfoList.length} files to database (dev mode)`);
      return fileInfoList.length;
    }

    try {
      let syncedCount = 0;

      for (const fileInfo of fileInfoList) {
        try {
          // 기존 파일 정보 확인
          const existingFile = await this.findExistingFile(fileInfo.file_path);

          if (existingFile) {
            // 파일이 변경된 경우에만 업데이트
            if (existingFile.file_hash !== fileInfo.file_hash ||
                existingFile.file_size !== fileInfo.file_size) {
              await this.updateFileInfo(existingFile.id, fileInfo);
              syncedCount++;
            }
          } else {
            // 새 파일 정보 저장
            await this.insertFileInfo(fileInfo);
            syncedCount++;
          }
        } catch (error) {
          logger.error(`Failed to sync file ${fileInfo.file_path}:`, error.message);
          this.scanStats.errors++;
        }
      }

      return syncedCount;
    } catch (error) {
      logger.error('Database sync failed:', error.message);
      throw error;
    }
  }

  /**
   * 기존 파일 정보 찾기
   */
  async findExistingFile(filePath) {
    const selectQuery = `
      SELECT * FROM nas_files
      WHERE file_path = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await query(selectQuery, [filePath]);
    return result.rows[0] || null;
  }

  /**
   * 파일 정보 저장
   */
  async insertFileInfo(fileInfo) {
    const insertQuery = `
      INSERT INTO nas_files (
        file_path, project_name, file_name, file_size, file_hash,
        build_number, file_extension, created_at, modified_at, scanned_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING id
    `;

    const values = [
      fileInfo.file_path,
      fileInfo.project_name,
      fileInfo.file_name,
      fileInfo.file_size,
      fileInfo.file_hash,
      fileInfo.build_number,
      fileInfo.file_extension,
      fileInfo.created_at,
      fileInfo.modified_at,
      fileInfo.scanned_at,
    ];

    const result = await query(insertQuery, values);
    return result.rows[0].id;
  }

  /**
   * 파일 정보 업데이트
   */
  async updateFileInfo(fileId, fileInfo) {
    const updateQuery = `
      UPDATE nas_files SET
        file_size = $1,
        file_hash = $2,
        modified_at = $3,
        scanned_at = $4
      WHERE id = $5
    `;

    await query(updateQuery, [
      fileInfo.file_size,
      fileInfo.file_hash,
      fileInfo.modified_at,
      fileInfo.scanned_at,
      fileId,
    ]);
  }

  /**
   * 전체 스캔 실행
   */
  async performFullScan() {
    if (this.isScanning) {
      throw new AppError('Scan already in progress', 409);
    }

    this.isScanning = true;
    const startTime = Date.now();

    try {
      logger.info(`Starting NAS scan: ${this.nasBasePath}`);

      // NAS 디렉토리 존재 확인
      if (!await fs.pathExists(this.nasBasePath)) {
        throw new AppError(`NAS directory not found: ${this.nasBasePath}`, 404);
      }

      // 스캔 통계 초기화
      this.scanStats = {
        lastScan: new Date(),
        totalFiles: 0,
        processedFiles: 0,
        errors: 0,
        duration: 0,
      };

      // 디렉토리 스캔
      const fileInfoList = await this.scanDirectory(this.nasBasePath);
      this.scanStats.totalFiles = fileInfoList.length;

      // 데이터베이스 동기화
      const syncedCount = await this.syncToDatabase(fileInfoList);
      this.scanStats.processedFiles = syncedCount;

      // 통계 업데이트
      this.scanStats.duration = Date.now() - startTime;

      logger.info(`NAS scan completed: ${syncedCount}/${fileInfoList.length} files processed in ${this.scanStats.duration}ms`);

      return {
        success: true,
        stats: this.scanStats,
        files: fileInfoList.slice(0, 10), // 처음 10개 파일만 반환
      };

    } catch (error) {
      logger.error('NAS scan failed:', error.message);
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * 스케줄러 시작
   */
  startScheduler() {
    // 개발환경에서는 스케줄러 비활성화
    if (process.env.NODE_ENV === 'development') {
      logger.info('NAS scanner scheduler disabled in development mode');
      return;
    }

    if (!cron.validate(this.scanInterval)) {
      throw new AppError(`Invalid cron expression: ${this.scanInterval}`, 400);
    }

    logger.info(`Starting NAS scan scheduler: ${this.scanInterval}`);

    this.schedulerTask = cron.schedule(this.scanInterval, async () => {
      try {
        logger.info('Scheduled NAS scan starting...');
        await this.performFullScan();
      } catch (error) {
        logger.error('Scheduled scan failed:', error.message);
      }
    }, {
      scheduled: false,
    });

    this.schedulerTask.start();
    return true;
  }

  /**
   * 스케줄러 중지
   */
  stopScheduler() {
    if (this.schedulerTask) {
      this.schedulerTask.stop();
      logger.info('NAS scan scheduler stopped');
      return true;
    }
    return false;
  }

  /**
   * 실시간 파일 감시 시작
   */
  startFileWatcher() {
    if (!this.watchEnabled) {
      logger.info('File watching is disabled');
      return false;
    }

    try {
      logger.info(`Starting file watcher: ${this.nasBasePath}`);

      const watcher = chokidar.watch(this.nasBasePath, {
        ignored: /(^|[\/\\])\../, // 숨김 파일 무시
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: 10,
      });

      watcher
        .on('add', (filePath) => this.handleFileAdd(filePath))
        .on('change', (filePath) => this.handleFileChange(filePath))
        .on('unlink', (filePath) => this.handleFileDelete(filePath))
        .on('error', (error) => logger.error('File watcher error:', error));

      this.watchers.set('main', watcher);
      return true;

    } catch (error) {
      logger.error('Failed to start file watcher:', error.message);
      return false;
    }
  }

  /**
   * 파일 추가 처리
   */
  async handleFileAdd(filePath) {
    try {
      logger.info(`File added: ${filePath}`);
      const fileInfo = await this.collectFileInfo(filePath);

      if (fileInfo) {
        await this.syncToDatabase([fileInfo]);
        logger.info(`File indexed: ${fileInfo.file_path}`);
      }
    } catch (error) {
      logger.error(`Failed to handle file add ${filePath}:`, error.message);
    }
  }

  /**
   * 파일 변경 처리
   */
  async handleFileChange(filePath) {
    try {
      logger.info(`File changed: ${filePath}`);
      const fileInfo = await this.collectFileInfo(filePath);

      if (fileInfo) {
        await this.syncToDatabase([fileInfo]);
        logger.info(`File updated: ${fileInfo.file_path}`);
      }
    } catch (error) {
      logger.error(`Failed to handle file change ${filePath}:`, error.message);
    }
  }

  /**
   * 파일 삭제 처리
   */
  async handleFileDelete(filePath) {
    if (process.env.NODE_ENV === 'development') {
      logger.info(`File deleted (dev mode): ${filePath}`);
      return;
    }

    try {
      const relativePath = path.relative(this.nasBasePath, filePath);

      const deleteQuery = `
        UPDATE nas_files
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE file_path = $1 AND deleted_at IS NULL
      `;

      await query(deleteQuery, [relativePath]);
      logger.info(`File marked as deleted: ${relativePath}`);
    } catch (error) {
      logger.error(`Failed to handle file delete ${filePath}:`, error.message);
    }
  }

  /**
   * 파일 감시 중지
   */
  stopFileWatcher() {
    for (const [key, watcher] of this.watchers) {
      watcher.close();
      logger.info(`File watcher stopped: ${key}`);
    }
    this.watchers.clear();
  }

  /**
   * 스캔 상태 조회
   */
  getStatus() {
    return {
      isScanning: this.isScanning,
      nasBasePath: this.nasBasePath,
      watchEnabled: this.watchEnabled,
      schedulerRunning: this.schedulerTask && this.schedulerTask.running,
      scanInterval: this.scanInterval,
      stats: this.scanStats,
      watchers: Array.from(this.watchers.keys()),
      config: {
        maxFileSize: this.maxFileSize,
        allowedExtensions: this.allowedExtensions,
      },
    };
  }

  /**
   * 서비스 정리
   */
  cleanup() {
    this.stopScheduler();
    this.stopFileWatcher();
    logger.info('NAS Scanner cleanup completed');
  }
}

// 싱글톤 인스턴스
let nasScanner = null;

function getNASScanner() {
  if (!nasScanner) {
    nasScanner = new NASScanner();
  }
  return nasScanner;
}

module.exports = {
  NASScanner,
  getNASScanner,
};
