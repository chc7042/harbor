const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { getNASService } = require('../services/nasService');
const logger = require('../config/logger');

const router = express.Router();

// Multer 스트리밍 설정
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.NAS_MAX_FILE_SIZE, 10) || 2147483648, // 2GB
    fieldSize: 25 * 1024 * 1024, // 25MB
  },
  fileFilter: (req, file, cb) => {
    // 허용된 파일 타입 체크
    const allowedTypes = [
      'application/gzip',
      'application/x-gzip',
      'application/zip',
      'application/x-zip-compressed',
      'application/json',
      'application/octet-stream',
      'text/plain',
    ];

    if (allowedTypes.includes(file.mimetype) ||
        file.originalname.endsWith('.tar.gz') ||
        file.originalname.endsWith('.zip') ||
        file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 파일 형식입니다.'), false);
    }
  },
});

// 모든 파일 라우트는 인증 필요
router.use(authenticateToken);

/**
 * 파일 다운로드 클래스 - 리다이렉트 패턴 구현
 */
class DownloadManager {
  constructor() {
    this.downloadStrategies = [
      { name: 'NAS Service Streaming', method: this.tryNasServiceDownload.bind(this) },
      { name: 'Synology Direct', method: this.tryDirectDownload.bind(this) },
      { name: 'Synology Share Link', method: this.tryShareLinkDownload.bind(this) },
    ];
  }

  /**
   * 다운로드 요청 메인 처리 함수
   */
  async processDownload(req, res) {
    const requestId = Math.random().toString(36).substr(2, 9);
    const startTime = Date.now();

    try {
      const { path } = req.query;
      const {user} = req;

      // 요청 검증
      const validationResult = this.validateDownloadRequest(path);
      if (!validationResult.isValid) {
        return res.status(400).json({
          success: false,
          error: validationResult.error,
        });
      }

      const relativePath = path.replace('/nas/release_version/', '');

      logger.info(`[DOWNLOAD-${requestId}] =================================`);
      logger.info(`[DOWNLOAD-${requestId}] 다운로드 요청 시작`);
      logger.info(`[DOWNLOAD-${requestId}] 사용자: ${user.username} (${user.email})`);
      logger.info(`[DOWNLOAD-${requestId}] 요청 경로: ${path}`);
      logger.info(`[DOWNLOAD-${requestId}] 상대 경로: ${relativePath}`);
      logger.info(`[DOWNLOAD-${requestId}] 클라이언트 IP: ${req.ip || req.connection.remoteAddress}`);

      // 다단계 폴백 체인 실행
      for (let i = 0; i < this.downloadStrategies.length; i++) {
        const strategy = this.downloadStrategies[i];
        let strategyStartTime = Date.now(); // 변수를 try 밖으로 이동

        try {
          logger.info(`[DOWNLOAD-${requestId}] 🚀 전략 ${i + 1}: ${strategy.name} 시도 중...`);

          // NAS Service 전략인 경우 response 객체 전달
          const isNasServiceStrategy = strategy.name === 'NAS Service Streaming';
          const result = isNasServiceStrategy
            ? await strategy.method(path, relativePath, requestId, res)
            : await strategy.method(path, relativePath, requestId);
          const strategyDuration = Date.now() - strategyStartTime;

          if (result.success) {
            const totalDuration = Date.now() - startTime;
            logger.info(`[DOWNLOAD-${requestId}] ✅ ${strategy.name} 성공! (${strategyDuration}ms)`);
            logger.info(`[DOWNLOAD-${requestId}] 다운로드 URL: ${result.url || result.action}`);
            logger.info(`[DOWNLOAD-${requestId}] =================================`);
            logger.info(`[DOWNLOAD-${requestId}] 전체 처리 시간: ${totalDuration}ms`);

            if (result.redirect) {
              return res.redirect(302, result.url);
            } else if (result.streaming) {
              // 스트리밍 전송 완료 - 이미 응답이 전송됨
              return;
            } else {
              // 직접 파일 전송 (레거시 - 메모리 기반)
              res.setHeader('Content-Type', 'application/octet-stream');
              res.setHeader('Content-Disposition', `attachment; filename="${path.split('/').pop()}"`);
              res.send(result.buffer);
              return;
            }
          }
        } catch (strategyError) {
          const strategyDuration = Date.now() - strategyStartTime;
          logger.warn(`[DOWNLOAD-${requestId}] ⚠ ${strategy.name} 실패 (${strategyDuration}ms): ${strategyError.message}`);

          // 스트리밍 도중 에러가 발생한 경우, 응답이 이미 시작되었을 수 있음
          if (isNasServiceStrategy && res.headersSent) {
            logger.error(`[DOWNLOAD-${requestId}] 스트리밍 도중 에러 발생 - 응답 이미 시작됨`);
            // 연결 종료만 하고 에러 응답은 보낼 수 없음
            if (!res.destroyed) {
              res.end();
            }
            return;
          }

          // 마지막 전략이 실패한 경우에만 에러 처리
          if (i === this.downloadStrategies.length - 1) {
            throw strategyError;
          }
        }
      }

      // 모든 전략이 실패한 경우
      throw new Error('모든 다운로드 전략이 실패했습니다.');

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      logger.error(`[DOWNLOAD-${requestId}] ❌ 다운로드 최종 실패 (${totalDuration}ms): ${error.message}`);
      logger.error(`[DOWNLOAD-${requestId}] =================================`);

      // 이미 응답이 시작된 경우 추가 응답을 보낼 수 없음
      if (res.headersSent) {
        logger.error(`[DOWNLOAD-${requestId}] 응답 헤더가 이미 전송됨 - JSON 에러 응답 불가`);
        if (!res.destroyed) {
          res.end();
        }
        return;
      }

      return res.status(404).json({
        success: false,
        error: {
          code: 'DOWNLOAD_FAILED',
          message: '다운로드에 실패했습니다.',
        },
      });
    }
  }

