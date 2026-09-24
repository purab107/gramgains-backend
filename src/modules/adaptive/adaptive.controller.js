const AdaptiveService = require('./adaptive.service');

async function getStatus(req, res) {
  try {
    const data = await AdaptiveService.getAdaptiveStatus(req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching adaptive metabolic status',
      error: error.message,
    });
  }
}

async function getCheckIn(req, res) {
  try {
    const data = await AdaptiveService.getCheckIn(req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching weekly check-in',
      error: error.message,
    });
  }
}

async function applyCheckIn(req, res) {
  try {
    const { checkInId, action, customCalories } = req.body;
    if (!checkInId) {
      return res.status(400).json({
        success: false,
        message: 'checkInId is required',
      });
    }

    const data = await AdaptiveService.applyCheckIn(
      { checkInId, action, customCalories },
      req.userId
    );
    return res.json({
      success: true,
      message: `Check-in ${action || 'processed'} successfully`,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error applying check-in recommendation',
      error: error.message,
    });
  }
}

module.exports = {
  getStatus,
  getCheckIn,
  applyCheckIn,
};
