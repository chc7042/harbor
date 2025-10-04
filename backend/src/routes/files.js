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
      'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype) || 
        file.originalname.endsWith('.tar.gz') || 
        file.originalname.endsWith('.zip') ||
        file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 파일 형식입니다.'), false);
    }
  }
});

// 모든 파일 라우트는 인증 필요
router.use(authenticateToken);

// NAS 직접 다운로드를 위한 리다이렉트
router.get('/download',
  async (req, res, next) => {
    try {
      const { path } = req.query;

      if (!path) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_PATH',
            message: '파일 경로가 필요합니다.',
          },
        });
      }

      // path가 /nas/release_version/으로 시작하는지 확인
      if (!path.startsWith('/nas/release_version/')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PATH',
            message: '유효하지 않은 파일 경로입니다.',
          },
        });
      }

      // /nas/release_version/ 제거하고 실제 NAS 경로 구성
      const relativePath = path.replace('/nas/release_version/', '');

      logger.info(`즉시 다운로드 리다이렉트 - 사용자: ${req.user.username}, 경로: ${relativePath}`);

      // Synology API를 통한 즉시 다운로드 리다이렉트
      const synologyApiService = require('../services/synologyApiService');
      
      try {
        logger.info(`🚀 Synology API 직접 다운로드 시도 시작: ${path}`);
        // Synology API 세션 확인 및 직접 다운로드 URL 생성
        const directDownloadResult = await synologyApiService.createDirectDownloadUrl(path);
        logger.info(`🔍 Synology API 결과:`, directDownloadResult);
        
        if (directDownloadResult.success && directDownloadResult.directNasUrl) {
          // 직접 NAS URL로 리다이렉트 (즉시 다운로드 시작)
          logger.info(`직접 NAS URL로 리다이렉트: ${directDownloadResult.directNasUrl}`);
          return res.redirect(302, directDownloadResult.directNasUrl);
        } else {
          throw new Error('직접 다운로드 URL 생성 실패');
        }
        
      } catch (downloadError) {
        logger.error(`❌ Synology API 직접 다운로드 실패: ${downloadError.message}, fallback to share link`);
        
        // 직접 다운로드 실패시 공유링크로 fallback
        try {
          logger.info(`🔄 Synology API 공유링크 fallback 시도: ${path}`);
          const shareResult = await synologyApiService.createFileDownloadLink(path);
          logger.info(`🔍 공유링크 결과:`, shareResult);
          if (shareResult.success && shareResult.directNasUrl) {
            logger.info(`✅ 공유링크로 리다이렉트: ${shareResult.directNasUrl}`);
            return res.redirect(302, shareResult.directNasUrl);
          } else {
            throw new Error('공유링크 생성도 실패');
          }
        } catch (shareError) {
          logger.error(`❌ 공유링크 생성 실패: ${shareError.message}, fallback to NAS service`);
          logger.info(`🔄 NAS 서비스 fallback 시도`);
          
          // 기존 NAS 서비스로 fallback
          const nasService = getNASService();
          try {
            const fileBuffer = await nasService.downloadFile(relativePath);
            
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${path.split('/').pop()}"`);
            res.send(fileBuffer);
            
            logger.info(`✅ NAS 서비스를 통한 다운로드 완료: ${relativePath}`);
            return;
          } catch (nasError) {
            logger.error(`❌ NAS 서비스 fallback도 실패: ${nasError.message}`);
            return res.status(404).json({
              success: false,
              error: {
                code: 'DOWNLOAD_FAILED',
                message: '다운로드에 실패했습니다.',
              },
            });
          }
        }
      }

    } catch (error) {
      logger.error('파일 다운로드 오류:', error.message);
      next(error);
    }
  },
);

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
      const file = req.file;

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
