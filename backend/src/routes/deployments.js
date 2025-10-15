const express = require('express');
const { authenticateToken } = require('../middleware/authSimple');
const { body, query, param, validationResult } = require('express-validator');
const { AppError } = require('../middleware/error');
const logger = require('../config/logger');
const { getJenkinsService } = require('../services/jenkinsService');
const { getNASService } = require('../services/nasService');
const { getDeploymentPathService } = require('../services/deploymentPathService');

const router = express.Router();


// 모든 배포 라우트는 인증 필요
router.use(authenticateToken);

/**
 * @swagger
 * /api/deployments:
 *   get:
 *     tags:
 *       - Deployments
 *     summary: 배포 이력 목록 조회
 *     description: 필터링 및 페이지네이션을 지원하는 배포 이력 목록 조회
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
 *         name: environment
 *         schema:
 *           type: string
 *           enum: [development, staging, production]
 *         description: 환경 필터
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_progress, success, failed, cancelled]
 *         description: 상태 필터
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: 검색어 (프로젝트명, 브랜치, 커밋 해시)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 시작 날짜 필터
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 종료 날짜 필터
 *     responses:
 *       200:
 *         description: 배포 목록 조회 성공
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
 *                     deployments:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Deployment'
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
router.get('/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('페이지는 1 이상의 숫자여야 합니다'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('한 페이지당 항목 수는 1-100 사이여야 합니다'),
    query('project').optional().isString().withMessage('프로젝트명은 문자열이어야 합니다'),
    query('environment').optional().isIn(['development', 'staging', 'production']).withMessage('유효하지 않은 환경입니다'),
    query('status').optional().isIn(['pending', 'in_progress', 'success', 'failed', 'cancelled']).withMessage('유효하지 않은 상태입니다'),
    query('search').optional().isString().withMessage('검색어는 문자열이어야 합니다'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('유효하지 않은 요청 파라미터입니다.', 400, errors.array());
      }

      const {
        page = 1,
        limit = 20,
        project,
        environment,
        status,
        search,
        startDate,
        endDate,
      } = req.query;

      const jenkinsService = getJenkinsService();

      try {
        // Jenkins에서 모든 작업 목록 조회
        const jobs = await jenkinsService.getJobs();

        // Jenkins job 구조 분석 및 그룹핑
        const groupedJobs = groupJobsByVersion(jobs);
        logger.info(`Grouped ${jobs.length} jobs into ${Object.keys(groupedJobs).length} version groups`);

        // 각 버전 그룹의 빌드 이력 조회
        let allBuilds = [];

        for (const [version, jobGroup] of Object.entries(groupedJobs)) {
          try {
            // 프로젝트 필터링
            if (project && !version.toLowerCase().includes(project.toLowerCase())) {
              continue;
            }

            // 버전 그룹의 배포 상태 결정
            const versionDeployment = await processVersionGroup(jenkinsService, version, jobGroup);
            if (versionDeployment) {
              allBuilds.push(versionDeployment);
            }
          } catch (error) {
            logger.warn(`Failed to process version group ${version}:`, error.message);

            // 에러가 발생한 경우에도 버전 정보는 표시
            const versionEntry = {
              id: `${version}-error`,
              projectName: version,
              buildNumber: null,
              status: 'error',
              timestamp: new Date(),
              duration: null,
              displayName: `${version} (오류)`,
              url: null,
              parameters: {},
              changes: [],
              environment: 'unknown',
              version: version,
              subJobs: [],
            };

            if (!search || version.toLowerCase().includes(search.toLowerCase())) {
              allBuilds.push(versionEntry);
            }
          }
        }

        // 개별 작업들도 처리 (버전 그룹에 속하지 않는 경우)
        for (const job of jobs) {
          try {
            // 이미 버전 그룹에서 처리된 job은 건너뛰기
            const isPartOfVersionGroup = Object.values(groupedJobs).some(group =>
              group.mrJob?.name === job.name || group.fsJob?.name === job.name,
            );
            if (isPartOfVersionGroup) continue;

            // 프로젝트 필터링
            if (project && !job.name.toLowerCase().includes(project.toLowerCase())) {
              continue;
            }

            const builds = await jenkinsService.getJobBuilds(job.name, 50);

            if (builds.length === 0) {
              // 빌드가 없는 경우 프로젝트 정보만으로 기본 엔트리 생성 (updated)
              const projectEntry = {
                id: `${job.name}-placeholder`,
                projectName: job.name,
                buildNumber: null,
                status: 'no_builds',
                timestamp: new Date(),
                duration: null,
                displayName: `${job.name} (빌드 없음)`,
                url: job.url,
                parameters: {},
                changes: [],
                environment: 'unknown',
                version: job.name, // 프로젝트 이름을 버전으로 사용
                subJobs: [],
              };

              // 검색 필터 적용
              if (search) {
                const searchLower = search.toLowerCase();
                if (!job.name.toLowerCase().includes(searchLower)) {
                  continue;
                }
              }

              allBuilds.push(projectEntry);
              continue;
            }

            // 필터링 적용
            const filteredBuilds = builds.filter(build => {
              // 환경 필터
              if (environment) {
                const buildEnv = determineEnvironment(build.projectName, build.parameters);
                if (buildEnv !== environment) return false;
              }

              // 상태 필터
              if (status && build.status !== status) return false;

              // 검색 필터
              if (search) {
                const searchLower = search.toLowerCase();
                if (!build.projectName.toLowerCase().includes(searchLower) &&
                    !build.changes.some(change => change.message.toLowerCase().includes(searchLower))) {
                  return false;
                }
              }

              // 날짜 필터
              if (startDate && new Date(build.timestamp) < new Date(startDate)) return false;
              if (endDate && new Date(build.timestamp) > new Date(endDate)) return false;

              return true;
            });

            allBuilds = allBuilds.concat(filteredBuilds);
          } catch (error) {
            logger.warn(`Failed to fetch builds for job ${job.name}:`, error.message);

            // 에러가 발생한 경우에도 프로젝트 정보는 표시
            const projectEntry = {
              id: `${job.name}-error`,
              projectName: job.name,
              buildNumber: null,
              status: 'error',
              timestamp: new Date(),
              duration: null,
              displayName: `${job.name} (오류)`,
              url: job.url,
              parameters: {},
              changes: [],
              environment: 'unknown',
              version: job.name,
              subJobs: [],
            };

            if (!search || job.name.toLowerCase().includes(search.toLowerCase())) {
              allBuilds.push(projectEntry);
            }
          }
        }

        // 시간순 정렬
        allBuilds.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // 페이지네이션 적용
        const totalItems = allBuilds.length;
        const totalPages = Math.ceil(totalItems / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + parseInt(limit);
        const paginatedBuilds = allBuilds.slice(startIndex, endIndex);

        // 아티팩트 정보를 지연 로딩으로 변경 - N+1 쿼리 문제 해결
        const deployments = paginatedBuilds.map((build) => {
          return {
            id: build.id,
            projectName: build.projectName,
            environment: determineEnvironment(build.projectName, build.parameters),
            version: build.parameters?.VERSION || build.parameters?.TAG || build.version || `build-${build.buildNumber}`,
            status: build.status,
            deployedBy: build.changes?.length > 0 ? build.changes[0].author : 'Jenkins',
            deployedAt: build.timestamp,
            duration: build.duration,
            buildNumber: build.buildNumber,
            jenkinsUrl: build.url,
            branch: build.parameters?.BRANCH_NAME || build.parameters?.GIT_BRANCH ||
                   (build.projectName && build.projectName.includes('_release') ?
                    build.projectName.split('/').pop().replace(/_(release|build)$/, '') : 'main'),
            commitHash: build.changes?.length > 0 ? build.changes[0].commitId : null,
            commitMessage: build.changes?.length > 0 ? build.changes[0].message : null,
            subJobs: build.subJobs || [],
            // 아티팩트 정보는 지연 로딩으로 처리 - 별도 API 엔드포인트에서 제공
            artifacts: [], // 기본값으로 빈 배열
            hasArtifacts: (build.status === 'success' || build.status === 'SUCCESS'), // 아티팩트 존재 여부만 표시
          };
        });

        logger.info(`배포 목록 조회 - 사용자: ${req.user.username}, 페이지: ${page}, Jenkins 데이터: ${deployments.length}개`);

        res.json({
          success: true,
          data: deployments,
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalItems,
            itemsPerPage: parseInt(limit),
            hasNext: page < totalPages,
            hasPrevious: page > 1,
          },
        });

      } catch (jenkinsError) {
        logger.error('Jenkins API 호출 실패, mock 데이터 사용:', jenkinsError.message);

        // Jenkins 연결 실패 시 mock 데이터 반환
        const mockDeployments = {
          data: [
            {
              id: 1,
              projectName: 'jenkins-connection-failed',
              environment: 'development',
              version: 'mock-v1.0.0',
              status: 'failed',
              deployedBy: 'Mock User',
              deployedAt: new Date().toISOString(),
              duration: 180,
              buildNumber: 999,
              branch: 'main',
              error: 'Jenkins API 연결 실패',
            },
          ],
          pagination: {
            currentPage: parseInt(page),
            totalPages: 1,
            totalItems: 1,
            itemsPerPage: parseInt(limit),
            hasNext: false,
            hasPrevious: false,
          },
        };

        res.json({
          success: true,
          data: mockDeployments.data,
          pagination: mockDeployments.pagination,
          warning: 'Jenkins 서버에 연결할 수 없어 mock 데이터를 표시합니다.',
        });
      }
    } catch (error) {
      next(error);
    }
  },
);

// 최근 배포 목록 조회
router.get('/recent',
  [
    query('hours').optional().custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const numValue = parseInt(value);
      if (isNaN(numValue) || numValue < 1) {
        throw new Error('시간은 양수여야 합니다');
      }
      return true;
    }),
    query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('한 페이지당 항목 수는 1-1000 사이여야 합니다'),
    query('page').optional().isInt({ min: 1 }).withMessage('페이지 번호는 1 이상이어야 합니다'),
    query('sort').optional().isString(),
    query('order').optional().isIn(['asc', 'desc']).withMessage('정렬 순서는 asc 또는 desc여야 합니다'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('유효하지 않은 요청 파라미터입니다.', 400, errors.array());
      }

      const {
        hours,
        limit = 5,
        page = 1,
        sort = 'created_at',
        order = 'desc',
        ...otherParams
      } = req.query;

      const jenkinsService = getJenkinsService();

      try {
        // hours가 null, undefined이거나 빈 문자열인 경우 무제한으로 설정
        const timeLimit = (hours === null || hours === undefined || hours === 'null' || hours === '') ? null : parseInt(hours);
        // 페이지네이션을 위해 더 많은 데이터를 가져온 후 프론트엔드에서 페이징 처리
        const fetchLimit = timeLimit === null ? 10000 : Math.max(parseInt(limit) * parseInt(page), 100);

        // Jenkins에서 최근 빌드 조회
        const recentBuilds = await jenkinsService.getRecentBuilds(timeLimit, fetchLimit);

        const recentDeployments = recentBuilds.map(build => ({
          id: build.id,
          projectName: build.projectName,
          environment: determineEnvironment(build.projectName, build.parameters),
          version: build.parameters?.VERSION || build.parameters?.TAG || `build-${build.buildNumber}`,
          status: build.status,
          deployedBy: build.changes && build.changes.length > 0 ? build.changes[0].author : 'Jenkins',
          deployedAt: build.timestamp,
          duration: build.duration,
          buildNumber: build.buildNumber,
          jenkinsUrl: build.url,
          branch: build.parameters?.BRANCH_NAME || build.parameters?.GIT_BRANCH ||
                 (build.projectName && build.projectName.includes('_release') ?
                  build.projectName.split('/').pop().replace(/_(release|build)$/, '') : 'main'),
          commitHash: build.changes && build.changes.length > 0 ? build.changes[0].commitId : null,
          commitMessage: build.changes && build.changes.length > 0 ? build.changes[0].message : null,
        }));

        // 페이지네이션 처리
        const totalItems = recentDeployments.length;
        const totalPages = Math.ceil(totalItems / parseInt(limit));
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        const paginatedDeployments = recentDeployments.slice(startIndex, endIndex);

        logger.info(`최근 배포 목록 조회 - 사용자: ${req.user?.username || 'unknown'}, 시간: ${timeLimit || '무제한'}h, 페이지: ${page}/${totalPages}, Jenkins 데이터: ${paginatedDeployments.length}/${totalItems}개`);

        res.json({
          success: true,
          data: paginatedDeployments,
          pagination: {
            currentPage: parseInt(page),
            totalPages: totalPages,
            totalItems: totalItems,
            itemsPerPage: parseInt(limit),
            hasNext: parseInt(page) < totalPages,
            hasPrevious: parseInt(page) > 1,
          },
        });

      } catch (jenkinsError) {
        logger.error('Jenkins API 호출 실패, mock 데이터 사용:', jenkinsError.message);

        // Jenkins 연결 실패 시 mock 데이터 반환
        const mockRecentDeployments = [
          {
            id: 1,
            projectName: 'jenkins-connection-failed',
            environment: 'development',
            version: 'mock-v1.0.0',
            status: 'failed',
            deployedBy: 'Mock User',
            deployedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
            duration: 180,
            buildNumber: 999,
            branch: 'main',
            error: 'Jenkins API 연결 실패',
          },
        ];

        // Mock 데이터에도 페이지네이션 적용
        const totalItems = mockRecentDeployments.length;
        const totalPages = Math.ceil(totalItems / parseInt(limit));
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        const paginatedMockDeployments = mockRecentDeployments.slice(startIndex, endIndex);

        res.json({
          success: true,
          data: paginatedMockDeployments,
          pagination: {
            currentPage: parseInt(page),
            totalPages: totalPages,
            totalItems: totalItems,
            itemsPerPage: parseInt(limit),
            hasNext: parseInt(page) < totalPages,
            hasPrevious: parseInt(page) > 1,
          },
          warning: 'Jenkins 서버에 연결할 수 없어 mock 데이터를 표시합니다.',
        });
      }
    } catch (error) {
      next(error);
    }
  },
);

// 특정 배포 상세 조회
router.get('/:id',
  [
    param('id').isInt({ min: 1 }).withMessage('배포 ID는 양의 정수여야 합니다'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('유효하지 않은 배포 ID입니다.', 400, errors.array());
      }

      const { id } = req.params;

      // TODO: 실제 배포 상세 조회 로직 구현
      // const deployment = await deploymentService.getDeploymentById(id);

      // 임시 데이터
      const mockDeployment = {
        id: parseInt(id),
        projectName: 'jenkins-nas-deployment-history',
        environment: 'production',
        version: 'v1.0.0',
        status: 'success',
        deployedBy: '홍길동',
        deployedAt: new Date().toISOString(),
        duration: 180,
        buildNumber: 42,
        commitHash: 'abc123def456',
        commitMessage: 'feat: Add deployment history feature',
        jenkinsUrl: 'http://jenkins.internal:8080/job/deploy-nas/42/',
        logs: [
          { timestamp: new Date().toISOString(), level: 'INFO', message: '배포 시작' },
          { timestamp: new Date().toISOString(), level: 'INFO', message: 'Docker 이미지 빌드 중...' },
          { timestamp: new Date().toISOString(), level: 'SUCCESS', message: '배포 완료' },
        ],
      };

      logger.info(`배포 상세 조회 - 사용자: ${req.user.username}, 배포 ID: ${id}`);

      res.json({
        success: true,
        data: mockDeployment,
      });
    } catch (error) {
      next(error);
    }
  },
);

// 배포 재시작
router.post('/:id/restart',
  [
    param('id').isInt({ min: 1 }).withMessage('배포 ID는 양의 정수여야 합니다'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('유효하지 않은 배포 ID입니다.', 400, errors.array());
      }

      const { id } = req.params;

      // TODO: 실제 배포 재시작 로직 구현
      // const result = await deploymentService.restartDeployment(id, req.user.id);

      logger.info(`배포 재시작 요청 - 사용자: ${req.user.username}, 배포 ID: ${id}`);

      res.json({
        success: true,
        message: '배포 재시작이 요청되었습니다.',
        data: {
          deploymentId: parseInt(id),
          status: 'pending',
          requestedBy: req.user.username,
          requestedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// 배포 취소
router.post('/:id/cancel',
  [
    param('id').isInt({ min: 1 }).withMessage('배포 ID는 양의 정수여야 합니다'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('유효하지 않은 배포 ID입니다.', 400, errors.array());
      }

      const { id } = req.params;

      // TODO: 실제 배포 취소 로직 구현
      // const result = await deploymentService.cancelDeployment(id, req.user.id);

      logger.info(`배포 취소 요청 - 사용자: ${req.user.username}, 배포 ID: ${id}`);

      res.json({
        success: true,
        message: '배포가 취소되었습니다.',
        data: {
          deploymentId: parseInt(id),
          status: 'cancelled',
          cancelledBy: req.user.username,
          cancelledAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Jenkins 배포 로그 조회
router.get('/logs/*',
  async (req, res, next) => {
    try {
      // URL path에서 projectName과 buildNumber 추출
      const pathParts = req.params[0].split('/');
      const buildNumber = pathParts.pop(); // 마지막 부분이 buildNumber
      const projectName = pathParts.join('/'); // 나머지가 projectName

      // 기본 유효성 검사
      if (!projectName || !buildNumber || isNaN(parseInt(buildNumber))) {
        throw new AppError('유효하지 않은 요청 파라미터입니다. 올바른 형식: /logs/{projectName}/{buildNumber}', 400);
      }

      // TEMP: TEST 용도로 인증 우회

      const jenkinsService = getJenkinsService();

      try {
        // Jenkins에서 빌드 로그 조회
        const logs = await jenkinsService.getBuildLog(projectName, buildNumber);

        logger.info(`Jenkins 빌드 로그 조회 - 사용자: ${req.user.username}, 프로젝트: ${projectName}, 빌드: ${buildNumber}`);

        res.json({
          success: true,
          data: logs,
        });

      } catch (jenkinsError) {
        logger.error('Jenkins 빌드 로그 조회 실패, mock 데이터 사용:', jenkinsError.message);

        // Jenkins 연결 실패 시 mock 데이터 반환
        const mockLogs = [
          { timestamp: '2025-09-29 12:30:01', level: 'INFO', message: `[${projectName}#${buildNumber}] 🚀 Starting Jenkins deployment process...` },
          { timestamp: '2025-09-29 12:30:03', level: 'INFO', message: `[${projectName}#${buildNumber}] 📥 Fetching code from Git repository` },
          { timestamp: '2025-09-29 12:30:05', level: 'INFO', message: `[${projectName}#${buildNumber}] 🔍 Checking out mr3.0.0 release branch` },
          { timestamp: '2025-09-29 12:30:12', level: 'INFO', message: `[${projectName}#${buildNumber}] 🔨 Building mr3.0.0 release package` },
          { timestamp: '2025-09-29 12:30:25', level: 'INFO', message: `[${projectName}#${buildNumber}] 🧪 Running unit tests for mr3.0.0` },
          { timestamp: '2025-09-29 12:30:38', level: 'INFO', message: `[${projectName}#${buildNumber}] ✅ All tests passed for mr3.0.0` },
          { timestamp: '2025-09-29 12:30:42', level: 'INFO', message: `[${projectName}#${buildNumber}] 📦 Creating mr3.0.0 release artifacts` },
          { timestamp: '2025-09-29 12:30:48', level: 'INFO', message: `[${projectName}#${buildNumber}] 🚀 Deploying mr3.0.0 to production environment` },
          { timestamp: '2025-09-29 12:30:55', level: 'SUCCESS', message: `[${projectName}#${buildNumber}] 🎉 mr3.0.0 deployment completed successfully!` },
          { timestamp: '2025-09-29 12:30:56', level: 'INFO', message: '⚠️  NOTE: This is MOCK DATA - Jenkins server is not reachable' },
        ];

        res.json({
          success: true,
          data: mockLogs,
          warning: 'Jenkins 서버에 연결할 수 없어 mock 데이터를 표시합니다.',
        });
      }
    } catch (error) {
      next(error);
    }
  },
);

// 배포 통계 조회
router.get('/stats/summary',
  async (req, res, next) => {
    try {
      // TODO: 실제 배포 통계 조회 로직 구현
      // const stats = await deploymentService.getDeploymentStats();

      // 임시 데이터
      const mockStats = {
        totalDeployments: 1247,
        successfulDeployments: 1189,
        failedDeployments: 58,
        successRate: 95.3,
        averageDuration: 145,
        deploymentsToday: 12,
        deploymentsThisWeek: 87,
        deploymentsThisMonth: 342,
        topProjects: [
          { name: 'api-gateway', deployments: 89 },
          { name: 'user-service', deployments: 76 },
          { name: 'payment-service', deployments: 54 },
        ],
      };

      logger.info(`배포 통계 조회 - 사용자: ${req.user.username}`);

      res.json({
        success: true,
        data: mockStats,
      });
    } catch (error) {
      next(error);
    }
  },
);

// 헬퍼 함수들

/**
 * Jenkins job들을 버전별로 그룹핑
 * 예: 1.2.0 → { mrJob: '1.2.0/mr1.2.0_release', fsJob: '1.2.0/fs1.2.0_release' }
 */
