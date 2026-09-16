const { Router } = require('express');
const TrackerController = require('./tracker.controller');

const router = Router();

router.get('/daily', TrackerController.getDaily);
router.post('/log', TrackerController.logMeal);
router.put('/log/:id', TrackerController.updateLog);
router.delete('/log/:id', TrackerController.deleteLog);

router.get('/water', TrackerController.getWater);
router.post('/water', TrackerController.logWater);
router.delete('/water/:id', TrackerController.deleteWater);

module.exports = router;