  /**
   * 다운로드 요청 검증
   */
  validateDownloadRequest(path) {
    if (!path) {
      return {
        isValid: false,
        error: {
          code: 'MISSING_PATH',
          message: '파일 경로가 필요합니다.',
        },
      };
    }

    if (!path.startsWith('/nas/release_version/')) {
      return {
        isValid: false,
        error: {
          code: 'INVALID_PATH',
          message: '유효하지 않은 파일 경로입니다.',
        },
      };
    }

    return { isValid: true };
  }

  /**
   * 전략 1: Synology API 직접 다운로드
   */
  async tryDirectDownload(path, relativePath, requestId) {
    const synologyApiService = require('../services/synologyApiService');

    logger.info(`[DOWNLOAD-${requestId}] Synology API 직접 다운로드 URL 생성 중...`);
    const result = await synologyApiService.createDirectDownloadUrl(path);

    if (result.success && result.directNasUrl) {
      return {
        success: true,
        redirect: true,
        url: result.directNasUrl,
        action: 'Synology Direct Download',
      };
    }

    throw new Error('직접 다운로드 URL 생성 실패');
  }

  /**
   * 전략 2: Synology API 공유링크 다운로드
   */
  async tryShareLinkDownload(path, relativePath, requestId) {
    const synologyApiService = require('../services/synologyApiService');

    logger.info(`[DOWNLOAD-${requestId}] Synology API 공유링크 생성 중...`);
    const result = await synologyApiService.createFileDownloadLink(path);

    if (result.success && result.directNasUrl) {
      return {
        success: true,
        redirect: true,
        url: result.directNasUrl,
        action: 'Synology Share Link',
      };
    }

    throw new Error('공유링크 생성 실패');
  }