function groupJobsByVersion(jobs) {
  const groups = {};

  for (const job of jobs) {
    // 버전 패턴 매칭: x.x.x/mrx.x.x_release 또는 x.x.x/fsx.x.x_release
    const versionMatch = job.name.match(/^(\d+\.\d+\.\d+)\/(mr|fs)(\d+\.\d+\.\d+)_release$/);

    if (versionMatch) {
      const [, version, prefix, subVersion] = versionMatch;

      if (!groups[version]) {
        groups[version] = {
          version,
          mrJob: null,
          fsJob: null,
        };
      }

      if (prefix === 'mr') {
        groups[version].mrJob = job;
      } else if (prefix === 'fs') {
        groups[version].fsJob = job;
      }
    }
  }

  // 완전한 그룹만 반환 (mr과 fs 모두 있는 경우)
  const completeGroups = {};
  for (const [version, group] of Object.entries(groups)) {
    if (group.mrJob && group.fsJob) {
      completeGroups[version] = group;
      logger.info(`Complete version group found: ${version} with mr and fs jobs`);
    }
  }

  return completeGroups;
}

/**
 * 버전 그룹의 배포 상태 처리
 * mr → fs 순서로 진행되며 둘 다 성공해야 전체 성공
 */
async function processVersionGroup(jenkinsService, version, jobGroup) {
  try {
    // mr job 빌드 조회
    const mrBuilds = await jenkinsService.getJobBuilds(jobGroup.mrJob.name, 10);
    const latestMrBuild = mrBuilds[0];

    // fs job 빌드 조회
    const fsBuilds = await jenkinsService.getJobBuilds(jobGroup.fsJob.name, 10);
    const latestFsBuild = fsBuilds[0];

    if (!latestMrBuild && !latestFsBuild) {
      return null; // 빌드가 없는 경우
    }

    // 전체 상태 결정 로직
    let overallStatus = 'pending';
    let timestamp = new Date();
    let duration = 0;
    let changes = [];
    let parameters = {};

    // mr → fs 순서 고려한 상태 결정
    if (latestMrBuild && latestFsBuild) {
      // 둘 다 성공한 경우에만 전체 성공
      if ((latestMrBuild.status === 'success' || latestMrBuild.status === 'SUCCESS') &&
          (latestFsBuild.status === 'success' || latestFsBuild.status === 'SUCCESS')) {
        overallStatus = 'success';
      } else if ((latestMrBuild.status === 'failed' || latestMrBuild.status === 'FAILED') ||
                 (latestFsBuild.status === 'failed' || latestFsBuild.status === 'FAILED')) {
        overallStatus = 'failed';
      } else {
        overallStatus = 'in_progress';
      }

      // 더 최근 빌드의 시간 사용
      timestamp = new Date(Math.max(new Date(latestMrBuild.timestamp), new Date(latestFsBuild.timestamp)));

      // duration 디버그 로그 추가
      logger.debug(`Duration calculation for ${version}: mr=${latestMrBuild.duration}s, fs=${latestFsBuild.duration}s`);

      // 두 작업 중 더 긴 시간을 사용 (순차 실행이 아닌 병렬 실행으로 가정)
      duration = Math.max(latestMrBuild.duration || 0, latestFsBuild.duration || 0);

      changes = [...(latestMrBuild.changes || []), ...(latestFsBuild.changes || [])];
      parameters = { ...latestMrBuild.parameters, ...latestFsBuild.parameters };
    } else if (latestMrBuild) {
      // mr만 있는 경우
      overallStatus = latestMrBuild.status === 'success' || latestMrBuild.status === 'SUCCESS' ? 'in_progress' : latestMrBuild.status;
      timestamp = new Date(latestMrBuild.timestamp);
      duration = latestMrBuild.duration || 0;
      changes = latestMrBuild.changes || [];
      parameters = latestMrBuild.parameters || {};
    } else if (latestFsBuild) {
      // fs만 있는 경우 (비정상적이지만 처리)
      overallStatus = latestFsBuild.status;
      timestamp = new Date(latestFsBuild.timestamp);
      duration = latestFsBuild.duration || 0;
      changes = latestFsBuild.changes || [];
      parameters = latestFsBuild.parameters || {};
    }

    // 서브 잡 정보 구성
    const subJobs = [];
    if (latestMrBuild) {
      subJobs.push({
        name: jobGroup.mrJob.name,
        status: latestMrBuild.status,
        buildNumber: latestMrBuild.buildNumber,
        timestamp: latestMrBuild.timestamp,
        duration: latestMrBuild.duration,
        order: 1,
      });
    }
    if (latestFsBuild) {
      subJobs.push({
        name: jobGroup.fsJob.name,
        status: latestFsBuild.status,
        buildNumber: latestFsBuild.buildNumber,
        timestamp: latestFsBuild.timestamp,
        duration: latestFsBuild.duration,
        order: 2,
      });
    }

    return {
      id: `${version}-group`,
      projectName: version,
      buildNumber: null, // 그룹에는 단일 빌드 번호가 없음
      status: overallStatus,
      timestamp: timestamp,
      duration: duration,
      displayName: `${version} (${subJobs.length}개 작업)`,
      url: null,
      parameters: parameters,
      changes: changes,
      environment: determineEnvironment(version, parameters),
      version: version,
      subJobs: subJobs,
    };
  } catch (error) {
    logger.error(`Error processing version group ${version}:`, error);
    throw error;
  }
}

