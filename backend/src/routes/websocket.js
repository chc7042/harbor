const express = require('express');
const router = express.Router();
const websocketManager = require('../services/websocketManager');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../config/logger');

/**
 * @swagger
 * tags:
 *   name: WebSocket
 *   description: WebSocket 관리 API
 */

/**
 * @swagger
 * /api/ws/stats:
 *   get:
 *     summary: WebSocket 연결 통계 조회
 *     tags: [WebSocket]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: WebSocket 연결 통계
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
 *                     connectedClients:
 *                       type: number
 *                     roomStats:
 *                       type: object
 *                     clients:
 *                       type: array
 *                       items:
 *                         type: object
 */
router.get('/stats', authenticateToken, (req, res) => {
  try {
    const connectedClients = websocketManager.getConnectedClients();
    const roomStats = websocketManager.getRoomStats();

    res.json({
      success: true,
      data: {
        connectedClients: connectedClients.length,
        roomStats,
        clients: connectedClients.map(client => ({
          id: client.id,
          username: client.username,
          subscriptions: client.subscriptions,
          connectedAt: client.connectedAt,
          status: client.status
        }))
      }
    });
  } catch (error) {
    logger.error('Failed to get WebSocket stats:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'WebSocket 통계 조회 실패',
        code: 'WEBSOCKET_STATS_ERROR'
      }
    });
  }
});

/**
 * @swagger
 * /api/ws/broadcast/deployment:
 *   post:
 *     summary: 배포 업데이트 브로드캐스트
 *     tags: [WebSocket]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deploymentData
 *             properties:
 *               deploymentData:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: number
 *                   project_name:
 *                     type: string
 *                   build_number:
 *                     type: number
 *                   status:
 *                     type: string
 *                     enum: [pending, in_progress, success, failed]
 *                   environment:
 *                     type: string
 *                   deployed_by:
 *                     type: string
 *                   branch:
 *                     type: string
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                   duration:
 *                     type: number
 *     responses:
 *       200:
 *         description: 브로드캐스트 성공
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */
router.post('/broadcast/deployment', authenticateToken, (req, res) => {
  try {
    const { deploymentData } = req.body;

    if (!deploymentData) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'deploymentData is required',
          code: 'MISSING_DEPLOYMENT_DATA'
        }
      });
    }

    // 필수 필드 검증
    const requiredFields = ['id', 'project_name', 'status'];
    const missingFields = requiredFields.filter(field => !deploymentData[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          message: `Missing required fields: ${missingFields.join(', ')}`,
          code: 'MISSING_REQUIRED_FIELDS'
        }
      });
    }

    // 배포 업데이트 브로드캐스트
    websocketManager.broadcastDeploymentUpdate(deploymentData);

    logger.info(`Deployment update broadcasted: ${deploymentData.project_name} #${deploymentData.build_number || 'N/A'}`);

    res.json({
      success: true,
      data: {
        message: 'Deployment update broadcasted successfully',
        deployment: deploymentData
      }
    });
  } catch (error) {
    logger.error('Failed to broadcast deployment update:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '배포 업데이트 브로드캐스트 실패',
        code: 'BROADCAST_ERROR'
      }
    });
  }
});

/**
 * @swagger
 * /api/ws/broadcast/system:
 *   post:
 *     summary: 시스템 알림 브로드캐스트
 *     tags: [WebSocket]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - notification
 *             properties:
 *               notification:
 *                 type: object
 *                 properties:
 *                   title:
 *                     type: string
 *                   message:
 *                     type: string
 *                   type:
 *                     type: string
 *                     enum: [info, success, warning, error]
 *                   showBrowserNotification:
 *                     type: boolean
 *                   targetRooms:
 *                     type: array
 *                     items:
 *                       type: string
 *     responses:
 *       200:
 *         description: 브로드캐스트 성공
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */
router.post('/broadcast/system', authenticateToken, (req, res) => {
  try {
    const { notification } = req.body;

    if (!notification) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'notification is required',
          code: 'MISSING_NOTIFICATION'
        }
      });
    }

    if (!notification.message) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'notification.message is required',
          code: 'MISSING_MESSAGE'
        }
      });
    }

    // 기본값 설정
    const systemNotification = {
      title: notification.title || 'Harbor 알림',
      message: notification.message,
      type: notification.type || 'info',
      showBrowserNotification: notification.showBrowserNotification ?? true,
      timestamp: new Date().toISOString(),
      sender: req.user.username
    };

    // 대상 룸이 지정된 경우 해당 룸에만 브로드캐스트
    if (notification.targetRooms && Array.isArray(notification.targetRooms)) {
      notification.targetRooms.forEach(room => {
        websocketManager.broadcast(room, {
          type: 'system_notification',
          data: systemNotification
        });
      });
    } else {
      // 전역 브로드캐스트
      websocketManager.broadcastSystemNotification(systemNotification);
    }

    logger.info(`System notification broadcasted by ${req.user.username}: ${notification.message}`);

    res.json({
      success: true,
      data: {
        message: 'System notification broadcasted successfully',
        notification: systemNotification
      }
    });
  } catch (error) {
    logger.error('Failed to broadcast system notification:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '시스템 알림 브로드캐스트 실패',
        code: 'BROADCAST_ERROR'
      }
    });
  }
});

/**
 * @swagger
 * /api/ws/test/deployment:
 *   post:
 *     summary: 테스트 배포 업데이트 전송
 *     tags: [WebSocket]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 테스트 메시지 전송 성공
 */
router.post('/test/deployment', authenticateToken, (req, res) => {
  try {
    const testDeployment = {
      id: Date.now(),
      project_name: 'test-project',
      build_number: Math.floor(Math.random() * 1000),
      status: ['success', 'failed', 'in_progress'][Math.floor(Math.random() * 3)],
      environment: 'development',
      deployed_by: req.user.username,
      branch: 'main',
      created_at: new Date().toISOString(),
      duration: Math.floor(Math.random() * 300) + 30
    };

    websocketManager.broadcastDeploymentUpdate(testDeployment);

    res.json({
      success: true,
      data: {
        message: 'Test deployment update sent',
        deployment: testDeployment
      }
    });
  } catch (error) {
    logger.error('Failed to send test deployment update:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '테스트 배포 업데이트 전송 실패',
        code: 'TEST_ERROR'
      }
    });
  }
});

/**
 * @swagger
 * /api/ws/test/notification:
 *   post:
 *     summary: 테스트 시스템 알림 전송
 *     tags: [WebSocket]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 테스트 알림 전송 성공
 */
router.post('/test/notification', authenticateToken, (req, res) => {
  try {
    const testNotification = {
      title: '테스트 알림',
      message: '이것은 테스트 시스템 알림입니다.',
      type: 'info',
      showBrowserNotification: true
    };

    websocketManager.broadcastSystemNotification(testNotification);

    res.json({
      success: true,
      data: {
        message: 'Test notification sent',
        notification: testNotification
      }
    });
  } catch (error) {
    logger.error('Failed to send test notification:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '테스트 알림 전송 실패',
        code: 'TEST_ERROR'
      }
    });
  }
});

module.exports = router;