// AML alert triage console — Express backend.
// The service key lives only here (env var). The browser talks to /api/* only.
'use strict';
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const auth = require('./lib/auth');
const evidence = require('./lib/evidence');
const report = require('./lib/report');
const { SAMPLES } = require('./lib/samples');

// ---------------------------------------------------------------------------
// Workflow contract (pinned from the workflow builder, version 1.2)
// ---------------------------------------------------------------------------
const API_BASE = (process.env.OPUS_API_BASE || 'https://operator.opus.com/api/v1').replace(/\/+$/, '');
const WORKFLOW_ID = process.env.OPUS_WORKFLOW_ID || '67761781-8be5-4dd8-a1de-af898247c7a5';
const INPUT_VAR = 'workflow_input_806ktowl2';            // TM Alert (JSON string)
const INPUT_DISPLAY = 'TM Alert';
const OUTPUT_VAR = 'workflow_output_bj5nkid7u';          // Final Disposition & Audit Trail (object)
const OFFICER_RESPONSE_VAR = process.env.OFFICER_RESPONSE_VAR || 'workflow_output_bhnpsw89f'; // Officer Response (str); only used when the packet carries no schema
const REVIEW_TIMEOUT_MIN = Number(process.env.REVIEW_TIMEOUT_MINUTES || 60);
const WEBHOOK_HEADER = String(process.env.REVIEW_WEBHOOK_HEADER || 'x-webhook-secret').toLowerCase();

const PRODUCT = {
  name: process.env.APP_NAME || 'AML Alert Triage',
  unit: process.env.ORG_UNIT || process.env.ORG_NAME || 'Financial Crime Unit',
  company: process.env.COMPANY_NAME || 'Harbourline Group',
};
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || '';
const ORG_ID = process.env.OPUS_ORG_ID || '';

const CASES_KEY = 'aml:cases';
const REVIEWS_KEY = 'aml:reviews';
const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
const DISPOSITIONS = ['ESCALATE', 'REFER', 'CLOSE'];
const ACTIONS = ['CONFIRM', 'OVERRIDE', 'ANNOTATE'];

function serviceKey() { return process.env.OPUS_SERVICE_KEY || process.env.OPUS_API_KEY || ''; }

function missingEnv() {
  const m = [];
  if (!serviceKey()) m.push('OPUS_SERVICE_KEY');
  if (!process.env.SESSION_SECRET) m.push('SESSION_SECRET');
  if (!process.env.REVIEW_WEBHOOK_SECRET) m.push('REVIEW_WEBHOOK_SECRET');
  if (!SUPPORT_EMAIL) m.push('SUPPORT_EMAIL (where "Report a problem" emails go)');
  if (!auth.demoEnabled() && !process.env.ADMIN_PASSWORD) m.push('ADMIN_PASSWORD (needed when DEMO_MODE=false)');
  if (!store.persistent()) m.push('Redis storage (KV_REST_API_URL + KV_REST_API_TOKEN, or REDIS_URL)');
  return m;
}

// ---------------------------------------------------------------------------
// Workflow API client
// ---------------------------------------------------------------------------
class UpstreamError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

