// AML alert triage console — Express backend.
// The service key lives only here (env var). The browser talks to /api/* only.
'use strict';
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const auth = require('./lib/auth');
const evidence = require('./lib/evidence');
const { SAMPLES } = require('./lib/samples');

// ---------------------------------------------------------------------------
// Workflow contract (pinned from the workflow builder, version 1.2)
// ---------------------------------------------------------------------------
const API_BASE = (process.env.OPUS_API_BASE || 'https://operator.opus.com/api/v1').replace(/\/+$/, '');
const WORKFLOW_ID = process.env.OPUS_WORKFLOW_ID || '67761781-8be5-4dd8-a1de-af898247c7a5';
const INPUT_VAR = 'workflow_input_806ktowl2';            // TM Alert (JSON string)
const INPUT_DISPLAY = 'TM Alert';
const OUTPUT_VAR = 'workflow_output_bj5nkid7u';          // Final Disposition & Audit Trail (object)
const OFFICER_RESPONSE_VAR = 'workflow_output_feqiebau8'; // Officer Response (str) on the review step
const REVIEW_TIMEOUT_MIN = Number(process.env.REVIEW_TIMEOUT_MINUTES || 10);
const WEBHOOK_HEADER = String(process.env.REVIEW_WEBHOOK_HEADER || 'x-webhook-secret').toLowerCase();

const APP_NAME = process.env.APP_NAME || 'AML Alert Triage';
const ORG_NAME = process.env.ORG_NAME || 'Financial Crime Compliance';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || '';

const CASES_KEY = 'aml:cases';
const REVIEWS_KEY = 'aml:reviews';
const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
const DISPOSITIONS = ['ESCALATE', 'REFER', 'CLOSE'];
const ACTIONS = ['CONFIRM', 'OVERRIDE', 'ANNOTATE'];

function serviceKey() { return process.env.OPUS_SERVICE_KEY || process.env.OPUS_API_KEY || ''; }

function missingEnv() {
  const m = [];
  if (!serviceKey()) m.push('OPUS_SERVICE_KEY');
  if (!process.env.ADMIN_PASSWORD) m.push('ADMIN_PASSWORD');
  if (!process.env.SESSION_SECRET) m.push('SESSION_SECRET');
  if (!process.env.REVIEW_WEBHOOK_SECRET) m.push('REVIEW_WEBHOOK_SECRET');
  if (!SUPPORT_EMAIL) m.push('SUPPORT_EMAIL (where Contact Opus sends messages)');
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

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------
const getCase = (id) => store.hget(CASES_KEY, id);
const saveCase = (c) => { c.updatedAt = new Date().toISOString(); return store.hset(CASES_KEY, c.id, c); };
const getReview = (id) => store.hget(REVIEWS_KEY, id);
const saveReview = (r) => store.hset(REVIEWS_KEY, r.id, r);

async function allCases() {
  const all = await store.hgetall(CASES_KEY);
  return Object.values(all).filter((c) => !c.deleted).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
async function allReviews() {
  const all = await store.hgetall(REVIEWS_KEY);
  return Object.values(all).filter((r) => !r.deleted).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
}

function reviewState(r) {
  if (!r) return null;
  if (r.status === 'PENDING' && r.deadline && Date.parse(r.deadline) < Date.now()) return 'EXPIRED';
  return r.status;
}

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
  return {
    id: c.id,
    alertId: c.alertId,
    customerId: c.customerId || '',
    customerName: c.customerName || '',
    account: c.account || '',
    rule: c.rule || '',
    alertScore: c.alertScore,
    priority: c.priority || '',
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    submittedBy: c.submittedByName || c.submittedBy,
    submittedByUser: c.submittedBy,
    opusStatus: c.opusStatus || 'PENDING',
    stage,
    recommended: c.recommended || rec.system_recommendation || '',
    riskScore: c.riskScore != null ? c.riskScore : (rec.risk_score_at_decision != null ? rec.risk_score_at_decision : null),
    finalDisposition: res.final_disposition || '',
    queue: routing.queue || '',
    slaHours: routing.sla_hours != null ? routing.sla_hours : null,
    officerAction: rec.officer_action || (c.decision && c.decision.action) || '',
    officerId: rec.officer_id || (c.decision && c.decision.officerId) || '',
    reviewId: review ? review.id : '',
    reviewState: review ? reviewState(review) : '',
    reviewDeadline: review ? review.deadline : '',
    duplicateOf: c.duplicateOf || '',
    error: c.error || '',
  };
}

function reviewForCase(c, reviews) {
  const linked = reviews.filter((r) => r.linkedCaseId === c.id);
  return linked.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))[0] || null;
}

