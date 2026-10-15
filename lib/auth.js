// Accounts, sessions and roles.
//
// Two kinds of account, the same way the payables console works:
//   - demo accounts: one per role, picked from a list on the sign-in page
//     (no password) while DEMO_MODE is on (the default);
//   - added users: created by an admin, sign in with email + password.
// Sessions are a signed cookie; the account is re-read on every request so
// disabling or deleting a user takes effect at once.
'use strict';
const crypto = require('crypto');
const store = require('./store');

const USERS_KEY = 'aml:accounts';
const COOKIE = 'aml_session';
const SESSION_HOURS = 12;
const ROLES = ['analyst', 'officer', 'admin'];
const ROLE_LABEL = { analyst: 'L1 Analyst', officer: 'Compliance Officer', admin: 'Admin' };
const HOME = { analyst: '/overview.html', officer: '/reviews.html', admin: '/overview.html' };

const DEFAULT_DEMO = [
  { role: 'analyst', name: 'Sara Haddad', email: 'sara.haddad@harbourlinegroup.com', officerId: '' },
  { role: 'officer', name: 'Omar Khalil', email: 'omar.khalil@harbourlinegroup.com', officerId: 'OFF-2147' },
  { role: 'admin', name: 'Nadia Rahman', email: 'nadia.rahman@harbourlinegroup.com', officerId: 'OFF-1001' },
];

function demoEnabled() { return String(process.env.DEMO_MODE || 'true').toLowerCase() !== 'false'; }

function demoAccounts() {
  let list = DEFAULT_DEMO;
  if (process.env.DEMO_ACCOUNTS) {
    try {
      const j = JSON.parse(process.env.DEMO_ACCOUNTS);
      if (Array.isArray(j) && j.length) list = j.filter((a) => a && ROLES.includes(a.role) && a.name && a.email);
    } catch (e) { /* keep defaults */ }
  }
  return list.map((a) => ({ kind: 'demo', role: a.role, name: a.name, email: normEmail(a.email), officerId: String(a.officerId || '').toUpperCase(), active: true }));
}

function secret() { return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'local-dev-only-secret'; }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }

function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function checkPassword(pw, user) {
  if (!user || !user.hash || !user.salt) return false;
  const h = crypto.scryptSync(String(pw), user.salt, 64);
  const want = Buffer.from(user.hash, 'hex');
  return want.length === h.length && crypto.timingSafeEqual(h, want);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}
function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!mac || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp && p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function setSession(res, account) {
  const payload = account.kind === 'demo' ? { k: 'demo', r: account.role } : { k: 'user', e: account.email };
  payload.exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(sign(payload))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}`);
}
function clearSession(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); }

// Added users. Records written by update 01/02 were keyed by user name and
// had no email; they are not shown or usable any more (demo accounts or
// admin-added users replace them).
async function allUsers() {
  const all = await store.hgetall(USERS_KEY);
  return Object.values(all).filter((u) => u && u.email).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
async function getUser(email) { return store.hget(USERS_KEY, normEmail(email)); }
async function saveUser(u) { u.email = normEmail(u.email); return store.hset(USERS_KEY, u.email, u); }
async function deleteUser(email) { return store.hdel(USERS_KEY, normEmail(email)); }

// When demo mode is off, the admin named in env vars always exists so the
// first sign-in works.
async function ensureBootstrapAdmin() {
  if (demoEnabled() || !process.env.ADMIN_PASSWORD) return null;
  const email = normEmail(process.env.ADMIN_EMAIL || 'admin@harbourlinegroup.com');
  let u = await getUser(email);
  if (!u) {
    u = Object.assign({ kind: 'user', email, name: 'Administrator', role: 'admin', officerId: '', active: true, createdAt: new Date().toISOString() }, hashPassword(process.env.ADMIN_PASSWORD));
    await saveUser(u);
  }
  return u;
}

function publicUser(u) {
  if (!u) return null;
  return { kind: u.kind || 'user', name: u.name, email: u.email, role: u.role, roleLabel: ROLE_LABEL[u.role] || u.role, officerId: u.officerId || '', active: u.active !== false, createdAt: u.createdAt || null };
}

async function attachUser(req, res, next) {
  req.user = null;
  try {
    const p = verify(readCookie(req, COOKIE));
    if (p && p.k === 'demo' && demoEnabled()) req.user = demoAccounts().find((a) => a.role === p.r) || null;
    else if (p && p.k === 'user') {
      const u = await getUser(p.e);
      if (u && u.active !== false) { u.kind = 'user'; req.user = u; }
    }
  } catch (e) { /* storage down: signed out */ }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(404).json({ error: 'Not found.' });
    next();
  };
}

// Who an action is attributed to in records and the audit trail.
function actor(u) { return { email: u.email, name: u.name, role: u.role }; }
function officerIdOf(u) { return String(u.officerId || u.email.split('@')[0]).toUpperCase(); }

module.exports = {
  ROLES, ROLE_LABEL, HOME, demoEnabled, demoAccounts, normEmail, hashPassword, checkPassword,
  setSession, clearSession, allUsers, getUser, saveUser, deleteUser, ensureBootstrapAdmin,
  publicUser, attachUser, requireRole, actor, officerIdOf,
};
