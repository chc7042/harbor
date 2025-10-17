const express = require('express');
const { getJenkinsService } = require('../services/jenkinsService');
const logger = require('../config/logger');

const router = express.Router();

// 인증 미들웨어 제거됨 - 간소화된 LDAP 인증 사용

/**
 * @swagger
 * components:
 *   schemas:
 *     JenkinsJob:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Job name
 *         url:
 *           type: string
 *           description: Job URL
 *         buildable:
 *           type: boolean
 *           description: Whether job is buildable
 *         lastBuild:
 *           $ref: '#/components/schemas/JenkinsBuild'
 *         projectFolder:
 *           type: string
 *           description: Project folder name
 *         fullJobName:
 *           type: string
 *           description: Full job name including folder path
 *     JenkinsBuild:
 *       type: object
 *       properties:
 *         number:
 *           type: integer
 *           description: Build number
 *         url:
 *           type: string
 *           description: Build URL
 *         result:
 *           type: string
 *           enum: [SUCCESS, FAILURE, ABORTED, UNSTABLE]
 *           description: Build result
 *         timestamp:
 *           type: integer
 *           description: Build timestamp
 *         duration:
 *           type: integer
 *           description: Build duration in milliseconds
 *         displayName:
 *           type: string
 *           description: Build display name
 */

