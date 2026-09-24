const AnalyticsService = require('./analytics.service');

async function getOverview(req, res) {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 30;
    const data = await AnalyticsService.getOverview(days, req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching analytics overview',
      error: error.message,
    });
  }
}

async function getTrends(req, res) {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 60;
    const data = await AnalyticsService.getTrends(days, req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching analytics trends',
      error: error.message,
    });
  }
}

async function getPatterns(req, res) {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 14;
    const data = await AnalyticsService.getPatterns(days, req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching nutrition patterns and insights',
      error: error.message,
    });
  }
}

module.exports = {
  getOverview,
  getTrends,
  getPatterns,
};
