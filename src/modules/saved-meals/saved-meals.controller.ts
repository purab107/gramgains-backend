import { Request, Response } from 'express';
import { SavedMealsService } from './saved-meals.service';

export class SavedMealsController {
  static async getAll(req: Request, res: Response) {
    try {
      const savedMeals = await SavedMealsService.getAll();
      return res.json({
        success: true,
        count: savedMeals.length,
        data: savedMeals,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching saved meals',
        error: error.message,
      });
    }
  }

  static async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const savedMeal = await SavedMealsService.getById(id);

      if (!savedMeal) {
        return res.status(404).json({
          success: false,
          message: 'Saved meal not found',
        });
      }

      return res.json({
        success: true,
        data: savedMeal,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching saved meal',
        error: error.message,
      });
    }
  }

  static async create(req: Request, res: Response) {
    try {
      const { name, description, items } = req.body;
      if (!name || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields (name, non-empty items array)',
        });
      }

      const savedMeal = await SavedMealsService.create({
        name,
        description,
        items,
      });

      return res.status(201).json({
        success: true,
        message: 'Saved meal created successfully',
        data: savedMeal,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error creating saved meal',
        error: error.message,
      });
    }
  }

  static async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updated = await SavedMealsService.update(id, req.body);

      return res.json({
        success: true,
        message: 'Saved meal updated successfully',
        data: updated,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error updating saved meal',
        error: error.message,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await SavedMealsService.delete(id);

      return res.json({
        success: true,
        message: 'Saved meal deleted successfully',
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error deleting saved meal',
        error: error.message,
      });
    }
  }

  static async logToTracker(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { date, mealType } = req.body;

      if (!date || !mealType) {
        return res.status(400).json({
          success: false,
          message: 'Missing required parameters (date, mealType)',
        });
      }

      const result = await SavedMealsService.logToTracker(id, date, mealType);
      return res.status(201).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error logging saved meal to tracker',
        error: error.message,
      });
    }
  }
}
