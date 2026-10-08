const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { toNodeHandler } = require('better-auth/node');
const { auth } = require('./config/auth');
const { requireAuth } = require('./middlewares/auth');

const foodRoutes       = require('./modules/food/food.routes');
const trackerRoutes    = require('./modules/tracker/tracker.routes');
const dashboardRoutes  = require('./modules/dashboard/dashboard.routes');
const profileRoutes    = require('./modules/profile/profile.routes');
const savedMealsRoutes = require('./modules/saved-meals/saved-meals.routes');
const adaptiveRoutes   = require('./modules/adaptive/adaptive.routes');
const analyticsRoutes  = require('./modules/analytics/analytics.routes');

const app = express();

// Trust reverse proxy (Render load balancer / Cloudflare)
app.set('trust proxy', 1);

const configuredOrigins = (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : [])
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, server-to-server, curl)
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.replace(/\/$/, '');
    const isConfigured = configuredOrigins.includes(cleanOrigin);
    const isLocalhost = /^https?:\/\/localhost(:\d+)?$/.test(cleanOrigin);
    const isVercel = /^https:\/\/[a-zA-Z0-9_-]+\.vercel\.app$/.test(cleanOrigin);

    if (isConfigured || isLocalhost || isVercel) {
      return callback(null, true);
    }
    return callback(null, true);
  },
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
    modules: ['food', 'tracker', 'dashboard', 'profile', 'saved-meals', 'adaptive', 'analytics', 'auth'],
  });
});

// Domain routes with auth support
app.use('/api/food',        foodRoutes);
app.use('/api/tracker',     requireAuth, trackerRoutes);
app.use('/api/dashboard',   requireAuth, dashboardRoutes);
app.use('/api/profile',     profileRoutes);
app.use('/api/saved-meals', requireAuth, savedMealsRoutes);
app.use('/api/adaptive',    requireAuth, adaptiveRoutes);
app.use('/api/analytics',   requireAuth, analyticsRoutes);

module.exports = app;
