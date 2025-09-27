const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, header, validationResult } = require('express-validator');
const { getJenkinsWebhookService } = require('../services/jenkinsWebhook');
const { AppError } = require('../middleware/error');
const logger = require('../config/logger');

const router = express.Router();

// Webhook 수신 제한 (1분당 100회)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 100,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_WEBHOOK_REQUESTS',
      message: 'Webhook 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Jenkins 서버별로 제한 적용
    return req.get('X-Forwarded-For') || req.ip;
  },
});

// Raw body 파싱을 위한 미들웨어
const rawBodyParser = express.raw({
  type: ['application/json', 'application/x-www-form-urlencoded'],
  limit: '1mb'
});

/**
 * @swagger
 * /api/webhooks/jenkins:
 *   post:
 *     tags:
 *       - Webhooks
 *     summary: Jenkins Webhook 수신
 *     description: Jenkins에서 전송되는 빌드/배포 이벤트를 수신하고 처리
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_name:
 *                 type: string
 *                 description: 프로젝트명
 *                 example: "harbor-frontend"
 *               build_number:
 *                 type: integer
 *                 description: 빌드 번호
 *                 example: 42
 *               status:
 *                 type: string
 *                 enum: [SUCCESS, FAILURE, ABORTED, UNSTABLE, BUILDING, PENDING]
 *                 description: 빌드 상태
 *                 example: "SUCCESS"
 *               branch:
 *                 type: string
 *                 description: Git 브랜치
 *                 example: "main"
 *               commit_hash:
 *                 type: string
 *                 description: 커밋 해시
 *                 example: "abc123def456"
 *               started_at:
 *                 type: string
 *                 format: date-time
 *                 description: 빌드 시작 시간
 *               completed_at:
 *                 type: string
 *                 format: date-time
 *                 description: 빌드 완료 시간
 *               duration:
 *                 type: integer
 *                 description: 빌드 소요 시간 (초)
 *                 example: 300
 *               jenkins_url:
 *                 type: string
 *                 format: uri
 *                 description: Jenkins 빌드 URL
 *                 example: "https://jenkins.roboetech.com/job/harbor-frontend/42/"
 *               triggered_by:
 *                 type: string
 *                 description: 빌드 트리거 사용자
 *                 example: "nicolas.choi"
 *     parameters:
 *       - in: header
 *         name: X-Jenkins-Event
 *         schema:
 *           type: string
 *         description: Jenkins 이벤트 타입
 *       - in: header
 *         name: X-Hub-Signature-256
 *         schema:
 *           type: string
 *         description: Webhook 서명 (HMAC-SHA256)
 *     responses:
 *       200:
 *         description: Webhook 처리 성공
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
 *                   example: "Webhook processed successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     deployment:
 *                       $ref: '#/components/schemas/Deployment'
 *                     eventType:
 *                       type: string
 *                       example: "build.completed"
 *       400:
 *         description: 잘못된 Webhook 데이터
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Webhook 서명 검증 실패
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: 요청 횟수 초과
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
router.post('/jenkins',
  webhookLimiter,
  rawBodyParser,
  async (req, res, next) => {
    try {
      const signature = req.get('X-Hub-Signature-256') || req.get('X-Hub-Signature');
      const eventType = req.get('X-Jenkins-Event') || 'unknown';
      const userAgent = req.get('User-Agent') || 'Unknown';
      const forwardedFor = req.get('X-Forwarded-For');

      logger.info(`Received Jenkins webhook: ${eventType} from ${forwardedFor || req.ip}`);

      // Raw body를 문자열로 변환
      const payload = req.body.toString('utf8');

      if (!payload) {
        throw new AppError('Empty webhook payload', 400);
      }

      // Webhook 서비스를 통해 처리
      const webhookService = getJenkinsWebhookService();
      const result = await webhookService.processWebhook(payload, signature, {
        'x-jenkins-event': eventType,
        'user-agent': userAgent
      });

      res.json({
        success: true,
        message: 'Webhook processed successfully',
        data: {
          deployment: result.deployment,
          eventType: result.eventType
        }
      });

    } catch (error) {
      logger.error('Jenkins webhook processing failed:', {
        error: error.message,
        stack: error.stack,
        headers: req.headers,
        ip: req.ip
      });

      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'WEBHOOK_ERROR',
            message: error.message,
            timestamp: new Date().toISOString()
          }
        });
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error occurred',
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

/**
 * @swagger
 * /api/webhooks/jenkins/status:
 *   get:
 *     tags:
 *       - Webhooks
 *     summary: Jenkins Webhook 상태 확인
 *     description: Jenkins Webhook 서비스의 현재 상태와 통계 정보 조회
 *     responses:
 *       200:
 *         description: Webhook 상태 조회 성공
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
 *                     status:
 *                       type: string
 *                       example: "active"
 *                     secretConfigured:
 *                       type: boolean
 *                       example: true
 *                     supportedEvents:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["job.started", "job.completed", "build.started"]
 *                     stats:
 *                       type: object
 *                       properties:
 *                         totalWebhooks:
 *                           type: integer
 *                           description: 총 Webhook 수신 수 (24시간)
 *                         successfulDeployments:
 *                           type: integer
 *                           description: 성공한 배포 수
 *                         failedDeployments:
 *                           type: integer
 *                           description: 실패한 배포 수
 *                         recentWebhooks:
 *                           type: integer
 *                           description: 최근 1시간 Webhook 수
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       500:
 *         description: 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/jenkins/status', async (req, res, next) => {
  try {
    const webhookService = getJenkinsWebhookService();
    const status = await webhookService.getWebhookStatus();

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Failed to get webhook status:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/webhooks/jenkins/test:
 *   post:
 *     tags:
 *       - Webhooks
 *     summary: Jenkins Webhook 테스트
 *     description: Jenkins Webhook 처리를 테스트하기 위한 모의 이벤트 전송
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_name:
 *                 type: string
 *                 example: "test-project"
 *               build_number:
 *                 type: integer
 *                 example: 1
 *               status:
 *                 type: string
 *                 example: "SUCCESS"
 *     responses:
 *       200:
 *         description: 테스트 성공
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
 *                   example: "Test webhook processed successfully"
 *                 data:
 *                   type: object
 */
