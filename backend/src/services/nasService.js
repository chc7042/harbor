const SMB2 = require('@marsaud/smb2');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../config/logger');
const { AppError } = require('../middleware/error');

/**
 * NAS 연결 및 파일 시스템 접근 서비스
 */
class NASService {
  constructor() {
    this.smbClient = null;
    this.isConnected = false;
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.connectionConfig = {
      share: `\\\\${process.env.NAS_HOST || 'nas.roboetech.com'}\\${process.env.NAS_SHARE || 'shared'}`,
      domain: process.env.NAS_DOMAIN || '',
      username: process.env.NAS_USERNAME || 'nasadmin',
      password: process.env.NAS_PASSWORD || 'Cmtes123',
      autoCloseTimeout: 0,
      maxCreditsToServer: 60,
      maxCreditsToClient: 60,
      // SMB 버전 및 추가 옵션
      packetConcurrency: 20,
      timeout: 30000
    };
    
    this.releaseBasePath = process.env.NAS_RELEASE_PATH || '';
    this.connectionRetries = 3;
    this.connectionTimeout = 30000; // 30초
    
    // 개발환경에서는 mock 디렉토리 사용
    if (this.isDevelopment) {
      this.mockBasePath = process.env.NAS_MOUNT_PATH || path.join(__dirname, '../../mock-nas');
    }
  }

