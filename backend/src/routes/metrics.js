const express = require('express');
const router = express.Router();
const {
  getMetrics,
  resetMetrics,
  getHealthWithMetrics,
} = require('../controllers/metricsController');
const { authenticateToken } = require('../middleware/authSimple');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// GET /api/metrics - Get metrics summary
router.get('/', getMetrics);


// GET /api/metrics/health - Get health status with metrics
router.get('/health', getHealthWithMetrics);

// POST /api/metrics/reset - Reset all metrics
router.post('/reset', resetMetrics);

module.exports = router;
