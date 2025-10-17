const express = require('express');
const multer = require('multer');
const { getNASService } = require('../services/nasService');
const downloadService = require('../services/downloadService');
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

// 인증 미들웨어 제거됨 - 간소화된 LDAP 인증 사용

// NAS 파일 다운로드 (Synology API 기반)
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

      // 경로 정리: /nas/release_version/ 제거
      let cleanPath = path.replace('/nas/release_version/', '');

      // 추가 중복 경로 정리 (더 강력한 정리)
      cleanPath = cleanPath.replace(/^\/+release_version\/+/g, ''); // 시작부분 release_version/ 제거
      cleanPath = cleanPath.replace(/^release_version\/+/g, ''); // 시작부분 release_version/ 제거
      cleanPath = cleanPath.replace(/\/+/g, '/'); // 연속된 슬래시 제거

      // 시작 슬래시 제거 (있다면)
      if (cleanPath.startsWith('/')) {
        cleanPath = cleanPath.substring(1);
      }

      // 최종 Synology API 경로 구성
      const finalPath = '/release_version/' + cleanPath;
      const originalFileName = cleanPath.split('/').pop();

      logger.info(`파일 다운로드 요청 - 사용자: ${req.user.username}`);
      logger.info(`원본 경로: ${path}`);
      logger.info(`정리된 경로: ${cleanPath}`);
      logger.info(`최종 NAS 경로: ${finalPath}`);
      logger.info(`원본 파일명: ${originalFileName}`);

      // Synology 직접 다운로드 URL 생성 및 리다이렉트 (기존 방식 복원)
      try {
        const downloadUrl = await downloadService.createDownloadUrl(finalPath);

        if (downloadUrl.success && downloadUrl.downloadUrl) {
          // 실제 찾은 파일명 추출
          const actualFileName = downloadUrl.actualPath ? downloadUrl.actualPath.split('/').pop() : originalFileName;
          
          logger.info(`✅ 직접 다운로드 URL 생성: ${originalFileName} -> ${actualFileName}`);
          logger.info(`다운로드 URL: ${downloadUrl.downloadUrl}`);
          if (downloadUrl.patternMatched) {
            logger.info(`📝 패턴 매칭으로 실제 파일 발견: ${actualFileName}`);
          }

          // Synology는 파일명을 포함하지 않는 Content-Disposition을 보내므로
          // 직접 스트리밍으로 올바른 파일명을 설정
          logger.info(`스트리밍 다운로드로 전환: ${actualFileName}`);
          
          // 다운로드 URL에서 파일 스트리밍
          const axios = require('axios');
          const response = await axios({
            method: 'GET',
            url: downloadUrl.downloadUrl,
            responseType: 'stream',
            timeout: 30000,
          });

          // 올바른 헤더 설정
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Disposition', `attachment; filename="${actualFileName}"`);
          res.setHeader('Content-Length', response.headers['content-length']);
          
          // 스트림 파이프
          response.data.pipe(res);
          return;
        } else {
          throw new Error(`다운로드 URL 생성 실패: ${downloadUrl.error}`);
        }
      } catch (downloadError) {
        logger.error(`파일 다운로드 실패: ${downloadError.message}`);
        throw new Error(`파일 다운로드 실패: ${downloadError.message}`);
      }

    } catch (error) {
      logger.error('파일 다운로드 오류:', error.message);
      return res.status(404).json({
        success: false,
        error: {
          code: 'DOWNLOAD_FAILED',
          message: '다운로드에 실패했습니다.',
        },
      });
    }
  },
);

// NAS 파일 목록 조회
router.get('/list',
  async (req, res, next) => {
    try {
      const { path = '' } = req.query;

      const nasService = getNASService();
      const files = await nasService.listFiles(path);

      res.json({
        success: true,
        data: {
          path: path,
          files: files,
          total: files.length,
        },
      });

    } catch (error) {
      logger.error('파일 목록 조회 오류:', error.message);
      next(error);
    }
  },
);

// NAS 파일 정보 조회
router.get('/info',
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

      const nasService = getNASService();
      const fileInfo = await nasService.getFileInfo(path);

      res.json({
        success: true,
        data: fileInfo,
      });

    } catch (error) {
      logger.error('파일 정보 조회 오류:', error.message);
      next(error);
    }
  },
);

// NAS 연결 상태 조회
router.get('/status',
  async (req, res, next) => {
    try {
      const nasService = getNASService();
      const status = nasService.getConnectionStatus();

      res.json({
        success: true,
        data: status,
      });

    } catch (error) {
      logger.error('NAS 상태 조회 오류:', error.message);
      next(error);
    }
  },
);

// 파일 업로드
router.post('/upload',
  (req, res, next) => {
    logger.info('파일 업로드 시작 - multer 처리 전');
    upload.single('file')(req, res, (err) => {
      if (err) {
        logger.error('Multer 오류:', err.message);
        return res.status(400).json({
          success: false,
          error: {
            code: 'MULTER_ERROR',
            message: `파일 업로드 오류: ${err.message}`,
          },
        });
      }
      logger.info('Multer 처리 완료');
      next();
    });
  },
  async (req, res, next) => {
    try {
      const { path = '' } = req.body;
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

      // 파일 크기 검증 (추가 체크)
      const maxFileSize = parseInt(process.env.NAS_MAX_FILE_SIZE, 10) || 2147483648; // 2GB
      if (file.size > maxFileSize) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `파일 크기가 너무 큽니다. 최대 크기: ${Math.round(maxFileSize / (1024 * 1024))}MB`,
          },
        });
      }

      // 파일명 안전성 검증
      const dangerousChars = /[<>:"|?*\x00-\x1F]/g;
      if (dangerousChars.test(file.originalname)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILENAME',
            message: '파일명에 허용되지 않는 문자가 포함되어 있습니다.',
          },
        });
      }

      logger.info(`파일 업로드 요청: ${file.originalname}, 크기: ${file.size}, 업로드 경로: ${path}`);
      logger.info(`파일 업로드 사용자: ${req.user.username}`);

      // NAS 서비스를 통해 파일 업로드 (경로 검증은 NAS 서비스에서 처리)
      const nasService = getNASService();
      const uploadResult = await nasService.uploadFile(file.buffer, path, file.originalname);

      if (uploadResult.success) {
        logger.info(`파일 업로드 성공: ${file.originalname} -> ${uploadResult.path}`);

        res.json({
          success: true,
          message: '파일 업로드가 완료되었습니다.',
          data: {
            filename: uploadResult.filename,
            size: uploadResult.size,
            path: uploadResult.path,
            uploadPath: path,
          },
        });
      } else {
        throw new Error('파일 업로드에 실패했습니다.');
      }

    } catch (error) {
      logger.error('파일 업로드 오류:', error.message);

      res.status(500).json({
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: error.message || '파일 업로드에 실패했습니다.',
        },
      });
    }
  },
);

module.exports = router;
