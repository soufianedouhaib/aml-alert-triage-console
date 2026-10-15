// Sessions, roles, password hashing. Stateless signed cookie; the user record
// is re-read on every request so disabling an account takes effect at once.
'use strict';
const crypto = require('crypto');
const store = require('./store');

const USERS_KEY = 'aml:users';
const COOKIE = 'aml_session';
const SESSION_HOURS = 12;
const ROLES = ['analyst', 'officer', 'admin'];
const ROLE_LABELS = { analyst: 'L1 Analyst', officer: 'Compliance Officer', admin: 'Administrator' };

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'local-dev-only-secret';
}

function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(pw, user) {
  if (!user || !user.hash || !user.salt) return false;
  const h = crypto.scryptSync(String(pw), user.salt, 64);
  const want = Buffer.from(user.hash, 'hex');
  return want.length === h.length && crypto.timingSafeEqual(h, want);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + mac;
}

function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch (e) { return null; }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function setSession(res, username) {
  const token = sign({ u: username, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function normName(u) { return String(u || '').trim().toLowerCase(); }

async function getUser(username) {
  return store.hget(USERS_KEY, normName(username));
}

async function allUsers() {
  const all = await store.hgetall(USERS_KEY);
  return Object.values(all).sort((a, b) => a.username.localeCompare(b.username));
}

async function saveUser(u) { return store.hset(USERS_KEY, u.username, u); }
async function deleteUser(username) { return store.hdel(USERS_KEY, normName(username)); }

// The admin account named in env vars always exists, so the first sign-in works
// before any user has been created.
async function ensureBootstrapAdmin() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  const username = normName(process.env.ADMIN_USERNAME || 'admin');
  let u = await getUser(username);
  if (!u) {
    const { salt, hash } = hashPassword(pw);
    u = { username, name: 'Administrator', role: 'admin', officerId: '', active: true, salt, hash, createdAt: new Date().toISOString(), bootstrap: true };
    await saveUser(u);
  }
  return u;
}

function publicUser(u) {
  if (!u) return null;
  return { username: u.username, name: u.name, role: u.role, roleLabel: ROLE_LABELS[u.role] || u.role, officerId: u.officerId || '', active: u.active !== false, createdAt: u.createdAt, bootstrap: !!u.bootstrap };
}

// Express middleware: attaches req.user (or null)
async function attachUser(req, res, next) {
  req.user = null;
  try {
    const p = verify(readCookie(req, COOKIE));
    if (p) {
      const u = await getUser(p.u);
      if (u && u.active !== false) req.user = u;
    }
  } catch (e) { /* storage down: treat as signed out */ }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(404).json({ error: 'Not found.' });
    next();
  };
}

module.exports = {
  ROLES, ROLE_LABELS, hashPassword, checkPassword, setSession, clearSession,
  getUser, allUsers, saveUser, deleteUser, ensureBootstrapAdmin, publicUser,
  attachUser, requireRole, normName,
};
