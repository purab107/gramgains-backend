import { Router } from 'express';
import { FoodController } from './food.controller';

const router = Router();

router.get('/search', FoodController.search);
router.get('/:id', FoodController.getById);
router.post('/', FoodController.create);

export default router;
