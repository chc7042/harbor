const SMB2 = require('@marsaud/smb2');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../config/logger');
const { AppError } = require('../middleware/error');
const { withNASRetry } = require('../utils/retryMechanism');

const execAsync = promisify(exec);

/**
 * NAS 연결 및 파일 시스템 접근 서비스
 */
class NASService {
  constructor() {
    this.smbClient = null;
    this.isConnected = false;
    // Mock NAS 사용 여부 (기본값: false, 프로덕션에서는 항상 실제 NAS 사용)
    this.useMockNAS = process.env.ENABLE_MOCK_NAS === 'true';
    this.connectionConfig = {
      share: `\\\\${process.env.NAS_HOST || 'nas.roboetech.com'}\\${process.env.NAS_SHARE || 'release_version'}`,
      domain: '', // 도메인 빈 문자열로 명시
      username: process.env.NAS_USERNAME || 'nasadmin',
      password: process.env.NAS_PASSWORD || 'Cmtes123',
      autoCloseTimeout: 0,
      maxCreditsToServer: 1,
      maxCreditsToClient: 1,
      // SMB 버전 및 추가 옵션
      packetConcurrency: 1,
      timeout: 60000, // 타임아웃 증가
      // SMB2 프로토콜 관련 설정
      highWaterMark: 16 * 1024,
      ntlm: false, // NTLM 비활성화로 시도
      smb2: true,
    };

    this.releaseBasePath = process.env.NAS_RELEASE_PATH || '';
    this.connectionRetries = 3;
    this.connectionTimeout = 30000; // 30초

    // Mock NAS 사용 시 디렉토리 설정
    if (this.useMockNAS) {
      this.mockBasePath = process.env.NAS_MOUNT_PATH || path.resolve(__dirname, '../../mock-nas');
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
    if (this.useMockNAS) {
      logger.info('Development mode: Skipping SMB connection, using local filesystem');
      this.isConnected = true;
      return true;
    }

    try {
      logger.info('Connecting to NAS with config:', {
        share: this.connectionConfig.share,
        username: this.connectionConfig.username,
        domain: this.connectionConfig.domain || '(empty)',
        timeout: this.connectionConfig.timeout,
        password: this.connectionConfig.password ? '***masked***' : '(empty)',
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
      logger.error('SMB2 library connection failed, trying smbclient fallback:', {
        message: error.message,
        code: error.code,
      });

      // Fallback to smbclient command
      try {
        await this.testSmbclientConnection();
        this.isConnected = true;
        this.useSmbclient = true;
        logger.info('NAS connection established using smbclient fallback');
        return true;
      } catch (fallbackError) {
        logger.error('Both SMB2 library and smbclient failed:', fallbackError.message);
        throw new AppError(`NAS connection failed: ${error.message}`, 503);
      }
    }
  }

  /**
   * 연결 테스트
   */
  async testConnection() {
    return withNASRetry(async () => {
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
    }, {}, 'NAS connection test');
  }

  /**
   * smbclient를 사용한 연결 테스트
   */
  async testSmbclientConnection() {
    const host = process.env.NAS_HOST || 'nas.roboetech.com';
    const share = process.env.NAS_SHARE || 'release_version';
    const username = process.env.NAS_USERNAME || 'nasadmin';
    const password = process.env.NAS_PASSWORD || 'Cmtes123';

    const command = `smbclient //${host}/${share} -U ${username}%${password} -c "ls" 2>/dev/null`;

    try {
      const { stderr } = await execAsync(command);
      if (stderr && !stderr.includes('WARNING')) {
        throw new Error(`smbclient error: ${stderr}`);
      }
      logger.info('smbclient connection test successful');
      return true;
    } catch (error) {
      logger.error('smbclient connection test failed:', error.message);
      throw error;
    }
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

    if (this.useMockNAS) {
      // 개발환경에서는 로컬 파일시스템 사용
      try {
        const fullPath = path.join(this.mockBasePath, dirPath);
        logger.info(`Mock NAS 디렉토리 목록 조회 - mockBasePath: ${this.mockBasePath}, dirPath: ${dirPath}, fullPath: ${fullPath}`);

        const files = await fs.readdir(fullPath, { withFileTypes: true });
        const fileNames = files.map(file => file.name);
        logger.info(`찾은 파일들: ${fileNames.join(', ')}`);
        return fileNames;
      } catch (error) {
        logger.error(`개발환경 디렉토리 조회 실패: ${dirPath}`, error.message);
        throw new AppError(`Directory listing failed: ${error.message}`, 404);
      }
    }

    if (this.useSmbclient) {
      return this.listDirectoryWithSmbclient(dirPath);
    }

    return withNASRetry(async () => {
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
    }, {}, `NAS directory listing: ${dirPath}`);
  }

  /**
   * smbclient를 사용한 디렉토리 목록 조회
   */
  async listDirectoryWithSmbclient(dirPath = '') {
    return withNASRetry(async () => {
      const host = process.env.NAS_HOST || 'nas.roboetech.com';
      const share = process.env.NAS_SHARE || 'release_version';
      const username = process.env.NAS_USERNAME || 'nasadmin';
      const password = process.env.NAS_PASSWORD || 'Cmtes123';

      const cdCommand = dirPath ? `cd "${dirPath}"; ` : '';
      const command = `smbclient //${host}/${share} -U ${username}%${password} -c "${cdCommand}ls" 2>/dev/null`;

      const { stdout } = await execAsync(command);
      const files = [];

      // Parse smbclient output
      const lines = stdout.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('.') || trimmed.includes('blocks')) continue;

        // Extract filename from smbclient output format
        const match = trimmed.match(/^(.+?)\s+(D|A|DA|DAS)\s+(\d+)/);
        if (match) {
          const [, name, type] = match;
          if (name !== '.' && name !== '..') {
            files.push({
              name: name.trim(),
              isDirectory: type.includes('D'),
              isFile: type === 'A',
            });
          }
        }
      }

      return files.map(f => f.name);
    }, {}, `smbclient directory listing: ${dirPath}`);
  }

  /**
   * 파일 정보 조회
   */
  async getFileInfo(filePath) {
    await this.ensureConnection();

    if (this.useSmbclient) {
      return this.getFileInfoWithSmbclient(filePath);
    }

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
            accessed: stats.atime,
          });
        }
      });
    });
  }

  /**
   * smbclient를 사용한 파일 정보 조회
   */
  async getFileInfoWithSmbclient(filePath) {
    const host = process.env.NAS_HOST || 'nas.roboetech.com';
    const share = process.env.NAS_SHARE || 'release_version';
    const username = process.env.NAS_USERNAME || 'nasadmin';
    const password = process.env.NAS_PASSWORD || 'Cmtes123';

    const dirPath = path.dirname(filePath);
    const fileName = path.basename(filePath);

    const cdCommand = dirPath && dirPath !== '.' ? `cd "${dirPath}"; ` : '';
    const command = `smbclient //${host}/${share} -U ${username}%${password} -c "${cdCommand}ls" 2>/dev/null`;

    try {
      const { stdout } = await execAsync(command);
      const lines = stdout.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const match = trimmed.match(/^(.+?)\s+(D|A|DA|DAS)\s+(\d+)\s+(.+)$/);
        if (match) {
          const [, name, type, sizeStr, dateStr] = match;
          if (name.trim() === fileName) {
            return {
              name: fileName,
              path: filePath,
              isDirectory: type.includes('D'),
              isFile: type === 'A',
              size: parseInt(sizeStr, 10),
              created: new Date(dateStr.trim()),
              modified: new Date(dateStr.trim()),
              accessed: new Date(dateStr.trim()),
            };
          }
        }
      }

      // If not found in listing, assume it's a directory
      return {
        name: fileName,
        path: filePath,
        isDirectory: true,
        isFile: false,
        size: 0,
        created: new Date(),
        modified: new Date(),
        accessed: new Date(),
      };
    } catch (error) {
      logger.error(`smbclient file info failed for ${filePath}:`, error.message);
      throw new AppError(`File info failed: ${error.message}`, 500);
    }
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
        projects: [],
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
              ...projectStructure,
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
        releaseFolder: null,
      };

      for (const item of contents) {
        try {
          const itemPath = path.posix.join(projectPath, item);
          const itemInfo = await this.getFileInfo(itemPath);

          if (itemInfo.isDirectory) {
            structure.directories.push({
              name: item,
              path: itemPath,
              modified: itemInfo.modified,
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
              modified: itemInfo.modified,
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
        files: [],
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
              files: versionContents.slice(0, 5), // 처음 5개 파일만 미리보기
            });
          } else {
            releaseStructure.files.push({
              name: item,
              path: itemPath,
              size: itemInfo.size,
              modified: itemInfo.modified,
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

    if (this.useMockNAS) {
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

      if (this.useSmbclient) {
        return this.downloadFileWithSmbclient(filePath);
      }

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
   * smbclient 명령어를 사용한 파일 다운로드
   */
  async downloadFileWithSmbclient(filePath) {
    return withNASRetry(async () => {
      const host = process.env.NAS_HOST || 'nas.roboetech.com';
      const share = process.env.NAS_SHARE || 'release_version';
      const username = process.env.NAS_USERNAME || 'nasadmin';
      const password = process.env.NAS_PASSWORD || 'Cmtes123';

      // 임시 파일 경로 생성 - 파일명에서 특수문자 제거
      const safeFileName = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
      const tempFileName = `nas_download_${Date.now()}_${safeFileName}`;
      const tempFilePath = `/tmp/${tempFileName}`;

      try {
        logger.info(`smbclient로 파일 다운로드 시도: ${filePath}`);
        logger.info(`임시 파일 경로: ${tempFilePath}`);

        // smbclient get 명령어 실행 - 타임아웃 증가
        const command = `timeout 300 smbclient //${host}/${share} -U ${username}%${password} -c "get \\"${filePath}\\" \\"${tempFilePath}\\"" 2>&1`;

        logger.info(`실행 명령어: ${command.replace(password, '***')}`);

        const { stdout, stderr } = await execAsync(command, {
          timeout: 300000, // 5분 타임아웃
          maxBuffer: 1024 * 1024 * 10, // 10MB 버퍼
        });

        logger.info(`smbclient 출력: ${stdout}`);
        if (stderr) {
          logger.warn(`smbclient 경고: ${stderr}`);
        }

        // 임시 파일 존재 확인
        try {
          await fs.access(tempFilePath);
        } catch (accessError) {
          throw new Error(`다운로드된 임시 파일을 찾을 수 없습니다: ${tempFilePath}`);
        }

        // 임시 파일에서 데이터 읽기
        const data = await fs.readFile(tempFilePath);

        // 임시 파일 삭제
        try {
          await fs.unlink(tempFilePath);
        } catch (unlinkError) {
          logger.warn(`Failed to delete temp file ${tempFilePath}:`, unlinkError.message);
        }

        logger.info(`File downloaded successfully via smbclient: ${filePath}, size: ${data.length} bytes`);
        return data;

      } catch (error) {
        // 임시 파일이 있다면 삭제 시도
        try {
          await fs.unlink(tempFilePath);
        } catch (unlinkError) {
          // 무시
        }

        logger.error(`smbclient 파일 다운로드 실패: ${filePath}`, error.message);
        throw new AppError(`File download failed: ${error.message}`, 404);
      }
    });
  }

  /**
   * 스트리밍 파일 다운로드 (메모리에 전체 로드하지 않음)
   */
  async streamDownloadFile(filePath, res) {
    return withNASRetry(async () => {
      const host = process.env.NAS_HOST || 'nas.roboetech.com';
      const share = process.env.NAS_SHARE || 'release_version';
      const username = process.env.NAS_USERNAME || 'nasadmin';
      const password = process.env.NAS_PASSWORD || 'Cmtes123';

      logger.info(`스트리밍 다운로드 시작: ${filePath}`);

      // smbclient를 사용한 스트리밍 다운로드
      const { spawn } = require('child_process');

      return new Promise((resolve, reject) => {
        // smbclient 명령어로 파일을 stdout으로 스트리밍
        const command = 'smbclient';
        const args = [
          `//${host}/${share}`,
          '-U', `${username}%${password}`,
          '-c', `get "${filePath}" -`,  // stdout으로 출력
        ];

        logger.info(`스트리밍 명령어: ${command} ${args.join(' ').replace(password, '***')}`);

        const smbProcess = spawn(command, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let errorOutput = '';
        let bytesTransferred = 0;

        // stderr 에러 수집
        smbProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        // stdout을 HTTP 응답으로 파이프
        smbProcess.stdout.on('data', (chunk) => {
          bytesTransferred += chunk.length;
          res.write(chunk);
        });

        smbProcess.stdout.on('end', () => {
          res.end();
          logger.info(`스트리밍 다운로드 완료: ${filePath}, 전송량: ${bytesTransferred} bytes`);
          resolve();
        });

        smbProcess.on('error', (error) => {
          logger.error(`smbclient 프로세스 에러: ${error.message}`);
          reject(new AppError(`Stream download process failed: ${error.message}`, 500));
        });

        smbProcess.on('close', (code) => {
          if (code !== 0) {
            logger.error(`smbclient 종료 코드: ${code}, 에러: ${errorOutput}`);

            if (!res.headersSent) {
              reject(new AppError(`Stream download failed with code ${code}: ${errorOutput}`, 404));
            } else {
              // 이미 응답이 시작된 경우 연결만 종료
              res.end();
              reject(new AppError(`Stream download interrupted: ${errorOutput}`, 500));
            }
          }
        });

        // 클라이언트 연결 해제 처리
        res.on('close', () => {
          if (!smbProcess.killed) {
            logger.warn(`클라이언트 연결 해제, smbclient 프로세스 종료: ${filePath}`);
            smbProcess.kill('SIGTERM');
          }
        });

        // 타임아웃 설정 (10분)
        const timeout = setTimeout(() => {
          if (!smbProcess.killed) {
            logger.error(`스트리밍 다운로드 타임아웃: ${filePath}`);
            smbProcess.kill('SIGTERM');
            reject(new AppError('Stream download timeout', 408));
          }
        }, 600000); // 10분

        smbProcess.on('close', () => {
          clearTimeout(timeout);
        });
      });
    });
  }

  /**
   * 파일 목록 조회 (files API용)
   */
  async listFiles(dirPath = '') {
    await this.ensureConnection();

    if (this.useMockNAS) {
      // 개발환경에서는 로컬 파일시스템 사용
      try {
        const fullPath = path.join(this.mockBasePath, dirPath);
        logger.info(`Mock NAS 파일 목록 조회 - mockBasePath: ${this.mockBasePath}, dirPath: ${dirPath}, fullPath: ${fullPath}`);

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
              modified: fileInfo.modified,
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
    if (!this.isConnected || (!this.useMockNAS && !this.smbClient)) {
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
        releaseBasePath: this.releaseBasePath,
      },
      lastConnected: this.lastConnected,
    };
  }

  /**
   * 젠킨스 빌드 로그 기반 아티팩트 검색
   */
  async searchArtifactsFromBuildLog(jobName, buildNumber) {
    try {
      // 젠킨스 서비스에서 빌드 로그로부터 아티팩트 정보 추출
      const { getJenkinsService } = require('./jenkinsService');
      const jenkinsService = getJenkinsService();

      logger.info(`Searching artifacts for ${jobName}#${buildNumber} from build log`);
      const extractedArtifacts = await jenkinsService.extractArtifactsFromBuildLog(jobName, buildNumber);

      if (extractedArtifacts.length === 0) {
        logger.warn(`No artifacts found in build log for ${jobName}#${buildNumber}`);
        return [];
      }

      // 실제 NAS 서버에서 파일 존재 여부 확인
      const verifiedArtifacts = [];

      // jobName에서 버전 추출하여 NAS 경로 결정
      const versionMatch = jobName.match(/(\d+\.\d+\.\d+)/);
      if (!versionMatch) {
        throw new Error(`Cannot extract version from job name: ${jobName}`);
      }

      const version = versionMatch[1];
      const searchPaths = [
        version, // 1.2.0
        `release_version/${version}`, // release_version/1.2.0
        `projects/${version}`, // projects/1.2.0
        `builds/${version}`, // builds/1.2.0
      ];

      await this.ensureConnection();

      for (const artifact of extractedArtifacts) {
        let found = false;

        // 여러 경로에서 파일 검색
        for (const searchPath of searchPaths) {
          try {
            const files = await this.searchFiles(searchPath, artifact.filename);

            if (files.length > 0) {
              // 파일을 찾은 경우
              const foundFile = files[0]; // 가장 최근 파일 선택
              verifiedArtifacts.push({
                ...artifact,
                nasPath: foundFile.path,
                fileSize: foundFile.size,
                lastModified: foundFile.modified,
                verified: true,
                searchPath: searchPath,
              });

              logger.info(`Found artifact on NAS: ${foundFile.path}`);
              found = true;
              break;
            }
          } catch (searchError) {
            logger.debug(`Failed to search in path ${searchPath}: ${searchError.message}`);
          }
        }

        if (!found) {
          // 파일을 찾지 못한 경우에도 정보 보존
          verifiedArtifacts.push({
            ...artifact,
            verified: false,
            searchError: 'File not found on NAS server',
          });
          logger.warn(`Artifact not found on NAS: ${artifact.filename}`);
        }
      }

      logger.info(`Verified ${verifiedArtifacts.filter(a => a.verified).length}/${extractedArtifacts.length} artifacts on NAS server`);
      return verifiedArtifacts;

    } catch (error) {
      logger.error(`Failed to search artifacts from build log for ${jobName}#${buildNumber}:`, error.message);
      throw new Error(`빌드 로그 기반 아티팩트 검색 실패: ${error.message}`);
    }
  }

  /**
   * 버전별 NAS 아티팩트 전체 검색
   */
  async searchArtifactsByVersion(version, pattern = null) {
    try {
      await this.ensureConnection();

      // 실제 NAS 구조에 맞는 검색 경로
      const searchPaths = [
        `release/product/${version}`,  // 메인 경로: release/product/mr1.2.0
        `release/product/mr${version}`, // mr 접두어 포함
        `release/product/${version.replace('.', '')}`, // 점 제거
        `release/dailybuild/${version}`, // 일일 빌드
        `${version}`, // 직접 버전 디렉토리
        `projects/${version}`, // 기존 fallback
      ];

      const allArtifacts = [];

      for (const searchPath of searchPaths) {
        try {
          logger.info(`Searching for artifacts in path: ${searchPath}`);

          // 디렉토리가 존재하는지 먼저 확인
          const allItems = await this.listDirectory(searchPath);

          for (const dirName of allItems) {
            if (dirName.match(/^\d{6}$/)) { // 날짜 형식 디렉토리 (250926)
              try {
                const datePath = path.posix.join(searchPath, dirName);
                const dirInfo = await this.getFileInfo(datePath);
                if (!dirInfo.isDirectory) continue;

                logger.info(`Found date directory: ${datePath}`);

                // 날짜 디렉토리 안의 빌드 번호 디렉토리들을 검색
                const buildItems = await this.listDirectory(datePath);

                for (const buildDirName of buildItems) {
                  if (buildDirName.match(/^\d+$/)) { // 숫자 디렉토리 (빌드 번호)
                    try {
                      const buildPath = path.posix.join(datePath, buildDirName);
                      const buildDirInfo = await this.getFileInfo(buildPath);
                      if (!buildDirInfo.isDirectory) continue;

                      logger.info(`Found build directory: ${buildPath}`);

                  // 실제 아티팩트 파일들 검색
                  const artifactFiles = await this.searchFiles(buildPath);

                  const compressedFiles = artifactFiles.filter(file => {
                    // 압축 파일인지 확인
                    if (!file.name.match(/\.(tar\.gz|zip|7z|enc\.tar\.gz)$/i)) {
                      return false;
                    }

                    // 패턴 필터링 (mr, fs 등의 접두어)
                    if (pattern) {
                      // 파일명이 패턴으로 시작하는지 확인 (예: fs1.2.0_... or mr1.2.0_...)
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

                      logger.info(`Found ${compressedFiles.length} artifacts in ${buildPath}`);
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

          // 직접 파일 검색도 시도 (기존 로직 유지)
          const directFiles = await this.searchFiles(searchPath);
          const compressedFiles = directFiles.filter(file =>
            file.name.match(/\.(tar\.gz|zip|7z|enc\.tar\.gz)$/i) &&
            (!pattern || file.name.toLowerCase().includes(pattern.toLowerCase())),
          );

          for (const file of compressedFiles) {
            allArtifacts.push({
              filename: file.name,
              nasPath: file.path,
              fileSize: file.size,
              lastModified: file.modified,
              buildNumber: this.extractBuildNumber(file.name),
              version: version,
              searchPath: searchPath,
              verified: true,
            });
          }

          if (compressedFiles.length > 0) {
            logger.info(`Found ${compressedFiles.length} direct artifacts in ${searchPath}`);
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
   * 최종 아티팩트 검색 (V1.2.0_XXX.tar 형태)
   * mr과 fs 빌드가 성공한 후 생성되는 최종 통합 아티팩트 검색
   */
  async searchFinalArtifactsByVersion(version) {
    try {
      await this.ensureConnection();

      // 최종 아티팩트는 V{version}_XXX.tar 형태로 생성됨
      const finalArtifactPattern = `V${version}_`;

      // 검색 경로 - 최종 아티팩트는 상위 레벨에 생성될 가능성이 높음
      const searchPaths = [
        `release/product/${version}`,  // 메인 경로
        `release/product/mr${version}`, // mr 디렉토리
        `release/final/${version}`,    // 최종 빌드 디렉토리
        `release/${version}`,          // 직접 릴리즈 디렉토리
        `${version}`,                  // 버전 직접 디렉토리
      ];

      const finalArtifacts = [];

      for (const searchPath of searchPaths) {
        try {
          logger.info(`Searching for final artifacts in path: ${searchPath}`);

          // 디렉토리 존재 확인 및 검색
          const allItems = await this.listDirectory(searchPath);

          for (const dirName of allItems) {
            if (dirName.match(/^\d{6}$/)) { // 날짜 형식 디렉토리 (250926)
              try {
                const datePath = path.posix.join(searchPath, dirName);
                const dirInfo = await this.getFileInfo(datePath);
                if (!dirInfo.isDirectory) continue;

                logger.info(`Searching final artifacts in date directory: ${datePath}`);

                // 날짜 디렉토리 안의 빌드 번호 디렉토리들을 검색
                const buildItems = await this.listDirectory(datePath);

                for (const buildDirName of buildItems) {
                  if (buildDirName.match(/^\d+$/)) { // 숫자 디렉토리 (빌드 번호)
                    try {
                      const buildPath = path.posix.join(datePath, buildDirName);
                      const buildDirInfo = await this.getFileInfo(buildPath);
                      if (!buildDirInfo.isDirectory) continue;

                      // 최종 아티팩트 파일들 검색
                      const artifactFiles = await this.searchFiles(buildPath);

                      const finalFiles = artifactFiles.filter(file => {
                        // V{version}_XXX.tar 패턴 매칭
                        return file.name.startsWith(finalArtifactPattern) &&
                               file.name.match(/\.tar$/i);
                      });

                      for (const file of finalFiles) {
                        finalArtifacts.push({
                          filename: file.name,
                          nasPath: file.path,
                          fileSize: file.size,
                          lastModified: file.modified,
                          buildNumber: buildDirName,
                          version: version,
                          searchPath: buildPath,
                          verified: true,
                          isFinalArtifact: true,
                        });
                      }

                      if (finalFiles.length > 0) {
                        logger.info(`Found ${finalFiles.length} final artifacts in ${buildPath}`);
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

          // 직접 파일 검색도 시도
          const directFiles = await this.searchFiles(searchPath);
          const finalFiles = directFiles.filter(file =>
            file.name.startsWith(finalArtifactPattern) &&
            file.name.match(/\.tar$/i),
          );

          for (const file of finalFiles) {
            finalArtifacts.push({
              filename: file.name,
              nasPath: file.path,
              fileSize: file.size,
              lastModified: file.modified,
              buildNumber: this.extractBuildNumber(file.name),
              version: version,
              searchPath: searchPath,
              verified: true,
              isFinalArtifact: true,
            });
          }

          if (finalFiles.length > 0) {
            logger.info(`Found ${finalFiles.length} direct final artifacts in ${searchPath}`);
          }

        } catch (searchError) {
          logger.debug(`No final artifacts found in path ${searchPath}: ${searchError.message}`);
        }
      }

      // 중복 제거 및 최신순 정렬
      const uniqueArtifacts = finalArtifacts.filter((artifact, index, self) =>
        index === self.findIndex(a => a.filename === artifact.filename),
      );

      uniqueArtifacts.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

      logger.info(`Total final artifacts found for version ${version}: ${uniqueArtifacts.length}`);
      return uniqueArtifacts;

    } catch (error) {
      logger.error(`Failed to search final artifacts for version ${version}:`, error.message);
      throw new Error(`최종 아티팩트 검색 실패: ${error.message}`);
    }
  }

  /**
   * 서비스 정리
   */
  /**
   * 디렉토리 존재 여부 확인
   * @param {string} dirPath - 확인할 디렉토리 경로 (예: "release/product/mr3.0.0/250310/26")
   * @returns {Promise<boolean>} - 디렉토리 존재 여부
   */
  async directoryExists(dirPath) {
    try {
      await this.ensureConnection();

      const host = process.env.NAS_HOST || 'nas.roboetech.com';
      const share = process.env.NAS_SHARE || 'release_version';
      const username = process.env.NAS_USERNAME || 'nasadmin';
      const password = process.env.NAS_PASSWORD || 'Cmtes123';

      // smbclient를 사용하여 디렉토리 존재 확인
      const command = `smbclient //${host}/${share} -U ${username}%${password} -c "cd \\"${dirPath}\\"; ls" 2>/dev/null`;

      logger.debug(`Checking directory existence: ${dirPath}`);
      logger.debug(`Command: ${command.replace(password, '***')}`);

      const { stdout, stderr } = await execAsync(command);

      // cd 명령이 성공하면 디렉토리가 존재
      if (stderr && stderr.includes('NT_STATUS_OBJECT_NAME_NOT_FOUND')) {
        logger.info(`Directory does not exist: ${dirPath}`);
        return false;
      }

      if (stdout && stdout.trim().length > 0) {
        logger.info(`Directory exists: ${dirPath}`);
        return true;
      }

      return false;

    } catch (error) {
      logger.warn(`Error checking directory existence for ${dirPath}: ${error.message}`);
      return false;
    }
  }

  /**
   * 여러 가능한 디렉토리 경로 중 실제 존재하는 첫 번째 경로 찾기
   * @param {string[]} possiblePaths - 가능한 경로들의 배열
   * @returns {Promise<string|null>} - 존재하는 첫 번째 경로 또는 null
   */
  async findExistingDirectory(possiblePaths) {
    for (const dirPath of possiblePaths) {
      const exists = await this.directoryExists(dirPath);
      if (exists) {
        logger.info(`Found existing directory: ${dirPath}`);
        return dirPath;
      }
    }

    logger.warn(`No existing directories found among: ${possiblePaths.join(', ')}`);
    return null;
  }

  /**
   * 특정 디렉토리의 파일 목록 확인
   * @param {string} dirPath - 디렉토리 경로
   * @returns {Promise<string[]>} - 파일명 목록
   */
  async getDirectoryFiles(dirPath) {
    try {
      await this.ensureConnection();

      if (this.useSmbclient) {
        return this.listDirectoryWithSmbclient(dirPath);
      }

      return this.listDirectory(dirPath);

    } catch (error) {
      logger.warn(`Error getting files for directory ${dirPath}: ${error.message}`);
      return [];
    }
  }

  /**
   * 파일 업로드 (버퍼 기반)
   * @param {string} filePath - 업로드할 파일 경로
   * @param {Buffer} buffer - 파일 데이터 버퍼
   */
  async uploadFile(filePath, buffer) {
    await this.ensureConnection();

    if (this.useMockNAS) {
      // 개발환경에서는 로컬 파일시스템 사용
      try {
        const fullPath = path.join(this.mockBasePath, filePath);
        const dirPath = path.dirname(fullPath);

        // 디렉토리 생성 (재귀적으로)
        await fs.mkdir(dirPath, { recursive: true });

        // 파일 쓰기
        await fs.writeFile(fullPath, buffer);

        logger.info(`File uploaded successfully to mock NAS: ${filePath}, size: ${buffer.length} bytes`);
        return;
      } catch (error) {
        logger.error(`Failed to upload file to mock NAS ${filePath}:`, error.message);
        throw new AppError(`File upload failed: ${error.message}`, 500);
      }
    }

    // 프로덕션환경에서는 smbclient 사용
    return this.uploadFileWithSmbclient(filePath, buffer);
  }

  /**
   * smbclient를 사용한 파일 업로드
   * @param {string} filePath - 업로드할 파일 경로
   * @param {Buffer} buffer - 파일 데이터 버퍼
   */
  async uploadFileWithSmbclient(filePath, buffer) {
    return withNASRetry(async () => {
      const host = process.env.NAS_HOST || 'nas.roboetech.com';
      const share = process.env.NAS_SHARE || 'release_version';
      const username = process.env.NAS_USERNAME || 'nasadmin';
      const password = process.env.NAS_PASSWORD || 'Cmtes123';

      // 임시 파일 경로 생성
      const safeFileName = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
      const tempFileName = `nas_upload_${Date.now()}_${safeFileName}`;
      const tempFilePath = `/tmp/${tempFileName}`;

      try {
        logger.info(`smbclient로 파일 업로드 시도: ${filePath}`);
        logger.info(`임시 파일 경로: ${tempFilePath}`);

        // 로컬 임시 파일에 버퍼 저장
        await fs.writeFile(tempFilePath, buffer);

        // 디렉토리 경로 생성 (필요한 경우)
        const dirPath = path.dirname(filePath);
        if (dirPath && dirPath !== '.') {
          const mkdirCommand = `smbclient //${host}/${share} -U ${username}%${password} -c "mkdir \\"${dirPath}\\"" 2>/dev/null || true`;
          await execAsync(mkdirCommand);
        }

        // smbclient put 명령어 실행
        const command = `smbclient //${host}/${share} -U ${username}%${password} -c "put \\"${tempFilePath}\\" \\"${filePath}\\"" 2>&1`;

        logger.info(`실행 명령어: ${command.replace(password, '***')}`);

        const { stdout, stderr } = await execAsync(command, {
          timeout: 300000, // 5분 타임아웃
          maxBuffer: 1024 * 1024 * 10, // 10MB 버퍼
        });

        logger.info(`smbclient 출력: ${stdout}`);
        if (stderr) {
          logger.warn(`smbclient 경고: ${stderr}`);
        }

        // 임시 파일 삭제
        try {
          await fs.unlink(tempFilePath);
        } catch (unlinkError) {
          logger.warn(`Failed to delete temp file ${tempFilePath}:`, unlinkError.message);
        }

        logger.info(`File uploaded successfully via smbclient: ${filePath}, size: ${buffer.length} bytes`);

      } catch (error) {
        // 임시 파일이 있다면 삭제 시도
        try {
          await fs.unlink(tempFilePath);
        } catch (unlinkError) {
          // 무시
        }

        logger.error(`smbclient 파일 업로드 실패: ${filePath}`, error.message);
        throw new AppError(`File upload failed: ${error.message}`, 500);
      }
    });
  }

  /**
   * 스트리밍 파일 업로드 (대용량 파일용)
   * @param {string} filePath - 업로드할 파일 경로
   * @param {Readable} stream - 파일 스트림 (Express req 객체)
   */
  async streamUploadFile(filePath, stream) {
    await this.ensureConnection();

    if (this.useMockNAS) {
      // 개발환경에서는 로컬 파일시스템 사용
      try {
        const fullPath = path.join(this.mockBasePath, filePath);
        const dirPath = path.dirname(fullPath);

        // 디렉토리 생성 (재귀적으로)
        await fs.mkdir(dirPath, { recursive: true });

        // 스트림을 파일로 파이프
        const writeStream = require('fs').createWriteStream(fullPath);

        return new Promise((resolve, reject) => {
          stream.pipe(writeStream);

          writeStream.on('finish', () => {
            logger.info(`Stream upload completed to mock NAS: ${filePath}`);
            resolve();
          });

          writeStream.on('error', (error) => {
            logger.error(`Stream upload failed to mock NAS: ${filePath}`, error.message);
            reject(new AppError(`Stream upload failed: ${error.message}`, 500));
          });
        });
      } catch (error) {
        logger.error(`Failed to setup stream upload to mock NAS ${filePath}:`, error.message);
        throw new AppError(`Stream upload setup failed: ${error.message}`, 500);
      }
    }

    // 프로덕션환경에서는 smbclient 사용
    return this.streamUploadFileWithSmbclient(filePath, stream);
  }

  /**
   * smbclient를 사용한 스트리밍 파일 업로드
   * @param {string} filePath - 업로드할 파일 경로
   * @param {Readable} stream - 파일 스트림
   */
  async streamUploadFileWithSmbclient(filePath, stream) {
    return withNASRetry(async () => {
      const host = process.env.NAS_HOST || 'nas.roboetech.com';
      const share = process.env.NAS_SHARE || 'release_version';
      const username = process.env.NAS_USERNAME || 'nasadmin';
      const password = process.env.NAS_PASSWORD || 'Cmtes123';

      logger.info(`스트리밍 업로드 시작: ${filePath}`);

      const { spawn } = require('child_process');

      return new Promise((resolve, reject) => {
        // 디렉토리 경로 생성 (필요한 경우)
        const dirPath = path.dirname(filePath);
        let mkdirPromise = Promise.resolve();

        if (dirPath && dirPath !== '.') {
          mkdirPromise = execAsync(`smbclient //${host}/${share} -U ${username}%${password} -c "mkdir \\"${dirPath}\\"" 2>/dev/null || true`);
        }

        mkdirPromise.then(() => {
          // smbclient 명령어로 stdin에서 파일을 받아서 업로드
          const command = 'smbclient';
          const args = [
            `//${host}/${share}`,
            '-U', `${username}%${password}`,
            '-c', `put - "${filePath}"`,  // stdin에서 읽어서 업로드
          ];

          logger.info(`스트리밍 업로드 명령어: ${command} ${args.join(' ').replace(password, '***')}`);

          const smbProcess = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          let errorOutput = '';
          let bytesReceived = 0;

          // stderr 에러 수집
          smbProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
          });

          // stdout 로그 수집
          smbProcess.stdout.on('data', (data) => {
            logger.debug(`smbclient stdout: ${data.toString()}`);
          });

          // 클라이언트 스트림을 smbclient stdin으로 파이프
          stream.on('data', (chunk) => {
            bytesReceived += chunk.length;
            smbProcess.stdin.write(chunk);
          });

          stream.on('end', () => {
            smbProcess.stdin.end();
            logger.info(`스트림 전송 완료: ${filePath}, 수신량: ${bytesReceived} bytes`);
          });

          stream.on('error', (error) => {
            logger.error(`클라이언트 스트림 에러: ${error.message}`);
            smbProcess.kill('SIGTERM');
            reject(new AppError(`Stream upload client error: ${error.message}`, 400));
          });

          smbProcess.on('error', (error) => {
            logger.error(`smbclient 프로세스 에러: ${error.message}`);
            reject(new AppError(`Stream upload process failed: ${error.message}`, 500));
          });

          smbProcess.on('close', (code) => {
            if (code === 0) {
              logger.info(`스트리밍 업로드 완료: ${filePath}, 수신량: ${bytesReceived} bytes`);
              resolve();
            } else {
              logger.error(`smbclient 종료 코드: ${code}, 에러: ${errorOutput}`);
              reject(new AppError(`Stream upload failed with code ${code}: ${errorOutput}`, 500));
            }
          });

          // 타임아웃 설정 (10분)
          const timeout = setTimeout(() => {
            if (!smbProcess.killed) {
              logger.error(`스트리밍 업로드 타임아웃: ${filePath}`);
              smbProcess.kill('SIGTERM');
              reject(new AppError('Stream upload timeout', 408));
            }
          }, 600000); // 10분

          smbProcess.on('close', () => {
            clearTimeout(timeout);
          });
        }).catch(reject);
      });
    });
  }

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
  getNASService,
};
