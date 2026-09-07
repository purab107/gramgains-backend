import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import foodRoutes from './modules/food/food.routes';
import trackerRoutes from './modules/tracker/tracker.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import profileRoutes from './modules/profile/profile.routes';
import savedMealsRoutes from './modules/saved-meals/saved-meals.routes';

const app = express();

app.use(cors());
app.use(express.json());

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    modules: ['food', 'tracker', 'dashboard', 'profile', 'saved-meals'],
  });
});

// Modular Routes
app.use('/api/food', foodRoutes);
app.use('/api/tracker', trackerRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/saved-meals', savedMealsRoutes);

export default app;
