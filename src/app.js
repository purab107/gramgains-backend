const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { toNodeHandler } = require('better-auth/node');
const { auth } = require('./config/auth');
const { optionalAuth } = require('./middlewares/auth');

const foodRoutes       = require('./modules/food/food.routes');
const trackerRoutes    = require('./modules/tracker/tracker.routes');
const dashboardRoutes  = require('./modules/dashboard/dashboard.routes');
const profileRoutes    = require('./modules/profile/profile.routes');
const savedMealsRoutes = require('./modules/saved-meals/saved-meals.routes');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Better Auth route handler must be before express.json() for raw body streams if needed, or express.json() after
app.all('/api/auth/*', toNodeHandler(auth.handler));

app.use(express.json());

// Request Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusColor = res.statusCode >= 400 ? '❌' : '⚡';
    console.log(`${statusColor} [HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    modules: ['food', 'tracker', 'dashboard', 'profile', 'saved-meals', 'auth'],
  });
});

// Domain routes with auth support
app.use('/api/food',        foodRoutes);
app.use('/api/tracker',     optionalAuth, trackerRoutes);
app.use('/api/dashboard',   optionalAuth, dashboardRoutes);
app.use('/api/profile',     optionalAuth, profileRoutes);
app.use('/api/saved-meals', optionalAuth, savedMealsRoutes);

module.exports = app;
