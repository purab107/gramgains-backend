const { auth } = require('../config/auth');
const { fromNodeHeaders } = require('better-auth/node');
const { DEFAULT_USER_ID } = require('../modules/profile/profile.service');

async function optionalAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (session && session.user) {
      req.user = session.user;
      req.session = session.session;
      req.userId = session.user.id;
    } else {
      req.userId = DEFAULT_USER_ID;
      req.user = null;
      req.session = null;
    }
  } catch (err) {
    req.userId = DEFAULT_USER_ID;
    req.user = null;
    req.session = null;
  }
  next();
}

async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
      return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    req.user = session.user;
    req.session = session.session;
    req.userId = session.user.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication failed', details: err.message });
  }
}

module.exports = { optionalAuth, requireAuth };
