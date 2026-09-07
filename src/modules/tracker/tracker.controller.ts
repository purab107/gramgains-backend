import { Request, Response } from 'express';
import { TrackerService } from './tracker.service';

export class TrackerController {
  static async getDaily(req: Request, res: Response) {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const data = await TrackerService.getDailyLogs(date);

      return res.json({
        success: true,
        data,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching daily tracker logs',
        error: error.message,
      });
    }
  }

  static async logMeal(req: Request, res: Response) {
    try {
      const { date, mealType, foodId, servings, customWeightGrams } = req.body;

      if (!date || !mealType || !foodId) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields (date, mealType, foodId)',
        });
      }

      const validMealTypes = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
      if (!validMealTypes.includes(mealType)) {
        return res.status(400).json({
          success: false,
          message: `Invalid mealType. Must be one of: ${validMealTypes.join(', ')}`,
        });
      }

      const log = await TrackerService.logMeal({
        date,
        mealType,
        foodId,
        servings: servings ? Number(servings) : 1,
        customWeightGrams: customWeightGrams ? Number(customWeightGrams) : undefined,
      });

      return res.status(201).json({
        success: true,
        message: 'Meal logged successfully',
        data: log,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error logging meal',
        error: error.message,
      });
    }
  }

  static async updateLog(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { servings, customWeightGrams, mealType } = req.body;

      const updated = await TrackerService.updateLog(id, {
        servings: servings ? Number(servings) : undefined,
        customWeightGrams: customWeightGrams ? Number(customWeightGrams) : undefined,
        mealType,
      });

      return res.json({
        success: true,
        message: 'Meal log updated successfully',
        data: updated,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error updating meal log',
        error: error.message,
      });
    }
  }

  static async deleteLog(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await TrackerService.deleteLog(id);

      return res.json({
        success: true,
        message: 'Meal log deleted successfully',
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error deleting meal log',
        error: error.message,
      });
    }
  }
}