function determineEnvironment(jobName, parameters = {}) {
  const name = jobName.toLowerCase();

  // 파라미터에서 환경 정보 확인
  if (parameters.ENVIRONMENT) {
    return parameters.ENVIRONMENT.toLowerCase();
  }

  if (parameters.DEPLOY_ENV) {
    return parameters.DEPLOY_ENV.toLowerCase();
  }

  // 작업 이름에서 환경 추정
  if (name.includes('prod') || name.includes('production')) {
    return 'production';
  }

  if (name.includes('stag') || name.includes('staging')) {
    return 'staging';
  }

  if (name.includes('dev') || name.includes('development')) {
    return 'development';
  }

  return 'development';
}

// 공통 배포 정보 조회 함수
async function getDeploymentInfo(projectName, buildNumber, version = null, req) {
  const logger = require('../config/logger');
  const jenkinsService = getJenkinsService();
  const nasService = getNASService();
  const SynologyApiService = require('../services/synologyApiService');
  const synologyApiService = new SynologyApiService();

  logger.info(`배포 정보 조회 시작 - 프로젝트: ${projectName}, 빌드: ${buildNumber}, 버전: ${version}`);

  // 1. 먼저 deployment_paths 테이블에서 기존 검증된 데이터 확인 (최적화됨)
  let deploymentInfo = null;
  try {
    logger.info(`DB 쿼리 시도 - 프로젝트: ${projectName}, 빌드: ${buildNumber}`);
    const { query } = require('../config/database');

    const dbResult = await query(
      'SELECT * FROM deployment_paths WHERE project_name = $1 AND build_number = $2',
      [projectName, parseInt(buildNumber)],
    );

    logger.info(`DB 쿼리 결과 - 행 개수: ${dbResult.rows.length}`);

    if (dbResult.rows.length > 0) {
      const dbRecord = dbResult.rows[0];
      logger.info(`DB 레코드 발견 - all_files: ${JSON.stringify(dbRecord.all_files)}`);
      deploymentInfo = {
        deploymentPath: dbRecord.nas_path,
        nasPath: dbRecord.nas_path,
        downloadFile: dbRecord.download_file,
        allFiles: dbRecord.all_files || [],
        verifiedFiles: dbRecord.all_files || [],
        directoryVerified: true,
        downloadFileVerified: true,
        buildDate: dbRecord.build_date,
        buildNumber: dbRecord.build_number,
      };
      logger.info(`Found verified deployment data in database for ${projectName}#${buildNumber}`);
      logger.info(`DB allFiles: ${JSON.stringify(dbRecord.all_files)}`);

      // DB에서 데이터를 찾은 경우 Synology API 호출 건너뛰기
      logger.info('DB에서 데이터를 찾았으므로 빠른 응답 제공');
    } else {
      logger.warn(`DB에서 레코드를 찾지 못함 - ${projectName}#${buildNumber}`);
    }
  } catch (dbError) {
    logger.error(`Database query failed: ${dbError.message}`);
    logger.error(`DB 연결 정보 - host: ${process.env.DB_HOST}, port: ${process.env.DB_PORT}, db: ${process.env.DB_NAME}, user: ${process.env.DB_USER}`);
  }

  // 2. DB에 데이터가 없으면 Jenkins에서 동적으로 조회
  if (!deploymentInfo) {
    logger.info(`Jenkins에서 배포 정보 조회 - ${projectName}#${buildNumber}`);
    deploymentInfo = await jenkinsService.extractDeploymentInfo(projectName, parseInt(buildNumber));
  }

  return {
    success: true,
    data: deploymentInfo || { downloadFile: null, allFiles: [], artifacts: {} },
  };
}

