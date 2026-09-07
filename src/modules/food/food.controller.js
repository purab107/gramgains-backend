const FoodService = require('./food.service');

async function search(req, res) {
  try {
    const { q, layer, category } = req.query;
    const parsedLayer = layer ? parseInt(layer, 10) : undefined;
    const foods = await FoodService.searchFoods(q, parsedLayer, category);
    return res.json({ success: true, count: foods.length, data: foods });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching food data', error: error.message });
  }
}

async function getById(req, res) {
  try {
    const food = await FoodService.getFoodById(req.params.id);
    if (!food) return res.status(404).json({ success: false, message: 'Food item not found' });
    return res.json({ success: true, data: food });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching food item', error: error.message });
  }
}

async function create(req, res) {
  try {
    const { name, aliases, category, servingUnit, servingWeight, calories, protein, carbohydrates, fat, fiber, source, layer } = req.body;
    if (!name || !category || calories === undefined || !source || !layer) {
      return res.status(400).json({ success: false, message: 'Missing required fields (name, category, calories, source, layer)' });
    }
    const food = await FoodService.createFood({
      name, aliases, category,
      servingUnit: servingUnit || 'g',
      servingWeight: Number(servingWeight) || 100,
      calories: Number(calories),
      protein: Number(protein) || 0,
      carbohydrates: Number(carbohydrates) || 0,
      fat: Number(fat) || 0,
      fiber: Number(fiber) || 0,
      source,
      layer: Number(layer),
    });
    return res.status(201).json({ success: true, message: 'Food item created successfully', data: food });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error creating food item', error: error.message });
  }
}

module.exports = { search, getById, create };