  /**
   * NAS 서버에 연결
   */
  async connect() {
    if (this.isConnected) {
      return true;
    }

    // 개발환경에서는 SMB 연결 건너뛰기
    if (this.isDevelopment) {
      logger.info('Development mode: Skipping SMB connection, using local filesystem');
      this.isConnected = true;
      return true;
    }

    try {
      logger.info(`Connecting to NAS with config:`, {
        share: this.connectionConfig.share,
        username: this.connectionConfig.username,
        domain: this.connectionConfig.domain || '(empty)',
        timeout: this.connectionConfig.timeout
      });
      
      this.smbClient = new SMB2(this.connectionConfig);
      
      // 연결 테스트를 위해 루트 디렉토리 읽기 시도
      await this.testConnection();
      
      this.isConnected = true;
      logger.info('NAS connection established successfully');
      return true;

    } catch (error) {
      this.isConnected = false;
      this.smbClient = null;
      logger.error('Failed to connect to NAS:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      throw new AppError(`NAS connection failed: ${error.message}`, 503);
    }
  }

  /**
   * 연결 테스트
   */
  async testConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      this.smbClient.readdir('', (err, files) => {
        clearTimeout(timeout);
        
        if (err) {
          reject(err);
        } else {
          logger.info(`NAS root directory contains ${files ? files.length : 0} items`);
          resolve(true);
        }
      });
    });
  }

  /**
   * NAS 연결 해제
   */
  async disconnect() {
    if (this.smbClient) {
      try {
        // SMB2 클라이언트 종료
        this.smbClient.disconnect();
        this.isConnected = false;
        this.smbClient = null;
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
    await this.ensureConnection();
    
    return new Promise((resolve, reject) => {
      this.smbClient.readdir(dirPath, (err, files) => {
        if (err) {
          logger.error(`Failed to list directory ${dirPath}:`, err.message);
          reject(new AppError(`Directory listing failed: ${err.message}`, 500));
        } else {
          resolve(files || []);
        }
      });
    });
  }

  /**
   * 파일 정보 조회
   */
  async getFileInfo(filePath) {
    await this.ensureConnection();
    
    return new Promise((resolve, reject) => {
      this.smbClient.stat(filePath, (err, stats) => {
        if (err) {
          logger.error(`Failed to get file info for ${filePath}:`, err.message);
          reject(new AppError(`File info failed: ${err.message}`, 500));
        } else {
          resolve({
            name: path.basename(filePath),
            path: filePath,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            accessed: stats.atime
          });
        }
      });
    });
  }

  /**
   * release_version 디렉토리 구조 탐색
   */
  async exploreReleaseStructure() {
    try {
      await this.ensureConnection();
      
      logger.info(`Exploring release structure at: ${this.releaseBasePath}`);
      
      // release_version 디렉토리 확인
      const releaseVersionExists = await this.directoryExists(this.releaseBasePath);
      if (!releaseVersionExists) {
        throw new AppError(`Release version directory not found: ${this.releaseBasePath}`, 404);
      }

      // release_version 하위 디렉토리 목록 조회
      const releaseVersionContents = await this.listDirectory(this.releaseBasePath);
      logger.info(`Found ${releaseVersionContents.length} items in release_version directory`);

      const structure = {
        basePath: this.releaseBasePath,
        projects: []
      };

      // 각 항목에 대해 상세 정보 수집
      for (const item of releaseVersionContents) {
        try {
          const itemPath = path.posix.join(this.releaseBasePath, item);
          const itemInfo = await this.getFileInfo(itemPath);
          
          if (itemInfo.isDirectory) {
            // 프로젝트 디렉토리로 가정하고 하위 구조 탐색
            const projectStructure = await this.exploreProjectDirectory(itemPath);
            structure.projects.push({
              name: item,
              path: itemPath,
              ...projectStructure
            });
          }
        } catch (error) {
          logger.warn(`Failed to process item ${item}:`, error.message);
        }
      }

      return structure;

    } catch (error) {
      logger.error('Failed to explore release structure:', error.message);
      throw error;
    }
  }

  /**
   * 프로젝트 디렉토리 구조 탐색
   */
  async exploreProjectDirectory(projectPath) {
    try {
      const contents = await this.listDirectory(projectPath);
      
      const structure = {
        totalItems: contents.length,
        directories: [],
        files: [],
        releaseFolder: null
      };

      for (const item of contents) {
        try {
          const itemPath = path.posix.join(projectPath, item);
          const itemInfo = await this.getFileInfo(itemPath);
          
          if (itemInfo.isDirectory) {
            structure.directories.push({
              name: item,
              path: itemPath,
              modified: itemInfo.modified
            });
            
            // release 폴더인지 확인
            if (item.toLowerCase() === 'release') {
              structure.releaseFolder = await this.exploreReleaseFolder(itemPath);
            }
          } else {
            structure.files.push({
              name: item,
              path: itemPath,
              size: itemInfo.size,
              modified: itemInfo.modified
            });
          }
        } catch (error) {
          logger.warn(`Failed to process project item ${item}:`, error.message);
        }
      }

      return structure;

    } catch (error) {
      logger.error(`Failed to explore project directory ${projectPath}:`, error.message);
      throw error;
    }
  }

  /**
   * release 폴더 구조 탐색
   */
  async exploreReleaseFolder(releasePath) {
    try {
      const contents = await this.listDirectory(releasePath);
      
      const releaseStructure = {
        path: releasePath,
        totalItems: contents.length,
        versions: [],
        files: []
      };

      for (const item of contents) {
        try {
          const itemPath = path.posix.join(releasePath, item);
          const itemInfo = await this.getFileInfo(itemPath);
          
          if (itemInfo.isDirectory) {
            // 버전 디렉토리로 가정
            const versionContents = await this.listDirectory(itemPath);
            releaseStructure.versions.push({
              name: item,
              path: itemPath,
              modified: itemInfo.modified,
              fileCount: versionContents.length,
              files: versionContents.slice(0, 5) // 처음 5개 파일만 미리보기
            });
          } else {
            releaseStructure.files.push({
              name: item,
              path: itemPath,
              size: itemInfo.size,
              modified: itemInfo.modified
            });
          }
        } catch (error) {
          logger.warn(`Failed to process release item ${item}:`, error.message);
        }
      }

      return releaseStructure;

    } catch (error) {
      logger.error(`Failed to explore release folder ${releasePath}:`, error.message);
      throw error;
    }
  }

  /**
   * 디렉토리 존재 확인
   */
  async directoryExists(dirPath) {
    try {
      const info = await this.getFileInfo(dirPath);
      return info.isDirectory;
    } catch (error) {
      return false;
    }
  }

  /**
   * 파일 검색
   */
  async searchFiles(searchPath, pattern) {
    try {
      await this.ensureConnection();
      
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
              // 빌드 번호 추출 시도
              buildNumber: this.extractBuildNumber(fileName)
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
      /(\d+)\.zip$/i
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
    } else {
      // 프로덕션환경에서는 SMB 사용
      await this.ensureConnection();
      
      return new Promise((resolve, reject) => {
        this.smbClient.readFile(filePath, (err, data) => {
          if (err) {
            logger.error(`Failed to download file ${filePath}:`, err.message);
            reject(new AppError(`File download failed: ${err.message}`, 404));
          } else {
            logger.info(`File downloaded successfully: ${filePath}, size: ${data.length} bytes`);
            resolve(data);
          }
        });
      });
    }
  }

  /**
   * 파일 목록 조회 (files API용)
   */
  async listFiles(dirPath = '') {
    await this.ensureConnection();
    
    if (this.isDevelopment) {
      // 개발환경에서는 로컬 파일시스템 사용
      try {
        const fullPath = path.join(this.mockBasePath, dirPath);
        logger.info(`개발환경 파일 목록 조회 - 경로: ${fullPath}`);
        
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
              modified: stats.mtime
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
    } else {
      // 프로덕션환경에서는 SMB 사용
      const fullPath = this.releaseBasePath ? path.posix.join(this.releaseBasePath, dirPath) : dirPath;
      
      try {
        const files = await this.listDirectory(fullPath);
        const result = [];
        
        for (const fileName of files) {
          try {
            const filePath = path.posix.join(fullPath, fileName);
            const fileInfo = await this.getFileInfo(filePath);
            
            result.push({
              name: fileName,
              path: filePath,
              isDirectory: fileInfo.isDirectory,
              isFile: fileInfo.isFile,
              size: fileInfo.size,
              modified: fileInfo.modified
            });
          } catch (error) {
            logger.warn(`Failed to get info for file ${fileName}:`, error.message);
          }
        }
        
        return result;
      } catch (error) {
        logger.error(`Failed to list files in ${fullPath}:`, error.message);
        throw new AppError(`Directory listing failed: ${error.message}`, 404);
      }
    }
  }

  /**
   * 연결 상태 확인 및 재연결
   */
  async ensureConnection() {
    if (!this.isConnected || (!this.isDevelopment && !this.smbClient)) {
      await this.connect();
    }
  }

  /**
   * 연결 상태 조회
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      config: {
        host: this.connectionConfig.share,
        username: this.connectionConfig.username,
        releaseBasePath: this.releaseBasePath
      },
      lastConnected: this.lastConnected
    };
  }

  /**
   * 서비스 정리
   */
  async cleanup() {
    await this.disconnect();
    logger.info('NAS service cleanup completed');
  }
}

// 싱글톤 인스턴스
let nasService = null;

function getNASService() {
  if (!nasService) {
    nasService = new NASService();
  }
  return nasService;
}

module.exports = {
  NASService,
  getNASService
};