// Jenkins 배포 정보 조회 (3-segment URL: version/projectName/buildNumber)
router.get('/deployment-info/:version/:projectName/:buildNumber',
  [
    param('version').isString().withMessage('버전은 문자열이어야 합니다'),
    param('projectName').isString().withMessage('프로젝트명은 문자열이어야 합니다'),
    param('buildNumber').isInt({ min: 1 }).withMessage('빌드 번호는 양의 정수여야 합니다'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: '입력 데이터가 올바르지 않습니다.',
          errors: errors.array(),
        });
      }

      const { version, projectName, buildNumber } = req.params;

      // 실제 projectName은 version/projectName 조합
      const fullProjectName = `${version}/${projectName}`;

      logger.info(`배포 정보 조회 요청 (3-segment) - 사용자: ${req.user.username}, 버전: ${version}, 프로젝트: ${projectName}, 빌드: ${buildNumber}`);
      logger.info(`Full project name: ${fullProjectName}`);

      // 공통 함수 사용
      const result = await getDeploymentInfo(fullProjectName, buildNumber, version, req);
      
      return res.json({
        success: result.success,
        data: {
          projectName: fullProjectName,
          buildNumber: parseInt(buildNumber),
          status: 'SUCCESS',
          ...result.data
        }
      });

      const jenkinsService = getJenkinsService();
      const nasService = getNASService();
      const SynologyApiService = require('../services/synologyApiService');
      const synologyApiService = new SynologyApiService();

      try {
        logger.info(`배포 정보 조회 시작 - 프로젝트: ${fullProjectName}, 빌드: ${buildNumber}`);

        // 1. 먼저 deployment_paths 테이블에서 기존 검증된 데이터 확인 (최적화됨)
        let deploymentInfo = null;
        try {
          logger.info(`DB 쿼리 시도 - 프로젝트: ${fullProjectName}, 빌드: ${buildNumber}`);
          const { query } = require('../config/database');

          const dbResult = await query(
            'SELECT * FROM deployment_paths WHERE project_name = $1 AND build_number = $2',
            [fullProjectName, parseInt(buildNumber)],
          );

          logger.info(`DB 쿼리 결과 - 행 개수: ${dbResult.rows.length}`);

          if (dbResult.rows.length > 0) {
            const dbRecord = dbResult.rows[0];
            logger.info(`DB 레코드 발견 - all_files: ${JSON.stringify(dbRecord.all_files)}`);
            deploymentInfo = {
              deploymentPath: dbRecord.nas_path,
              nasPath: dbRecord.nas_path,
              downloadFile: dbRecord.download_file,
              allFiles: dbRecord.all_files || [],
              verifiedFiles: dbRecord.all_files || [],
              directoryVerified: true,
              downloadFileVerified: true,
              buildDate: dbRecord.build_date,
              buildNumber: dbRecord.build_number,
            };
            logger.info(`Found verified deployment data in database for ${fullProjectName}#${buildNumber}`);
            logger.info(`DB allFiles: ${JSON.stringify(dbRecord.all_files)}`);

            // DB에서 데이터를 찾은 경우 Synology API 호출 건너뛰기
            if (false) {
              logger.info('DB에서 데이터를 찾았지만 Synology 공유 링크가 없음, 생성 시도');

              // 버전 정보 추출
              const extractedVersion = version.replace(/^(\d+\.\d+\.\d+).*/, '$1');
              let date = '';
              let buildNum = '';

              const dateMatch = fullProjectName.match(/_(\d{6})_/) || deploymentInfo.nasPath?.match(/\/(\d{6})\//);
              const buildMatch = fullProjectName.match(/_(\d+)$/) || deploymentInfo.nasPath?.match(/\/(\d+)$/);

              if (dateMatch) date = dateMatch[1];
              if (buildMatch) buildNum = buildMatch[1];

              // 기본값 설정
              if (!date) date = '250116'; // 2.0.0 기본 날짜
              if (!buildNum) buildNum = buildNumber;

              logger.info(`🔗 Synology API 호출 시작 (DB 데이터 보완) - getOrCreateVersionShareLink(${extractedVersion}, ${date}, ${buildNum})`);
              try {
                const shareResult = await Promise.race([
                  synologyApiService.getOrCreateVersionShareLink(extractedVersion, date, buildNum),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Synology API timeout')), 3000)),
                ]);

                logger.info('🔗 Synology API 응답 (DB 데이터 보완):', JSON.stringify(shareResult, null, 2));

                if (shareResult.success) {
                  deploymentInfo.synologyShareUrl = shareResult.shareUrl;
                  deploymentInfo.synologyShareId = shareResult.shareId;
                  deploymentInfo.shareCreated = shareResult.isNew;

                  logger.info(`Synology folder share link ${shareResult.isNew ? 'created' : 'found'} (DB 데이터 보완): ${shareResult.shareUrl}`);
                } else {
                  logger.warn(`Synology share link creation failed (DB 데이터 보완): ${shareResult.error}`);
                }
              } catch (shareError) {
                logger.warn(`Synology share link error (DB 데이터 보완): ${shareError.message}`);
              }
            } else {
              // DB에서 데이터를 찾았으므로 Synology API 호출 건너뛰기
              logger.info('DB에서 데이터를 찾았으므로 빠른 응답 제공');
            }
          } else {
            logger.warn(`DB에서 레코드를 찾지 못함 - ${fullProjectName}#${buildNumber}`);
          }
        } catch (dbError) {
          logger.error(`Database query failed: ${dbError.message}`);
          logger.error(`DB 연결 정보 - host: ${process.env.DB_HOST}, port: ${process.env.DB_PORT}, db: ${process.env.DB_NAME}, user: ${process.env.DB_USER}`);
        }

        // 2. DB에 데이터가 없으면 Jenkins에서 동적으로 조회
        if (!deploymentInfo) {
          // Jenkins에서 빌드 정보 확인 - extractDeploymentInfoFromBuildLog를 통해 상태도 확인
          let buildStatus = null;
          try {
            logger.info(`Jenkins 빌드 로그 추출 시도 - ${fullProjectName}#${buildNumber}`);
            // 빌드 로그에서 정보를 먼저 추출해보고 상태 확인
            const preliminaryInfo = await jenkinsService.extractDeploymentInfoFromBuildLog(fullProjectName, parseInt(buildNumber));
            buildStatus = 'SUCCESS'; // 로그를 성공적으로 가져왔으면 빌드는 완료된 것으로 간주
            logger.info(`Jenkins 빌드 로그 추출 성공 - ${fullProjectName}#${buildNumber}`);
          } catch (error) {
            logger.error(`빌드 로그 접근 실패 - ${fullProjectName}#${buildNumber}: ${error.message}`);
            logger.error('Error stack:', error.stack);
            buildStatus = 'UNKNOWN';
          }

          // Jenkins에서 배포 정보 조회 (PRD 기반 자동 경로 탐지 시스템 사용)
          deploymentInfo = await jenkinsService.extractDeploymentInfo(fullProjectName, parseInt(buildNumber));
        }

        const buildStatus = 'SUCCESS';

        // NAS 디렉토리 존재 확인 및 검증
        if (deploymentInfo.nasPath || deploymentInfo.deploymentPath) {
          const nasPath = deploymentInfo.nasPath || deploymentInfo.deploymentPath;

          // Windows 경로를 Unix 경로로 변환
          let unixPath = nasPath
            .replace(/\\\\/g, '')              // \\ 제거
            .replace('nas.roboetech.com', '')   // 호스트명 제거
            .replace(/\\/g, '/')                // \ -> /
            .replace(/^\/+/, '');               // 앞의 중복 슬래시 정리

          // release_version을 Synology API용 절대 경로로 변환
          if (!unixPath.startsWith('/release_version/')) {
            unixPath = unixPath.replace(/^release_version\//, '/release_version/');
            if (!unixPath.startsWith('/release_version/')) {
              unixPath = '/release_version/' + unixPath;
            }
          }

          logger.info(`Checking NAS directory existence: ${unixPath}`);

          // 실제 NAS 디렉토리 존재 확인
          const directoryExists = await nasService.directoryExists(unixPath);

          if (directoryExists) {
            // 디렉토리가 존재하면 파일 목록도 조회
            try {
              const files = await nasService.getDirectoryFiles(unixPath);
              deploymentInfo.verifiedFiles = files;
              deploymentInfo.directoryVerified = true;

              // NAS에서 해당 버전 관련 파일들 찾기
              const versionFiles = files.filter(file => {
                const isDeploymentFile = file.endsWith('.tar.gz') || file.endsWith('.enc.tar.gz');
                return isDeploymentFile;
              });

              deploymentInfo.allFiles = versionFiles;
              deploymentInfo.verifiedAllFiles = versionFiles;

              logger.info(`Found ${versionFiles.length} deployment files in NAS: ${versionFiles.join(', ')}`);

              // 메인 다운로드 파일 설정 (V로 시작하는 비암호화 파일 우선)
              const mainFile = versionFiles.find(f => f.startsWith('V') && !f.includes('.enc.'));
              if (mainFile) {
                deploymentInfo.downloadFile = mainFile;
                deploymentInfo.downloadFileVerified = true;
                logger.info(`Set download file to: ${mainFile}`);
              }

              logger.info(`NAS directory verified: ${unixPath} (${files.length} files found)`);

              // NAS 스캔 성공 시 캐시에 저장
              try {
                const deploymentPathService = getDeploymentPathService();
                const buildDate = new Date(); // 현재 날짜를 빌드 날짜로 사용

                await deploymentPathService.saveDeploymentPath({
                  projectName: fullProjectName,
                  version: version || '1.0.0',
                  buildNumber: parseInt(buildNumber) || 0,
                  buildDate: buildDate,
                  nasPath: deploymentInfo.nasPath || deploymentInfo.deploymentPath,
                  downloadFile: deploymentInfo.downloadFile,
                  allFiles: deploymentInfo.allFiles || [],
                });

                logger.info(`Cached deployment path: ${fullProjectName} v${version} #${buildNumber}`);
              } catch (cacheError) {
                // 캐시 저장 실패해도 메인 로직은 계속 진행
                logger.warn(`Failed to cache deployment path: ${cacheError.message}`);
              }
            } catch (error) {
              logger.warn(`Failed to get file list for ${unixPath}: ${error.message}`);
              deploymentInfo.directoryVerified = true;
              deploymentInfo.verificationWarning = 'Directory exists but file list unavailable';
            }
          }
        }

        // Synology 공유 링크 생성 시도 (3-segment route)
        if (deploymentInfo && (deploymentInfo.nasPath || deploymentInfo.deploymentPath)) {
          // 프로젝트명에서 버전과 날짜 추출
          const extractedVersion = version; // 3-segment route는 version 파라미터가 있음
          let date = '250310'; // 기본값
          let buildNum = buildNumber;

          // 프로젝트명 및 NAS 경로에서 날짜/빌드 번호 추출 (Windows 경로 지원)
          const dateMatch = fullProjectName.match(/_(\d{6})_/) || deploymentInfo.nasPath?.match(/[\\\/](\d{6})[\\\/]/);
          const buildMatch = fullProjectName.match(/_(\d+)$/) || deploymentInfo.nasPath?.match(/[\\\/](\d+)$/);

          if (dateMatch) date = dateMatch[1];
          if (buildMatch) buildNum = buildMatch[1];

          logger.info(`🔍 날짜/빌드번호 추출 결과 (3-segment) - date: ${date}, buildNum: ${buildNum}, nasPath: ${deploymentInfo.nasPath}`);

          logger.info(`🔗 Synology API 호출 시작 (3-segment) - getOrCreateVersionShareLink(${extractedVersion}, ${date}, ${buildNum})`);
          try {
            const shareResult = await Promise.race([
              synologyApiService.getOrCreateVersionShareLink(extractedVersion, date, buildNum),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Synology API timeout')), 3000)),
            ]);

            logger.info('🔗 Synology API 응답 (3-segment):', JSON.stringify(shareResult, null, 2));

            if (shareResult.success) {
              deploymentInfo.synologyShareUrl = shareResult.shareUrl;
              deploymentInfo.synologyShareId = shareResult.shareId;
              deploymentInfo.shareCreated = shareResult.isNew;

              logger.info(`Synology folder share link ${shareResult.isNew ? 'created' : 'found'} (3-segment): ${shareResult.shareUrl}`);
            } else {
              logger.warn(`Synology share link creation failed (3-segment): ${shareResult.error}`);
            }
          } catch (shareError) {
            logger.warn(`Synology share link error (3-segment): ${shareError.message}`);
          }

          // 파일 정보 매핑 생성
          if (deploymentInfo.allFiles && deploymentInfo.allFiles.length > 0) {
            try {
              const fileInfoResult = await synologyApiService.findActualFileNames(
                deploymentInfo.nasPath, extractedVersion, date,
              );
              if (fileInfoResult.success) {
                deploymentInfo.fileInfoMap = fileInfoResult.fileInfoMap || {};
                logger.info('File info map created (3-segment):', JSON.stringify(deploymentInfo.fileInfoMap, null, 2));
              }
            } catch (fileInfoError) {
              logger.warn(`File info mapping failed (3-segment): ${fileInfoError.message}`);
              deploymentInfo.fileInfoMap = {};
            }
          }
        }

        return res.json({
          success: true,
          data: {
            projectName: fullProjectName,
            buildNumber: parseInt(buildNumber),
            status: buildStatus,
            deploymentPath: deploymentInfo.deploymentPath,
            nasPath: deploymentInfo.nasPath,
            downloadFile: deploymentInfo.downloadFile,
            allFiles: deploymentInfo.allFiles || [],
            verifiedFiles: deploymentInfo.verifiedFiles || [],
            directoryVerified: deploymentInfo.directoryVerified || false,
            downloadFileVerified: deploymentInfo.downloadFileVerified || false,
            buildDate: deploymentInfo.buildDate,
            buildNumber: deploymentInfo.buildNumber,
            synologyShareUrl: deploymentInfo.synologyShareUrl,
            synologyShareId: deploymentInfo.synologyShareId,
            shareCreated: deploymentInfo.shareCreated,
            fileInfoMap: deploymentInfo.fileInfoMap || {},
          },
          message: '배포 정보를 조회했습니다.',
        });

      } catch (innerError) {
        logger.error(`Jenkins 배포 정보 조회 실패 - ${fullProjectName}#${buildNumber}: ${innerError.message}`);
        logger.error('Inner error stack:', innerError.stack);

        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: '요청한 리소스를 찾을 수 없습니다.',
          },
        });
      }
    } catch (error) {
      logger.error(`배포 정보 조회 중 오류 발생: ${error.message}`);
      next(error);
    }
  },
);

