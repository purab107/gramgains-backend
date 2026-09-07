const { Router } = require('express');
const DashboardController = require('./dashboard.controller');

const router = Router();

router.get('/summary', DashboardController.getSummary);
router.get('/heatmap', DashboardController.getHeatmap);

module.exports = router;