async function opus(method, p, body) {
  if (!serviceKey()) throw new UpstreamError(503, 'The triage service is not configured yet (service key missing). Ask your administrator.');
  let r;
  try {
    r = await fetch(API_BASE + p, {
      method,
      headers: { 'x-service-key': serviceKey(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new UpstreamError(502, 'Could not reach the triage service. Try again in a minute.');
  }
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = null; }
  if (r.status >= 400) {
    const msg = (json && (json.message || (json.error && (json.error.message || json.error)))) || ('HTTP ' + r.status);
    throw new UpstreamError(r.status, 'Triage service error (' + r.status + '): ' + String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300), json || text);
  }
  return { status: r.status, json: json || {} };
}

// The input variable's declared type, read from the workflow once and cached.
let specCache = null;
async function inputSpec() {
  if (specCache && Date.now() - specCache.at < 10 * 60 * 1000) return specCache;
  let found = null;
  try {
    const { json } = await opus('GET', `/workflow/${encodeURIComponent(WORKFLOW_ID)}`);
    (function walk(v, d) {
      if (found || !v || typeof v !== 'object' || d > 8) return;
      if (v[INPUT_VAR] && Array.isArray(v[INPUT_VAR].allowed_types)) { found = v[INPUT_VAR]; return; }
      for (const k of Object.keys(v)) walk(v[k], d + 1);
    })(json, 0);
  } catch (e) { /* fall back to the known declaration */ }
  const t = found && found.allowed_types[0] ? found.allowed_types[0] : null;
  specCache = {
    at: Date.now(),
    type: (t && t.type) || 'json_string',
    typeDefinition: (t && t.type_definition) || null,
    displayName: (found && found.display_name) || INPUT_DISPLAY,
    fromWorkflow: !!found,
  };
  return specCache;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------
const getCase = (id) => store.hget(CASES_KEY, id);
const saveCase = (c) => { c.updatedAt = new Date().toISOString(); return store.hset(CASES_KEY, c.id, c); };
const getReview = (id) => store.hget(REVIEWS_KEY, id);
const saveReview = (r) => store.hset(REVIEWS_KEY, r.id, r);

async function allCases() {
  const all = await store.hgetall(CASES_KEY);
  return Object.values(all).filter((c) => c && !c.deleted).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
async function allReviews() {
  const all = await store.hgetall(REVIEWS_KEY);
  return Object.values(all).filter((r) => r && !r.deleted).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
}

// Analysts see the alerts they submitted; officers and admins see every alert.
function canSee(user, c) {
  if (!user || !c) return false;
  if (user.role !== 'analyst') return true;
  return c.submittedBy === user.email;
}
async function casesFor(user) { return (await allCases()).filter((c) => canSee(user, c)); }

function reviewState(r) {
  if (!r) return null;
  if (r.status === 'PENDING' && r.deadline && Date.parse(r.deadline) < Date.now()) return 'EXPIRED';
  return r.status;
}

function submitterName(c) { return c.submittedByName || c.submittedBy || ''; }

// Single projection used by every list, so every screen agrees.
function toRow(c, review) {
  const res = c.result || {};
  const rec = (res.audit_trail && res.audit_trail.decision_record) || {};
  const routing = res.routing || {};
  let stage = 'RUNNING';
  if (c.opusStatus === 'PENDING' || !c.opusStatus) stage = 'QUEUED';
  if (c.opusStatus === 'WAITING') stage = 'AWAITING_REVIEW';
  if (review && reviewState(review) === 'DECIDED' && !TERMINAL.includes(c.opusStatus)) stage = 'FINALISING';
  if (TERMINAL.includes(c.opusStatus)) stage = c.opusStatus;
  if (c.opusStatus === 'COMPLETED' && !res.final_disposition) stage = 'COMPLETED_NO_RESULT';
  const decision = (review && review.decision) || c.decision || null;
  const finishedAt = c.finishedAt || null;
  return {
    id: c.id,
    alertId: c.alertId,
    customerId: c.customerId || '',
    customerName: c.customerName || '',
    kycRisk: c.kycRisk || '',
    account: c.account || '',
    rule: c.rule || '',
    alertScore: c.alertScore,
    priority: c.priority || '',
    note: c.note || '',
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    finishedAt,
    durationMs: finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(c.createdAt)) : null,
    submittedBy: submitterName(c),
    submittedByUser: c.submittedBy,
    opusStatus: c.opusStatus || 'PENDING',
    stage,
    recommended: c.recommended || rec.system_recommendation || '',
    riskScore: c.riskScore != null ? c.riskScore : (rec.risk_score_at_decision != null ? rec.risk_score_at_decision : null),
    finalDisposition: res.final_disposition || '',
    queue: routing.queue || '',
    slaHours: routing.sla_hours != null ? routing.sla_hours : null,
    officerAction: rec.officer_action || (decision && decision.action) || '',
    officerId: rec.officer_id || (decision && decision.officerId) || '',
    officerName: (decision && decision.byName) || '',
    decisionAt: (decision && decision.at) || '',
    decisionText: (decision && decision.responseText) || '',
    reviewId: review ? review.id : '',
    reviewState: review ? reviewState(review) : '',
    reviewReceivedAt: review ? review.receivedAt : '',
    reviewDeadline: review ? review.deadline : '',
    duplicateOf: c.duplicateOf || '',
    error: c.error || '',
  };
}

function reviewForCase(c, reviews) {
  return reviews.filter((r) => r.linkedCaseId === c.id).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))[0] || null;
}

async function rowsFor(user, refreshLive) {
  const cases = await casesFor(user);
  const reviews = await allReviews();
  if (refreshLive) {
    const live = cases.filter((c) => !TERMINAL.includes(c.opusStatus) || (c.opusStatus === 'COMPLETED' && !c.result)).slice(0, 6);
    await Promise.all(live.map((c) => refreshCase(c).catch(() => c)));
  }
  return cases.map((c) => toRow(c, reviewForCase(c, reviews)));
}

// ---------------------------------------------------------------------------
// Status refresh (throttled per case)
// ---------------------------------------------------------------------------
const lastPoll = new Map();

// ---------------------------------------------------------------------------
// Run logs: every step of every run, from submission to the end, kept for the
// engineering team (admin-only on the System page). Never holds secrets: no
// service key, no callback token, no webhook secret, header names only.
// ---------------------------------------------------------------------------
const RUNLOG_INDEX = 'aml:runlogs';
const RUNLOG_TTL = 60 * 24 * 3600;
const RUNLOG_MAX = 400;
const lastRefreshError = new Map();
function clip(v, n) { const t = typeof v === 'string' ? v : JSON.stringify(v); return t && t.length > (n || 2000) ? t.slice(0, n || 2000) + '…' : t; }
async function runlog(id, source, level, message, detail, meta, at) {
  if (!id) return;
  try {
    const ev = { at: at || new Date().toISOString(), source, level, message };
    if (at) ev.loggedAt = new Date().toISOString();
    if (detail !== undefined && detail !== null && detail !== '') ev.detail = typeof detail === 'string' ? clip(detail) : JSON.parse(clip(detail, 4000) || 'null') || clip(detail, 4000);
    await store.push('aml:runlog:' + id, ev, RUNLOG_MAX, RUNLOG_TTL);
    const idx = (await store.hget(RUNLOG_INDEX, id)) || { id, firstAt: ev.at, events: 0, errors: 0, warnings: 0 };
    Object.assign(idx, meta || {});
    idx.lastAt = ev.loggedAt || ev.at; idx.lastMessage = message; idx.events = (idx.events || 0) + 1;
    if (level === 'error') { idx.errors = (idx.errors || 0) + 1; idx.lastError = message; }
    if (level === 'warn') idx.warnings = (idx.warnings || 0) + 1;
    await store.hset(RUNLOG_INDEX, id, idx);
  } catch (e) { /* logging must never break a run */ }
}

async function refreshCase(c, force) {
  if (!c || !c.caseId) return c;
  if (TERMINAL.includes(c.opusStatus) && (c.opusStatus !== 'COMPLETED' || c.result)) return c;
  const now = Date.now();
  if (!force && lastPoll.has(c.id) && now - lastPoll.get(c.id) < 4000) return c;
  lastPoll.set(c.id, now);
  try {
    const { json } = await opus('GET', `/case/${encodeURIComponent(c.caseId)}/status`);
    const st = String(json.status || 'UNKNOWN').toUpperCase();
    let changed = st !== c.opusStatus;
    if (changed) {
      const bad = ['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(st);
      await runlog(c.id, 'opus', bad ? 'error' : 'info', `Status ${c.opusStatus || 'PENDING'} → ${st}`, bad ? json : null, { status: st });
    }
    c.opusStatus = st;
    if (st === 'COMPLETED' && !c.result) {
      const r = await opus('GET', `/case/${encodeURIComponent(c.caseId)}/results`);
      if (r.status === 200 && r.json && r.json.results) {
        const out = r.json.results[OUTPUT_VAR] || Object.values(r.json.results)[0];
        const val = out ? evidence.tryJson(out.value) : null;
        c.result = val && typeof val === 'object' ? val : {};
        c.completedAt = c.completedAt || new Date().toISOString();
        changed = true;
        const ro = (c.result && c.result.routing) || {};
        if (c.result && c.result.final_disposition) await runlog(c.id, 'opus', 'info', `Result read: ${c.result.final_disposition} → ${ro.queue || '—'}${ro.sla_hours ? ' (' + ro.sla_hours + ' h SLA)' : ''}`, { final_disposition: c.result.final_disposition, routing: ro, audit_id: c.result.audit_trail && c.result.audit_trail.audit_id });
        else await runlog(c.id, 'opus', 'error', 'Case completed but the result has no final disposition', out || r.json);
      } else {
        await runlog(c.id, 'opus', 'warn', 'Case completed but results were not ready (HTTP ' + r.status + ')');
      }
    }
    if (TERMINAL.includes(st) && !c.finishedAt) { c.finishedAt = new Date().toISOString(); changed = true; }
    c.error = '';
    if (changed) await saveCase(c);
  } catch (e) {
    if (e.status === 404) {
      c.opusStatus = 'FAILED'; c.error = 'The case no longer exists on the triage service.'; await saveCase(c);
      await runlog(c.id, 'opus', 'error', 'Status check: the case no longer exists on the triage service (404)', e.body, { status: 'FAILED' });
    } else if (lastRefreshError.get(c.id) !== e.message) {
      lastRefreshError.set(c.id, e.message);
      await runlog(c.id, 'opus', 'warn', 'Status check failed: ' + e.message, e.body);
    }
  }
  return c;
}

// Evidence comes from the per-step audit log. Cached once the case is final.
const evCache = new Map();
async function getEvidence(c) {
  const key = 'aml:evidence:' + c.id;
  if (TERMINAL.includes(c.opusStatus)) {
    const cached = await store.get(key);
    if (cached) return cached;
  }
  const mem = evCache.get(c.id);
  if (mem && mem.status === c.opusStatus && Date.now() - mem.at < 3000) return mem.ev;
  let ev;
  try {
    const { json } = await opus('GET', `/case/${encodeURIComponent(c.caseId)}/audit`);
    ev = evidence.build(json, c.opusStatus);
  } catch (e) {
    ev = evidence.build(null, c.opusStatus);
    ev.error = e.message;
  }
  // Log each step once as it finishes, fails or starts waiting.
  if (ev.nodes && ev.nodes.length) {
    const seen = c.stepsLogged || {};
    let changedSteps = false;
    for (const n of ev.nodes) {
      const prev = seen[n.id];
      if (prev === n.status) continue;
      if (!['COMPLETED', 'FAILED', 'WAITING', 'CANCELLED', 'TIMED_OUT'].includes(n.status)) continue;
      seen[n.id] = n.status; changedSteps = true;
      const lvl = n.status === 'FAILED' || n.status === 'CANCELLED' || n.status === 'TIMED_OUT' ? 'error' : 'info';
      // Timestamped when the step actually ended (or started, while waiting), from the audit log.
      const endAt = n.startedAt ? new Date(Date.parse(n.startedAt) + (n.status === 'WAITING' ? 0 : (n.ms || 0))).toISOString() : null;
      await runlog(c.id, 'opus', lvl, `Step ${n.name}: ${n.status === 'WAITING' ? 'waiting for the officer' : n.status}${n.ms != null && n.status !== 'WAITING' ? ' in ' + (n.ms / 1000).toFixed(1) + ' s' : ''}`, n.error ? { error: n.error, startedAt: n.startedAt } : null, null, endAt);
    }
    if (changedSteps) { c.stepsLogged = seen; await saveCase(c); }
  }
  if (ev.error) {
    if (lastRefreshError.get('ev:' + c.id) !== ev.error) { lastRefreshError.set('ev:' + c.id, ev.error); await runlog(c.id, 'opus', 'warn', 'Audit log read failed: ' + ev.error); }
  }
  // Remember headline numbers on the case so lists and reports can show them.
  const nar = ev.data.narrative && typeof ev.data.narrative === 'object' ? ev.data.narrative : null;
  const man = ev.data.manifest && typeof ev.data.manifest === 'object' ? ev.data.manifest : null;
  const cd = ev.data.customerData && typeof ev.data.customerData === 'object' ? ev.data.customerData : null;
  let dirty = false;
  const rec = (man && man.case_header && man.case_header.recommended_disposition) || (nar && nar.disposition && nar.disposition.recommendation);
  const score = (man && man.case_header && man.case_header.risk_score) != null ? man.case_header.risk_score : (nar ? nar.blended_risk_score : null);
  const cname = (man && man.customer_name) || (nar && nar.customer_name) || (cd && cd.customer_profile && cd.customer_profile.full_name);
  const cid = (man && man.customer_id) || (nar && nar.customer_id) || (ev.data.parsedAlert && ev.data.parsedAlert.customer_id);
  const kyc = cd && cd.customer_profile && cd.customer_profile.risk_rating;
  if (rec && DISPOSITIONS.includes(rec) && c.recommended !== rec) { c.recommended = rec; dirty = true; }
  if (score != null && !isNaN(Number(score)) && c.riskScore !== Number(score)) { c.riskScore = Number(score); dirty = true; }
  if (cname && c.customerName !== cname) { c.customerName = cname; dirty = true; }
  if (cid && c.customerId !== cid) { c.customerId = cid; dirty = true; }
  if (kyc && c.kycRisk !== kyc) { c.kycRisk = String(kyc); dirty = true; }
  if (dirty) await saveCase(c);
  evCache.set(c.id, { at: Date.now(), status: c.opusStatus, ev });
  if (TERMINAL.includes(c.opusStatus) && ev.hasAudit) await store.set(key, ev);
  return ev;
}

async function deleteCaseAndReviews(c, reviews, who) {
  await runlog(c.id, 'console', 'warn', `Alert removed from the console${who ? ' by ' + who : ''}; this log is kept`, null, { removed: true });
  await store.hdel(CASES_KEY, c.id);
  await store.del('aml:evidence:' + c.id);
  for (const r of reviews.filter((x) => x.linkedCaseId === c.id)) await store.hdel(REVIEWS_KEY, r.id);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(auth.attachUser);

function wrap(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    const status = e.status && e.status >= 400 && e.status < 600 ? (e.status === 401 || e.status === 403 ? 502 : e.status) : 500;
    if (!(e instanceof UpstreamError)) console.error(e);
    res.status(status).json({ error: e instanceof UpstreamError ? e.message : 'Something went wrong on the server. ' + (e.message || '') });
  });
}

const anyUser = auth.requireRole();
const officerOrAdmin = auth.requireRole('officer', 'admin');
const adminOnly = auth.requireRole('admin');

app.get('/api/health', wrap(async (req, res) => {
  const missing = missingEnv();
  const out = { ok: missing.length === 0 };
  if (req.user && req.user.role === 'admin') out.missing = missing;
  res.json(out);
}));

app.get('/api/config', (req, res) => {
  res.json({ product: PRODUCT, supportEmail: SUPPORT_EMAIL, demo: auth.demoEnabled() });
});

// --- sign-in ----------------------------------------------------------------
const attempts = new Map();
function throttle(req, res) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
  attempts.set(ip, a);
  if (a.n >= 10) { res.status(429).json({ error: 'Too many sign-in attempts. Wait 15 minutes and try again.' }); return null; }
  return a;
}