// ---------------------------------------------------------------------------
// Status refresh (throttled per case)
// ---------------------------------------------------------------------------
const lastPoll = new Map();

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
    c.opusStatus = st;
    if (st === 'COMPLETED' && !c.result) {
      const r = await opus('GET', `/case/${encodeURIComponent(c.caseId)}/results`);
      if (r.status === 200 && r.json && r.json.results) {
        const out = r.json.results[OUTPUT_VAR] || Object.values(r.json.results)[0];
        const val = out ? evidence.tryJson(out.value) : null;
        c.result = val && typeof val === 'object' ? val : {};
        c.completedAt = c.completedAt || new Date().toISOString();
        changed = true;
      }
    }
    if (TERMINAL.includes(st) && !c.finishedAt) { c.finishedAt = new Date().toISOString(); changed = true; }
    c.error = '';
    if (changed) await saveCase(c);
  } catch (e) {
    if (e.status === 404) { c.opusStatus = 'FAILED'; c.error = 'The case no longer exists on the triage service.'; await saveCase(c); }
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
  // Remember headline numbers on the case so lists can show them.
  const nar = ev.data.narrative && typeof ev.data.narrative === 'object' ? ev.data.narrative : null;
  const man = ev.data.manifest && typeof ev.data.manifest === 'object' ? ev.data.manifest : null;
  let dirty = false;
  const rec = (man && man.case_header && man.case_header.recommended_disposition) || (nar && nar.disposition && nar.disposition.recommendation);
  const score = (man && man.case_header && man.case_header.risk_score) != null ? man.case_header.risk_score : (nar ? nar.blended_risk_score : null);
  const cname = (man && man.customer_name) || (nar && nar.customer_name);
  const cid = (man && man.customer_id) || (nar && nar.customer_id) || (ev.data.parsedAlert && ev.data.parsedAlert.customer_id);
  if (rec && DISPOSITIONS.includes(rec) && c.recommended !== rec) { c.recommended = rec; dirty = true; }
  if (score != null && !isNaN(Number(score)) && c.riskScore !== Number(score)) { c.riskScore = Number(score); dirty = true; }
  if (cname && c.customerName !== cname) { c.customerName = cname; dirty = true; }
  if (cid && c.customerId !== cid) { c.customerId = cid; dirty = true; }
  if (dirty) await saveCase(c);
  evCache.set(c.id, { at: Date.now(), status: c.opusStatus, ev });
  if (TERMINAL.includes(c.opusStatus) && ev.hasAudit) await store.set(key, ev);
  return ev;
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
  const out = { ok: missing.length === 0, app: APP_NAME };
  if (req.user && req.user.role === 'admin') out.missing = missing;
  res.json(out);
}));

app.get('/api/config', (req, res) => {
  res.json({ appName: APP_NAME, orgName: ORG_NAME, supportEmail: SUPPORT_EMAIL, reviewTimeoutMinutes: REVIEW_TIMEOUT_MIN });
});

