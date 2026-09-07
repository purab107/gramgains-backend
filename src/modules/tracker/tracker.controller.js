const TrackerService = require('./tracker.service');

const VALID_MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];

async function getDaily(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const data = await TrackerService.getDailyLogs(date);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching daily logs', error: error.message });
  }
}

async function logMeal(req, res) {
  try {
    const { date, mealType, foodId, servings, customWeightGrams } = req.body;
    if (!date || !mealType || !foodId) {
      return res.status(400).json({ success: false, message: 'Missing required fields (date, mealType, foodId)' });
    }
    if (!VALID_MEAL_TYPES.includes(mealType)) {
      return res.status(400).json({ success: false, message: `Invalid mealType. Must be one of: ${VALID_MEAL_TYPES.join(', ')}` });
    }
    const log = await TrackerService.logMeal({
      date, mealType, foodId,
      servings: servings ? Number(servings) : 1,
      customWeightGrams: customWeightGrams ? Number(customWeightGrams) : undefined,
    });
    return res.status(201).json({ success: true, message: 'Meal logged successfully', data: log });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error logging meal', error: error.message });
  }
}

async function updateLog(req, res) {
  try {
    const { id } = req.params;
    const { servings, customWeightGrams, mealType } = req.body;
    const updated = await TrackerService.updateLog(id, {
      servings: servings ? Number(servings) : undefined,
      customWeightGrams: customWeightGrams ? Number(customWeightGrams) : undefined,
      mealType,
    });
    return res.json({ success: true, message: 'Meal log updated successfully', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating meal log', error: error.message });
  }
}

async function deleteLog(req, res) {
  try {
    await TrackerService.deleteLog(req.params.id);
    return res.json({ success: true, message: 'Meal log deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting meal log', error: error.message });
  }
}

module.exports = { getDaily, logMeal, updateLog, deleteLog };