// The account list on the sign-in page: one per role, plus added users
// (they still need their password).
app.get('/api/demo', wrap(async (req, res) => {
  if (!auth.demoEnabled()) return res.json({ enabled: false, accounts: [] });
  const users = (await auth.allUsers()).filter((u) => u.active !== false).map((u) => ({ kind: 'user', role: u.role, name: u.name, email: u.email }));
  const demo = auth.demoAccounts().map((a) => ({ kind: 'demo', role: a.role, name: a.name, email: a.email }));
  res.json({ enabled: true, accounts: demo.concat(users) });
}));

app.post('/api/demo-login', wrap(async (req, res) => {
  if (!auth.demoEnabled()) return res.status(404).json({ error: 'Quick sign-in is turned off. Sign in with your email and password.' });
  const a = auth.demoAccounts().find((x) => x.role === (req.body && req.body.role));
  if (!a) return res.status(400).json({ error: 'Pick an account.' });
  auth.setSession(res, a);
  res.json({ user: auth.publicUser(a), home: auth.HOME[a.role] });
}));

app.post('/api/login', wrap(async (req, res) => {
  const a = throttle(req, res); if (!a) return;
  await auth.ensureBootstrapAdmin();
  const { email, password } = req.body || {};
  const u = await auth.getUser(email);
  if (!u || u.active === false || !auth.checkPassword(password || '', u)) {
    a.n++;
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  a.n = 0;
  u.kind = 'user';
  auth.setSession(res, u);
  res.json({ user: auth.publicUser(u), home: auth.HOME[u.role] });
}));

app.post('/api/logout', (req, res) => { auth.clearSession(res); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  const out = {
    user: auth.publicUser(req.user),
    home: auth.HOME[req.user.role] || '/',
    product: PRODUCT,
    support: { email: SUPPORT_EMAIL, workflowId: WORKFLOW_ID, orgId: ORG_ID || null },
    reviewTimeoutMinutes: REVIEW_TIMEOUT_MIN,
    demo: auth.demoEnabled(),
    storage: store.persistent() ? 'ok' : 'memory',
  };
  if (req.user.role === 'admin') out.setupWarnings = missingEnv();
  res.json(out);
});

app.post('/api/me/password', anyUser, wrap(async (req, res) => {
  if (req.user.kind === 'demo') return res.status(400).json({ error: 'This account signs in from the account list on the sign-in page, so it has no password. Ask an admin to add you as a user to get one.' });
  const { current, next } = req.body || {};
  if (!auth.checkPassword(current || '', req.user)) return res.status(400).json({ error: 'Your current password is not correct.' });
  if (!next || String(next).length < 10) return res.status(400).json({ error: 'The new password needs at least 10 characters.' });
  Object.assign(req.user, auth.hashPassword(next));
  await auth.saveUser(req.user);
  res.json({ ok: true });
}));

// --- users (admin) ----------------------------------------------------------
app.get('/api/users', adminOnly, wrap(async (req, res) => {
  const users = (await auth.allUsers()).map(auth.publicUser);
  const demo = auth.demoEnabled() ? auth.demoAccounts().map(auth.publicUser) : [];
  res.json({ users, demo });
}));

app.post('/api/users', adminOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const email = auth.normEmail(b.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!auth.ROLES.includes(b.role)) return res.status(400).json({ error: 'Pick a role.' });
  if (auth.demoAccounts().some((d) => d.email === email)) return res.status(400).json({ error: 'That email belongs to an account on the sign-in list. Use another address.' });
  let u = await auth.getUser(email);
  const isNew = !u || b.isNew;
  if (b.isNew && u) return res.status(409).json({ error: 'A user with that email already exists.' });
  if (isNew && (!b.password || String(b.password).length < 10)) return res.status(400).json({ error: 'Set a password of at least 10 characters.' });
  if (!isNew && b.password && String(b.password).length < 10) return res.status(400).json({ error: 'The new password needs at least 10 characters.' });
  const officerId = String(b.officerId != null ? b.officerId : (u && u.officerId) || '').trim().toUpperCase().slice(0, 30);
  if (b.role === 'officer' && !officerId) return res.status(400).json({ error: 'Compliance officers need an officer ID (for example OFF-2147). It is written into the audit trail.' });
  if (!String(b.name || (u && u.name) || '').trim()) return res.status(400).json({ error: 'Enter a name.' });
  if (!isNew && req.user.email === email && b.role !== 'admin') return res.status(400).json({ error: 'You cannot remove your own admin role.' });
  u = u || { email, createdAt: new Date().toISOString() };
  u.name = String(b.name || u.name).trim().slice(0, 80);
  u.role = b.role;
  u.officerId = officerId;
  u.active = b.active !== false;
  if (b.password) Object.assign(u, auth.hashPassword(b.password));
  await auth.saveUser(u);
  res.json({ user: auth.publicUser(u), created: isNew });
}));