// --- auth -------------------------------------------------------------------
const loginAttempts = new Map();
app.post('/api/login', wrap(async (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
  await auth.ensureBootstrapAdmin();
  const { username, password } = req.body || {};
  const u = await auth.getUser(username);
  if (!u || u.active === false || !auth.checkPassword(password || '', u)) {
    a.n++; loginAttempts.set(ip, a);
    if (!process.env.ADMIN_PASSWORD && !u) return res.status(401).json({ error: 'Sign-in is not set up yet. The administrator must set ADMIN_PASSWORD and redeploy.' });
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  loginAttempts.delete(ip);
  auth.setSession(res, u.username);
  res.json({ user: auth.publicUser(u) });
}));

app.post('/api/logout', (req, res) => { auth.clearSession(res); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  res.json({ user: auth.publicUser(req.user), appName: APP_NAME, orgName: ORG_NAME, supportEmail: SUPPORT_EMAIL, workflowId: WORKFLOW_ID, reviewTimeoutMinutes: REVIEW_TIMEOUT_MIN, storage: store.persistent() ? 'ok' : 'memory' });
});

app.post('/api/me/password', anyUser, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!auth.checkPassword(current || '', req.user)) return res.status(400).json({ error: 'Your current password is not correct.' });
  if (!next || String(next).length < 8) return res.status(400).json({ error: 'The new password needs at least 8 characters.' });
  Object.assign(req.user, auth.hashPassword(next));
  await auth.saveUser(req.user);
  res.json({ ok: true });
}));

// --- users (admin) ----------------------------------------------------------
app.get('/api/users', adminOnly, wrap(async (req, res) => {
  res.json({ users: (await auth.allUsers()).map(auth.publicUser) });
}));

app.post('/api/users', adminOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const username = auth.normName(b.username);
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: 'Username: 3–40 characters, letters, digits, dot, dash or underscore.' });
  if (!auth.ROLES.includes(b.role)) return res.status(400).json({ error: 'Pick a role.' });
  let u = await auth.getUser(username);
  const isNew = !u;
  if (isNew && (!b.password || String(b.password).length < 8)) return res.status(400).json({ error: 'Set a password of at least 8 characters.' });
  if (b.role === 'officer' && !String(b.officerId || (u && u.officerId) || '').trim()) return res.status(400).json({ error: 'Compliance officers need an officer ID (for example OFF-2147). It is written into the audit trail.' });
  if (!isNew && u.username === req.user.username && b.role !== 'admin') return res.status(400).json({ error: 'You cannot remove your own administrator role.' });
  u = u || { username, createdAt: new Date().toISOString() };
  u.name = String(b.name || u.name || username).slice(0, 80);
  u.role = b.role;
  u.officerId = String(b.officerId != null ? b.officerId : (u.officerId || '')).trim().toUpperCase().slice(0, 30);
  u.active = b.active !== false;
  if (b.password) Object.assign(u, auth.hashPassword(b.password));
  await auth.saveUser(u);
  res.json({ user: auth.publicUser(u), created: isNew });
}));

app.delete('/api/users/:username', adminOnly, wrap(async (req, res) => {
  const name = auth.normName(req.params.username);
  if (name === req.user.username) return res.status(400).json({ error: 'You cannot delete your own account.' });
  await auth.deleteUser(name);
  res.json({ ok: true });
}));

// --- samples + submit -------------------------------------------------------
app.get('/api/samples', anyUser, (req, res) => {
  res.json({ samples: SAMPLES.map((s) => ({ key: s.key, title: s.title, expect: s.expect, customer: s.customer, alert: s.alert })) });
});

const REQUIRED_FIELDS = ['alert_id', 'rule_code', 'subject_account', 'narrative'];

