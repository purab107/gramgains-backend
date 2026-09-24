const { Router } = require('express');
const TrackerController = require('./tracker.controller');

const router = Router();

router.get('/daily', TrackerController.getDaily);
router.get('/recent-foods', TrackerController.getRecentFoods);
router.post('/log', TrackerController.logMeal);

router.put('/log/:id', TrackerController.updateLog);
router.delete('/log/:id', TrackerController.deleteLog);

router.get('/water', TrackerController.getWater);
router.post('/water', TrackerController.logWater);
router.delete('/water/:id', TrackerController.deleteWater);

router.get('/weight', TrackerController.getWeight);
router.post('/weight', TrackerController.logWeight);
router.put('/weight/:id/exclude', TrackerController.toggleWeightExclusion);
router.delete('/weight/:id', TrackerController.deleteWeight);

module.exports = router;
