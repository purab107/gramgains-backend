import { Request, Response } from 'express';
import { DashboardService } from './dashboard.service';

export class DashboardController {
  static async getSummary(req: Request, res: Response) {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const summary = await DashboardService.getSummary(date);

      return res.json({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching dashboard summary',
        error: error.message,
      });
    }
  }

  static async getHeatmap(req: Request, res: Response) {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 90;
      const heatmap = await DashboardService.getHeatmap(days);

      return res.json({
        success: true,
        data: heatmap,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching heatmap data',
        error: error.message,
      });
    }
  }
}