  /**
   * 전략 3: NAS 서비스를 통한 스트리밍 파일 전송 (메모리 우회)
   */
  async tryNasServiceDownload(path, relativePath, requestId, res) {
    const nasService = getNASService();

    logger.info(`[DOWNLOAD-${requestId}] NAS 서비스를 통한 스트리밍 다운로드 중...`);

    // 파일명 추출 및 헤더 설정
    const fileName = path.split('/').pop();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // 스트리밍 다운로드 (메모리에 전체 파일 로딩하지 않음)
    await nasService.streamDownloadFile(relativePath, res);

    return {
      success: true,
      redirect: false,
      streaming: true,
      action: 'NAS Service Streaming Transfer',
    };
  }
}

// 다운로드 매니저 인스턴스 생성
const downloadManager = new DownloadManager();

// NAS 직접 다운로드를 위한 리다이렉트 (향상된 패턴)
router.get('/download', async (req, res, next) => {
  try {
    await downloadManager.processDownload(req, res);
  } catch (error) {
    logger.error('파일 다운로드 오류:', error.message);
    next(error);
  }
});

// NAS 파일 목록 조회
router.get('/list',
  async (req, res, next) => {
    try {
      const { path = '' } = req.query;

      logger.info(`파일 목록 조회 요청 - 사용자: ${req.user.username}, 경로: ${path}`);

      const nasService = getNASService();

      try {
        const files = await nasService.listFiles(path);

        res.json({
          success: true,
          data: {
            path,
            files,
          },
        });

        logger.info(`파일 목록 조회 완료 - 사용자: ${req.user.username}, 파일 수: ${files.length}개`);

      } catch (nasError) {
        logger.error(`NAS 파일 목록 조회 실패 - 경로: ${path}, 오류: ${nasError.message}`);

        return res.status(404).json({
          success: false,
          error: {
            code: 'PATH_NOT_FOUND',
            message: '경로를 찾을 수 없습니다.',
          },
        });
      }

    } catch (error) {
      logger.error('파일 목록 조회 오류:', error.message);
      next(error);
    }
  },
);

// 파일 검색
router.get('/search',
  async (req, res, next) => {
    try {
      const { filename } = req.query;

      if (!filename) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_FILENAME',
            message: '파일명이 필요합니다.',
          },
        });
      }

      logger.info(`파일 검색 요청 - 사용자: ${req.user.username}, 파일명: ${filename}`);

      const nasService = getNASService();

      try {
        // NAS에서 파일 검색 - 여러 경로에서 검색
        const searchPaths = [
          'release/product',
          'release/dailybuild',
        ];

        let foundFiles = [];

        for (const basePath of searchPaths) {
          try {
            const files = await nasService.searchFiles(basePath, filename);
            foundFiles = foundFiles.concat(files.map(file => ({
              ...file,
              searchPath: basePath,
              downloadUrl: `/api/files/download?path=${encodeURIComponent('/nas/release_version/' + file.path)}`,
            })));
          } catch (searchError) {
            logger.debug(`Search failed in ${basePath}: ${searchError.message}`);
          }
        }

        res.json({
          success: true,
          data: {
            filename,
            files: foundFiles,
            total: foundFiles.length,
          },
        });

        logger.info(`파일 검색 완료 - 사용자: ${req.user.username}, 파일명: ${filename}, 결과: ${foundFiles.length}개`);

      } catch (nasError) {
        logger.error(`NAS 파일 검색 실패 - 파일명: ${filename}, 오류: ${nasError.message}`);

        return res.status(404).json({
          success: false,
          error: {
            code: 'FILE_SEARCH_FAILED',
            message: '파일 검색에 실패했습니다.',
          },
        });
      }

    } catch (error) {
      logger.error('파일 검색 오류:', error.message);
      next(error);
    }
  },
);

