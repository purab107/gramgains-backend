import { Request, Response } from 'express';
import { ProfileService } from './profile.service';

export class ProfileController {
  static async getProfile(req: Request, res: Response) {
    try {
      const profile = await ProfileService.getProfile();
      return res.json({
        success: true,
        data: profile,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching profile settings',
        error: error.message,
      });
    }
  }

  static async updateProfile(req: Request, res: Response) {
    try {
      const updated = await ProfileService.updateProfile(req.body);
      return res.json({
        success: true,
        message: 'Profile and TDEE goals updated successfully',
        data: updated,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Error updating profile settings',
        error: error.message,
      });
    }
  }
}
