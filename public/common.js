/* Shared helpers and page chrome. Every page loads this first, then its own
   script, which calls UI.boot(options, onReady). */
(function () {
  'use strict';

  var THEME_KEY = 'aml-theme';
  try {
    var savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);
  } catch (e) { /* storage unavailable */ }

  var ROLE_LABEL = { analyst: 'L1 Analyst', officer: 'Compliance Officer', admin: 'Admin' };
  var PRODUCT = { name: 'AML Alert Triage', unit: 'Financial Crime Unit', company: 'Harbourline Group' };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Read as text first, then parse: a platform 413/502 returns an HTML page,
  // and the status code is what the user needs to see.
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'X-Requested-With': 'aml-console', Accept: 'application/json' };
    var body = opts.body;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    return fetch(path, { method: opts.method || 'GET', headers: headers, body: body, credentials: 'same-origin' }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (res.status === 401 && !opts.allow401) { goLogin(); throw new Error('Please sign in.'); }
        if (!res.ok) {
          var err = new Error((data && data.error) || ('Request failed (' + res.status + (res.status === 413 ? ': request too large' : res.status >= 500 ? ': server problem' : '') + ').'));
          err.status = res.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function goLogin() {
    var here = location.pathname + location.search;
    location.href = '/login.html' + (here && here !== '/' && here.indexOf('login') === -1 ? '?next=' + encodeURIComponent(here) : '');
  }

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  function fmtDate(iso, dateOnly) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var o = { day: '2-digit', month: 'short', year: 'numeric' };
    if (!dateOnly) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleString(undefined, o);
  }
  function fmtAgo(iso) {
    if (!iso) return '—';
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var h = Math.round(mins / 60);
    if (h < 24) return h + ' h ago';
    return Math.round(h / 24) + ' d ago';
  }
  function fmtMs(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return '—';
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60) + 's';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }
  // A case id as people read it: a long UUID cut to its first block.
  function shortId(id) {
    var s = String(id || '');
    return /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(s) ? s.slice(0, 8) : s;
  }
  // "Customer · 2 min ago" with each part kept whole when the line wraps.
  function metaLine(parts) {
    var list = parts.filter(Boolean);
    return list.map(function (p, i) { return '<span class="nowrap">' + esc(p) + (i < list.length - 1 ? ' ·' : '') + '</span>'; }).join(' ');
  }
  // Free text with IDs such as TXN-A013 or RUSSIA-EO14024 kept on one line.
  function prose(text) {
    return esc(text).replace(/\b([A-Z][A-Z0-9]{1,}(?:[-–][A-Z0-9]+)+)\b/g, '<span class="nowrap">$1</span>');
  }
  function money(n, cur) {
    if (n === null || n === undefined || n === '') return '—';
    var v = Number(n);
    if (isNaN(v)) return esc(n);
    return v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + (cur ? ' ' + esc(cur) : '');
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function humanKey(k) {
    var MAP = { pep_status: 'PEP status', annual_income_usd: 'Annual income', kyc: 'KYC', sla_hours: 'SLA (hours)', txn_ids: 'Transaction IDs', id: 'ID' };
    if (MAP[k]) return MAP[k];
    return String(k).replace(/_usd$/, '').replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }

  // ---------- labels every screen shares ----------
  var DISP = {
    ESCALATE: { cls: 'bad', label: 'Escalate', long: 'Escalate to SAR team', done: 'Escalated · SAR' },
    REFER: { cls: 'warn', label: 'Refer', long: 'Refer to L2 investigation', done: 'Referred · L2' },
    CLOSE: { cls: 'ok', label: 'Close', long: 'Close as false positive', done: 'Closed' }
  };
  var QUEUES = { SAR_TEAM: 'SAR filing team', L2_INVESTIGATION: 'L2 investigation', ARCHIVE: 'Archive (closed)', SUPERVISOR_REVIEW: 'Supervisor review' };
  var ACTIONS = { CONFIRM: 'Confirmed', OVERRIDE: 'Overridden', ANNOTATE: 'Annotated' };

  function pill(cls, text, extra) { return '<span class="pill ' + (cls || '') + (extra ? ' ' + extra : '') + '">' + esc(text) + '</span>'; }
  function dispPill(d, long) {
    var x = DISP[String(d || '').toUpperCase()];
    return x ? pill(x.cls, long ? x.long : x.label) : '<span class="muted">—</span>';
  }
  // One status label for a case, used on every list and the case page.
  function casePill(r) {
    switch (r.stage) {
      case 'QUEUED': return pill('info', 'Queued', 'live');
      case 'RUNNING': return pill('info', 'Investigating', 'live');
      case 'AWAITING_REVIEW': return r.reviewState === 'EXPIRED' ? pill('bad', 'Review window closed') : pill('warn', 'Awaiting officer');
      case 'FINALISING': return pill('info', 'Routing decision', 'live');
      case 'COMPLETED':
        if (r.queue === 'SUPERVISOR_REVIEW') return pill('bad', 'Supervisor review');
        return DISP[r.finalDisposition] ? pill(DISP[r.finalDisposition].cls, DISP[r.finalDisposition].done) : pill('', 'Completed');
      case 'COMPLETED_NO_RESULT': return pill('bad', 'No result');
      case 'TIMED_OUT': return pill('bad', 'Timed out');
      case 'CANCELLED': return pill('', 'Cancelled');
      case 'FAILED': return pill('bad', 'Did not finish');
      default: return pill('', r.stage || 'Unknown');
    }
  }
  // Buckets for the status tiles on the alert list.
  function statusBucket(r) {
    if (['QUEUED', 'RUNNING', 'FINALISING'].indexOf(r.stage) >= 0) return 'progress';
    if (r.stage === 'AWAITING_REVIEW' && r.reviewState !== 'EXPIRED') return 'review';
    if (r.stage === 'COMPLETED') return 'completed';
    return 'failed';
  }
  function isOpen(r) { var b = statusBucket(r); return b === 'progress' || b === 'review'; }

  function riskColour(s) { return s >= 70 ? 'var(--series-escalate)' : s >= 40 ? 'var(--risk-mid)' : 'var(--series-close)'; }
  function riskWord(s) { return s >= 70 ? 'High' : s >= 40 ? 'Medium' : 'Low'; }
  function scoreBadge(score, compact) {
    if (score === null || score === undefined || score === '' || isNaN(Number(score))) return '<span class="muted">—</span>';
    var s = Math.max(0, Math.min(100, Number(score)));
    return '<span class="score" title="' + riskWord(s) + ' risk">' + s + '<span class="bar"><i style="width:' + s + '%;background:' + riskColour(s) + '"></i></span>' + (compact ? '' : '<small>' + riskWord(s) + '</small>') + '</span>';
  }
  function levelPill(level) {
    var l = String(level || 'NONE').toUpperCase();
    var cls = l === 'CRITICAL' || l === 'HIGH' ? 'bad' : l === 'MEDIUM' ? 'warn' : l === 'LOW' ? 'ok' : '';
    return pill(cls, l.charAt(0) + l.slice(1).toLowerCase());
  }

  function fmtRemaining(deadline) {
    var ms = new Date(deadline).getTime() - Date.now();
    if (isNaN(ms)) return '';
    if (ms <= 0) return 'window closed';
    var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    if (m >= 60) return Math.floor(m / 60) + ' h ' + (m % 60) + ' min left';
    return m + ':' + (s < 10 ? '0' : '') + s + ' left';
  }
  setInterval(function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-deadline]'), function (el) {
      var dl = el.getAttribute('data-deadline');
      el.textContent = fmtRemaining(dl);
      el.classList.toggle('low', new Date(dl).getTime() - Date.now() < 3 * 60000);
    });
  }, 1000);

  function countdown(deadline) { return '<span class="countdown" data-deadline="' + esc(deadline) + '">' + esc(fmtRemaining(deadline)) + '</span>'; }

  // Structured values (findings, audit trail) as readable lists, not JSON.
  function renderValue(v, depth) {
    depth = depth || 0;
    if (v === null || v === undefined || v === '') return '<span class="muted">—</span>';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v !== 'object') return esc(v);
    if (depth > 3) return '<code>' + esc(JSON.stringify(v)).slice(0, 400) + '</code>';
    if (Array.isArray(v)) {
      if (!v.length) return '<span class="muted">None</span>';
      if (v.every(function (x) { return x && typeof x === 'object' && !Array.isArray(x); })) {
        var cols = [];
        v.forEach(function (x) { Object.keys(x).forEach(function (k) { if (cols.indexOf(k) < 0 && cols.length < 7) cols.push(k); }); });
        return '<div class="table-wrap"><table><thead><tr>' + cols.map(function (c) { return '<th>' + esc(humanKey(c)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          v.slice(0, 40).map(function (x) { return '<tr>' + cols.map(function (c) { return '<td>' + renderValue(x[c], depth + 2) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      }
      return '<ul class="clean">' + v.slice(0, 40).map(function (x) { return '<li>' + renderValue(x, depth + 1) + '</li>'; }).join('') + '</ul>';
    }
    return '<dl>' + Object.keys(v).map(function (k) {
      var x = v[k];
      if (x && typeof x === 'object') return '<dt>' + esc(humanKey(k)) + '</dt><dd><div class="nest">' + renderValue(x, depth + 1) + '</div></dd>';
      return '<dt>' + esc(humanKey(k)) + '</dt><dd>' + renderValue(x, depth + 1) + '</dd>';
    }).join('') + '</dl>';
  }
  function jsonBlock(v) {
    var isAdmin = window.UI.me && window.UI.me.user.role === 'admin';
    return '<div class="jv">' + renderValue(v) + '</div>' + (isAdmin && v && typeof v === 'object' ? '<details class="raw"><summary>Show raw JSON</summary><pre>' + esc(JSON.stringify(v, null, 2)) + '</pre></details>' : '');
  }

  var toastTimer = null;
  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // A page-level dialog. Returns { el, close }.
  function modal(html, cls) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(back);
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    Array.prototype.forEach.call(back.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', close); });
    var first = back.querySelector('input, select, textarea, button.primary');
    if (first) setTimeout(function () { first.focus(); }, 30);
    return { el: back, close: close };
  }

  function showError(el, err) {
    if (!el) return;
    el.innerHTML = esc(err && err.message ? err.message : String(err));
    el.hidden = false;
  }

  // ---------- icons ----------
  var ICONS = {
    overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.6"/><rect x="13.5" y="11" width="7" height="9.5" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/>',
    submit: '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
    cases: '<path d="M7 3.5h7l4.5 4.5v11A1.5 1.5 0 0 1 17 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5V8h4.5M9 12.5h6M9 16h6"/>',
    reviews: '<path d="M9 11.5l2 2 4-4.5"/><rect x="4" y="4" width="16" height="16" rx="3"/>',
    customers: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    rules: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17" cy="6" r="2.2"/><circle cx="14" cy="18" r="2.2"/>',
    queues: '<rect x="3.5" y="4" width="17" height="4.5" rx="1.4"/><rect x="3.5" y="10" width="17" height="4.5" rx="1.4"/><rect x="3.5" y="16" width="11" height="4" rx="1.4"/>',
    report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 19a5 5 0 0 0-2.6-4.4"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
    support: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.5M12 16.8v.1"/>',
    signout: '<path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10"/><path d="M15 8l4 4-4 4M19 12H9"/>',
    chevron: '<path d="M15 6l-6 6 6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-5"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'
  };
  function icon(name) {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  // The product's own mark: a shield with a tick, in the brand colour.
  function productMark(size) {
    size = size || 28;
    return '<svg class="product-mark" width="' + size + '" height="' + size + '" viewBox="0 0 32 32" aria-hidden="true">' +
      '<rect width="32" height="32" rx="8" fill="var(--brand)"/>' +
      '<path d="M16 7.5l7 2.8v5.2c0 4.3-2.9 7.4-7 8.9-4.1-1.5-7-4.6-7-8.9v-5.2z" fill="none" stroke="var(--on-brand)" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M12.6 15.8l2.3 2.3 4.4-4.7" fill="none" stroke="var(--on-brand)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // What each role sees: the triage work first, then the neighbouring records
  // it reads from (read only), then reporting and administration.
  function navGroups(user) {
    var r = user.role;
    var related = { title: 'Customers & queues', note: 'Read only', links: [
      { href: '/customers.html', label: 'Customers', key: 'customers', icon: 'customers', ro: true },
      { href: '/rules.html', label: 'Monitoring rules', key: 'rules', icon: 'rules', ro: true },
      { href: '/queues.html', label: 'Case queues', key: 'queues', icon: 'queues', ro: true }
    ] };
    var insights = { title: 'Insights', links: [{ href: '/report.html', label: 'Reports', key: 'report', icon: 'report' }] };
    if (r === 'analyst') return [
      { title: 'Alert triage', links: [
        { href: '/overview.html', label: 'Overview', key: 'overview', icon: 'overview' },
        { href: '/submit.html', label: 'New alert', key: 'submit', icon: 'submit' },
        { href: '/', label: 'My alerts', key: 'cases', icon: 'cases' }
      ] }, related, insights,
      { title: 'Account', links: [{ href: '/settings.html', label: 'Settings', key: 'settings', icon: 'settings' }] }
    ];
    if (r === 'officer') return [
      { title: 'Alert triage', links: [
        { href: '/reviews.html', label: 'Review queue', key: 'reviews', icon: 'reviews', badge: true },
        { href: '/overview.html', label: 'Overview', key: 'overview', icon: 'overview' },
        { href: '/', label: 'Alerts', key: 'cases', icon: 'cases' }
      ] }, related, insights,
      { title: 'Account', links: [{ href: '/settings.html', label: 'Settings', key: 'settings', icon: 'settings' }] }
    ];
    return [
      { title: 'Alert triage', links: [
        { href: '/overview.html', label: 'Overview', key: 'overview', icon: 'overview' },
        { href: '/', label: 'Alerts', key: 'cases', icon: 'cases' },
        { href: '/submit.html', label: 'New alert', key: 'submit', icon: 'submit' },
        { href: '/reviews.html', label: 'Review queue', key: 'reviews', icon: 'reviews', badge: true }
      ] }, related, insights,
      { title: 'Administration', links: [
        { href: '/users.html', label: 'Users', key: 'users', icon: 'users' },
        { href: '/settings.html', label: 'Settings', key: 'settings', icon: 'settings' }
      ] }
    ];
  }

  // ---------- Report a problem ----------
  // One button everywhere. It writes the email for the person: what went
  // wrong, the step it stopped at, and the workflow, org, execution and case
  // ids, and it offers a screenshot of the page to attach (a mailto link
  // cannot attach files). The technical ids go in the email only.
  var supportContext = null;
  function setSupportContext(fn) { supportContext = fn; }
  function line(label, value) { return value ? label + ': ' + value : null; }

  function supportEmail(me, d, shotName) {
    var subject = PRODUCT.name + (d.reference ? ' – alert ' + d.reference : '') +
      (d.failed ? ' did not finish' + (d.failedAt ? ' at ' + d.failedAt : '') : d.status ? ' (' + String(d.status).toLowerCase().replace(/_/g, ' ') + ')' : ', question');
    var parts = [
      'Hello support team,', '',
      d.reason ? 'What went wrong: ' + d.reason : 'Describe the issue here:',
      d.failedAt ? 'Stopped at step: ' + d.failedAt : null,
      '',
      line('Workflow ID', d.workflowId),
      'Org ID: ' + (d.orgId || 'not set'),
      line('Execution ID', d.executionId),
      line('Case ID', d.caseId ? d.caseId + (d.reference ? ' (alert ' + d.reference + ')' : '') : null),
      line('Review execution ID', d.reviewExecutionId),
      line('Status', d.status),
      line('Submitted', d.submittedAt ? new Date(d.submittedAt).toISOString() + (d.submittedBy ? ' by ' + d.submittedBy : '') : null),
      line('Finished', d.finishedAt ? new Date(d.finishedAt).toISOString() : null),
      '',
      'Reported by: ' + me.user.name + ' <' + me.user.email + '>' + (me.user.officerId ? ' (' + me.user.officerId + ')' : ''),
      'Page: ' + location.href,
      'When: ' + new Date().toISOString(),
      shotName ? 'Screenshot: attached (' + shotName + ')' : 'Screenshot: please see attachment'
    ].filter(function (x) { return x !== null; });
    var body = parts.join('\n');
    if (body.length > 1800) body = body.slice(0, 1790) + '\n…';
    return 'mailto:' + ((me.support && me.support.email) || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.html2canvas) return resolve();
      var sc = document.createElement('script');
      sc.src = src; sc.onload = resolve; sc.onerror = function () { reject(new Error('The screenshot tool could not load.')); };
      document.head.appendChild(sc);
    });
  }
  function takeScreenshot(name) {
    document.body.classList.remove('nav-open');
    return loadScript('/vendor/html2canvas.min.js').then(function () {
      return window.html2canvas(document.body, {
        scale: Math.min(2, window.devicePixelRatio || 1),
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        ignoreElements: function (el) { return el.id === 'support-modal' || (el.classList && el.classList.contains('side-scrim')); },
        windowWidth: document.documentElement.clientWidth
      });
    }).then(function (canvas) {
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = name;
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          resolve();
        }, 'image/png');
      });
    });
  }

  function openSupport() {
    var me = window.UI.me;
    if (!me) return;
    var old = document.getElementById('support-modal');
    if (old) old.remove();
    var noMail = !(me.support && me.support.email);
    var m = modal(
      '<h2 id="support-title">Report a problem</h2>' +
      '<p class="muted small" style="margin:-6px 0 14px">The email to the support team is written for you, with the technical details they need. A mailto link cannot attach files, so download the screenshot first and attach it to the email.</p>' +
      '<dl class="kv" id="support-details"><dt>Details</dt><dd>Gathering…</dd></dl>' +
      (noMail ? '<div class="alert warn" style="margin-top:12px">No support address is set up yet. Copy the details and send them to your support contact, or ask IT to set SUPPORT_EMAIL.</div>' : '') +
      '<div class="alert bad" id="support-error" hidden style="margin-top:12px"></div>' +
      '<div class="support-steps">' +
        '<button type="button" class="btn" id="support-shot"><span class="step-n">1</span>Download screenshot</button>' +
        '<a class="btn primary" id="support-mail" href="#"' + (noMail ? ' hidden' : '') + '><span class="step-n">2</span>Open email</a>' +
      '</div>' +
      '<div class="actions"><button type="button" class="btn small" id="support-copy">Copy details</button><button type="button" class="btn small" data-close>Close</button></div>',
      'support-modal');
    m.el.id = 'support-modal';
    var root = m.el;
    var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    var details = { workflowId: me.support && me.support.workflowId, orgId: me.support && me.support.orgId };
    var shotName = 'aml-triage-' + stamp + '.png';
    var mail = root.querySelector('#support-mail');

    function render(d) {
      details = d;
      shotName = 'aml-triage-' + (d.reference ? d.reference + '-' : '') + stamp + '.png';
      var rows = [['What went wrong', d.reason], ['Stopped at', d.failedAt], ['Alert', d.reference], ['Case', d.caseId ? shortId(d.caseId) : null]]
        .filter(function (r) { return r[1]; });
      if (!rows.length) rows.push(['Details', 'Describe the problem in the email. The technical details support needs are added for you.']);
      root.querySelector('#support-details').innerHTML = rows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd' + (r[0] === 'Case' ? ' class="mono"' : '') + '>' + esc(String(r[1])) + '</dd>';
      }).join('');
      mail.href = supportEmail(me, d, shotName);
    }
    render(details);
    (supportContext ? supportContext() : Promise.resolve(null)).then(function (d) {
      if (d) render(Object.assign({}, details, d));
    }, function (err) { showError(root.querySelector('#support-error'), err); });

    root.querySelector('#support-shot').addEventListener('click', function () {
      var b = this; b.disabled = true;
      var label = b.innerHTML; b.textContent = 'Capturing…';
      takeScreenshot(shotName).then(function () {
        b.innerHTML = '<span class="step-n">✓</span>Screenshot saved'; b.disabled = false;
      }, function (err) {
        b.innerHTML = label; b.disabled = false;
        showError(root.querySelector('#support-error'), new Error(err.message + ' Use your own screenshot tool instead.'));
      });
    });
    root.querySelector('#support-copy').addEventListener('click', function () {
      var href = supportEmail(me, details, shotName);
      var text = decodeURIComponent(href.split('?subject=')[1].split('&body=')[0]) + '\n\n' + decodeURIComponent(href.split('&body=')[1] || '');
      var b = this;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Copy failed'; });
    });
  }

  // ---------- chrome: the sidebar ----------
  var SIDE_KEY = 'aml-sidebar';
  function setCollapsed(next) {
    document.body.classList.toggle('side-collapsed', Boolean(next));
    var t = document.getElementById('side-toggle');
    if (t) { t.setAttribute('aria-expanded', next ? 'false' : 'true'); t.title = next ? 'Expand the menu' : 'Collapse the menu'; t.setAttribute('aria-label', t.title); }
    try { localStorage.setItem(SIDE_KEY, next ? 'collapsed' : 'open'); } catch (e) { /* private window */ }
  }
  function setDrawer(open) {
    document.body.classList.toggle('nav-open', Boolean(open));
    var m = document.getElementById('menu-btn');
    if (m) m.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function renderChrome(me, active) {
    var user = me.user;
    document.body.classList.add('has-sidebar');
    var scrim = document.createElement('div');
    scrim.className = 'side-scrim';
    document.body.appendChild(scrim);

    var top = document.createElement('header');
    top.className = 'topbar';
    top.innerHTML = '<button type="button" class="icon-btn" id="menu-btn" aria-controls="sidebar" aria-expanded="false" aria-label="Open the menu">' + icon('menu') + '</button>' +
      '<a class="topbar-brand" href="' + esc(me.home || '/') + '">' + productMark(24) + '<span>' + esc(PRODUCT.name) + '</span></a>';
    document.body.insertBefore(top, document.body.firstChild);

    var rail = document.createElement('aside');
    rail.className = 'sidebar'; rail.id = 'sidebar'; rail.setAttribute('aria-label', 'Main');
    rail.innerHTML =
      '<div class="side-head">' +
        '<a class="brand-lockup" href="' + esc(me.home || '/') + '" title="' + esc(PRODUCT.name) + '">' + productMark(28) + '<span class="label">' + esc(PRODUCT.name) + '<small>' + esc(PRODUCT.unit) + '</small></span></a>' +
        '<button type="button" class="side-toggle" id="side-toggle" aria-expanded="true" aria-label="Collapse the menu" title="Collapse the menu">' + icon('chevron') + '</button>' +
        '<button type="button" class="side-close icon-btn" id="side-close" aria-label="Close the menu">' + icon('close') + '</button>' +
      '</div>' +
      '<nav class="side-nav">' + navGroups(user).map(function (g) {
        return '<div class="nav-group"><p class="nav-title"><span>' + esc(g.title) + '</span>' + (g.note ? '<span class="nav-note">' + esc(g.note) + '</span>' : '') + '</p>' +
          g.links.map(function (l) {
            return '<a href="' + l.href + '"' + (l.key === active ? ' aria-current="page"' : '') + ' title="' + esc(l.label + (l.ro ? ' (read only)' : '')) + '">' + icon(l.icon) +
              '<span class="label">' + esc(l.label) + '</span>' + (l.badge ? '<span class="badge-count" id="review-badge" hidden></span>' : '') + '</a>';
          }).join('') + '</div>';
      }).join('') + '</nav>' +
      '<div class="side-foot">' +
        '<button type="button" class="side-link" id="theme-toggle" title="Switch light or dark">' + icon('theme') + '<span class="label">Light / dark</span></button>' +
        '<button type="button" class="side-link" id="support-btn" title="Report a problem">' + icon('support') + '<span class="label">Report a problem</span></button>' +
        '<div class="side-account" title="' + esc(user.name + ', ' + (ROLE_LABEL[user.role] || user.role)) + '"><span class="avatar">' + esc((user.name || user.email || '?').charAt(0).toUpperCase()) + '</span>' +
          '<span class="label"><span class="account-name">' + esc(user.name) + '</span><span class="account-role">' + esc(ROLE_LABEL[user.role] || user.role) + (user.officerId && user.role !== 'analyst' ? ' · ' + esc(user.officerId) : '') + '</span></span></div>' +
        '<button type="button" class="side-out" id="logout-btn" title="Sign out">' + icon('signout') + '<span class="label">Sign out</span></button>' +
      '</div>';
    document.body.insertBefore(rail, top.nextSibling);

    if (me.setupWarnings && me.setupWarnings.length) {
      var b = document.createElement('div');
      b.className = 'setup-banner';
      b.innerHTML = '<div class="inner"><strong>Setup incomplete.</strong> Part of the connection to the triage service is not configured yet, so some features may not work. <a href="/system.html">See what is missing</a>.</div>';
      var main = document.querySelector('main');
      if (main) main.parentNode.insertBefore(b, main);
    }

    var footer = document.createElement('footer');
    footer.className = 'footer';
    footer.innerHTML = '<span><b>' + esc(PRODUCT.name) + '</b> · ' + esc(PRODUCT.unit) + ' · ' + esc(PRODUCT.company) + '</span>' +
      (me.storage === 'memory' && user.role === 'admin' ? '<span class="nowrap" style="color:var(--bad)">History storage is not configured — records are temporary.</span>' : '');
    document.body.appendChild(footer);

    var saved = false;
    try { saved = localStorage.getItem(SIDE_KEY) === 'collapsed'; } catch (e) { /* ignore */ }
    setCollapsed(saved);
    document.getElementById('side-toggle').addEventListener('click', function () { setCollapsed(!document.body.classList.contains('side-collapsed')); });
    document.getElementById('menu-btn').addEventListener('click', function () { setDrawer(true); });
    document.getElementById('side-close').addEventListener('click', function () { setDrawer(false); });
    scrim.addEventListener('click', function () { setDrawer(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setDrawer(false); });
    document.getElementById('support-btn').addEventListener('click', function () { setDrawer(false); openSupport(); });
    document.getElementById('logout-btn').addEventListener('click', function () {
      api('/api/logout', { method: 'POST', allow401: true }).then(function () { location.href = '/login.html'; }, function () { location.href = '/login.html'; });
    });
    document.getElementById('theme-toggle').addEventListener('click', function () {
      var root = document.documentElement;
      var current = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    });
    if (user.role === 'officer' || user.role === 'admin') refreshReviewBadge();
  }

  function refreshReviewBadge() {
    var el = document.getElementById('review-badge');
    if (!el) return;
    api('/api/reviews').then(function (d) {
      var n = d && d.pending ? d.pending.length : 0;
      el.textContent = n; el.hidden = n === 0;
    }, function () { /* leave as is */ });
  }

  // Every page: ask /api/me first and render nothing until it answers, so a
  // signed-out visitor never sees a flash of a screen they are about to lose.
  function boot(options, onReady) {
    document.body.classList.add('booting');
    api('/api/me', { allow401: true }).then(function (me) {
      if (!me || !me.user) return goLogin();
      if (options.roles && options.roles.indexOf(me.user.role) === -1) { location.href = me.home || '/'; return; }
      if (me.product) Object.assign(PRODUCT, me.product);
      window.UI.me = me;
      if (options.title) document.title = options.title + ' · ' + PRODUCT.name;
      renderChrome(me, options.active);
      document.body.classList.remove('booting');
      onReady(me.user, me);
    }, function (err) {
      if (err && err.status === 401) return goLogin();
      document.body.classList.remove('booting');
      var main = document.querySelector('main');
      if (main) main.innerHTML = '<div class="alert bad"><strong>Could not load the page.</strong>' + esc(err.message) + '</div>';
    });
  }

  function downloadJson(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  window.UI = {
    esc: esc, prose: prose, api: api, qs: qs, goLogin: goLogin, fmtDate: fmtDate, fmtAgo: fmtAgo, fmtMs: fmtMs, shortId: shortId, metaLine: metaLine,
    money: money, plural: plural, humanKey: humanKey, DISP: DISP, QUEUES: QUEUES, ACTIONS: ACTIONS, ROLE_LABEL: ROLE_LABEL, PRODUCT: PRODUCT,
    pill: pill, dispPill: dispPill, casePill: casePill, statusBucket: statusBucket, isOpen: isOpen, scoreBadge: scoreBadge, levelPill: levelPill,
    riskWord: riskWord, fmtRemaining: fmtRemaining, countdown: countdown, renderValue: renderValue, jsonBlock: jsonBlock, toast: toast, modal: modal,
    showError: showError, icon: icon, productMark: productMark, boot: boot, openSupport: openSupport, setSupportContext: setSupportContext,
    refreshReviewBadge: refreshReviewBadge, downloadJson: downloadJson, me: null
  };
})();