// Jenkins 배포 정보 조회 (NAS 경로, 다운로드 파일 등) - 2-segment URL fallback
router.get('/deployment-info/:projectName/:buildNumber',
  [
    param('projectName').isString().withMessage('프로젝트명은 문자열이어야 합니다'),
    param('buildNumber').isInt({ min: 1 }).withMessage('빌드 번호는 양의 정수여야 합니다'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: '입력 데이터가 올바르지 않습니다.',
          errors: errors.array(),
        });
      }

      const { projectName, buildNumber } = req.params;

      logger.info(`배포 정보 조회 요청 - 사용자: ${req.user.username}, 프로젝트: ${projectName}, 빌드: ${buildNumber}`);

      const jenkinsService = getJenkinsService();
      const nasService = getNASService();
      const SynologyApiService = require('../services/synologyApiService');
      const synologyApiService = new SynologyApiService();

      try {
        logger.info(`배포 정보 조회 시작 (2-segment) - 프로젝트: ${projectName}, 빌드: ${buildNumber}`);

        // 1. 먼저 deployment_paths 테이블에서 기존 검증된 데이터 확인 (최적화됨)
        let deploymentInfo = null;
        try {
          logger.info(`DB 쿼리 시도 (2-segment) - 프로젝트: ${projectName}, 빌드: ${buildNumber}`);
          const { query } = require('../config/database');

          const dbResult = await query(
            'SELECT * FROM deployment_paths WHERE project_name = $1 AND build_number = $2',
            [projectName, parseInt(buildNumber)],
          );

          logger.info(`DB 쿼리 결과 (2-segment) - 행 개수: ${dbResult.rows.length}`);

          if (dbResult.rows.length > 0) {
            const dbRecord = dbResult.rows[0];
            logger.info(`DB 레코드 발견 (2-segment) - all_files: ${JSON.stringify(dbRecord.all_files)}`);
            deploymentInfo = {
              deploymentPath: dbRecord.nas_path,
              nasPath: dbRecord.nas_path,
              downloadFile: dbRecord.download_file,
              allFiles: dbRecord.all_files || [],
              verifiedFiles: dbRecord.all_files || [],
              directoryVerified: true,
              downloadFileVerified: true,
              buildDate: dbRecord.build_date,
              buildNumber: dbRecord.build_number,
            };
            logger.info(`Found verified deployment data in database (2-segment) for ${projectName}#${buildNumber}`);
            logger.info(`DB allFiles (2-segment): ${JSON.stringify(dbRecord.all_files)}`);
          } else {
            logger.warn(`DB에서 레코드를 찾지 못함 (2-segment) - ${projectName}#${buildNumber}`);
          }
        } catch (dbError) {
          logger.error(`Database query failed (2-segment): ${dbError.message}`);
          logger.error(`DB 연결 정보 (2-segment) - host: ${process.env.DB_HOST}, port: ${process.env.DB_PORT}, db: ${process.env.DB_NAME}, user: ${process.env.DB_USER}`);
        }

        // 2. DB에 데이터가 있으면 즉시 반환 (성능 최적화)
        logger.info(`🔍 DB 조회 결과 확인 - deploymentInfo exists: ${!!deploymentInfo}`);
        if (deploymentInfo) {
          logger.info('📋 캐시된 데이터 발견, 즉시 반환합니다');

          return res.json({
            success: true,
            data: {
              projectName,
              buildNumber: parseInt(buildNumber),
              status: 'SUCCESS',
              deploymentPath: deploymentInfo.deploymentPath,
              nasPath: deploymentInfo.nasPath,
              downloadFile: deploymentInfo.downloadFile,
              allFiles: deploymentInfo.allFiles || [],
              verifiedFiles: deploymentInfo.verifiedFiles || [],
              directoryVerified: deploymentInfo.directoryVerified || false,
              downloadFileVerified: deploymentInfo.downloadFileVerified || false,
              buildDate: deploymentInfo.buildDate,
              buildNumber: deploymentInfo.buildNumber,
              cached: true, // 캐시된 데이터임을 표시
            },
            message: '캐시된 배포 정보를 조회했습니다.',
          });
        }

        // 3. DB에 데이터가 없는 경우만 느린 작업 수행
        logger.info(`캐시된 데이터가 없어 실시간 조회를 시작합니다`);
        // 성능상의 이유로 실시간 조회는 비활성화 (캐시된 데이터만 사용)
        return res.json({
          success: false,
          message: '캐시된 배포 정보가 없습니다. 관리자에게 문의하세요.',
          data: {
            projectName,
            buildNumber: parseInt(buildNumber),
            status: 'NO_CACHE',
            cached: false,
          }
        });

        // 아래는 원래의 느린 코드 (비활성화됨)
        if (false) {
          logger.info('📋 deploymentInfo 내용:', JSON.stringify(deploymentInfo, null, 2));
          // 프로젝트명에서 버전과 날짜 추출 (예: mr4.0.0_release)
          let version = '4.0.0';
          let date = '251013';
          let buildNum = buildNumber;

          // 프로젝트명 및 NAS 경로에서 정보 추출 (Windows 경로 지원)
          const versionMatch = projectName.match(/mr(\d+\.\d+\.\d+)/) || deploymentInfo.nasPath?.match(/mr(\d+\.\d+\.\d+)/);
          const dateMatch = projectName.match(/_(\d{6})_/) || deploymentInfo.nasPath?.match(/[\\\/](\d{6})[\\\/]/);
          const buildMatch = projectName.match(/_(\d+)$/) || deploymentInfo.nasPath?.match(/[\\\/](\d+)$/);

          if (versionMatch) version = versionMatch[1];
          if (dateMatch) date = dateMatch[1];
          if (buildMatch) buildNum = buildMatch[1];

          logger.info(`추출된 정보 (2-segment) - version: ${version}, date: ${date}, buildNum: ${buildNum}, nasPath: ${deploymentInfo.nasPath}`);

          // Synology 공유 링크 생성 시도 (백그라운드로 실행, 오류가 나도 응답 차단하지 않음)
          logger.info(`🔗 Synology API 호출 시작 - getOrCreateVersionShareLink(${version}, ${date}, ${buildNum})`);
          try {
            const shareResult = await Promise.race([
              synologyApiService.getOrCreateVersionShareLink(version, date, buildNum),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Synology API timeout')), 3000)),
            ]);

            logger.info('🔗 Synology API 응답:', JSON.stringify(shareResult, null, 2));

            if (shareResult.success) {
              deploymentInfo.synologyShareUrl = shareResult.shareUrl;
              deploymentInfo.synologyShareId = shareResult.shareId;
              deploymentInfo.shareCreated = shareResult.isNew;

              logger.info(`Synology folder share link ${shareResult.isNew ? 'created' : 'found'} (2-segment): ${shareResult.shareUrl}`);
            } else {
              logger.warn(`Synology share link creation failed (2-segment): ${shareResult.error}`);
            }
          } catch (shareError) {
            logger.warn(`Synology share link error (2-segment): ${shareError.message}`);
          }

          return res.json({
            success: true,
            data: {
              projectName,
              buildNumber: parseInt(buildNumber),
              status: 'SUCCESS',
              deploymentPath: deploymentInfo.deploymentPath,
              nasPath: deploymentInfo.nasPath,
              downloadFile: deploymentInfo.downloadFile,
              allFiles: deploymentInfo.allFiles || [],
              verifiedFiles: deploymentInfo.verifiedFiles || [],
              directoryVerified: deploymentInfo.directoryVerified || false,
              downloadFileVerified: deploymentInfo.downloadFileVerified || false,
              buildDate: deploymentInfo.buildDate,
              buildNumber: deploymentInfo.buildNumber,
              synologyShareUrl: deploymentInfo.synologyShareUrl,
              synologyShareId: deploymentInfo.synologyShareId,
              shareCreated: deploymentInfo.shareCreated,
              fileInfoMap: deploymentInfo.fileInfoMap || {},
            },
            message: '배포 정보를 조회했습니다.',
          });
        }

        // 3. DB에 데이터가 없으면 Jenkins에서 동적으로 조회
        // Jenkins에서 빌드 정보 확인 - extractDeploymentInfoFromBuildLog를 통해 상태도 확인
        let buildStatus = null;
        try {
          logger.info(`Jenkins 빌드 로그 추출 시도 - ${projectName}#${buildNumber}`);
          // 빌드 로그에서 정보를 먼저 추출해보고 상태 확인
          const preliminaryInfo = await jenkinsService.extractDeploymentInfoFromBuildLog(projectName, parseInt(buildNumber));
          buildStatus = 'SUCCESS'; // 로그를 성공적으로 가져왔으면 빌드는 완료된 것으로 간주
          logger.info(`Jenkins 빌드 로그 추출 성공 - ${projectName}#${buildNumber}`);
        } catch (error) {
          logger.error(`빌드 로그 접근 실패 - ${projectName}#${buildNumber}: ${error.message}`);
          logger.error('Error stack:', error.stack);
          buildStatus = 'UNKNOWN';
        }

        // 실패한 배포인 경우 파일 검색 없이 기본 정보만 반환
        if (buildStatus === 'FAILURE' || buildStatus === 'FAILED' || buildStatus === 'ABORTED') {
          logger.info(`배포 실패 상태(${buildStatus})로 인해 파일 검색 생략 - 프로젝트: ${projectName}, 빌드: ${buildNumber}`);

          return res.json({
            success: true,
            data: {
              projectName,
              buildNumber: parseInt(buildNumber),
              status: buildStatus,
              deploymentPath: null,
              nasPath: null,
              downloadFile: null,
              allFiles: [],
              verifiedFiles: [],
              directoryVerified: false,
              downloadFileVerified: false,
              message: `배포가 실패했습니다 (${buildStatus}). 아티팩트 파일이 생성되지 않았습니다.`,
            },
            message: '배포 정보를 조회했습니다.',
          });
        }

        // Jenkins에서 배포 정보 조회 (PRD 기반 자동 경로 탐지 시스템 사용)
        deploymentInfo = await jenkinsService.extractDeploymentInfo(projectName, parseInt(buildNumber));

        // NAS 디렉토리 존재 확인 및 검증
        if (deploymentInfo.nasPath || deploymentInfo.deploymentPath) {
          const nasPath = deploymentInfo.nasPath || deploymentInfo.deploymentPath;

          // Windows 경로를 Unix 경로로 변환
          let unixPath = nasPath
            .replace(/\\\\/g, '')              // \\ 제거
            .replace('nas.roboetech.com', '')   // 호스트명 제거
            .replace(/\\/g, '/')                // \ -> /
            .replace(/^\/+/, '');               // 앞의 중복 슬래시 정리

          // release_version을 Synology API용 절대 경로로 변환
          if (!unixPath.startsWith('/release_version/')) {
            unixPath = unixPath.replace(/^release_version\//, '/release_version/');
            if (!unixPath.startsWith('/release_version/')) {
              unixPath = '/release_version/' + unixPath;
            }
          }

          logger.info(`Checking NAS directory existence: ${unixPath}`);

          // 실제 NAS 디렉토리 존재 확인
          const directoryExists = await nasService.directoryExists(unixPath);

          if (directoryExists) {
            // 디렉토리가 존재하면 파일 목록도 조회
            try {
              const files = await nasService.getDirectoryFiles(unixPath);
              deploymentInfo.verifiedFiles = files;
              deploymentInfo.directoryVerified = true;

              // 다운로드 파일이 실제로 존재하는지 확인
              if (deploymentInfo.downloadFile) {
                const fileExists = files.includes(deploymentInfo.downloadFile);
                deploymentInfo.downloadFileVerified = fileExists;

                if (!fileExists) {
                  logger.warn(`Download file ${deploymentInfo.downloadFile} not found in directory ${unixPath}`);
                  logger.info(`Available files in directory: ${files.join(', ')}`);

                  // V{version}_{date} 패턴으로 파일 찾기 (시간 무관)
                  const versionDateMatch = deploymentInfo.downloadFile.match(/V(\d+\.\d+\.\d+)_(\d{6})/);
                  if (versionDateMatch) {
                    const version = versionDateMatch[1];
                    const date = versionDateMatch[2];
                    const pattern = `V${version}_${date}`;

                    logger.info(`Looking for files with pattern: ${pattern}*`);

                    // 같은 버전과 날짜로 시작하는 파일 찾기 (시간은 무관)
                    const alternativeFile = files.find(f =>
                      f.startsWith(pattern) && f.endsWith('.tar.gz') && !f.includes('.enc.'),
                    );

                    if (alternativeFile) {
                      deploymentInfo.downloadFile = alternativeFile;
                      deploymentInfo.downloadFileVerified = true;
                      logger.info(`Found alternative download file with pattern ${pattern}: ${alternativeFile}`);
                    } else {
                      logger.warn(`No files found with pattern ${pattern} in available files`);
                    }
                  }
                }
              }

              // allFiles 배열의 파일들도 검증하고, NAS에서 실제 배포 파일 찾기
              if (deploymentInfo.allFiles && deploymentInfo.allFiles.length > 0) {
                deploymentInfo.verifiedAllFiles = deploymentInfo.allFiles.filter(file => files.includes(file));
                deploymentInfo.allFiles = deploymentInfo.verifiedAllFiles; // 존재하는 파일만 반환
              } else {
                // allFiles가 비어있는 경우, NAS에서 직접 배포 파일 찾기
                deploymentInfo.allFiles = [];

                // 버전 정보 추출
                const versionMatch = projectName.match(/(\d+\.\d+\.\d+)/);
                if (versionMatch) {
                  const version = versionMatch[1];

                  // NAS에서 해당 버전 관련 파일들 찾기
                  const versionFiles = files.filter(file => {
                    const isDeploymentFile = file.endsWith('.tar.gz') || file.endsWith('.enc.tar.gz');
                    const hasVersionInName = file.includes(version);
                    return isDeploymentFile && hasVersionInName;
                  });

                  deploymentInfo.allFiles = versionFiles;
                  deploymentInfo.verifiedAllFiles = versionFiles;

                  logger.info(`Found ${versionFiles.length} version-related files in NAS: ${versionFiles.join(', ')}`);

                  // 메인 다운로드 파일도 다시 설정 (V{version}로 시작하는 비암호화 파일 우선)
                  if (!deploymentInfo.downloadFileVerified) {
                    const mainFile = versionFiles.find(f => f.startsWith('V') && !f.includes('.enc.'));
                    if (mainFile) {
                      deploymentInfo.downloadFile = mainFile;
                      deploymentInfo.downloadFileVerified = true;
                      logger.info(`Updated download file to: ${mainFile}`);
                    }
                  }
                }
              }

              logger.info(`NAS directory verified: ${unixPath} (${files.length} files found)`);

              // NAS 스캔 성공 시 캐시에 저장 (2-segment route)
              try {
                const deploymentPathService = getDeploymentPathService();
                const buildDate = new Date(); // 현재 날짜를 빌드 날짜로 사용

                // 프로젝트명에서 버전 추출
                const versionMatch = projectName.match(/(\d+\.\d+\.\d+)/);
                const extractedVersion = versionMatch ? versionMatch[1] : '1.0.0';

                await deploymentPathService.saveDeploymentPath({
                  projectName: projectName,
                  version: extractedVersion,
                  buildNumber: parseInt(buildNumber) || 0,
                  buildDate: buildDate,
                  nasPath: deploymentInfo.nasPath || deploymentInfo.deploymentPath,
                  downloadFile: deploymentInfo.downloadFile,
                  allFiles: deploymentInfo.allFiles || [],
                });

                logger.info(`Cached deployment path (2-segment): ${projectName} v${extractedVersion} #${buildNumber}`);
              } catch (cacheError) {
                // 캐시 저장 실패해도 메인 로직은 계속 진행
                logger.warn(`Failed to cache deployment path (2-segment): ${cacheError.message}`);
              }
            } catch (error) {
              logger.warn(`Failed to get file list for ${unixPath}: ${error.message}`);
              deploymentInfo.directoryVerified = true;
              deploymentInfo.verificationWarning = 'Directory exists but file list unavailable';
            }
          } else {
            deploymentInfo.directoryVerified = false;
            deploymentInfo.downloadFileVerified = false;

            // 대체 경로들 시도
            const versionMatch = projectName.match(/(\d+\.\d+\.\d+)/);
            if (versionMatch) {
              const version = versionMatch[1];
              const alternativePaths = [
                `release_version/release/product/mr${version}`,
                `release_version/release/product/${version}`,
                `release_version/${version}`,
                `release_version/projects/${version}`,
              ];

              logger.info(`Original path ${unixPath} not found, trying alternatives...`);

              for (const altPath of alternativePaths) {
                const exists = await nasService.directoryExists(altPath);
                if (exists) {
                  try {
                    const files = await nasService.getDirectoryFiles(altPath);
                    deploymentInfo.nasPath = `\\\\nas.roboetech.com\\${altPath.replace(/\//g, '\\')}`;
                    deploymentInfo.deploymentPath = deploymentInfo.nasPath;
                    deploymentInfo.directoryVerified = true;
                    deploymentInfo.verifiedFiles = files;
                    deploymentInfo.alternativePathUsed = altPath;

                    logger.info(`Found alternative NAS path: ${altPath} (${files.length} files)`);

                    // 대체 경로 찾은 경우에도 캐시에 저장
                    try {
                      const deploymentPathService = getDeploymentPathService();
                      const buildDate = new Date(); // 현재 날짜를 빌드 날짜로 사용

                      await deploymentPathService.saveDeploymentPath({
                        projectName: projectName,
                        version: version,
                        buildNumber: parseInt(buildNumber) || 0,
                        buildDate: buildDate,
                        nasPath: deploymentInfo.nasPath,
                        downloadFile: deploymentInfo.downloadFile,
                        allFiles: files || [],
                      });

                      logger.info(`Cached alternative deployment path: ${projectName} v${version} #${buildNumber} -> ${altPath}`);
                    } catch (cacheError) {
                      // 캐시 저장 실패해도 메인 로직은 계속 진행
                      logger.warn(`Failed to cache alternative deployment path: ${cacheError.message}`);
                    }
                    break;
                  } catch (error) {
                    logger.warn(`Failed to get files from alternative path ${altPath}: ${error.message}`);
                  }
                }
              }
            }

            if (!deploymentInfo.directoryVerified) {
              logger.warn(`No valid NAS directory found for deployment ${projectName}#${buildNumber}`);
              deploymentInfo.verificationError = 'NAS directory not found';
            }
          }
        } else {
          deploymentInfo.directoryVerified = false;
          deploymentInfo.verificationError = 'No NAS path found in deployment info';
          logger.warn(`No NAS path found for deployment ${projectName}#${buildNumber}`);
        }

        // 시놀로지 공유 링크 및 파일별 다운로드 링크 생성 (디렉토리가 존재하는 경우만)
        if (deploymentInfo.directoryVerified && deploymentInfo.nasPath) {
          try {
            // NAS 경로에서 버전, 날짜, 빌드 번호 추출 (Windows 및 Unix 경로 모두 지원)
            logger.info(`Trying to extract version info from NAS path: ${deploymentInfo.nasPath}`);
            const pathMatch = deploymentInfo.nasPath.match(/mr(\d+\.\d+\.\d+)[\\\/](\d+)[\\\/](\d+)/);
            if (pathMatch) {
              const [, version, date, buildNum] = pathMatch;

              logger.info(`Creating Synology links for version ${version}, date ${date}, build ${buildNum}`);

              // 0. 실제 파일명 찾기
              const folderPath = `/release_version/release/product/mr${version}/${date}/${buildNum}`;
              const actualFileNamesResult = await Promise.race([
                synologyApiService.findActualFileNames(folderPath, version, date),
                new Promise((_, reject) => setTimeout(() => reject(new Error('File listing timeout')), 3000)),
              ]);

              let actualFileNames = {};
              let fileInfoMap = {};
              if (actualFileNamesResult.success) {
                actualFileNames = actualFileNamesResult.fileMap;
                fileInfoMap = actualFileNamesResult.fileInfoMap || {};
                logger.info(`Found actual file names: ${JSON.stringify(actualFileNames)}`);
                logger.info(`Found file info: ${JSON.stringify(fileInfoMap)}`);

                // 실제 파일명으로 업데이트
                if (actualFileNames.main) {
                  deploymentInfo.downloadFile = actualFileNames.main;
                  deploymentInfo.downloadFileVerified = true;
                }

                // 추가 파일 정보 업데이트
                deploymentInfo.actualFiles = {
                  main: actualFileNames.main || null,
                  morow: actualFileNames.morow || null,
                  backend: actualFileNames.backend || null,
                  frontend: actualFileNames.frontend || null,
                };

                // 파일 정보 추가 (크기, 수정일)
                deploymentInfo.fileInfoMap = fileInfoMap;

                // allFiles 배열을 실제 파일명으로 업데이트
                deploymentInfo.allFiles = Object.values(deploymentInfo.actualFiles).filter(file => file !== null);
                logger.info(`Updated allFiles with actual file names: ${JSON.stringify(deploymentInfo.allFiles)}`);
              } else {
                logger.warn(`Failed to find actual file names: ${actualFileNamesResult.error}`);
              }

              // 1. 폴더 공유 링크 생성 (기존)
              const shareResult = await Promise.race([
                synologyApiService.getOrCreateVersionShareLink(version, date, buildNum),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Synology API timeout')), 3000)),
              ]);

              if (shareResult.success) {
                deploymentInfo.synologyShareUrl = shareResult.shareUrl;
                deploymentInfo.synologyShareId = shareResult.shareId;
                deploymentInfo.shareCreated = shareResult.isNew;

                logger.info(`Synology folder share link ${shareResult.isNew ? 'created' : 'found'}: ${shareResult.shareUrl}`);
              } else {
                logger.warn(`Failed to create Synology folder share link: ${shareResult.error}`);
                deploymentInfo.synologyShareError = shareResult.error;
              }

              // 2. 개별 파일 다운로드 링크 생성 (새로운 기능)
              deploymentInfo.fileDownloadLinks = {};

              // 메인 다운로드 파일에 대한 직접 다운로드 링크
              if (deploymentInfo.downloadFile && deploymentInfo.downloadFileVerified) {
                try {
                  const fileDownloadResult = await Promise.race([
                    synologyApiService.getOrCreateFileDownloadLink(version, date, buildNum, deploymentInfo.downloadFile),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('File download link timeout')), 3000)),
                  ]);

                  if (fileDownloadResult.success) {
                    deploymentInfo.fileDownloadLinks[deploymentInfo.downloadFile] = {
                      downloadUrl: fileDownloadResult.downloadUrl || fileDownloadResult.shareUrl,
                      isDirectDownload: fileDownloadResult.isDirectDownload,
                      fileName: fileDownloadResult.fileName,
                    };

                    // 메인 파일의 다운로드 링크를 별도로 저장
                    deploymentInfo.mainFileDownloadUrl = fileDownloadResult.downloadUrl || fileDownloadResult.shareUrl;
                    deploymentInfo.isMainFileDirectDownload = fileDownloadResult.isDirectDownload;

                    logger.info(`Main file download link created: ${deploymentInfo.mainFileDownloadUrl} (direct: ${fileDownloadResult.isDirectDownload})`);
                  }
                } catch (error) {
                  logger.warn(`Failed to create download link for main file ${deploymentInfo.downloadFile}: ${error.message}`);
                }
              }

              // 3. 실제 파일들에 대한 다운로드 링크 생성 (actualFiles 사용)
              if (deploymentInfo.actualFiles) {
                const fileTypes = ['morow', 'backend', 'frontend'];

                for (const fileType of fileTypes) {
                  const fileName = deploymentInfo.actualFiles[fileType];
                  if (fileName) {
                    try {
                      const fileDownloadResult = await Promise.race([
                        synologyApiService.getOrCreateFileDownloadLink(version, date, buildNum, fileName),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('File download link timeout')), 5000)),
                      ]);

                      if (fileDownloadResult.success) {
                        deploymentInfo.fileDownloadLinks[fileName] = {
                          downloadUrl: fileDownloadResult.downloadUrl || fileDownloadResult.shareUrl,
                          isDirectDownload: fileDownloadResult.isDirectDownload,
                          fileName: fileDownloadResult.fileName,
                          fileType: fileType,
                        };

                        // 파일 타입별로도 저장 (프론트엔드에서 쉽게 접근하기 위해)
                        deploymentInfo.fileDownloadLinks[`${fileType}File`] = deploymentInfo.fileDownloadLinks[fileName];

                        logger.info(`${fileType} file download link created for ${fileName}: ${fileDownloadResult.downloadUrl || fileDownloadResult.shareUrl} (direct: ${fileDownloadResult.isDirectDownload})`);
                      }
                    } catch (error) {
                      logger.warn(`Failed to create download link for ${fileType} file ${fileName}: ${error.message}`);
                      // 개별 파일 링크 생성 실패는 무시하고 계속 진행
                    }
                  }
                }
              }

            } else {
              logger.warn(`Could not extract version info from NAS path: ${deploymentInfo.nasPath}`);
            }
          } catch (error) {
            logger.error(`Synology link creation failed (will continue without it): ${error.message}`);
            deploymentInfo.synologyShareError = error.message;
            // 시놀로지 API 실패해도 계속 진행
          }
        }

        logger.info(`Jenkins 배포 정보 조회 완료 - 사용자: ${req.user.username}, 프로젝트: ${projectName}, 빌드: ${buildNumber}, 디렉토리 검증: ${deploymentInfo.directoryVerified}`);

        // 최종 응답 데이터 로깅 (fileInfoMap 포함)
        logger.info('Final deploymentInfo response data:', JSON.stringify({
          fileInfoMap: deploymentInfo.fileInfoMap,
          actualFiles: deploymentInfo.actualFiles,
          allFiles: deploymentInfo.allFiles,
        }, null, 2));

        res.json({
          success: true,
          data: deploymentInfo,
          message: '배포 정보를 성공적으로 조회했습니다.',
        });
      } catch (error) {
        logger.error(`Jenkins 배포 정보 조회 실패 - 프로젝트: ${projectName}, 빌드: ${buildNumber}:`, error.message);
        logger.error('Error stack:', error.stack);

        res.status(500).json({
          success: false,
          message: '배포 정보 조회에 실패했습니다.',
          error: error.message,
          projectName: projectName,
          buildNumber: buildNumber,
        });
      }
    } catch (error) {
      next(error);
    }
  },
);

