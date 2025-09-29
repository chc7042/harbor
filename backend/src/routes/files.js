const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { getNASService } = require('../services/nasService');
const logger = require('../config/logger');

const router = express.Router();

// 모든 파일 라우트는 인증 필요
router.use(authenticateToken);

// NAS 파일 다운로드
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

      logger.info(`파일 다운로드 요청 - 사용자: ${req.user.username}, 원본 경로: ${path}, 변환된 경로: ${relativePath}`);

      const nasService = getNASService();

      try {
        // NAS에서 파일 다운로드
        const fileBuffer = await nasService.downloadFile(relativePath);

        // 파일명 추출
        const fileName = relativePath.split('/').pop();

        // 파일 확장자에 따른 MIME 타입 설정
        let mimeType = 'application/octet-stream';
        if (fileName.endsWith('.tar.gz')) {
          mimeType = 'application/gzip';
        } else if (fileName.endsWith('.zip')) {
          mimeType = 'application/zip';
        } else if (fileName.endsWith('.json')) {
          mimeType = 'application/json';
        }

        // 파일 다운로드 응답
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', fileBuffer.length);

        res.send(fileBuffer);

        logger.info(`파일 다운로드 완료 - 사용자: ${req.user.username}, 파일: ${fileName}, 크기: ${fileBuffer.length} bytes`);

      } catch (nasError) {
        logger.error(`NAS 파일 다운로드 실패 - 경로: ${relativePath}, 오류: ${nasError.message}`);

        return res.status(404).json({
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: '파일을 찾을 수 없습니다.',
          },
        });
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

module.exports = router;