app.delete('/api/users/:email', adminOnly, wrap(async (req, res) => {
  const email = auth.normEmail(req.params.email);
  if (email === req.user.email) return res.status(400).json({ error: 'You cannot delete your own account.' });
  await auth.deleteUser(email);
  res.json({ ok: true });
}));

// --- samples + submit -------------------------------------------------------
app.get('/api/samples', anyUser, (req, res) => {
  res.json({ samples: SAMPLES.map((s) => ({ key: s.key, title: s.title, expect: s.expect, expectTone: s.expectTone, customer: s.customer, desc: s.desc, alert: s.alert })) });
});

const REQUIRED_FIELDS = ['alert_id', 'rule_code', 'subject_account', 'narrative'];

app.post('/api/alerts', auth.requireRole('analyst', 'admin'), wrap(async (req, res) => {
  let alert = req.body && req.body.alert;
  if (typeof alert === 'string') {
    try { alert = JSON.parse(alert); } catch (e) { return res.status(400).json({ error: 'The alert is not valid JSON: ' + e.message }); }
  }
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) return res.status(400).json({ error: 'Send the alert as one JSON object.' });
  const missing = REQUIRED_FIELDS.filter((f) => !String(alert[f] == null ? '' : alert[f]).trim());
  if (missing.length) return res.status(400).json({ error: 'Missing required field' + (missing.length > 1 ? 's' : '') + ': ' + missing.join(', ') });
  alert.alert_id = String(alert.alert_id).trim();
  if (alert.score != null && alert.score !== '') {
    const n = Number(alert.score);
    if (isNaN(n) || n < 0 || n > 100) return res.status(400).json({ error: 'Alert score must be a number from 0 to 100.' });
    alert.score = n;
  }
  const note = String((req.body && req.body.note) || '').trim().slice(0, 500);

  const existing = (await allCases()).find((c) => c.alertId === alert.alert_id);
  if (existing && !(req.body && req.body.allowDuplicate)) {
    return res.status(409).json({ error: `Alert ${alert.alert_id} was already submitted on ${String(existing.createdAt).slice(0, 10)}.`, existingId: canSee(req.user, existing) ? existing.id : '' });
  }

  const cust = String(alert.narrative || '').match(/\b(CUS-\d{3,})\b/);
  const meta = { alertId: alert.alert_id, submittedBy: req.user.name, rule: alert.rule_code };
  let created;
  try {
    created = await opus('POST', '/case', { workflowId: WORKFLOW_ID, title: `AML alert ${alert.alert_id}`, description: `${alert.rule_code} · ${alert.subject_account}` });
  } catch (e) {
    const sid = 'submit-' + Date.now();
    await runlog(sid, 'console', 'info', `Alert ${alert.alert_id} submitted by ${req.user.name}`, { rule: alert.rule_code, account: alert.subject_account, workflowId: WORKFLOW_ID }, Object.assign({ status: 'NOT_STARTED' }, meta));
    await runlog(sid, 'opus', 'error', 'Create case failed: ' + e.message, e.body);
    throw e;
  }
  const caseId = created.json.caseId || created.json.id;
  if (!caseId) throw new UpstreamError(502, 'The triage service did not return a case id.');
  await runlog(caseId, 'console', 'info', `Alert ${alert.alert_id} submitted by ${req.user.name}`, { rule: alert.rule_code, account: alert.subject_account, score: alert.score, flagged: alert.flagged_txns, workflowId: WORKFLOW_ID }, Object.assign({ status: 'PENDING' }, meta));
  await runlog(caseId, 'opus', 'info', 'Case created', { caseId });

  // Send the alert with the type the workflow declares for its input
  // (json_string). Sent as plain "str" the input step fails at once.
  const spec = await inputSpec();
  const payload = { [INPUT_VAR]: { value: JSON.stringify(alert), type: spec.type, displayName: spec.displayName } };
  if (spec.typeDefinition) payload[INPUT_VAR].typeDefinition = spec.typeDefinition;
  try {
    await opus('POST', `/case/${encodeURIComponent(caseId)}/execute`, { payload });
    await runlog(caseId, 'opus', 'info', `Execution started (input ${INPUT_VAR} sent as ${spec.type}${spec.fromWorkflow ? ', read from the workflow' : ', default'})`);
  } catch (e) {
    if ((e.status === 400 || e.status === 422) && payload[INPUT_VAR].type !== 'str') {
      await runlog(caseId, 'opus', 'warn', `Execute refused with ${spec.type} (${e.status}); retrying with str`, e.body);
      payload[INPUT_VAR].type = 'str';
      delete payload[INPUT_VAR].typeDefinition;
      try {
        await opus('POST', `/case/${encodeURIComponent(caseId)}/execute`, { payload });
        await runlog(caseId, 'opus', 'info', 'Execution started (input sent as str)');
      } catch (e2) { await runlog(caseId, 'opus', 'error', 'Execute failed: ' + e2.message, e2.body, { status: 'FAILED' }); throw e2; }
    } else { await runlog(caseId, 'opus', 'error', 'Execute failed: ' + e.message, e.body, { status: 'FAILED' }); throw e; }
  }

  const c = {
    id: caseId, caseId,
    alertId: alert.alert_id,
    rule: alert.rule_code,
    alertScore: alert.score != null ? alert.score : null,
    priority: alert.priority || '',
    account: alert.subject_account,
    customerId: cust ? cust[1] : '',
    alert,
    note,
    opusStatus: 'PENDING',
    submittedBy: req.user.email,
    submittedByName: req.user.name,
    submittedRole: req.user.role,
    createdAt: new Date().toISOString(),
    duplicateOf: existing ? existing.id : '',
  };
  await saveCase(c);
  res.status(201).json({ case: toRow(c, null) });
}));

