const express = require('express');
const { query } = require('../config/database');
const router = express.Router();

/**
 * Health check endpoint
 * Returns the health status of the application and its dependencies
 */
router.get('/', async (req, res) => {
  const healthCheck = {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    status: 'healthy',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    checks: {
      database: 'unknown',
      memory: 'unknown',
      disk: 'unknown'
    }
  };

  try {
    // Database health check
    try {
      await query('SELECT 1');
      healthCheck.checks.database = 'healthy';
    } catch (error) {
      healthCheck.checks.database = 'unhealthy';
      healthCheck.status = 'degraded';
    }

    // Memory health check
    const memUsage = process.memoryUsage();
    const memUsedMB = memUsage.heapUsed / 1024 / 1024;
    const memTotalMB = memUsage.heapTotal / 1024 / 1024;
    const memUsagePercent = (memUsedMB / memTotalMB) * 100;

    healthCheck.checks.memory = {
      status: memUsagePercent < 90 ? 'healthy' : 'warning',
      used: `${memUsedMB.toFixed(2)} MB`,
      total: `${memTotalMB.toFixed(2)} MB`,
      percentage: `${memUsagePercent.toFixed(2)}%`
    };

    if (memUsagePercent >= 95) {
      healthCheck.status = 'unhealthy';
    } else if (memUsagePercent >= 85) {
      healthCheck.status = 'degraded';
    }

    // Set HTTP status code based on health
    const statusCode = healthCheck.status === 'healthy' ? 200 :
                      healthCheck.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json({
      success: true,
      data: healthCheck
    });

  } catch (error) {
    console.error('Health check error:', error);

    healthCheck.status = 'unhealthy';
    healthCheck.error = 'Health check failed';

    res.status(503).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Application health check failed'
      },
      data: healthCheck
    });
  }
});

/**
 * Readiness probe endpoint
 * Returns 200 when the application is ready to serve traffic
 */
router.get('/ready', async (req, res) => {
  try {
    // Check database connectivity
    await query('SELECT 1');

    res.status(200).json({
      success: true,
      message: 'Application is ready',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Readiness check failed:', error);

    res.status(503).json({
      success: false,
      error: {
        code: 'NOT_READY',
        message: 'Application is not ready to serve traffic'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Liveness probe endpoint
 * Returns 200 when the application is alive
 */
router.get('/live', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Application is alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Metrics endpoint (basic)
 * Returns basic application metrics
 */
router.get('/metrics', (req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid,
    platform: process.platform,
    nodeVersion: process.version
  };

  res.status(200).json({
    success: true,
    data: metrics
  });
});

module.exports = router;