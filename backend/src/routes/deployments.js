const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { body, query, param, validationResult } = require('express-validator');
const { AppError } = require('../middleware/error');
const logger = require('../config/logger');
const { getJenkinsService } = require('../services/jenkinsService');
const { getNASService } = require('../services/nasService');

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
              group.mrJob?.name === job.name || group.fsJob?.name === job.name
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

        // 아티팩트 정보 추가하여 응답 데이터 변환
        const deployments = await Promise.all(paginatedBuilds.map(async (build) => {
          let artifacts = [];

          // 성공한 배포에 대해서만 최종 아티팩트 (V1.2.0_XXX.tar) 검색
          if (build.status === 'success' || build.status === 'SUCCESS') {
            try {
              const nasService = getNASService();

              // 버전 그룹인 경우 최종 아티팩트 검색
              if (build.subJobs && build.subJobs.length > 0) {
                // V1.2.0_XXX.tar 형태의 최종 아티팩트 검색
                const version = build.version || build.projectName;
                artifacts = await nasService.searchFinalArtifactsByVersion(version);
                logger.info(`Found ${artifacts.length} final artifacts for version ${version}`);
              } else {
                // 개별 잡인 경우 기존 로직 유지
                const versionMatch = build.projectName.match(/(\d+\.\d+\.\d+)/);
                if (versionMatch) {
                  const version = versionMatch[1];
                  const prefixMatch = build.projectName.match(/\/([a-z]+)\d+\.\d+\.\d+/);
                  const prefix = prefixMatch ? prefixMatch[1] : null;

                  artifacts = await nasService.searchArtifactsByVersion(version, prefix);
                  logger.info(`Found ${artifacts.length} artifacts for ${build.projectName} version ${version} with prefix ${prefix}`);
                } else {
                  artifacts = await nasService.searchArtifactsFromBuildLog(build.projectName, build.buildNumber);
                  logger.info(`Found ${artifacts.length} artifacts from build log for ${build.projectName}#${build.buildNumber}`);
                }
              }
            } catch (error) {
              logger.warn(`Failed to fetch artifacts for ${build.projectName}:`, error.message);
              artifacts = [];
            }
          }

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
            branch: build.parameters?.BRANCH_NAME || build.parameters?.GIT_BRANCH || 'main',
            commitHash: build.changes?.length > 0 ? build.changes[0].commitId : null,
            commitMessage: build.changes?.length > 0 ? build.changes[0].message : null,
            subJobs: build.subJobs || [],
            artifacts: artifacts.filter(artifact => artifact.verified).map(artifact => ({
              name: artifact.filename,
              size: artifact.fileSize,
              downloadUrl: `/api/files/download?path=${encodeURIComponent('/nas/release_version/' + artifact.nasPath)}`,
              lastModified: artifact.lastModified,
            })),
          };
        }));

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
    query('hours').optional().isInt({ min: 1, max: 720 }).withMessage('시간은 1-720 사이여야 합니다'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('한 페이지당 항목 수는 1-100 사이여야 합니다'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('유효하지 않은 요청 파라미터입니다.', 400, errors.array());
      }

      const { hours = 24, limit = 20 } = req.query;

      const jenkinsService = getJenkinsService();

      try {
        // Jenkins에서 최근 빌드 조회
        const recentBuilds = await jenkinsService.getRecentBuilds(parseInt(hours), parseInt(limit));

        const recentDeployments = recentBuilds.map(build => ({
          id: build.id,
          projectName: build.projectName,
          environment: determineEnvironment(build.projectName, build.parameters),
          version: build.parameters?.VERSION || build.parameters?.TAG || `build-${build.buildNumber}`,
          status: build.status,
          deployedBy: build.changes.length > 0 ? build.changes[0].author : 'Jenkins',
          deployedAt: build.timestamp,
          duration: build.duration,
          buildNumber: build.buildNumber,
          jenkinsUrl: build.url,
          branch: build.parameters?.BRANCH_NAME || build.parameters?.GIT_BRANCH || 'main',
          commitHash: build.changes.length > 0 ? build.changes[0].commitId : null,
          commitMessage: build.changes.length > 0 ? build.changes[0].message : null,
        }));

        logger.info(`최근 배포 목록 조회 - 사용자: ${req.user.username}, 시간: ${hours}h, Jenkins 데이터: ${recentDeployments.length}개`);

        res.json({
          success: true,
          data: recentDeployments,
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

        res.json({
          success: true,
          data: mockRecentDeployments,
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
          fsJob: null
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
      duration = (latestMrBuild.duration || 0) + (latestFsBuild.duration || 0);
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
        order: 1
      });
    }
    if (latestFsBuild) {
      subJobs.push({
        name: jobGroup.fsJob.name,
        status: latestFsBuild.status,
        buildNumber: latestFsBuild.buildNumber,
        timestamp: latestFsBuild.timestamp,
        duration: latestFsBuild.duration,
        order: 2
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
      subJobs: subJobs
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

module.exports = router;
