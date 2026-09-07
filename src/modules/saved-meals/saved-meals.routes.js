const { Router } = require('express');
const SavedMealsController = require('./saved-meals.controller');

const router = Router();

router.get('/', SavedMealsController.getAll);
router.get('/:id', SavedMealsController.getById);
router.post('/', SavedMealsController.create);
router.put('/:id', SavedMealsController.update);
router.delete('/:id', SavedMealsController.remove);
router.post('/:id/log', SavedMealsController.logToTracker);

module.exports = router;
