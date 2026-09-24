const { Router } = require('express');
const AnalyticsController = require('./analytics.controller');

const router = Router();

router.get('/overview', AnalyticsController.getOverview);
router.get('/trends', AnalyticsController.getTrends);
router.get('/patterns', AnalyticsController.getPatterns);

module.exports = router;