// --- cases ------------------------------------------------------------------
app.get('/api/cases', anyUser, wrap(async (req, res) => {
  res.json({ cases: await rowsFor(req.user, true), scope: req.user.role === 'analyst' ? 'mine' : 'all' });
}));

// Admin clean-up: keep the newest few, delete the rest with their reviews.
app.post('/api/cases/clear', adminOnly, wrap(async (req, res) => {
  const cases = await allCases();
  const reviews = await allReviews();
  // mode 'unfinished': only alerts that stopped without a disposition.
  // mode 'all': every alert. Alerts still being investigated are always kept.
  const mode = req.body && req.body.mode === 'all' ? 'all' : 'unfinished';
  const running = (c) => !TERMINAL.includes(c.opusStatus);
  const unfinished = (c) => !running(c) && (c.opusStatus !== 'COMPLETED' || !(c.result && c.result.final_disposition));
  const drop = cases.filter((c) => !running(c) && (mode === 'all' || unfinished(c)));
  for (const c of drop) await deleteCaseAndReviews(c, reviews, req.user.name);
  res.json({ mode, cleared: drop.length, kept: cases.length - drop.length, running: cases.filter(running).length });
}));

async function caseForReq(req, res) {
  const c = await getCase(req.params.id);
  if (!c || c.deleted || !canSee(req.user, c)) { res.status(404).json({ error: 'Case not found.' }); return null; }
  return c;
}

app.get('/api/cases/:id', anyUser, wrap(async (req, res) => {
  const c = await caseForReq(req, res); if (!c) return;
  await refreshCase(c, true);
  const ev = await getEvidence(c);
  const review = reviewForCase(c, await allReviews());
  const original = c.duplicateOf ? await getCase(c.duplicateOf) : null;
  const pr = review ? publicReview(review) : null;
  if (pr) pr.ownAlert = c.submittedBy === req.user.email;
  res.json({
    case: toRow(c, review),
    alert: c.alert,
    result: c.result || null,
    evidence: ev,
    review: pr,
    duplicateOfAlert: original && canSee(req.user, original) ? original.alertId : '',
  });
}));

// What "Report a problem" puts in the email for this case.
app.get('/api/cases/:id/support', anyUser, wrap(async (req, res) => {
  const c = await caseForReq(req, res); if (!c) return;
  const review = reviewForCase(c, await allReviews());
  const row = toRow(c, review);
  const ev = evCache.get(c.id) ? evCache.get(c.id).ev : await store.get('aml:evidence:' + c.id);
  const failedStage = ev && ev.stages ? ev.stages.find((s) => s.status === 'FAILED' || s.status === 'STOPPED') : null;
  const failed = ['FAILED', 'TIMED_OUT', 'CANCELLED', 'COMPLETED_NO_RESULT'].includes(row.stage);
  res.json({
    caseId: c.caseId,
    executionId: c.caseId,
    reference: c.alertId,
    status: row.stage,
    failed,
    failedAt: failed && failedStage ? failedStage.label : null,
    reason: failed ? (c.error || (row.stage === 'TIMED_OUT' ? 'The officer review window closed before a decision was recorded.' : 'The case stopped before a disposition was recorded.')) : null,
    reviewExecutionId: review ? review.executionId : null,
    submittedAt: c.createdAt,
    submittedBy: submitterName(c),
    finishedAt: c.finishedAt || null,
    workflowId: WORKFLOW_ID,
  });
}));

app.post('/api/cases/:id/refresh', anyUser, wrap(async (req, res) => {
  const c = await caseForReq(req, res); if (!c) return;
  evCache.delete(c.id);
  await refreshCase(c, true);
  res.json({ ok: true });
}));

