import { Router } from 'express';
import { ProfileController } from './profile.controller';

const router = Router();

router.get('/', ProfileController.getProfile);
router.put('/', ProfileController.updateProfile);

export default router;
