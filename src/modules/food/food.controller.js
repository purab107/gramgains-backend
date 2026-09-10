const FoodService = require('./food.service');

async function search(req, res) {
  try {
    const { q, layer, category, limit, page, barcode } = req.query;
    const parsedLayer = layer ? parseInt(layer, 10) : undefined;
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const parsedPage = page ? parseInt(page, 10) : 1;

    const result = await FoodService.searchFoods(q, parsedLayer, category, parsedLimit, parsedPage, barcode);
    return res.json({
      success: true,
      count: result.foods.length,
      total: result.total,
      page: result.page,
      limit: result.limit,
      data: result.foods,
    });
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

async function getByBarcode(req, res) {
  try {
    const { barcode } = req.params;
    const food = await FoodService.getFoodByBarcode(barcode);
    if (!food) return res.status(404).json({ success: false, message: 'Food item with specified barcode not found' });
    return res.json({ success: true, data: food });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching food by barcode', error: error.message });
  }
}

async function create(req, res) {
  try {
    const { name, aliases, category, brand, brandOwner, genericName, barcode, servingUnit, servingWeight, calories, protein, carbohydrates, fat, fiber, source, layer } = req.body;
    if (!name || !category || calories === undefined || !source || !layer) {
      return res.status(400).json({ success: false, message: 'Missing required fields (name, category, calories, source, layer)' });
    }
    const food = await FoodService.createFood({
      name,
      aliases,
      category,
      brand: brand || null,
      brandOwner: brandOwner || null,
      genericName: genericName || null,
      barcode: barcode || null,
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

module.exports = { search, getById, getByBarcode, create };