app.post('/api/alerts', auth.requireRole('analyst', 'admin', 'officer'), wrap(async (req, res) => {
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

  const existing = (await allCases()).find((c) => c.alertId === alert.alert_id);
  if (existing && !(req.body && req.body.allowDuplicate)) {
    return res.status(409).json({ error: `Alert ${alert.alert_id} was already submitted on ${existing.createdAt.slice(0, 10)}.`, existingId: existing.id });
  }

  const cust = String(alert.narrative || '').match(/\b(CUS-\d{3,})\b/);
  const created = await opus('POST', '/case', { workflowId: WORKFLOW_ID, title: `AML alert ${alert.alert_id}`, description: `${alert.rule_code} · ${alert.subject_account}` });
  const caseId = created.json.caseId || created.json.id;
  if (!caseId) throw new UpstreamError(502, 'The triage service did not return a case id.');

  const payload = { [INPUT_VAR]: { value: JSON.stringify(alert), type: 'str', displayName: INPUT_DISPLAY } };
  try {
    await opus('POST', `/case/${encodeURIComponent(caseId)}/execute`, { payload });
  } catch (e) {
    // Some deployments expect the declared json_string type name. Retry once on a validation error.
    if (e.status === 400 || e.status === 422) {
      payload[INPUT_VAR].type = 'json_string';
      await opus('POST', `/case/${encodeURIComponent(caseId)}/execute`, { payload });
    } else throw e;
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
    opusStatus: 'PENDING',
    submittedBy: req.user.username,
    submittedByName: req.user.name || req.user.username,
    createdAt: new Date().toISOString(),
    duplicateOf: existing ? existing.id : '',
  };
  await saveCase(c);
  res.status(201).json({ case: toRow(c, null) });
}));

// --- cases ------------------------------------------------------------------
app.get('/api/cases', anyUser, wrap(async (req, res) => {
  let cases = await allCases();
  const reviews = await allReviews();
  // Refresh a few running cases per call so lists move without a page per case.
  const live = cases.filter((c) => !TERMINAL.includes(c.opusStatus) || (c.opusStatus === 'COMPLETED' && !c.result)).slice(0, 6);
  await Promise.all(live.map((c) => refreshCase(c).catch(() => c)));
  res.json({ cases: cases.map((c) => toRow(c, reviewForCase(c, reviews))) });
}));

app.get('/api/cases/:id', anyUser, wrap(async (req, res) => {
  const c = await getCase(req.params.id);
  if (!c || c.deleted) return res.status(404).json({ error: 'Case not found.' });
  await refreshCase(c, true);
  const ev = await getEvidence(c);
  const reviews = await allReviews();
  const review = reviewForCase(c, reviews);
  const original = c.duplicateOf ? await getCase(c.duplicateOf) : null;
  res.json({
    case: toRow(c, review),
    alert: c.alert,
    result: c.result || null,
    evidence: ev,
    review: review ? publicReview(review) : null,
    duplicateOfAlert: original ? original.alertId : '',
  });
}));

app.post('/api/cases/:id/refresh', anyUser, wrap(async (req, res) => {
  const c = await getCase(req.params.id);
  if (!c || c.deleted) return res.status(404).json({ error: 'Case not found.' });
  evCache.delete(c.id);
  await refreshCase(c, true);
  res.json({ ok: true });
}));

