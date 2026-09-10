const { Router } = require('express');
const FoodController = require('./food.controller');

const router = Router();

router.get('/search', FoodController.search);
router.get('/barcode/:barcode', FoodController.getByBarcode);
router.get('/:id', FoodController.getById);
router.post('/', FoodController.create);

module.exports = router;
