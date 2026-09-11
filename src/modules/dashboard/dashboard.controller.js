const DashboardService = require('./dashboard.service');

async function getSummary(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const summary = await DashboardService.getSummary(date, req.userId);
    return res.json({ success: true, data: summary });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching dashboard summary', error: error.message });
  }
}

async function getHeatmap(req, res) {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 90;
    const heatmap = await DashboardService.getHeatmap(days, req.userId);
    return res.json({ success: true, data: heatmap });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching heatmap data', error: error.message });
  }
}

module.exports = { getSummary, getHeatmap };