/**
 * @swagger
 * /api/jenkins/health:
 *   get:
 *     tags:
 *       - Jenkins
 *     summary: Jenkins 서버 상태 확인
 *     description: Jenkins 서버의 현재 상태 및 연결 상태 확인
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Jenkins 서버 상태
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
 *                     status:
 *                       type: string
 *                       enum: [healthy, unhealthy]
 *                     version:
 *                       type: string
 *                     mode:
 *                       type: string
 *                     nodeDescription:
 *                       type: string
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.get('/health', async (req, res) => {
  try {
    const jenkinsService = getJenkinsService();
    const healthStatus = await jenkinsService.healthCheck();
    
    res.json({
      success: true,
      data: healthStatus
    });
  } catch (error) {
    logger.error('Jenkins health check failed:', error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'JENKINS_HEALTH_CHECK_FAILED',
        message: 'Jenkins 상태 확인에 실패했습니다.',
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/jenkins/jobs:
 *   get:
 *     tags:
 *       - Jenkins
 *     summary: Jenkins 작업 목록 조회
 *     description: 모든 Jenkins 작업 목록을 조회합니다
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Jenkins 작업 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/JenkinsJob'
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.get('/jobs', async (req, res) => {
  try {
    const jenkinsService = getJenkinsService();
    const jobs = await jenkinsService.getJobs();
    
    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    logger.error('Failed to fetch Jenkins jobs:', error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'JENKINS_JOBS_FETCH_FAILED',
        message: 'Jenkins 작업 목록을 가져올 수 없습니다.',
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/jenkins/jobs/all:
 *   get:
 *     tags:
 *       - Jenkins
 *     summary: 모든 Jenkins 작업 조회 (재귀적)
 *     description: 폴더 구조를 포함하여 모든 Jenkins 작업을 재귀적으로 조회합니다
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 모든 Jenkins 작업 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/JenkinsJob'
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.get('/jobs/all', async (req, res) => {
  try {
    const jenkinsService = getJenkinsService();
    const jobs = await jenkinsService.getAllJobs();
    
    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    logger.error('Failed to fetch all Jenkins jobs:', error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'JENKINS_ALL_JOBS_FETCH_FAILED',
        message: '전체 Jenkins 작업 목록을 가져올 수 없습니다.',
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/jenkins/jobs/{jobName}/builds:
 *   get:
 *     tags:
 *       - Jenkins
 *     summary: 특정 작업의 빌드 목록 조회
 *     description: 지정된 Jenkins 작업의 빌드 목록을 조회합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Jenkins 작업 이름
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: 조회할 빌드 수 제한
 *     responses:
 *       200:
 *         description: 빌드 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/JenkinsBuild'
 *       401:
 *         description: 인증 실패
 *       404:
 *         description: 작업을 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.get('/jobs/:jobName/builds', async (req, res) => {
  try {
    const { jobName } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    
    const jenkinsService = getJenkinsService();
    const builds = await jenkinsService.getJobBuilds(jobName, limit);
    
    res.json({
      success: true,
      data: builds
    });
  } catch (error) {
    logger.error(`Failed to fetch builds for job ${req.params.jobName}:`, error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'JENKINS_BUILDS_FETCH_FAILED',
        message: `작업 ${req.params.jobName}의 빌드 목록을 가져올 수 없습니다.`,
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/jenkins/jobs/{jobName}/builds/{buildNumber}:
 *   get:
 *     tags:
 *       - Jenkins
 *     summary: 특정 빌드 상세 정보 조회
 *     description: 지정된 Jenkins 빌드의 상세 정보를 조회합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Jenkins 작업 이름
 *       - in: path
 *         name: buildNumber
 *         required: true
 *         schema:
 *           type: integer
 *         description: 빌드 번호
 *     responses:
 *       200:
 *         description: 빌드 상세 정보
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/JenkinsBuild'
 *       401:
 *         description: 인증 실패
 *       404:
 *         description: 빌드를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.get('/jobs/:jobName/builds/:buildNumber', async (req, res) => {
  try {
    const { jobName, buildNumber } = req.params;
    
    const jenkinsService = getJenkinsService();
    const buildDetails = await jenkinsService.getBuildDetails(jobName, parseInt(buildNumber));
    
    res.json({
      success: true,
      data: buildDetails
    });
  } catch (error) {
    logger.error(`Failed to fetch build details for ${req.params.jobName}#${req.params.buildNumber}:`, error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'JENKINS_BUILD_DETAILS_FETCH_FAILED',
        message: `빌드 ${req.params.jobName}#${req.params.buildNumber}의 상세 정보를 가져올 수 없습니다.`,
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/jenkins/jobs/{jobName}/builds/{buildNumber}/log:
 *   get:
 *     tags:
 *       - Jenkins
 *     summary: 빌드 로그 조회
 *     description: 지정된 Jenkins 빌드의 콘솔 로그를 조회합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Jenkins 작업 이름
 *       - in: path
 *         name: buildNumber
 *         required: true
 *         schema:
 *           type: integer
 *         description: 빌드 번호
 *     responses:
 *       200:
 *         description: 빌드 로그
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       timestamp:
 *                         type: string
 *                       level:
 *                         type: string
 *                       message:
 *                         type: string
 *                       lineNumber:
 *                         type: integer
 *       401:
 *         description: 인증 실패
 *       404:
 *         description: 빌드를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.get('/jobs/:jobName/builds/:buildNumber/log', async (req, res) => {
  try {
    const { jobName, buildNumber } = req.params;
    
    const jenkinsService = getJenkinsService();
    const buildLog = await jenkinsService.getBuildLog(jobName, parseInt(buildNumber));
    
    res.json({
      success: true,
      data: buildLog
    });
  } catch (error) {
    logger.error(`Failed to fetch build log for ${req.params.jobName}#${req.params.buildNumber}:`, error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'JENKINS_BUILD_LOG_FETCH_FAILED',
        message: `빌드 ${req.params.jobName}#${req.params.buildNumber}의 로그를 가져올 수 없습니다.`,
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/jenkins/recent:
 *   get:
 *     tags:
 *       - Jenkins
 *     summary: 최근 빌드 목록 조회
 *     description: 최근 지정된 시간 내의 빌드 목록을 조회합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: hours
 *         schema:
 *           type: integer
 *         description: 조회할 시간 범위 (시간). null이면 시간 제한 없음
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: 조회할 최대 빌드 수
 *     responses:
 *       200:
 *         description: 최근 빌드 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/JenkinsBuild'
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.get('/recent', async (req, res) => {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours) : null;
    const limit = parseInt(req.query.limit) || 50;
    
    const jenkinsService = getJenkinsService();
    const recentBuilds = await jenkinsService.getRecentBuilds(hours, limit);
    
    res.json({
      success: true,
      data: recentBuilds
    });
  } catch (error) {
    logger.error('Failed to fetch recent builds:', error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'JENKINS_RECENT_BUILDS_FETCH_FAILED',
        message: '최근 빌드 목록을 가져올 수 없습니다.',
        details: error.message
      }
    });
  }
});

/**
 * @swagger
 * /api/jenkins/jobs/{jobName}/trigger:
 *   post:
 *     tags:
 *       - Jenkins
 *     summary: 빌드 트리거
 *     description: 지정된 Jenkins 작업의 빌드를 트리거합니다
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Jenkins 작업 이름
 *     requestBody:
 *       description: 빌드 매개변수 (선택사항)
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: 빌드 트리거 성공
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
 *                     jobName:
 *                       type: string
 *                     queueId:
 *                       type: string
 *                     message:
 *                       type: string
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
router.post('/jobs/:jobName/trigger', async (req, res) => {
  try {
    const { jobName } = req.params;
    const parameters = req.body || {};
    
    const jenkinsService = getJenkinsService();
    const result = await jenkinsService.triggerBuild(jobName, parameters);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error(`Failed to trigger build for job ${req.params.jobName}:`, error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'JENKINS_BUILD_TRIGGER_FAILED',
        message: `작업 ${req.params.jobName}의 빌드 트리거에 실패했습니다.`,
        details: error.message
      }
    });
  }
});

module.exports = router;