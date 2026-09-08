require('dotenv').config();
const app = require('./app');
const { prisma } = require('./config/db');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Verify Database Connection
    await prisma.$connect();
    console.log('\n---------------------------------------------------------');
    console.log('🔥 GramGains Backend Service Started Successfully!');
    console.log('---------------------------------------------------------');
    console.log(`🌐 Server URL:        http://localhost:${PORT}`);
    console.log(`🗄️  Database Status:  Connected (Prisma + PostgreSQL)`);
    console.log(`📡 Registered Endpoints:`);
    console.log(`   - GET  /api/health`);
    console.log(`   - GET  /api/profile & PUT /api/profile`);
    console.log(`   - GET  /api/dashboard/summary & /api/dashboard/heatmap`);
    console.log(`   - GET  /api/tracker/daily & POST /api/tracker/log`);
    console.log(`   - GET  /api/food/search`);
    console.log(`   - GET  /api/saved-meals & POST /api/saved-meals`);
    console.log('---------------------------------------------------------\n');

    app.listen(PORT, () => {
      console.log(`Listening for requests on port ${PORT}...`);
    });
  } catch (error) {
    console.error('❌ Failed to connect to PostgreSQL Database:', error.message);
    process.exit(1);
  }
}

startServer();