// 파일 업로드
router.post('/upload',
  upload.single('file'),
  async (req, res, next) => {
    try {
      const { path } = req.body;
      const {file} = req;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILE',
            message: '업로드할 파일이 없습니다.',
          },
        });
      }

      if (!path) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_PATH',
            message: '업로드 경로가 필요합니다.',
          },
        });
      }

      // path가 /nas/release_version/으로 시작하는지 확인
      if (!path.startsWith('/nas/release_version/')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PATH',
            message: '유효하지 않은 업로드 경로입니다.',
          },
        });
      }

      // /nas/release_version/ 제거하고 실제 NAS 경로 구성
      const relativePath = path.replace('/nas/release_version/', '');
      const fullPath = relativePath + '/' + file.originalname;

      logger.info(`파일 업로드 요청 - 사용자: ${req.user.username}, 파일: ${file.originalname}, 크기: ${file.size}, 경로: ${fullPath}`);

      const nasService = getNASService();

      try {
        // NAS에 파일 업로드
        await nasService.uploadFile(fullPath, file.buffer);

        res.json({
          success: true,
          data: {
            filename: file.originalname,
            size: file.size,
            path: fullPath,
            uploadedAt: new Date().toISOString(),
          },
        });

        logger.info(`파일 업로드 완료 - 사용자: ${req.user.username}, 파일: ${file.originalname}, 경로: ${fullPath}`);

      } catch (nasError) {
        logger.error(`NAS 파일 업로드 실패 - 경로: ${fullPath}, 오류: ${nasError.message}`);

        return res.status(500).json({
          success: false,
          error: {
            code: 'UPLOAD_FAILED',
            message: '파일 업로드에 실패했습니다.',
          },
        });
      }

    } catch (error) {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          const maxSizeMB = Math.round((parseInt(process.env.NAS_MAX_FILE_SIZE, 10) || 2147483648) / 1024 / 1024);
          return res.status(413).json({
            success: false,
            error: {
              code: 'FILE_TOO_LARGE',
              message: `파일 크기가 너무 큽니다. (최대 ${maxSizeMB}MB)`,
            },
          });
        } else if (error.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_FILE_FIELD',
              message: '잘못된 파일 필드입니다.',
            },
          });
        }
      }

      logger.error('파일 업로드 오류:', error.message);
      next(error);
    }
  },
);

// 스트리밍 업로드 (대용량 파일용)
router.post('/upload/stream',
  async (req, res, next) => {
    try {
      const { path, filename } = req.query;

      if (!path || !filename) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_PARAMETERS',
            message: '경로와 파일명이 필요합니다.',
          },
        });
      }

      // path가 /nas/release_version/으로 시작하는지 확인
      if (!path.startsWith('/nas/release_version/')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PATH',
            message: '유효하지 않은 업로드 경로입니다.',
          },
        });
      }

      // /nas/release_version/ 제거하고 실제 NAS 경로 구성
      const relativePath = path.replace('/nas/release_version/', '');
      const fullPath = relativePath + '/' + filename;

      logger.info(`스트리밍 업로드 시작 - 사용자: ${req.user.username}, 파일: ${filename}, 경로: ${fullPath}`);

      const nasService = getNASService();

      try {
        // 스트리밍 업로드
        await nasService.streamUploadFile(fullPath, req);

        res.json({
          success: true,
          data: {
            filename: filename,
            path: fullPath,
            uploadedAt: new Date().toISOString(),
          },
        });

        logger.info(`스트리밍 업로드 완료 - 사용자: ${req.user.username}, 파일: ${filename}, 경로: ${fullPath}`);

      } catch (nasError) {
        logger.error(`스트리밍 업로드 실패 - 경로: ${fullPath}, 오류: ${nasError.message}`);

        if (!res.headersSent) {
          return res.status(500).json({
            success: false,
            error: {
              code: 'STREAM_UPLOAD_FAILED',
              message: '스트리밍 업로드에 실패했습니다.',
            },
          });
        }
      }

    } catch (error) {
      logger.error('스트리밍 업로드 오류:', error.message);
      if (!res.headersSent) {
        next(error);
      }
    }
  },
);

module.exports = router;
