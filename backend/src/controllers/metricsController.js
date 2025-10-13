const { getMetricsService } = require('../services/metricsService');
const logger = require('../config/logger');

/**
 * Get metrics summary
 * @swagger
 * /api/metrics:
 *   get:
 *     summary: Get basic metrics summary
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Metrics summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uptime:
 *                   type: string
 *                   description: Service uptime
 *                 totalRequests:
 *                   type: number
 *                   description: Total requests processed
 *                 successfulRequests:
 *                   type: number
 *                   description: Number of successful requests
 *                 failedRequests:
 *                   type: number
 *                   description: Number of failed requests
 *                 successRate:
 *                   type: string
 *                   description: Success rate percentage
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
const getMetrics = async (req, res) => {
  try {
    const metricsService = getMetricsService();
    const summary = metricsService.getMetricsSummary();

    logger.debug('Metrics summary requested', {
      requestId: req.id,
      userId: req.user?.username,
      uptime: summary.uptime,
      totalRequests: summary.totalRequests,
    });

    res.json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get metrics summary', {
      error: error.message,
      errorStack: error.stack,
      requestId: req.id,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve metrics',
      message: error.message,
    });
  }
};

/**
 * Reset metrics
 * @swagger
 * /api/metrics/reset:
 *   post:
 *     summary: Reset all metrics counters
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Metrics reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
const resetMetrics = async (req, res) => {
  try {
    const metricsService = getMetricsService();

    logger.info('Metrics reset requested', {
      requestId: req.id,
      userId: req.user?.username,
      timestamp: new Date().toISOString(),
    });

    metricsService.resetMetrics();

    res.json({
      success: true,
      message: 'Metrics reset successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to reset metrics', {
      error: error.message,
      errorStack: error.stack,
      requestId: req.id,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to reset metrics',
      message: error.message,
    });
  }
};

/**
 * Get health status with metrics
 * @swagger
 * /api/metrics/health:
 *   get:
 *     summary: Get health status with key metrics
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Health status with metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy]
 *                 metrics:
 *                   type: object
 *                   description: Key health metrics
 *                 alerts:
 *                   type: array
 *                   description: Active alerts based on metrics
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
const getHealthWithMetrics = async (req, res) => {
  try {
    const metricsService = getMetricsService();
    const summary = metricsService.getMetricsSummary();

    // Determine health status based on metrics
    let status = 'healthy';
    const alerts = [];

    const successRate = parseFloat(summary.successRate);

    if (summary.totalRequests > 10) {
      if (successRate < 90) {
        status = 'unhealthy';
        alerts.push({
          level: 'critical',
          message: `Low success rate: ${summary.successRate}`,
          metric: 'successRate',
          value: summary.successRate,
          threshold: '90%',
        });
      } else if (successRate < 95) {
        status = 'degraded';
        alerts.push({
          level: 'warning',
          message: `Degraded success rate: ${summary.successRate}`,
          metric: 'successRate',
          value: summary.successRate,
          threshold: '95%',
        });
      }
    }

    const healthData = {
      status,
      metrics: {
        uptime: summary.uptime,
        totalRequests: summary.totalRequests,
        successfulRequests: summary.successfulRequests,
        failedRequests: summary.failedRequests,
        successRate: summary.successRate,
      },
      alerts,
      timestamp: new Date().toISOString(),
    };

    logger.debug('Health check with metrics performed', {
      requestId: req.id,
      status,
      alertCount: alerts.length,
      totalRequests: summary.totalRequests,
    });

    res.json({
      success: true,
      data: healthData,
    });
  } catch (error) {
    logger.error('Failed to get health status with metrics', {
      error: error.message,
      errorStack: error.stack,
      requestId: req.id,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve health status',
      message: error.message,
    });
  }
};

module.exports = {
  getMetrics,
  resetMetrics,
  getHealthWithMetrics,
};
