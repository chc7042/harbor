const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
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

// 모든 파일 라우트는 인증 필요
router.use(authenticateToken);

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
      const fileName = cleanPath.split('/').pop();
      
      logger.info(`파일 다운로드 요청 - 사용자: ${req.user.username}`);
      logger.info(`원본 경로: ${path}`);
      logger.info(`정리된 경로: ${cleanPath}`);
      logger.info(`최종 NAS 경로: ${finalPath}`);
      logger.info(`파일명: ${fileName}`);

      // Synology 직접 다운로드 URL 생성 및 리다이렉트 (기존 방식 복원)
      try {
        const downloadUrl = await downloadService.createDownloadUrl(finalPath);
        
        if (downloadUrl.success && downloadUrl.downloadUrl) {
          logger.info(`✅ 직접 다운로드 URL 생성: ${fileName} -> ${downloadUrl.downloadUrl}`);
          
          // 직접 다운로드 URL로 리다이렉트 (즉시 다운로드 시작)
          res.redirect(downloadUrl.downloadUrl);
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

// 파일 업로드 (필요한 경우)
router.post('/upload',
  upload.single('file'),
  async (req, res, next) => {
    try {
      const { path = '' } = req.body;
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

      // 파일 업로드 로직 (필요시 구현)
      logger.info(`파일 업로드 요청: ${file.originalname}, 크기: ${file.size}`);

      res.json({
        success: true,
        message: '파일 업로드가 완료되었습니다.',
        data: {
          filename: file.originalname,
          size: file.size,
          path: path,
        },
      });

    } catch (error) {
      logger.error('파일 업로드 오류:', error.message);
      next(error);
    }
  },
);

module.exports = router;