router.post('/jenkins/test', async (req, res, next) => {
  try {
    // 개발환경에서만 테스트 허용
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Test webhooks are not allowed in production', 403);
    }

    const testData = {
      project_name: req.body.project_name || 'test-project',
      build_number: req.body.build_number || Date.now(),
      status: req.body.status || 'SUCCESS',
      branch: req.body.branch || 'main',
      commit_hash: req.body.commit_hash || 'test123',
      started_at: new Date(Date.now() - 300000), // 5분 전
      completed_at: new Date(),
      duration: 300,
      jenkins_url: req.body.jenkins_url || 'https://jenkins.example.com/job/test/1/',
      triggered_by: req.body.triggered_by || 'test-user',
      environment: req.body.environment || 'development'
    };

    const webhookService = getJenkinsWebhookService();
    const result = await webhookService.processWebhook(
      JSON.stringify(testData),
      null, // 테스트에서는 서명 없음
      { 'x-jenkins-event': 'test.webhook' }
    );

    res.json({
      success: true,
      message: 'Test webhook processed successfully',
      data: {
        deployment: result.deployment,
        eventType: 'test.webhook'
      }
    });

  } catch (error) {
    logger.error('Test webhook failed:', error.message);
    next(error);
  }
});

/**
 * @swagger
 * /api/webhooks/jenkins/config:
 *   get:
 *     tags:
 *       - Webhooks
 *     summary: Jenkins Webhook 설정 정보
 *     description: Jenkins에서 설정해야 할 Webhook URL과 설정 가이드 제공
 *     responses:
 *       200:
 *         description: 설정 정보 조회 성공
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
 *                     webhookUrl:
 *                       type: string
 *                       example: "https://api.harbor.roboetech.com/api/webhooks/jenkins"
 *                     secretRequired:
 *                       type: boolean
 *                       example: true
 *                     supportedMethods:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["POST"]
 *                     recommendedEvents:
 *                       type: array
 *                       items:
 *                         type: string
 *                     setupInstructions:
 *                       type: string
 */
router.get('/jenkins/config', (req, res) => {
  const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3003}`;

  res.json({
    success: true,
    data: {
      webhookUrl: `${baseUrl}/api/webhooks/jenkins`,
      testUrl: `${baseUrl}/api/webhooks/jenkins/test`,
      statusUrl: `${baseUrl}/api/webhooks/jenkins/status`,
      secretRequired: !!process.env.JENKINS_WEBHOOK_SECRET,
      supportedMethods: ['POST'],
      supportedContentTypes: ['application/json', 'application/x-www-form-urlencoded'],
      recommendedEvents: [
        'job.started',
        'job.completed',
        'job.finalized',
        'build.started',
        'build.completed'
      ],
      setupInstructions: `
1. Jenkins에서 'Generic Webhook Trigger' 플러그인 설치
2. Job 설정에서 'Build Triggers' 섹션으로 이동
3. 'Generic Webhook Trigger' 체크
4. Webhook URL: ${baseUrl}/api/webhooks/jenkins
5. HTTP Method: POST
6. Content Type: application/json
${process.env.JENKINS_WEBHOOK_SECRET ? '7. Secret Token 설정: [환경변수에서 설정됨]' : '7. Secret Token: [선택사항]'}
8. 필요한 변수들을 JSON으로 전송하도록 설정
      `.trim()
    }
  });
});

module.exports = router;