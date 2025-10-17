const express = require('express');
const { getCacheService } = require('../services/cacheService');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

// 모든 캐시 라우트에 인증 적용
router.use(authenticateToken);

/**
 * @swagger
 * /api/cache/stats:
 *   get:
 *     tags:
 *       - Cache
 *     summary: 캐시 통계 조회
 *     description: 모든 캐시 인스턴스의 통계 정보 조회
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 캐시 통계 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     hits:
 *                       type: object
 *                       description: 캐시별 히트 횟수
 *                     misses:
 *                       type: object
 *                       description: 캐시별 미스 횟수
 *                     sets:
 *                       type: object
 *                       description: 캐시별 설정 횟수
 *                     deletes:
 *                       type: object
 *                       description: 캐시별 삭제 횟수
 *                     cacheInfo:
 *                       type: object
 *                       description: 캐시별 상세 정보
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.get('/stats', async (req, res) => {
  try {
    const cacheService = getCacheService();
    const stats = cacheService.getStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Failed to get cache stats:', error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'CACHE_STATS_ERROR',
        message: '캐시 통계 조회에 실패했습니다.',
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/cache/flush:
 *   post:
 *     tags:
 *       - Cache
 *     summary: 모든 캐시 삭제
 *     description: 모든 캐시 인스턴스의 데이터를 삭제합니다
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 캐시 삭제 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "모든 캐시가 삭제되었습니다"
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.post('/flush', async (req, res) => {
  try {
    const cacheService = getCacheService();
    cacheService.flushAll();
    
    logger.info(`🚀 [CACHE-API] All caches flushed by user: ${req.user?.username}`);
    
    res.json({
      success: true,
      message: '모든 캐시가 삭제되었습니다'
    });
  } catch (error) {
    logger.error('Failed to flush caches:', error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'CACHE_FLUSH_ERROR',
        message: '캐시 삭제에 실패했습니다.',
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/cache/flush/{cacheName}:
 *   post:
 *     tags:
 *       - Cache
 *     summary: 특정 캐시 삭제
 *     description: 지정된 캐시 인스턴스의 데이터를 삭제합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cacheName
 *         required: true
 *         schema:
 *           type: string
 *         description: 삭제할 캐시 이름 (nasFiles, nasScanResults, jenkinsBuilds, fileMetadata, dbQueries)
 *     responses:
 *       200:
 *         description: 캐시 삭제 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "nasFiles 캐시가 삭제되었습니다"
 *       400:
 *         description: 잘못된 캐시 이름
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.post('/flush/:cacheName', async (req, res) => {
  try {
    const { cacheName } = req.params;
    const cacheService = getCacheService();
    
    const validCaches = ['nasFiles', 'nasScanResults', 'jenkinsBuilds', 'fileMetadata', 'dbQueries'];
    if (!validCaches.includes(cacheName)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CACHE_NAME',
          message: `잘못된 캐시 이름입니다. 유효한 값: ${validCaches.join(', ')}`,
        }
      });
    }
    
    const success = cacheService.flushCache(cacheName);
    
    if (success) {
      logger.info(`🚀 [CACHE-API] Cache '${cacheName}' flushed by user: ${req.user?.username}`);
      res.json({
        success: true,
        message: `${cacheName} 캐시가 삭제되었습니다`
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          code: 'CACHE_FLUSH_FAILED',
          message: '캐시 삭제에 실패했습니다'
        }
      });
    }
  } catch (error) {
    logger.error(`Failed to flush cache ${req.params.cacheName}:`, error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'CACHE_FLUSH_ERROR',
        message: '캐시 삭제에 실패했습니다.',
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/cache/invalidate/version/{version}:
 *   post:
 *     tags:
 *       - Cache
 *     summary: 버전별 캐시 무효화
 *     description: 특정 버전과 관련된 모든 캐시 항목을 무효화합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: version
 *         required: true
 *         schema:
 *           type: string
 *         description: 무효화할 버전 (예: 4.0.0)
 *     responses:
 *       200:
 *         description: 캐시 무효화 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "버전 4.0.0 관련 캐시가 무효화되었습니다"
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.post('/invalidate/version/:version', async (req, res) => {
  try {
    const { version } = req.params;
    const cacheService = getCacheService();
    
    cacheService.invalidateVersion(version);
    
    logger.info(`🚀 [CACHE-API] Version '${version}' cache invalidated by user: ${req.user?.username}`);
    
    res.json({
      success: true,
      message: `버전 ${version} 관련 캐시가 무효화되었습니다`
    });
  } catch (error) {
    logger.error(`Failed to invalidate version cache ${req.params.version}:`, error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'CACHE_INVALIDATE_ERROR',
        message: '캐시 무효화에 실패했습니다.',
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/cache/invalidate/project/{projectName}:
 *   post:
 *     tags:
 *       - Cache
 *     summary: 프로젝트별 캐시 무효화
 *     description: 특정 프로젝트와 관련된 모든 캐시 항목을 무효화합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectName
 *         required: true
 *         schema:
 *           type: string
 *         description: 무효화할 프로젝트 이름
 *     responses:
 *       200:
 *         description: 캐시 무효화 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "프로젝트 mr4.0.0_release 관련 캐시가 무효화되었습니다"
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.post('/invalidate/project/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const cacheService = getCacheService();
    
    cacheService.invalidateProject(projectName);
    
    logger.info(`🚀 [CACHE-API] Project '${projectName}' cache invalidated by user: ${req.user?.username}`);
    
    res.json({
      success: true,
      message: `프로젝트 ${projectName} 관련 캐시가 무효화되었습니다`
    });
  } catch (error) {
    logger.error(`Failed to invalidate project cache ${req.params.projectName}:`, error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'CACHE_INVALIDATE_ERROR',
        message: '캐시 무효화에 실패했습니다.',
        details: error.message
      }
    });
  }
});

module.exports = router;