const express = require('express');
const { authenticateToken } = require('../middleware/authSimple');
const { query, param, validationResult } = require('express-validator');
const { getNASService } = require('../services/nasService');
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
    await scanner.triggerScan();
    const result = scanner.getStatus();

    res.json({
      success: true,
      message: 'NAS scan completed successfully',
      data: result,
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
 *                       example: "every 15 minutes"
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
router.get('/status', (req, res, next) => {
  try {
    const scanner = getNASScanner();
    const status = scanner.getStatus();

    res.json({
      success: true,
      data: status,
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
    await scanner.start();
    const started = true;

    if (started) {
      res.json({
        success: true,
        message: 'NAS scan scheduler started',
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
router.post('/scheduler/stop', async (req, res, next) => {
  try {
    const scanner = getNASScanner();
    await scanner.stop();

    res.json({
      success: true,
      message: 'NAS scan scheduler stopped',
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
router.post('/watcher/start', async (req, res, next) => {
  try {
    const scanner = getNASScanner();
    await scanner.start();

    res.json({
      success: true,
      message: 'Polling started (simplified file monitoring)',
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
router.post('/watcher/stop', async (req, res, next) => {
  try {
    const scanner = getNASScanner();
    await scanner.stop();

    res.json({
      success: true,
      message: 'Polling stopped (simplified file monitoring)',
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
    query('extension').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Invalid query parameters', 400, errors.array());
      }

      const { page = 1, limit = 20, project, extension } = req.query;
      const offset = (page - 1) * limit;

      // 실제 데이터베이스 조회
      let whereClause = 'WHERE is_active = true';
      const queryParams = [];
      let paramIndex = 1;

      if (project) {
        whereClause += ` AND project_name ILIKE $${paramIndex}`;
        queryParams.push(`%${project}%`);
        paramIndex++;
      }

      if (extension) {
        // file_extension 컬럼이 없으므로 file_name으로 확장자 필터링
        whereClause += ` AND file_name LIKE $${paramIndex}`;
        queryParams.push(`%${extension}`);
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
               build_number, scan_date
        FROM nas_files
        ${whereClause}
        ORDER BY scan_date DESC
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
            totalPages: Math.ceil(total / limit),
          },
        },
      });

    } catch (error) {
      logger.error('Failed to get NAS files:', error.message);
      next(error);
    }
  },
);

/**
 * @swagger
 * /api/nas/connect:
 *   post:
 *     tags:
 *       - NAS
 *     summary: NAS 서버 연결 테스트
 *     description: nas.roboetech.com 서버에 실제 연결을 테스트합니다
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 연결 성공
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
 *                   example: "NAS connection successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: object
 *                       description: 연결 상태 정보
 *       503:
 *         description: 연결 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/connect', async (req, res, next) => {
  try {
    const nasService = getNASService();
    await nasService.connect();
    const status = nasService.getConnectionStatus();

    res.json({
      success: true,
      message: 'NAS connection successful',
      data: { status },
    });

  } catch (error) {
    logger.error('NAS connection test failed:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/nas/explore:
 *   get:
 *     tags:
 *       - NAS
 *     summary: release_version 디렉토리 구조 탐색
 *     description: NAS의 release_version 디렉토리 하위 구조를 탐색하고 release 폴더를 찾습니다
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 탐색 성공
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
 *                     basePath:
 *                       type: string
 *                       example: "release_version"
 *                     projects:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           path:
 *                             type: string
 *                           totalItems:
 *                             type: integer
 *                           releaseFolder:
 *                             type: object
 *                             nullable: true
 *       404:
 *         description: release_version 디렉토리를 찾을 수 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: NAS 연결 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/explore', async (req, res, next) => {
  try {
    const nasService = getNASService();
    const structure = await nasService.exploreReleaseStructure();

    res.json({
      success: true,
      data: structure,
    });

  } catch (error) {
    logger.error('NAS structure exploration failed:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/nas/search:
 *   get:
 *     tags:
 *       - NAS
 *     summary: NAS 파일 검색
 *     description: 지정된 경로에서 파일을 검색합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: path
 *         schema:
 *           type: string
 *           default: "release_version"
 *         description: 검색할 디렉토리 경로
 *       - in: query
 *         name: pattern
 *         schema:
 *           type: string
 *         description: 검색 패턴 (파일명에 포함될 문자열)
 *     responses:
 *       200:
 *         description: 검색 성공
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
 *                     searchPath:
 *                       type: string
 *                     pattern:
 *                       type: string
 *                     files:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           path:
 *                             type: string
 *                           size:
 *                             type: integer
 *                           modified:
 *                             type: string
 *                             format: date-time
 *                           buildNumber:
 *                             type: string
 *                             nullable: true
 */
router.get('/search',
  [
    query('path').optional().isString(),
    query('pattern').optional().isString(),
    query('developer').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Invalid query parameters', 400, errors.array());
      }

      const { path: searchPath = 'release_version', pattern, developer } = req.query;
      
      logger.info('🔍 NAS 검색 요청:', {
        searchPath,
        pattern: pattern || 'no pattern',
        developer: developer || 'no developer filter',
        user: req.user?.username || 'unknown'
      });

      const nasService = getNASService();
      const files = await nasService.searchFiles(searchPath, pattern);
      
      logger.info('🔍 검색 결과 (필터링 전):', {
        totalFiles: files.length,
        searchPath,
        pattern: pattern || 'no pattern'
      });

      // 개발자별 필터링 (만약 developer 파라미터가 있다면)
      let filteredFiles = files;
      if (developer && developer !== 'all') {
        const originalCount = filteredFiles.length;
        filteredFiles = files.filter(file => {
          const pathMatch = file.path && file.path.toLowerCase().includes(developer.toLowerCase());
          const nameMatch = file.name && file.name.toLowerCase().includes(developer.toLowerCase());
          return pathMatch || nameMatch;
        });
        
        logger.info('🔍 개발자별 필터링 결과:', {
          developer,
          originalCount,
          filteredCount: filteredFiles.length,
          difference: originalCount - filteredFiles.length
        });
      }

      logger.info('🔍 최종 검색 결과:', {
        totalFiles: filteredFiles.length,
        sampleFiles: filteredFiles.slice(0, 3).map(f => ({
          name: f.name,
          path: f.path?.substring(0, 50) + '...',
          isdir: f.isdir
        }))
      });

      res.json({
        success: true,
        data: {
          searchPath,
          pattern: pattern || null,
          developer: developer || null,
          files: filteredFiles,
        },
      });

    } catch (error) {
      logger.error('NAS file search failed:', error.message);
      next(error);
    }
  },
);

/**
 * @swagger
 * /api/nas/directory:
 *   get:
 *     tags:
 *       - NAS
 *     summary: 디렉토리 목록 조회
 *     description: 지정된 NAS 디렉토리의 내용을 조회합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: path
 *         schema:
 *           type: string
 *           default: ""
 *         description: 조회할 디렉토리 경로 (빈 문자열은 루트)
 *     responses:
 *       200:
 *         description: 조회 성공
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
 *                     path:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.get('/directory',
  [
    query('path').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Invalid query parameters', 400, errors.array());
      }

      const { path: dirPath = '' } = req.query;

      const nasService = getNASService();
      const items = await nasService.listDirectory(dirPath);

      res.json({
        success: true,
        data: {
          path: dirPath,
          items,
        },
      });

    } catch (error) {
      logger.error('NAS directory listing failed:', error.message);
      next(error);
    }
  },
);

/**
 * @swagger
 * /api/nas/artifacts/build-log:
 *   get:
 *     tags:
 *       - NAS
 *     summary: 빌드 로그 기반 아티팩트 검색
 *     description: 젠킨스 빌드 로그에서 추출한 아티팩트 정보를 실제 NAS 서버에서 검색하여 검증
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: jobName
 *         schema:
 *           type: string
 *         required: true
 *         description: 젠킨스 작업명 (예- 1.2.0/mr1.2.0_release)
 *       - in: query
 *         name: buildNumber
 *         schema:
 *           type: integer
 *         required: true
 *         description: 빌드 번호
 *     responses:
 *       200:
 *         description: 아티팩트 검색 성공
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
 *                     jobName:
 *                       type: string
 *                     buildNumber:
 *                       type: integer
 *                     extractedCount:
 *                       type: integer
 *                       description: 빌드 로그에서 추출된 아티팩트 수
 *                     verifiedCount:
 *                       type: integer
 *                       description: NAS에서 실제 발견된 아티팩트 수
 *                     artifacts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           filename:
 *                             type: string
 *                           verified:
 *                             type: boolean
 *                           nasPath:
 *                             type: string
 *                             nullable: true
 *                           fileSize:
 *                             type: integer
 *                             nullable: true
 *                           lastModified:
 *                             type: string
 *                             format: date-time
 *                             nullable: true
 *                           context:
 *                             type: string
 *                             description: 빌드 로그에서 발견된 컨텍스트
 *                           searchError:
 *                             type: string
 *                             nullable: true
 *       400:
 *         description: 잘못된 요청 파라미터
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: 인증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/artifacts/build-log',
  [
    query('jobName').notEmpty().isString().withMessage('Job name is required'),
    query('buildNumber').notEmpty().isInt({ min: 1 }).withMessage('Build number must be a positive integer'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Invalid query parameters', 400, errors.array());
      }

      const { jobName, buildNumber } = req.query;
      const nasService = getNASService();

      logger.info(`Searching artifacts from build log for ${jobName}#${buildNumber}`);
      const artifacts = await nasService.searchArtifactsFromBuildLog(jobName, parseInt(buildNumber));

      const verifiedCount = artifacts.filter(a => a.verified).length;

      res.json({
        success: true,
        data: {
          jobName,
          buildNumber: parseInt(buildNumber),
          extractedCount: artifacts.length,
          verifiedCount,
          artifacts,
        },
      });

    } catch (error) {
      logger.error('Build log artifact search failed:', error.message);
      next(error);
    }
  },
);

/**
 * @swagger
 * /api/nas/artifacts/version:
 *   get:
 *     tags:
 *       - NAS
 *     summary: 버전별 아티팩트 검색
 *     description: 지정된 버전의 모든 압축 파일 아티팩트를 NAS 서버에서 검색
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: version
 *         schema:
 *           type: string
 *         required: true
 *         description: 검색할 버전 (예- 1.2.0)
 *       - in: query
 *         name: pattern
 *         schema:
 *           type: string
 *         description: 추가 검색 패턴 (파일명에 포함될 문자열)
 *     responses:
 *       200:
 *         description: 아티팩트 검색 성공
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
 *                     version:
 *                       type: string
 *                     pattern:
 *                       type: string
 *                       nullable: true
 *                     totalCount:
 *                       type: integer
 *                     artifacts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           filename:
 *                             type: string
 *                           nasPath:
 *                             type: string
 *                           fileSize:
 *                             type: integer
 *                           lastModified:
 *                             type: string
 *                             format: date-time
 *                           version:
 *                             type: string
 *                           searchPath:
 *                             type: string
 *                           verified:
 *                             type: boolean
 *       400:
 *         description: 잘못된 요청 파라미터
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/artifacts/version',
  [
    query('version').notEmpty().isString().withMessage('Version is required'),
    query('pattern').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Invalid query parameters', 400, errors.array());
      }

      const { version, pattern } = req.query;
      const nasService = getNASService();

      logger.info(`Searching artifacts by version ${version} with pattern: ${pattern || 'none'}`);
      const artifacts = await nasService.searchArtifactsByVersion(version, pattern);

      res.json({
        success: true,
        data: {
          version,
          pattern: pattern || null,
          totalCount: artifacts.length,
          artifacts,
        },
      });

    } catch (error) {
      logger.error('Version-based artifact search failed:', error.message);
      next(error);
    }
  },
);

/**
 * @swagger
 * /api/nas/disconnect:
 *   post:
 *     tags:
 *       - NAS
 *     summary: NAS 연결 해제
 *     description: 현재 NAS 연결을 해제합니다
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 연결 해제 성공
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
 *                   example: "NAS disconnected successfully"
 */
router.post('/disconnect', async (req, res, next) => {
  try {
    const nasService = getNASService();
    await nasService.disconnect();

    res.json({
      success: true,
      message: 'NAS disconnected successfully',
    });

  } catch (error) {
    logger.error('NAS disconnection failed:', error.message);
    next(error);
  }
});

module.exports = router;