app.delete('/api/cases/:id', adminOnly, wrap(async (req, res) => {
  const c = await getCase(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  await deleteCaseAndReviews(c, await allReviews(), req.user.name);
  res.json({ ok: true });
}));

function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

app.get('/api/export.csv', officerOrAdmin, wrap(async (req, res) => {
  let rows = await rowsFor(req.user, false);
  if (req.query.preset !== undefined) {
    const { from, to } = report.periodBounds(req.query);
    rows = rows.filter((r) => { const t = Date.parse(r.createdAt); return (!from || t >= from.getTime()) && (!to || t < to.getTime()); });
  }
  const cols = ['alertId', 'customerId', 'customerName', 'kycRisk', 'account', 'rule', 'alertScore', 'riskScore', 'recommended', 'officerAction', 'finalDisposition', 'queue', 'slaHours', 'officerId', 'officerName', 'stage', 'submittedBy', 'createdAt', 'finishedAt', 'durationMs', 'duplicateOf'];
  const lines = [cols.join(',')].concat(rows.map((r) => cols.map((k) => csvCell(r[k])).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="aml-alerts-' + new Date().toISOString().slice(0, 10) + '.csv"');
  res.send(lines.join('\n'));
}));

// --- reports + read-only neighbour views -------------------------------------
app.get('/api/report', anyUser, wrap(async (req, res) => {
  const rows = await rowsFor(req.user, false);
  const out = report.build(rows, req.query);
  out.scope = req.user.role === 'analyst' ? 'mine' : 'all';
  res.json(out);
}));

function tally(rows, keyFn, extra) {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyFn(r); if (!k) return;
    if (!m.has(k)) m.set(k, Object.assign({ key: k, alerts: 0, open: 0, CLOSE: 0, REFER: 0, ESCALATE: 0, last: '' }, extra ? extra(r) : {}));
    const g = m.get(k);
    g.alerts++;
    if (r.stage === 'COMPLETED' && DISPOSITIONS.includes(r.finalDisposition)) g[r.finalDisposition]++;
    else if (['QUEUED', 'RUNNING', 'FINALISING', 'AWAITING_REVIEW'].includes(r.stage)) g.open++;
    if (String(r.createdAt) > g.last) g.last = r.createdAt;
    if (extra) Object.entries(extra(r)).forEach(([kk, v]) => { if (v && !g[kk]) g[kk] = v; });
  });
  return [...m.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)));
}

app.get('/api/customers', anyUser, wrap(async (req, res) => {
  const rows = await rowsFor(req.user, false);
  res.json({ customers: tally(rows, (r) => r.customerId || null, (r) => ({ name: r.customerName, kycRisk: r.kycRisk, account: r.account })) });
}));

app.get('/api/rules', anyUser, wrap(async (req, res) => {
  const rows = await rowsFor(req.user, false);
  res.json({ rules: tally(rows, (r) => r.rule || null).map((g) => { const done = g.CLOSE + g.REFER + g.ESCALATE; return Object.assign(g, { finished: done, fpRate: done ? g.CLOSE / done : null }); }) });
}));

app.get('/api/queues', anyUser, wrap(async (req, res) => {
  const rows = (await rowsFor(req.user, false)).filter((r) => r.stage === 'COMPLETED' && r.queue);
  res.json({ items: rows.map((r) => ({ id: r.id, alertId: r.alertId, customerName: r.customerName, customerId: r.customerId, queue: r.queue, finalDisposition: r.finalDisposition, slaHours: r.slaHours, routedAt: r.finishedAt, dueAt: r.slaHours && r.finishedAt ? new Date(Date.parse(r.finishedAt) + r.slaHours * 3600000).toISOString() : null, officerName: r.officerName, officerId: r.officerId, riskScore: r.riskScore })) });
}));

// --- officer reviews --------------------------------------------------------
function publicReview(r) {
  const m = r.manifest || {};
  return {
    id: r.id,
    linkedCaseId: r.linkedCaseId || '',
    alertId: r.alertId || m.alert_id || '',
    customerName: m.customer_name || '',
    customerId: m.customer_id || '',
    receivedAt: r.receivedAt,
    deadline: r.deadline,
    state: reviewState(r),
    manifest: r.manifest || null,
    presentation: r.md || '',
    decision: r.decision || null,
    error: r.error || '',
  };
}

app.get('/api/reviews', officerOrAdmin, wrap(async (req, res) => {
  const reviews = await allReviews();
  const cases = await store.hgetall(CASES_KEY);
  const list = reviews.map((r) => {
    const p = publicReview(r);
    const c = r.linkedCaseId && cases[r.linkedCaseId];
    if (c) { p.rule = c.rule; p.account = c.account; p.priority = c.priority; p.submittedBy = submitterName(c); p.ownAlert = c.submittedBy === req.user.email; p.caseStage = toRow(c, r).stage; p.finalDisposition = (c.result && c.result.final_disposition) || ''; p.queue = (c.result && c.result.routing && c.result.routing.queue) || ''; }
    delete p.presentation;
    return p;
  });
  const pending = list.filter((r) => r.state === 'PENDING' || r.state === 'SUBMITTING').sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
  const log = list.filter((r) => r.decision).sort((a, b) => String(b.decision.at).localeCompare(String(a.decision.at))).slice(0, 50);
  res.json({ reviews: list, pending, log });
}));

app.get('/api/reviews/:id', officerOrAdmin, wrap(async (req, res) => {
  const r = await getReview(req.params.id);
  if (!r || r.deleted) return res.status(404).json({ error: 'Review not found.' });
  res.json({ review: publicReview(r) });
}));

app.delete('/api/reviews/:id', adminOnly, wrap(async (req, res) => {
  await store.hdel(REVIEWS_KEY, req.params.id);
  res.json({ ok: true });
}));

