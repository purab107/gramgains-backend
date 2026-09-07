import { Router } from 'express';
import { SavedMealsController } from './saved-meals.controller';

const router = Router();

router.get('/', SavedMealsController.getAll);
router.get('/:id', SavedMealsController.getById);
router.post('/', SavedMealsController.create);
router.put('/:id', SavedMealsController.update);
router.delete('/:id', SavedMealsController.delete);
router.post('/:id/log', SavedMealsController.logToTracker);

export default router;
