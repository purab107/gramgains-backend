const express = require('express');
const cors = require('cors');
require('dotenv').config();

const foodRoutes       = require('./modules/food/food.routes');
const trackerRoutes    = require('./modules/tracker/tracker.routes');
const dashboardRoutes  = require('./modules/dashboard/dashboard.routes');
const profileRoutes    = require('./modules/profile/profile.routes');
const savedMealsRoutes = require('./modules/saved-meals/saved-meals.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    modules: ['food', 'tracker', 'dashboard', 'profile', 'saved-meals'],
  });
});

app.use('/api/food',        foodRoutes);
app.use('/api/tracker',     trackerRoutes);
app.use('/api/dashboard',   dashboardRoutes);
app.use('/api/profile',     profileRoutes);
app.use('/api/saved-meals', savedMealsRoutes);

module.exports = app;
