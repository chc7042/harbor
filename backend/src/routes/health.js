const express = require('express');
const { query } = require('../config/database');
const { getJenkinsService } = require('../services/jenkinsService');
const { getDeploymentPathService } = require('../services/deploymentPathService');
const { getAlertingService } = require('../services/alertingService');
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
      disk: 'unknown',
      deploymentPathDetection: 'unknown',
    },
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
      percentage: `${memUsagePercent.toFixed(2)}%`,
    };

    if (memUsagePercent >= 95) {
      healthCheck.status = 'unhealthy';
    } else if (memUsagePercent >= 85) {
      healthCheck.status = 'degraded';
    }

    // Deployment path detection health check
    try {
      const pathDetectionHealth = await checkDeploymentPathDetectionHealth();
      healthCheck.checks.deploymentPathDetection = pathDetectionHealth;

      if (pathDetectionHealth.status === 'unhealthy') {
        healthCheck.status = 'degraded';
      } else if (pathDetectionHealth.status === 'warning' && healthCheck.status === 'healthy') {
        healthCheck.status = 'degraded';
      }
    } catch (error) {
      healthCheck.checks.deploymentPathDetection = {
        status: 'unhealthy',
        error: 'Health check failed',
        message: error.message,
      };
      healthCheck.status = 'degraded';
    }

    // Set HTTP status code based on health
    const statusCode = healthCheck.status === 'healthy' ? 200 :
                      healthCheck.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json({
      success: true,
      data: healthCheck,
    });

  } catch (error) {
    console.error('Health check error:', error);

    healthCheck.status = 'unhealthy';
    healthCheck.error = 'Health check failed';

    res.status(503).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Application health check failed',
      },
      data: healthCheck,
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
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Readiness check failed:', error);

    res.status(503).json({
      success: false,
      error: {
        code: 'NOT_READY',
        message: 'Application is not ready to serve traffic',
      },
      timestamp: new Date().toISOString(),
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
    uptime: process.uptime(),
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
    nodeVersion: process.version,
  };

  res.status(200).json({
    success: true,
    data: metrics,
  });
});

/**
 * Alerting status endpoint
 * Returns the current alerting service status and recent alerts
 */
router.get('/alerts', (req, res) => {
  try {
    const alertingService = getAlertingService();
    const alertStatus = alertingService.getAlertStatus();

    res.status(200).json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        alerting: alertStatus,
      },
    });
  } catch (error) {
    console.error('Alerting status check error:', error);

    res.status(500).json({
      success: false,
      error: {
        code: 'ALERTING_STATUS_CHECK_FAILED',
        message: 'Failed to retrieve alerting status',
      },
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Check deployment path detection health
 * Tests critical components of the path detection system
 */
async function checkDeploymentPathDetectionHealth() {
  const checks = {
    databaseConnection: false,
    deploymentPathsTable: false,
    jenkinsService: false,
    nasServiceAvailable: false,
    recentFailures: 0,
    avgResponseTime: null,
  };

  const issues = [];
  let overallStatus = 'healthy';

  try {
    // Check database connection and deployment_paths table
    try {
      await query('SELECT 1 FROM deployment_paths LIMIT 1');
      checks.databaseConnection = true;
      checks.deploymentPathsTable = true;
    } catch (error) {
      if (error.message.includes('relation "deployment_paths" does not exist')) {
        checks.databaseConnection = true;
        checks.deploymentPathsTable = false;
        issues.push('deployment_paths table does not exist');
        overallStatus = 'unhealthy';
      } else {
        checks.databaseConnection = false;
        issues.push('database connection failed');
        overallStatus = 'unhealthy';
      }
    }

    // Check Jenkins service availability
    try {
      const jenkinsService = getJenkinsService();
      // Test if Jenkins service can be instantiated (basic config check)
      if (jenkinsService.baseURL && jenkinsService.username && jenkinsService.password) {
        checks.jenkinsService = true;
      } else {
        checks.jenkinsService = false;
        issues.push('Jenkins service not properly configured');
        overallStatus = 'warning';
      }
    } catch (error) {
      checks.jenkinsService = false;
      issues.push(`Jenkins service initialization failed: ${error.message}`);
      overallStatus = 'warning';
    }

    // Check recent deployment path detection performance
    try {
      const deploymentPathService = getDeploymentPathService();
      const recentPaths = await deploymentPathService.getRecentPaths(10);

      if (recentPaths && recentPaths.length > 0) {
        checks.nasServiceAvailable = true;

        // Calculate recent failures (paths without successful detection)
        const pathsWithNullNasPath = recentPaths.filter(p => !p.nas_path);
        checks.recentFailures = pathsWithNullNasPath.length;

        if (checks.recentFailures > 5) {
          issues.push(`High failure rate: ${checks.recentFailures}/10 recent requests failed`);
          overallStatus = 'warning';
        } else if (checks.recentFailures > 8) {
          issues.push(`Critical failure rate: ${checks.recentFailures}/10 recent requests failed`);
          overallStatus = 'unhealthy';
        }
      } else {
        checks.nasServiceAvailable = true; // No recent activity, assume available
      }
    } catch (error) {
      checks.nasServiceAvailable = false;
      issues.push(`Failed to check recent deployment paths: ${error.message}`);
      if (overallStatus === 'healthy') overallStatus = 'warning';
    }

    // Check response time performance (based on recent metrics if available)
    try {
      const result = await query(`
        SELECT AVG(EXTRACT(EPOCH FROM (verified_at - created_at))) * 1000 as avg_response_time_ms
        FROM deployment_paths 
        WHERE created_at > NOW() - INTERVAL '1 hour'
        AND verified_at IS NOT NULL
      `);

      if (result.rows[0]?.avg_response_time_ms) {
        checks.avgResponseTime = Math.round(result.rows[0].avg_response_time_ms);

        if (checks.avgResponseTime > 25000) { // 25 seconds
          issues.push(`Slow response time: ${checks.avgResponseTime}ms average`);
          if (overallStatus === 'healthy') overallStatus = 'warning';
        }
      }
    } catch (error) {
      // Non-critical check, don't change status
    }

  } catch (error) {
    issues.push(`Health check error: ${error.message}`);
    overallStatus = 'unhealthy';
  }

  return {
    status: overallStatus,
    checks,
    issues: issues.length > 0 ? issues : undefined,
    timestamp: new Date().toISOString(),
    summary: `${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length} checks passed`,
  };
}

module.exports = router;
