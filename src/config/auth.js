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
    'https://*.vercel.app',
    'http://localhost:3000',
  ],
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5000',
  secret: process.env.BETTER_AUTH_SECRET || 'gramgains-super-secret-auth-key-change-in-production-123456',
  advanced: {
    cookiePrefix: 'gramgains',
    defaultCookieAttributes: {
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
    crossSubDomainCookies: {
      enabled: false,
    },
    disableCSRF: false,
  },
});

module.exports = { auth };