// Upload 폴더 공유 링크 가져오기
router.get('/share/upload',
  authenticateToken,
  async (req, res) => {
    try {
      logger.info(`Upload 폴더 공유 링크 요청 - 사용자: ${req.user.username}`);

      const nasService = getNASService();

      // 여러 가능한 업로드 경로 시도
      const possibleUploadPaths = [
        '/release_version/release/upload',  // 현재 사용 중인 경로
        '/release_version/upload',          // 더 상위 경로
        '/volume1/release_version/release/upload',  // volume1 포함
        '/volume1/release_version/upload'   // volume1 포함 상위 경로
      ];

      let uploadPath = null;
      let pathExists = null;

      // 존재하는 경로 찾기
      for (const testPath of possibleUploadPaths) {
        logger.info(`업로드 경로 테스트 중: ${testPath}`);
        pathExists = await nasService.synologyApiService.checkPathExists(testPath);
        logger.info(`경로 ${testPath} 존재 여부: ${JSON.stringify(pathExists)}`);
        
        if (pathExists.success && pathExists.exists) {
          uploadPath = testPath;
          logger.info(`유효한 업로드 경로 발견: ${uploadPath}`);
          break;
        }
      }

      if (!uploadPath) {
        logger.error('모든 업로드 경로 테스트 실패, 기본 경로 사용');
        uploadPath = '/release_version/release/upload';
      }

      try {
        // upload 폴더에 대해서는 직접 경로로 공유 링크 생성
        const directShareResult = await nasService.synologyApiService.createShareLink(uploadPath);

        if (directShareResult.success && directShareResult.shareUrl) {
          logger.info(`Upload 폴더 직접 공유 링크 생성 성공: ${directShareResult.shareUrl}`);

          res.json({
            success: true,
            shareUrl: directShareResult.shareUrl,
            shareId: directShareResult.shareId,
            path: uploadPath,
            method: 'direct',
            message: 'Upload 폴더 공유 링크를 성공적으로 가져왔습니다.',
          });
        } else {
          throw new Error(directShareResult.error || 'Upload 폴더 공유 링크 생성 실패');
        }
      } catch (directError) {
        logger.error(`Upload 폴더 공유 링크 생성 실패: ${directError.message}`);
        throw new Error(`공유 링크 생성 실패: ${directError.message}`);
      }

    } catch (error) {
      logger.error('Upload 폴더 공유 링크 요청 처리 실패:', error.message);

      res.status(500).json({
        success: false,
        message: 'Upload 폴더 공유 링크 가져오기에 실패했습니다.',
        error: error.message,
      });
    }
  },
);

