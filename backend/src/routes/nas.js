const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { query, param, validationResult } = require('express-validator');
const { getNASScanner } = require('../services/nasScanner');
const { AppError } = require('../middleware/error');
const logger = require('../config/logger');

const router = express.Router();

// 모든 NAS 라우트는 인증 필요
router.use(authenticateToken);

/**
 * @swagger
 * /api/nas/scan:
 *   post:
 *     tags:
 *       - NAS
 *     summary: NAS 전체 스캔 실행
 *     description: NAS 디렉토리를 전체 스캔하여 배포 파일 정보를 수집
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 스캔 성공
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
 *                   example: "NAS scan completed successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     stats:
 *                       type: object
 *                       properties:
 *                         lastScan:
 *                           type: string
 *                           format: date-time
 *                         totalFiles:
 *                           type: integer
 *                           description: 발견된 총 파일 수
 *                         processedFiles:
 *                           type: integer
 *                           description: 처리된 파일 수
 *                         errors:
 *                           type: integer
 *                           description: 오류 발생 수
 *                         duration:
 *                           type: integer
 *                           description: 스캔 소요 시간 (ms)
 *                     files:
 *                       type: array
 *                       description: 스캔된 파일 샘플 (최대 10개)
 *                       items:
 *                         type: object
 *                         properties:
 *                           file_path:
 *                             type: string
 *                             example: "harbor-frontend/build-42.tar.gz"
 *                           project_name:
 *                             type: string
 *                             example: "harbor-frontend"
 *                           file_size:
 *                             type: integer
 *                             example: 1024000
 *                           file_hash:
 *                             type: string
 *                             example: "sha256:abc123..."
 *                           build_number:
 *                             type: integer
 *                             example: 42
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: 스캔이 이미 진행 중
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/scan', async (req, res, next) => {
  try {
    const scanner = getNASScanner();
    const result = await scanner.performFullScan();

    res.json({
      success: true,
      message: 'NAS scan completed successfully',
      data: result
    });

  } catch (error) {
    logger.error('NAS scan failed:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/nas/status:
 *   get:
 *     tags:
 *       - NAS
 *     summary: NAS 스캔 상태 조회
 *     description: NAS 스캐너의 현재 상태, 설정, 통계 정보 조회
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 상태 조회 성공
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
 *                     isScanning:
 *                       type: boolean
 *                       description: 현재 스캔 중인지 여부
 *                     nasBasePath:
 *                       type: string
 *                       description: NAS 기본 경로
 *                       example: "/nas/deployments"
 *                     watchEnabled:
 *                       type: boolean
 *                       description: 실시간 파일 감시 활성화 여부
 *                     schedulerRunning:
 *                       type: boolean
 *                       description: 스케줄러 실행 여부
 *                     scanInterval:
 *                       type: string
 *                       description: 스캔 주기 (cron 표현식)
 *                       example: "*/15 * * * *"
 *                     stats:
 *                       type: object
 *                       description: 마지막 스캔 통계
 *                     config:
 *                       type: object
 *                       properties:
 *                         maxFileSize:
 *                           type: integer
 *                           description: 최대 파일 크기 (bytes)
 *                         allowedExtensions:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: 허용된 파일 확장자
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/status', (req, res) => {
  try {
    const scanner = getNASScanner();
    const status = scanner.getStatus();

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Failed to get NAS status:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/nas/scheduler/start:
 *   post:
 *     tags:
 *       - NAS
 *     summary: NAS 스캔 스케줄러 시작
 *     description: 주기적인 NAS 스캔을 위한 스케줄러 시작
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 스케줄러 시작 성공
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
 *                   example: "NAS scan scheduler started"
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/scheduler/start', async (req, res, next) => {
  try {
    const scanner = getNASScanner();
    const started = scanner.startScheduler();

    if (started) {
      res.json({
        success: true,
        message: 'NAS scan scheduler started'
      });
    } else {
      throw new AppError('Failed to start scheduler', 500);
    }

  } catch (error) {
    logger.error('Failed to start NAS scheduler:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/nas/scheduler/stop:
 *   post:
 *     tags:
 *       - NAS
 *     summary: NAS 스캔 스케줄러 중지
 *     description: 주기적인 NAS 스캔 스케줄러 중지
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 스케줄러 중지 성공
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
 *                   example: "NAS scan scheduler stopped"
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/scheduler/stop', (req, res) => {
  try {
    const scanner = getNASScanner();
    const stopped = scanner.stopScheduler();

    res.json({
      success: true,
      message: stopped ? 'NAS scan scheduler stopped' : 'Scheduler was not running'
    });

  } catch (error) {
    logger.error('Failed to stop NAS scheduler:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/nas/watcher/start:
 *   post:
 *     tags:
 *       - NAS
 *     summary: NAS 파일 감시 시작
 *     description: 실시간 파일 변경 감지를 위한 파일 감시 시작
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 파일 감시 시작 성공
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
 *                   example: "File watcher started"
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/watcher/start', (req, res) => {
  try {
    const scanner = getNASScanner();
    const started = scanner.startFileWatcher();

    res.json({
      success: true,
      message: started ? 'File watcher started' : 'File watching is disabled or already running'
    });

  } catch (error) {
    logger.error('Failed to start file watcher:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/nas/watcher/stop:
 *   post:
 *     tags:
 *       - NAS
 *     summary: NAS 파일 감시 중지
 *     description: 실시간 파일 변경 감지 중지
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 파일 감시 중지 성공
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
 *                   example: "File watcher stopped"
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/watcher/stop', (req, res) => {
  try {
    const scanner = getNASScanner();
    scanner.stopFileWatcher();

    res.json({
      success: true,
      message: 'File watcher stopped'
    });

  } catch (error) {
    logger.error('Failed to stop file watcher:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/nas/files:
 *   get:
 *     tags:
 *       - NAS
 *     summary: NAS 파일 목록 조회
 *     description: 스캔된 NAS 파일 목록을 필터링과 페이지네이션으로 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: 페이지 번호
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: 페이지당 항목 수
 *       - in: query
 *         name: project
 *         schema:
 *           type: string
 *         description: 프로젝트명 필터
 *       - in: query
 *         name: extension
 *         schema:
 *           type: string
 *         description: 파일 확장자 필터
 *     responses:
 *       200:
 *         description: 파일 목록 조회 성공
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
 *                     files:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           file_path:
 *                             type: string
 *                           project_name:
 *                             type: string
 *                           file_name:
 *                             type: string
 *                           file_size:
 *                             type: integer
 *                           file_hash:
 *                             type: string
 *                           build_number:
 *                             type: integer
 *                           scanned_at:
 *                             type: string
 *                             format: date-time
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         totalPages:
 *                           type: integer
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/files',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('project').optional().isString(),
    query('extension').optional().isString()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Invalid query parameters', 400, errors.array());
      }

      const { page = 1, limit = 20, project, extension } = req.query;
      const offset = (page - 1) * limit;

      // 개발환경에서는 mock 데이터 반환
      if (process.env.NODE_ENV === 'development') {
        const mockFiles = [
          {
            id: 1,
            file_path: 'harbor-frontend/build-1.tar.gz',
            project_name: 'harbor-frontend',
            file_name: 'build-1.tar.gz',
            file_size: 1024000,
            file_hash: 'sha256:abc123def456',
            build_number: 1,
            file_extension: '.tar.gz',
            scanned_at: new Date()
          },
          {
            id: 2,
            file_path: 'harbor-backend/build-2.tar.gz',
            project_name: 'harbor-backend',
            file_name: 'build-2.tar.gz',
            file_size: 2048000,
            file_hash: 'sha256:def456ghi789',
            build_number: 2,
            file_extension: '.tar.gz',
            scanned_at: new Date()
          }
        ];

        const filteredFiles = mockFiles.filter(file => {
          if (project && !file.project_name.includes(project)) return false;
          if (extension && file.file_extension !== extension) return false;
          return true;
        });

        return res.json({
          success: true,
          data: {
            files: filteredFiles.slice(offset, offset + limit),
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: filteredFiles.length,
              totalPages: Math.ceil(filteredFiles.length / limit)
            }
          }
        });
      }

      // 프로덕션 환경에서는 실제 데이터베이스 조회
      let whereClause = 'WHERE deleted_at IS NULL';
      const queryParams = [];
      let paramIndex = 1;

      if (project) {
        whereClause += ` AND project_name ILIKE $${paramIndex}`;
        queryParams.push(`%${project}%`);
        paramIndex++;
      }

      if (extension) {
        whereClause += ` AND file_extension = $${paramIndex}`;
        queryParams.push(extension);
        paramIndex++;
      }

      // 총 개수 조회
      const countQuery = `SELECT COUNT(*) as total FROM nas_files ${whereClause}`;
      const { query: dbQuery } = require('../config/database');
      const countResult = await dbQuery(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total);

      // 파일 목록 조회
      const filesQuery = `
        SELECT id, file_path, project_name, file_name, file_size, file_hash,
               build_number, file_extension, scanned_at, modified_at
        FROM nas_files
        ${whereClause}
        ORDER BY scanned_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      queryParams.push(limit, offset);
      const filesResult = await dbQuery(filesQuery, queryParams);

      res.json({
        success: true,
        data: {
          files: filesResult.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / limit)
          }
        }
      });

    } catch (error) {
      logger.error('Failed to get NAS files:', error.message);
      next(error);
    }
  }
);

module.exports = router;