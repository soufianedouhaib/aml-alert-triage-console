// Figures for the Reports page, computed from the case rows the caller may
// see (an analyst's own alerts, or every alert for an officer or admin).
'use strict';

const DISP = ['CLOSE', 'REFER', 'ESCALATE'];
const STOPPED = ['FAILED', 'TIMED_OUT', 'CANCELLED', 'COMPLETED_NO_RESULT'];

function ms(a, b) {
  const x = Date.parse(a); const y = Date.parse(b);
  return isNaN(x) || isNaN(y) || y < x ? null : y - x;
}
function mean(list) { const v = list.filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; }
function blank() { return { total: 0, CLOSE: 0, REFER: 0, ESCALATE: 0 }; }
function add(b, d) { b.total++; if (DISP.includes(d)) b[d]++; }

function periodBounds(q) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let from = null; let to = null; let label = 'All time';
  const p = q.preset;
  if (p === 'today') { from = startOfDay(now); label = 'Today'; }
  else if (p === 'last-7') { from = new Date(startOfDay(now).getTime() - 6 * 864e5); label = 'Last 7 days'; }
  else if (p === 'this-month') { from = new Date(now.getFullYear(), now.getMonth(), 1); label = 'This month'; }
  else if (p === 'last-month') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 1); label = 'Last month'; }
  else if (p === 'last-90') { from = new Date(startOfDay(now).getTime() - 89 * 864e5); label = 'Last 90 days'; }
  else if (p === 'custom') {
    if (q.from && !isNaN(Date.parse(q.from))) from = new Date(q.from + 'T00:00:00');
    if (q.to && !isNaN(Date.parse(q.to))) to = new Date(new Date(q.to + 'T00:00:00').getTime() + 864e5);
    label = 'Custom dates';
  }
  return { from, to, label };
}

function build(rows, q) {
  const { from, to, label } = periodBounds(q || {});
  const inRange = rows.filter((r) => {
    const t = Date.parse(r.createdAt);
    return (!from || t >= from.getTime()) && (!to || t < to.getTime());
  });
  const finished = inRange.filter((r) => r.stage === 'COMPLETED' && DISP.includes(r.finalDisposition));
  const counts = blank();
  finished.forEach((r) => add(counts, r.finalDisposition));
  const awaiting = inRange.filter((r) => r.stage === 'AWAITING_REVIEW' && r.reviewState !== 'EXPIRED').length;
  const running = inRange.filter((r) => ['QUEUED', 'RUNNING', 'FINALISING'].includes(r.stage)).length;
  const stopped = inRange.filter((r) => STOPPED.includes(r.stage) || (r.stage === 'AWAITING_REVIEW' && r.reviewState === 'EXPIRED')).length;
  const decided = inRange.filter((r) => r.officerAction);
  const overrides = decided.filter((r) => r.officerAction === 'OVERRIDE').length;
  const changed = finished.filter((r) => r.recommended && r.finalDisposition !== r.recommended).length;
  const supervisor = finished.filter((r) => r.queue === 'SUPERVISOR_REVIEW').length;

  // Over time: by day for a month or less, otherwise by week.
  let span = from ? ((to ? to.getTime() : Date.now()) - from.getTime()) / 864e5 : null;
  if (span == null && finished.length) {
    const ts = finished.map((r) => Date.parse(r.createdAt));
    span = (Math.max(...ts) - Math.min(...ts)) / 864e5;
  }
  const byWeek = span != null && span > 35;
  const buckets = new Map();
  const ymd = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  finished.forEach((r) => {
    const d = new Date(r.createdAt);
    let key;
    if (byWeek) key = ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
    else key = ymd(d);
    if (!buckets.has(key)) buckets.set(key, blank());
    add(buckets.get(key), r.finalDisposition);
  });
  const overTime = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => Object.assign({ start: k }, v));

  const group = (keyFn, list) => {
    const m = new Map();
    list.forEach((r) => {
      const k = keyFn(r) || 'Unknown';
      if (!m.has(k)) m.set(k, Object.assign(blank(), { key: k, open: 0 }));
      const g = m.get(k);
      if (r.stage === 'COMPLETED' && DISP.includes(r.finalDisposition)) add(g, r.finalDisposition);
      else if (['QUEUED', 'RUNNING', 'FINALISING', 'AWAITING_REVIEW'].includes(r.stage)) g.open++;
    });
    return [...m.values()].sort((a, b) => (b.total + b.open) - (a.total + a.open));
  };
  const byRule = group((r) => r.rule, inRange).map((g) => Object.assign(g, { fpRate: g.total ? g.CLOSE / g.total : null }));
  const byAnalyst = group((r) => r.submittedBy, inRange);

  const officers = new Map();
  decided.forEach((r) => {
    const k = r.officerName || r.officerId || 'Unknown';
    if (!officers.has(k)) officers.set(k, { key: k, officerId: r.officerId, decided: 0, CONFIRM: 0, OVERRIDE: 0, ANNOTATE: 0, waits: [] });
    const o = officers.get(k);
    o.decided++;
    if (o[r.officerAction] != null) o[r.officerAction]++;
    o.waits.push(ms(r.reviewReceivedAt, r.decisionAt));
  });
  const byOfficer = [...officers.values()].map((o) => ({ key: o.key, officerId: o.officerId, decided: o.decided, CONFIRM: o.CONFIRM, OVERRIDE: o.OVERRIDE, ANNOTATE: o.ANNOTATE, avgDecisionMs: mean(o.waits) })).sort((a, b) => b.decided - a.decided);

  // System recommendation against the officer's final call.
  const matrix = {};
  DISP.forEach((a) => { matrix[a] = { CLOSE: 0, REFER: 0, ESCALATE: 0 }; });
  finished.forEach((r) => { if (matrix[r.recommended]) matrix[r.recommended][r.finalDisposition]++; });

  const bands = [{ key: 'Low (0–39)', min: 0, max: 39 }, { key: 'Medium (40–69)', min: 40, max: 69 }, { key: 'High (70–100)', min: 70, max: 100 }].map((b) => {
    const g = Object.assign(blank(), { key: b.key });
    finished.forEach((r) => { if (r.riskScore != null && r.riskScore >= b.min && r.riskScore <= b.max) add(g, r.finalDisposition); });
    return g;
  });

  return {
    period: { label, from: from ? from.toISOString() : null, to: to ? new Date(to.getTime() - 1).toISOString() : null },
    totals: {
      alerts: inRange.length,
      finished: finished.length,
      CLOSE: counts.CLOSE, REFER: counts.REFER, ESCALATE: counts.ESCALATE,
      closedRate: finished.length ? counts.CLOSE / finished.length : null,
      awaiting, running, stopped, supervisor,
      decided: decided.length, overrides, changed,
      avgRunMs: mean(finished.map((r) => ms(r.createdAt, r.finishedAt))),
      timed: finished.filter((r) => ms(r.createdAt, r.finishedAt) != null).length,
      avgDecisionMs: mean(decided.map((r) => ms(r.reviewReceivedAt, r.decisionAt))),
    },
    overTime, byWeek, byRule, byAnalyst, byOfficer, matrix, bands,
  };
}

module.exports = { build, periodBounds };