function oneLine(s) { return String(s || '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, ''); }

function composeResponse(action, newDisp, text, officerId) {
  const t = oneLine(text);
  if (action === 'CONFIRM') return `CONFIRM: ${t}. Officer: ${officerId}`;
  if (action === 'OVERRIDE') return `OVERRIDE to ${newDisp}: ${t}. Officer: ${officerId}`;
  return `ANNOTATE: ${t}. Officer: ${officerId}`;
}

function buildOutputData(expected, responseText, d) {
  const out = {};
  const fields = expected && typeof expected === 'object' ? Object.values(expected) : [];
  if (!fields.length) { out[OFFICER_RESPONSE_VAR] = responseText; return out; }
  let usedMain = false;
  for (const f of fields) {
    const name = f.variable_name || f.variableName;
    if (!name) continue;
    const label = String(f.display_name || f.displayName || name).toLowerCase();
    const type = String(f.type || (f.allowed_types && f.allowed_types[0] && f.allowed_types[0].type) || 'str').toLowerCase();
    if (/officer.?id/.test(label)) out[name] = d.officerId;
    else if (/^action|officer action|decision type/.test(label)) out[name] = d.action;
    else if (/disposition/.test(label) && !/response/.test(label)) out[name] = d.finalDisposition;
    else if (/rationale|reason|note/.test(label) && usedMain) out[name] = oneLine(d.rationale);
    else if (!usedMain && (type === 'str' || type === 'string' || type === 'text')) { out[name] = responseText; usedMain = true; }
    else if (type === 'bool' || type === 'boolean') out[name] = d.action !== 'OVERRIDE';
    else if (!f.is_nullable) out[name] = responseText;
  }
  if (!usedMain && !Object.values(out).includes(responseText)) {
    const first = fields.find((f) => f.variable_name);
    if (first) out[first.variable_name] = responseText;
  }
  return out;
}

app.post('/api/reviews/:id/decision', officerOrAdmin, wrap(async (req, res) => {
  const r = await getReview(req.params.id);
  if (!r || r.deleted) return res.status(404).json({ error: 'Review not found.' });
  const state = reviewState(r);
  if (state === 'DECIDED') return res.status(409).json({ error: 'This review was already decided by ' + ((r.decision && r.decision.byName) || 'another officer') + '.' });
  if (state === 'EXPIRED') { await runlog(r.linkedCaseId || r.executionId, 'officer', 'error', `${req.user.name} tried to decide after the review window closed`); return res.status(410).json({ error: 'The review window for this alert has closed, so the decision can no longer be recorded. The case has timed out on the triage service.' }); }
  if (r.status === 'SUBMITTING' && r.lockedAt && Date.now() - Date.parse(r.lockedAt) < 30000) return res.status(409).json({ error: 'Another officer is submitting a decision for this alert right now.' });
  const linked = r.linkedCaseId ? await getCase(r.linkedCaseId) : null;
  if (linked && linked.submittedBy === req.user.email) return res.status(409).json({ error: 'You submitted this alert, so another officer must decide it.' });

  const b = req.body || {};
  const action = String(b.action || '').toUpperCase();
  if (!ACTIONS.includes(action)) return res.status(400).json({ error: 'Choose Confirm, Override or Annotate.' });
  const recommended = (r.manifest && r.manifest.case_header && r.manifest.case_header.recommended_disposition) || '';
  let finalDisp = recommended;
  if (action === 'OVERRIDE') {
    finalDisp = String(b.newDisposition || '').toUpperCase();
    if (!DISPOSITIONS.includes(finalDisp)) return res.status(400).json({ error: 'Choose the new disposition: Escalate, Refer or Close.' });
    if (finalDisp === recommended) return res.status(400).json({ error: 'The new disposition is the same as the recommendation. Use Confirm or Annotate instead.' });
  }
  const text = oneLine(b.rationale);
  if (text.length < 10) return res.status(400).json({ error: action === 'ANNOTATE' ? 'Write your notes (at least 10 characters).' : 'Write your rationale (at least 10 characters). It is kept word for word in the audit trail.' });
  if (text.length > 1500) return res.status(400).json({ error: 'Keep the rationale under 1,500 characters.' });
  const officerId = auth.officerIdOf(req.user);
  const responseText = composeResponse(action, finalDisp, text, officerId);

  r.status = 'SUBMITTING'; r.lockedAt = new Date().toISOString();
  await saveReview(r);

  const outputData = buildOutputData(r.expected, responseText, { officerId, action, finalDisposition: finalDisp, rationale: text });
  let resp; let respText = '';
  try {
    const headers = { 'Content-Type': 'application/json' };
    headers[r.callback.header || 'x-callback-token'] = r.callback.token;
    await runlog(r.linkedCaseId || r.executionId, 'officer', 'info', `Decision by ${req.user.name} (${officerId || 'no officer ID'}): ${responseText}`, { outputFields: Object.keys(outputData) });
    resp = await fetch(r.callback.url, { method: 'POST', headers, body: JSON.stringify({ output_data: outputData, status: 'success' }) });
    respText = await resp.text();
  } catch (e) {
    r.status = 'PENDING'; r.error = 'Could not reach the triage service. Try again.';
    await runlog(r.linkedCaseId || r.executionId, 'opus', 'error', 'Decision callback could not reach Opus: ' + e.message);
    await saveReview(r);
    return res.status(502).json({ error: r.error });
  }

  await runlog(r.linkedCaseId || r.executionId, 'opus', resp.status >= 200 && resp.status < 300 ? 'info' : 'error', `Decision callback answered ${resp.status}${resp.status >= 200 && resp.status < 300 ? ' — the workflow resumes' : ''}`, resp.status >= 300 ? clip(respText, 1500) : null);
  if (resp.status >= 200 && resp.status < 300) {
    r.status = 'DECIDED';
    r.error = '';
    r.decision = { action, finalDisposition: finalDisp, recommended, rationale: text, officerId, by: req.user.email, byName: req.user.name, at: new Date().toISOString(), responseText };
    await saveReview(r);
    if (linked) { linked.decision = r.decision; linked.opusStatus = linked.opusStatus === 'WAITING' ? 'IN_PROGRESS' : linked.opusStatus; await saveCase(linked); lastPoll.delete(linked.id); }
    return res.json({ ok: true, review: publicReview(r) });
  }
  if (resp.status === 401) {
    r.status = 'EXPIRED'; r.error = 'The triage service no longer accepts a decision for this alert (the review window closed or it was already answered).';
    await saveReview(r);
    return res.status(410).json({ error: r.error });
  }
  r.status = 'PENDING';
  r.error = 'The triage service rejected the decision (' + resp.status + '). ' + respText.slice(0, 200);
  await saveReview(r);
  return res.status(502).json({ error: r.error });
}));

// Inbound review request from the workflow (off-platform review task).
// Last webhook calls, so the System page can say why Opus could not hand over a review.
// Only header NAMES are kept, never values.
async function logHook(req, status, reason, body) {
  try {
    const list = (await store.get('aml:webhook-log')) || [];
    const b = body || req.body || {};
    list.unshift({ at: new Date().toISOString(), status, reason,
      headers: Object.keys(req.headers || {}).filter((h) => !/^(x-vercel|x-forwarded|x-real-ip|forwarded|cookie|authorization)/.test(h)).sort(),
      executionId: String(b.execution_id || ''), bodyKeys: b && typeof b === 'object' ? Object.keys(b).slice(0, 12) : [] });
    await store.set('aml:webhook-log', list.slice(0, 10));
    if (b.execution_id) {
      const ok = status >= 200 && status < 300;
      await runlog(String(b.execution_id), 'webhook', ok ? 'info' : 'error',
        ok ? 'Officer review packet received from Opus: ' + reason : `Officer review hand-over refused (${status}): ${reason}`,
        { headers: Object.keys(req.headers || {}).filter((h) => !/^(x-vercel|x-forwarded|x-real-ip|forwarded|cookie|authorization)/.test(h)).sort(), bodyKeys: Object.keys(b).slice(0, 12) });
    }
  } catch (e) { }
}

app.post('/api/review-webhook', wrap(async (req, res) => {
  const want = process.env.REVIEW_WEBHOOK_SECRET;
  if (!want) { await logHook(req, 503, 'REVIEW_WEBHOOK_SECRET is not set in Vercel.'); return res.status(503).json({ error: 'Review webhook is not configured.' }); }
  // The secret can come as a header (preferred) or, for tools that cannot set headers,
  // as ?key=... on the webhook URL.
  const viaQuery = !req.headers[WEBHOOK_HEADER] && req.query && req.query.key;
  const got = String(req.headers[WEBHOOK_HEADER] || (req.query && req.query.key) || '');
  const ok = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) {
    await logHook(req, 401, got ? (viaQuery ? 'The ?key= on the URL does not match REVIEW_WEBHOOK_SECRET.' : `Header ${WEBHOOK_HEADER} was sent but its value does not match REVIEW_WEBHOOK_SECRET.`) : `No secret: header ${WEBHOOK_HEADER} was not sent and the URL has no ?key=.`);
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const p = req.body || {};
  const cb = p.callback || {};
  if (!cb.url || !cb.token) { await logHook(req, 400, 'The body has no callback url/token (is the task set to "callback" mode?).'); return res.status(400).json({ error: 'Missing callback.' }); }
  await logHook(req, 200, viaQuery ? 'Accepted (secret from the URL).' : 'Accepted.', p);
  const id = crypto.createHash('sha256').update(String(cb.token)).digest('hex').slice(0, 20);
  if (await getReview(id)) return res.json({ ok: true, id, duplicate: true });

  const { manifest, md } = evidence.findPacket(p.inputs || p);
  const alertId = (manifest && manifest.alert_id) || ((md || '').match(/CASE REVIEW · (\S+)/) || [])[1] || '';
  const receivedAt = new Date();
  const r = {
    id,
    executionId: String(p.execution_id || ''),
    workflowId: String(p.workflow_id || ''),
    receivedAt: receivedAt.toISOString(),
    deadline: new Date(receivedAt.getTime() + REVIEW_TIMEOUT_MIN * 60000).toISOString(),
    callback: { url: String(cb.url), token: String(cb.token), header: String(cb.token_header || 'x-callback-token') },
    expected: p.expected_output_schema || null,
    manifest: manifest || null,
    md: md || '',
    alertId,
    status: 'PENDING',
    linkedCaseId: '',
  };

  // Link to our case: same execution id, else the newest open case for that alert id.
  const cases = await allCases();
  let c = cases.find((x) => x.caseId === r.executionId || x.id === r.executionId);
  if (!c && alertId) c = cases.find((x) => x.alertId === alertId && !TERMINAL.includes(x.opusStatus));
  if (!c && alertId) c = cases.find((x) => x.alertId === alertId);
  if (c) {
    r.linkedCaseId = c.id;
    await runlog(c.id, 'webhook', 'info', `Review linked to the alert; officer window ${REVIEW_TIMEOUT_MIN} min, closes ${r.deadline}`,
      { reviewId: id, recommended: manifest && manifest.case_header && manifest.case_header.recommended_disposition, riskScore: manifest && manifest.case_header && manifest.case_header.risk_score, expectedOutputs: Object.keys(r.expected || {}) }, { status: 'WAITING' });
    c.opusStatus = TERMINAL.includes(c.opusStatus) ? c.opusStatus : 'WAITING';
    if (manifest && manifest.case_header) {
      if (DISPOSITIONS.includes(manifest.case_header.recommended_disposition)) c.recommended = manifest.case_header.recommended_disposition;
      if (manifest.case_header.risk_score != null) c.riskScore = Number(manifest.case_header.risk_score);
    }
    if (manifest && manifest.customer_name) c.customerName = manifest.customer_name;
    await saveCase(c);
  }
  if (!c) await runlog(r.executionId || ('review-' + id), 'webhook', 'warn', `Review packet for ${alertId || 'an unknown alert'} did not match any alert submitted from this console`, { reviewId: id, executionId: r.executionId });
  await saveReview(r);
  res.json({ ok: true, id });
}));

// --- run logs (admin) ------------------------------------------------------
app.get('/api/runlogs', adminOnly, wrap(async (req, res) => {
  const idx = await store.hgetall(RUNLOG_INDEX);
  const cases = await store.hgetall(CASES_KEY);
  const list = Object.values(idx).map((x) => {
    const c = cases[x.id];
    return Object.assign({}, x, c ? { stage: toRow(c, null).stage, alertId: x.alertId || c.alertId, customerName: c.customerName || '' } : { stage: x.removed ? 'REMOVED' : (x.status || '') });
  }).sort((a, b) => String(b.firstAt).localeCompare(String(a.firstAt))).slice(0, 200);
  res.json({ runs: list, keptDays: RUNLOG_TTL / 86400 });
}));

app.get('/api/runlogs/:id', adminOnly, wrap(async (req, res) => {
  const id = String(req.params.id);
  const meta = await store.hget(RUNLOG_INDEX, id);
  const events = await store.list('aml:runlog:' + id);
  if (!meta && !events.length) return res.status(404).json({ error: 'No log for this run.' });
  const c = await getCase(id);
  let steps = [];
  let caseInfo = null;
  if (c) {
    await refreshCase(c, true);
    const ev = await getEvidence(c);
    steps = ev.nodes || [];
    const row = toRow(c, reviewForCase(c, await allReviews()));
    caseInfo = { id: c.id, caseId: c.caseId, alertId: c.alertId, stage: row.stage, opusStatus: c.opusStatus, createdAt: c.createdAt, finishedAt: c.finishedAt || null, error: c.error || '', finalDisposition: row.finalDisposition, queue: row.queue };
  }
  res.json({ id, workflowId: WORKFLOW_ID, meta: meta || null, case: caseInfo, steps, events });
}));

// --- admin system view ------------------------------------------------------
app.get('/api/system', adminOnly, wrap(async (req, res) => {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const cases = await allCases();
  const reviews = await allReviews();
  res.json({
    missing: missingEnv(),
    storage: store.mode(),
    demo: auth.demoEnabled(),
    workflowId: WORKFLOW_ID,
    apiBase: API_BASE,
    inputVar: INPUT_VAR,
    outputVar: OUTPUT_VAR,
    officerResponseVar: OFFICER_RESPONSE_VAR,
    webhookUrl: host ? `${proto}://${host}/api/review-webhook` : '/api/review-webhook',
    webhookHeader: WEBHOOK_HEADER,
    reviewTimeoutMinutes: REVIEW_TIMEOUT_MIN,
    supportEmail: SUPPORT_EMAIL,
    counts: { cases: cases.length, reviews: reviews.length, unlinkedReviews: reviews.filter((r) => !r.linkedCaseId).length },
    inputType: (await inputSpec()).type,
    inputTypeFromWorkflow: (await inputSpec()).fromWorkflow,
    webhookLog: (await store.get('aml:webhook-log')) || [],
    unlinked: reviews.filter((r) => !r.linkedCaseId).map((r) => ({ id: r.id, alertId: r.alertId, receivedAt: r.receivedAt, state: reviewState(r), executionId: r.executionId })),
  });
}));

// --- static -----------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// Unknown page: a proper page with the console's menu instead of "Cannot GET".
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('AML console on http://localhost:' + port));
}
