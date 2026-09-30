const { Router } = require('express');
const AdaptiveController = require('./adaptive.controller');

const router = Router();

router.get('/status', AdaptiveController.getStatus);
router.get('/check-in', AdaptiveController.getCheckIn);
router.post('/check-in/apply', AdaptiveController.applyCheckIn);
router.get('/goal-history', AdaptiveController.getGoalHistory);

module.exports = router;
