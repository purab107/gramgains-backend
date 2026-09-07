const SavedMealsService = require('./saved-meals.service');

async function getAll(req, res) {
  try {
    const savedMeals = await SavedMealsService.getAll();
    return res.json({ success: true, count: savedMeals.length, data: savedMeals });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching saved meals', error: error.message });
  }
}

async function getById(req, res) {
  try {
    const savedMeal = await SavedMealsService.getById(req.params.id);
    if (!savedMeal) return res.status(404).json({ success: false, message: 'Saved meal not found' });
    return res.json({ success: true, data: savedMeal });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching saved meal', error: error.message });
  }
}

async function create(req, res) {
  try {
    const { name, description, items } = req.body;
    if (!name || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing required fields (name, non-empty items array)' });
    }
    const savedMeal = await SavedMealsService.create({ name, description, items });
    return res.status(201).json({ success: true, message: 'Saved meal created successfully', data: savedMeal });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error creating saved meal', error: error.message });
  }
}

async function update(req, res) {
  try {
    const updated = await SavedMealsService.update(req.params.id, req.body);
    return res.json({ success: true, message: 'Saved meal updated successfully', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating saved meal', error: error.message });
  }
}

async function remove(req, res) {
  try {
    await SavedMealsService.remove(req.params.id);
    return res.json({ success: true, message: 'Saved meal deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting saved meal', error: error.message });
  }
}

async function logToTracker(req, res) {
  try {
    const { date, mealType } = req.body;
    if (!date || !mealType) {
      return res.status(400).json({ success: false, message: 'Missing required parameters (date, mealType)' });
    }
    const result = await SavedMealsService.logToTracker(req.params.id, date, mealType);
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error logging saved meal to tracker', error: error.message });
  }
}

module.exports = { getAll, getById, create, update, remove, logToTracker };