app.delete('/api/cases/:id', adminOnly, wrap(async (req, res) => {
  const c = await getCase(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  await store.hdel(CASES_KEY, c.id);
  await store.del('aml:evidence:' + c.id);
  res.json({ ok: true });
}));

function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

app.get('/api/export.csv', officerOrAdmin, wrap(async (req, res) => {
  const cases = await allCases();
  const reviews = await allReviews();
  const cols = ['alertId', 'customerId', 'customerName', 'account', 'rule', 'alertScore', 'riskScore', 'recommended', 'officerAction', 'finalDisposition', 'queue', 'slaHours', 'officerId', 'stage', 'submittedBy', 'createdAt', 'duplicateOf'];
  const lines = [cols.join(',')].concat(cases.map((c) => { const r = toRow(c, reviewForCase(c, reviews)); return cols.map((k) => csvCell(r[k])).join(','); }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="aml-alerts-' + new Date().toISOString().slice(0, 10) + '.csv"');
  res.send(lines.join('\n'));
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
  res.json({
    reviews: reviews.map((r) => {
      const p = publicReview(r);
      const c = r.linkedCaseId && cases[r.linkedCaseId];
      if (c) { p.rule = c.rule; p.account = c.account; p.priority = c.priority; }
      delete p.presentation;
      return p;
    }),
  });
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
  if (state === 'EXPIRED') return res.status(410).json({ error: 'The review window for this alert has closed, so the decision can no longer be recorded. The case has timed out on the triage service.' });
  if (r.status === 'SUBMITTING' && r.lockedAt && Date.now() - Date.parse(r.lockedAt) < 30000) return res.status(409).json({ error: 'Another officer is submitting a decision for this alert right now.' });

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
  const officerId = (req.user.officerId || req.user.username).toUpperCase();
  const responseText = composeResponse(action, finalDisp, text, officerId);

  r.status = 'SUBMITTING'; r.lockedAt = new Date().toISOString();
  await saveReview(r);

  const outputData = buildOutputData(r.expected, responseText, { officerId, action, finalDisposition: finalDisp, rationale: text });
  let resp; let respText = '';
  try {
    const headers = { 'Content-Type': 'application/json' };
    headers[r.callback.header || 'x-callback-token'] = r.callback.token;
    resp = await fetch(r.callback.url, { method: 'POST', headers, body: JSON.stringify({ output_data: outputData, status: 'success' }) });
    respText = await resp.text();
  } catch (e) {
    r.status = 'PENDING'; r.error = 'Could not reach the triage service. Try again.';
    await saveReview(r);
    return res.status(502).json({ error: r.error });
  }

  if (resp.status >= 200 && resp.status < 300) {
    r.status = 'DECIDED';
    r.error = '';
    r.decision = { action, finalDisposition: finalDisp, recommended, rationale: text, officerId, by: req.user.username, byName: req.user.name || req.user.username, at: new Date().toISOString(), responseText };
    await saveReview(r);
    if (r.linkedCaseId) {
      const c = await getCase(r.linkedCaseId);
      if (c) { c.decision = r.decision; c.opusStatus = c.opusStatus === 'WAITING' ? 'IN_PROGRESS' : c.opusStatus; await saveCase(c); lastPoll.delete(c.id); }
    }
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
app.post('/api/review-webhook', wrap(async (req, res) => {
  const want = process.env.REVIEW_WEBHOOK_SECRET;
  if (!want) return res.status(503).json({ error: 'Review webhook is not configured.' });
  const got = String(req.headers[WEBHOOK_HEADER] || '');
  const ok = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) return res.status(401).json({ error: 'Unauthorized.' });

  const p = req.body || {};
  const cb = p.callback || {};
  if (!cb.url || !cb.token) return res.status(400).json({ error: 'Missing callback.' });
  const id = crypto.createHash('sha256').update(String(cb.token)).digest('hex').slice(0, 20);
  const existing = await getReview(id);
  if (existing) return res.json({ ok: true, id, duplicate: true });

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
    c.opusStatus = TERMINAL.includes(c.opusStatus) ? c.opusStatus : 'WAITING';
    if (manifest && manifest.case_header) {
      if (DISPOSITIONS.includes(manifest.case_header.recommended_disposition)) c.recommended = manifest.case_header.recommended_disposition;
      if (manifest.case_header.risk_score != null) c.riskScore = Number(manifest.case_header.risk_score);
    }
    if (manifest && manifest.customer_name) c.customerName = manifest.customer_name;
    await saveCase(c);
  }
  await saveReview(r);
  res.json({ ok: true, id });
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
    workflowId: WORKFLOW_ID,
    apiBase: API_BASE,
    inputVar: INPUT_VAR,
    outputVar: OUTPUT_VAR,
    officerResponseVar: OFFICER_RESPONSE_VAR,
    webhookUrl: host ? `${proto}://${host}/api/review-webhook` : '/api/review-webhook',
    webhookHeader: WEBHOOK_HEADER,
    reviewTimeoutMinutes: REVIEW_TIMEOUT_MIN,
    counts: { cases: cases.length, reviews: reviews.length, unlinkedReviews: reviews.filter((r) => !r.linkedCaseId).length },
    unlinked: reviews.filter((r) => !r.linkedCaseId).map((r) => ({ id: r.id, alertId: r.alertId, receivedAt: r.receivedAt, state: reviewState(r), executionId: r.executionId })),
  });
}));

// --- static -----------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('AML console on http://localhost:' + port));
}
