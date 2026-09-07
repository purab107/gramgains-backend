import { Router } from 'express';
import { TrackerController } from './tracker.controller';

const router = Router();

router.get('/daily', TrackerController.getDaily);
router.post('/log', TrackerController.logMeal);
router.put('/log/:id', TrackerController.updateLog);
router.delete('/log/:id', TrackerController.deleteLog);

export default router;
