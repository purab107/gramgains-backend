const { betterAuth } = require('better-auth');
const { prismaAdapter } = require('better-auth/adapters/prisma');
const { prisma } = require('./db');

const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: false,
  },
  trustedOrigins: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
  ],
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5000',
  secret: process.env.BETTER_AUTH_SECRET || 'gramgains-super-secret-auth-key-change-in-production-123456',
  advanced: {
    cookiePrefix: 'gramgains',
    crossSubDomainCookies: {
      enabled: false,
    },
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],
      trustedProxies: ['0.0.0.0/0'],
    },
  },
});

module.exports = { auth };