/**
 * @swagger
 * /api/deployments/cache/stats:
 *   get:
 *     tags:
 *       - Deployments
 *     summary: 배포 경로 캐시 통계 조회
 *     description: 캐시된 배포 경로 통계 정보 조회
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 캐시 통계 조회 성공
 */
router.get('/cache/stats', async (req, res, next) => {
  try {
    const deploymentPathService = getDeploymentPathService();
    const stats = await deploymentPathService.getCacheStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/deployments/cache/cleanup:
 *   post:
 *     tags:
 *       - Deployments
 *     summary: 오래된 캐시 데이터 정리
 *     description: 지정된 일수보다 오래된 캐시 데이터 삭제
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               daysOld:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 365
 *                 default: 90
 *                 description: 삭제할 데이터의 기준 일수
 *     responses:
 *       200:
 *         description: 캐시 정리 성공
 */
router.post('/cache/cleanup',
  [
    body('daysOld')
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage('daysOld must be between 1 and 365'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('유효하지 않은 요청 파라미터입니다.', 400, errors.array());
      }

      const { daysOld = 90 } = req.body;
      const deploymentPathService = getDeploymentPathService();

      const deletedCount = await deploymentPathService.cleanupOldPaths(daysOld);

      res.json({
        success: true,
        data: {
          deletedCount,
          daysOld,
          message: `${deletedCount}개의 오래된 캐시 항목이 삭제되었습니다.`,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /api/deployments/cache/invalidate:
 *   delete:
 *     tags:
 *       - Deployments
 *     summary: 특정 배포 경로 캐시 무효화
 *     description: 특정 프로젝트의 배포 경로 캐시를 삭제
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: projectName
 *         required: true
 *         schema:
 *           type: string
 *         description: 프로젝트명
 *       - in: query
 *         name: version
 *         required: true
 *         schema:
 *           type: string
 *         description: 버전
 *       - in: query
 *         name: buildNumber
 *         required: true
 *         schema:
 *           type: integer
 *         description: 빌드 번호
 *     responses:
 *       200:
 *         description: 캐시 무효화 성공
 */
router.delete('/cache/invalidate',
  [
    query('projectName')
      .notEmpty()
      .withMessage('projectName is required'),
    query('version')
      .notEmpty()
      .withMessage('version is required'),
    query('buildNumber')
      .isInt({ min: 0 })
      .withMessage('buildNumber must be a non-negative integer'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('유효하지 않은 요청 파라미터입니다.', 400, errors.array());
      }

      const { projectName, version, buildNumber } = req.query;
      const deploymentPathService = getDeploymentPathService();

      const deleted = await deploymentPathService.deleteDeploymentPath(
        projectName,
        version,
        parseInt(buildNumber),
      );

      res.json({
        success: true,
        data: {
          deleted,
          projectName,
          version,
          buildNumber,
          message: deleted ?
            '캐시가 성공적으로 삭제되었습니다.' :
            '삭제할 캐시를 찾을 수 없습니다.',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /api/deployments/{version}/{buildNumber}/artifacts:
 *   get:
 *     tags:
 *       - Deployments
 *     summary: 특정 배포의 아티팩트 정보 조회
 *     description: 지연 로딩을 위한 개별 배포의 아티팩트 정보를 조회합니다.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: version
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: 배포 버전
 *       - name: buildNumber
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: 빌드 번호
 *     responses:
 *       200:
 *         description: 아티팩트 정보 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     artifacts:
 *                       type: array
 *                       items:
 *                         type: object
 *                     buildNumber:
 *                       type: integer
 *                     version:
 *                       type: string
 *                     cached:
 *                       type: boolean
 *       404:
 *         description: 배포를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.get(
  '/:version/:buildNumber/artifacts',
  async (req, res, next) => {
    try {
      const { version, buildNumber } = req.params;
      const nasService = getNASService();

      logger.info(`아티팩트 조회 요청 - 사용자: ${req.user.username}, 버전: ${version}, 빌드: ${buildNumber}`);

      // NAS에서 해당 버전의 아티팩트 검색
      const artifacts = await nasService.searchFinalArtifactsByVersion(version);

      res.json({
        success: true,
        data: {
          artifacts: artifacts || [],
          buildNumber: parseInt(buildNumber),
          version: version,
          cached: false, // 실시간 조회이므로 캐시되지 않음
          timestamp: new Date().toISOString(),
        },
      });

      logger.info(`아티팩트 조회 완료 - 버전: ${version}, 빌드: ${buildNumber}, 아티팩트 수: ${artifacts?.length || 0}`);

    } catch (error) {
      logger.error(`아티팩트 조회 실패 - 버전: ${req.params.version}, 빌드: ${req.params.buildNumber}, 오류: ${error.message}`);
      next(error);
    }
  },
);

module.exports = router;
