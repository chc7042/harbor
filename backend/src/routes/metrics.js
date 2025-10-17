const express = require('express');
const router = express.Router();
const {
  getMetrics,
  resetMetrics,
  getHealthWithMetrics,
} = require('../controllers/metricsController');

// 인증 미들웨어 제거됨 - 간소화된 LDAP 인증 사용

// GET /api/metrics - Get metrics summary
router.get('/', getMetrics);


// GET /api/metrics/health - Get health status with metrics
router.get('/health', getHealthWithMetrics);

// POST /api/metrics/reset - Reset all metrics
router.post('/reset', resetMetrics);

module.exports = router;
