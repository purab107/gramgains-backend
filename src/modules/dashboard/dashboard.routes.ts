import { Router } from 'express';
import { DashboardController } from './dashboard.controller';

const router = Router();

router.get('/summary', DashboardController.getSummary);
router.get('/heatmap', DashboardController.getHeatmap);

export default router;
