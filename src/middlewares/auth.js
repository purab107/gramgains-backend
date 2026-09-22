const { auth } = require('../config/auth');
const { fromNodeHeaders } = require('better-auth/node');
const { DEFAULT_USER_ID } = require('../modules/profile/profile.service');

// ---------------------------------------------------------------------------
// Lightweight in-process session cache: avoids hitting the DB/session store
// on every API request. Keyed by the raw Cookie header.
// TTL: 30 seconds — short enough to pick up logouts promptly.
// ---------------------------------------------------------------------------
const SESSION_CACHE_TTL_MS = 30_000;
const sessionCache = new Map(); // cookie string -> { user, userId, expiresAt }

function getCachedSession(cookieHeader) {
  const entry = sessionCache.get(cookieHeader);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sessionCache.delete(cookieHeader);
    return null;
  }
  return entry;
}

function setCachedSession(cookieHeader, user) {
  sessionCache.set(cookieHeader, {
    user,
    userId: user.id,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });
  // Evict stale entries once the map grows large (>500)
  if (sessionCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of sessionCache) {
      if (now > v.expiresAt) sessionCache.delete(k);
    }
  }
}

function invalidateCachedSession(cookieHeader) {
  sessionCache.delete(cookieHeader);
}

// ---------------------------------------------------------------------------

async function optionalAuth(req, res, next) {
  const cookieHeader = req.headers.cookie || '';
  try {
    const cached = getCachedSession(cookieHeader);
    if (cached) {
      req.user = cached.user;
      req.userId = cached.userId;
      req.session = null;
      return next();
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (session && session.user) {
      req.user = session.user;
      req.session = session.session;
      req.userId = session.user.id;
      setCachedSession(cookieHeader, session.user);
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
  const cookieHeader = req.headers.cookie || '';
  try {
    const cached = getCachedSession(cookieHeader);
    if (cached) {
      req.user = cached.user;
      req.userId = cached.userId;
      req.session = null;
      return next();
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
      return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    setCachedSession(cookieHeader, session.user);
    req.user = session.user;
    req.session = session.session;
    req.userId = session.user.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication failed', details: err.message });
  }
}

module.exports = { optionalAuth, requireAuth, invalidateCachedSession };
