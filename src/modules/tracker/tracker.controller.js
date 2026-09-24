const TrackerService = require('./tracker.service');

const VALID_MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];

async function getDaily(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const data = await TrackerService.getDailyLogs(date, req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching daily logs', error: error.message });
  }
}

async function logMeal(req, res) {
  try {
    const { date, mealType, foodId, servings, customWeightGrams, unitLabel } = req.body;
    if (!date || !mealType || !foodId) {
      return res.status(400).json({ success: false, message: 'Missing required fields (date, mealType, foodId)' });
    }
    if (!VALID_MEAL_TYPES.includes(mealType)) {
      return res.status(400).json({ success: false, message: `Invalid mealType. Must be one of: ${VALID_MEAL_TYPES.join(', ')}` });
    }
    const log = await TrackerService.logMeal(
      {
        date,
        mealType,
        foodId,
        servings: servings !== undefined && servings !== null ? Number(servings) : 1,
        customWeightGrams: customWeightGrams !== undefined && customWeightGrams !== null ? Number(customWeightGrams) : undefined,
        unitLabel: unitLabel ? String(unitLabel) : undefined,
      },
      req.userId
    );
    return res.status(201).json({ success: true, message: 'Meal logged successfully', data: log });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error logging meal', error: error.message });
  }
}

async function updateLog(req, res) {
  try {
    const { id } = req.params;
    const { servings, customWeightGrams, mealType, unitLabel } = req.body;
    const updated = await TrackerService.updateLog(
      id,
      {
        servings: servings !== undefined && servings !== null ? Number(servings) : undefined,
        customWeightGrams: customWeightGrams !== undefined && customWeightGrams !== null ? Number(customWeightGrams) : undefined,
        mealType,
        unitLabel: unitLabel !== undefined ? String(unitLabel) : undefined,
      },
      req.userId
    );
    return res.json({ success: true, message: 'Meal log updated successfully', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating meal log', error: error.message });
  }
}

async function deleteLog(req, res) {
  try {
    await TrackerService.deleteLog(req.params.id, req.userId);
    return res.json({ success: true, message: 'Meal log deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting meal log', error: error.message });
  }
}

async function getWater(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const data = await TrackerService.getDailyWaterLogs(date, req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching water logs', error: error.message });
  }
}

async function logWater(req, res) {
  try {
    const { date, amountMl } = req.body;
    if (!date || !amountMl) {
      return res.status(400).json({ success: false, message: 'Missing required fields (date, amountMl)' });
    }
    const log = await TrackerService.logWater({ date, amountMl }, req.userId);
    return res.status(201).json({ success: true, message: 'Water logged successfully', data: log });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error logging water', error: error.message });
  }
}

async function deleteWater(req, res) {
  try {
    await TrackerService.deleteWaterLog(req.params.id, req.userId);
    return res.json({ success: true, message: 'Water log deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting water log', error: error.message });
  }
}

async function getRecentFoods(req, res) {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 30;
    const data = await TrackerService.getRecentFoods(req.userId, limit);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching recent foods', error: error.message });
  }
}

async function getWeight(req, res) {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 90;
    const data = await TrackerService.getWeightLogs(days, req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching weight logs', error: error.message });
  }
}

async function logWeight(req, res) {
  try {
    const { date, weightKg, note, isExcluded } = req.body;
    if (!date || weightKg === undefined) {
      return res.status(400).json({ success: false, message: 'date and weightKg are required' });
    }
    const data = await TrackerService.logWeight(
      { date, weightKg, note, isExcluded },
      req.userId
    );
    return res.status(201).json({ success: true, message: 'Weight logged successfully', data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error logging weight', error: error.message });
  }
}

async function toggleWeightExclusion(req, res) {
  try {
    const { id } = req.params;
    const data = await TrackerService.toggleWeightExclusion(id, req.userId);
    return res.json({ success: true, message: 'Weight exclusion status toggled', data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error toggling weight exclusion', error: error.message });
  }
}

async function deleteWeight(req, res) {
  try {
    const { id } = req.params;
    await TrackerService.deleteWeightLog(id, req.userId);
    return res.json({ success: true, message: 'Weight log deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting weight log', error: error.message });
  }
}

module.exports = {
  getDaily,
  logMeal,
  updateLog,
  deleteLog,
  getWater,
  logWater,
  deleteWater,
  getRecentFoods,
  getWeight,
  logWeight,
  toggleWeightExclusion,
  deleteWeight,
};

