/* Shared helpers and page chrome. Exposes window.UI. */
(function () {
  'use strict';

  var ICONS = {
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-6 6 3 3 6-6"/><path d="M13 7l4 4"/><path d="M11 9l4-4 4 4-4 4z"/><path d="M14 21h7"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c1.8.7 3 2.5 3.5 5.2"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3.5" height="12" rx="1"/><rect x="13.5" y="6" width="3.5" height="12" rx="1"/></svg>',
    xmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/></svg>'
  };

  // ---------- theme (per-viewer convenience only) ----------
  function getTheme() { try { return localStorage.getItem('aml-theme') || ''; } catch (e) { return ''; } }
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(getTheme());
  function cycleTheme() {
    var cur = getTheme();
    var next = cur === '' ? 'dark' : cur === 'dark' ? 'light' : '';
    try { if (next) localStorage.setItem('aml-theme', next); else localStorage.removeItem('aml-theme'); } catch (e) {}
    applyTheme(next);
    toast('Theme: ' + (next || 'match system'));
  }

  // ---------- utils ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function api(method, url, body) {
    var opts = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : {}; } catch (e) { j = null; }
        if (!r.ok) {
          var err = new Error((j && j.error) || ('The server answered ' + r.status + (r.status === 413 ? ' (request too large)' : r.status >= 500 ? ' (server problem)' : '') + '.'));
          err.status = r.status; err.body = j;
          if (r.status === 401 && url !== '/api/login' && url !== '/api/me') { location.href = '/?next=' + encodeURIComponent(location.pathname + location.search); }
          throw err;
        }
        if (j === null) throw new Error('Unexpected response from the server.');
        return j;
      });
    });
  }

  function fmtDate(iso, withTime) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    var opts = { day: '2-digit', month: 'short', year: 'numeric' };
    if (withTime !== false) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
    return d.toLocaleString(undefined, opts);
  }
  function ago(iso) {
    if (!iso) return '';
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function dur(ms) {
    if (ms == null) return '';
    if (ms < 1000) return ms + ' ms';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + ' s';
    return Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s';
  }
  function money(n, cur) {
    if (n == null || n === '') return '—';
    var v = Number(n);
    if (isNaN(v)) return esc(n);
    return v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + (cur ? ' ' + esc(cur) : '');
  }

  // ---------- labels shared by every screen ----------
  var DISP = {
    ESCALATE: { cls: 'red', label: 'Escalate', long: 'Escalate to SAR team' },
    REFER: { cls: 'violet', label: 'Refer', long: 'Refer to L2 investigation' },
    CLOSE: { cls: 'green', label: 'Close', long: 'Close — no suspicious activity' }
  };
  var QUEUES = {
    SAR_TEAM: 'SAR filing team',
    L2_INVESTIGATION: 'L2 investigation',
    ARCHIVE: 'Archive (closed)',
    SUPERVISOR_REVIEW: 'Supervisor review'
  };
  var ACTIONS = { CONFIRM: 'Confirmed', OVERRIDE: 'Overridden', ANNOTATE: 'Annotated' };

  function pill(cls, text, extra) { return '<span class="pill ' + cls + (extra ? ' ' + extra : '') + '">' + esc(text) + '</span>'; }
  function dispPill(d, long) {
    var x = DISP[String(d || '').toUpperCase()];
    return x ? pill(x.cls, long ? x.long : x.label) : '<span class="faint">—</span>';
  }

  // One status label for a case row, used on every list and the case page.
  function casePill(r) {
    switch (r.stage) {
      case 'QUEUED': return pill('grey', 'Queued', 'live');
      case 'RUNNING': return pill('blue', 'Investigating', 'live');
      case 'AWAITING_REVIEW':
        if (r.reviewState === 'EXPIRED') return pill('red', 'Review window closed');
        return pill('amber', 'Awaiting officer');
      case 'FINALISING': return pill('blue', 'Routing decision', 'live');
      case 'COMPLETED':
        if (r.queue === 'SUPERVISOR_REVIEW') return pill('red', 'Supervisor review');
        if (r.finalDisposition === 'ESCALATE') return pill('red', 'Escalated · SAR');
        if (r.finalDisposition === 'REFER') return pill('violet', 'Referred · L2');
        if (r.finalDisposition === 'CLOSE') return pill('green', 'Closed');
        return pill('grey', 'Completed');
      case 'COMPLETED_NO_RESULT': return pill('grey', 'Completed · no result');
      case 'TIMED_OUT': return pill('red', 'Timed out');
      case 'CANCELLED': return pill('grey', 'Cancelled');
      case 'FAILED': return pill('red', 'Failed');
      default: return pill('grey', r.stage || 'Unknown');
    }
  }
  function isOpen(r) { return ['QUEUED', 'RUNNING', 'AWAITING_REVIEW', 'FINALISING'].indexOf(r.stage) >= 0; }

  function riskColour(score) { return score >= 70 ? 'var(--red)' : score >= 40 ? 'var(--amber)' : 'var(--green)'; }
  function riskWord(score) { return score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low'; }
  function scoreBadge(score, compact) {
    if (score == null || score === '' || isNaN(Number(score))) return '<span class="faint">—</span>';
    var s = Math.max(0, Math.min(100, Number(score)));
    return '<span class="score" title="' + riskWord(s) + ' risk"><span>' + s + '</span><span class="bar"><i style="width:' + s + '%;background:' + riskColour(s) + '"></i></span>' + (compact ? '' : '<span class="faint small">' + riskWord(s) + '</span>') + '</span>';
  }
  function levelPill(level) {
    var l = String(level || 'NONE').toUpperCase();
    var cls = l === 'CRITICAL' || l === 'HIGH' ? 'red' : l === 'MEDIUM' ? 'amber' : l === 'LOW' ? 'green' : 'grey';
    return pill(cls, l.charAt(0) + l.slice(1).toLowerCase());
  }

  function countdown(deadline) {
    var ms = new Date(deadline).getTime() - Date.now();
    if (isNaN(ms)) return '';
    if (ms <= 0) return 'closed';
    var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    if (m >= 60) return Math.floor(m / 60) + ' h ' + (m % 60) + ' min left';
    return m + ':' + (s < 10 ? '0' : '') + s + ' left';
  }
  // Ticks every element with data-deadline once a second.
  setInterval(function () {
    $all('[data-deadline]').forEach(function (el) {
      var dl = el.getAttribute('data-deadline');
      var left = new Date(dl).getTime() - Date.now();
      el.textContent = countdown(dl);
      el.classList.toggle('low', left < 3 * 60000);
    });
  }, 1000);

  var toastTimer = null;
  function toast(msg, isErr) {
    var t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 6000 : 3000);
  }

  function dialog(html) {
    var d = document.createElement('dialog');
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener('close', function () { d.remove(); });
    $all('[data-close]', d).forEach(function (b) { b.addEventListener('click', function () { d.close(); }); });
    d.showModal();
    return d;
  }

  // ---------- chrome ----------
  var state = { me: null };

  function navItems(role) {
    var items = [{ href: '/dashboard.html', key: 'dashboard', label: 'Dashboard', icon: 'home' }];
    if (role === 'analyst' || role === 'admin') items.push({ href: '/submit.html', key: 'submit', label: 'New alert', icon: 'plus' });
    items.push({ href: '/alerts.html', key: 'alerts', label: 'Alerts', icon: 'list' });
    if (role === 'officer' || role === 'admin') items.push({ href: '/reviews.html', key: 'reviews', label: 'Review queue', icon: 'gavel', count: true });
    if (role === 'admin') items.push({ href: '/users.html', key: 'users', label: 'Users', icon: 'users' });
    return items;
  }

  function lockup(me) {
    return '<div class="lockup"><div class="mark">' + ICONS.shield + '</div><div><div class="name">' + esc(me.appName) + '</div><div class="org">' + esc(me.orgName) + '</div></div></div>';
  }

  function renderShell(active, me) {
    var tpl = document.getElementById('tpl');
    var u = me.user;
    var nav = navItems(u.role).map(function (i) {
      return '<a href="' + i.href + '"' + (i.key === active ? ' class="active" aria-current="page"' : '') + '>' + ICONS[i.icon] + '<span>' + esc(i.label) + '</span>' + (i.count ? '<span class="count" id="nav-review-count" hidden></span>' : '') + '</a>';
    }).join('');
    var root = document.getElementById('root');
    root.className = 'shell';
    root.innerHTML =
      '<aside class="side" id="side">' + lockup(me) +
      '<nav class="nav" aria-label="Main">' + nav + '</nav>' +
      '<div class="side-foot">' +
      '<div class="whoami"><b>' + esc(u.name) + '</b>' + esc(u.roleLabel) + (u.officerId ? ' · ' + esc(u.officerId) : '') + '</div>' +
      '<button class="side-btn" id="btn-contact">' + ICONS.mail + 'Contact Opus</button>' +
      '<button class="side-btn" id="btn-help">' + ICONS.help + 'Help</button>' +
      '<button class="side-btn" id="btn-theme">' + ICONS.moon + 'Theme</button>' +
      '<button class="side-btn" id="btn-pw">' + ICONS.key + 'Change password</button>' +
      '<button class="side-btn" id="btn-out">' + ICONS.out + 'Sign out</button>' +
      '</div></aside>' +
      '<div class="main"><div class="topbar"><button id="btn-menu" aria-label="Open menu">' + ICONS.menu + '</button><span class="t">' + esc(me.appName) + '</span></div>' +
      '<div class="content" id="content"></div>' +
      '<div class="footer">' + esc(me.orgName) + ' · ' + esc(me.appName) + (me.storage === 'memory' ? ' · <span class="err-text">History storage is not configured — records are temporary.</span>' : '') + '</div></div>';
    $('#content').appendChild(tpl.content.cloneNode(true));
    $('#btn-out').onclick = function () { api('POST', '/api/logout', {}).then(function () { location.href = '/'; }); };
    $('#btn-theme').onclick = cycleTheme;
    $('#btn-help').onclick = function () { showHelp(me); };
    $('#btn-contact').onclick = function () { contactSupport(); };
    $('#btn-pw').onclick = changePassword;
    $('#btn-menu').onclick = function (e) { e.stopPropagation(); root.classList.toggle('nav-open'); };
    root.addEventListener('click', function (e) { if (root.classList.contains('nav-open') && !$('#side').contains(e.target)) root.classList.remove('nav-open'); });
    if (u.role === 'officer' || u.role === 'admin') refreshReviewCount();
  }

  function refreshReviewCount() {
    api('GET', '/api/reviews').then(function (j) {
      var n = j.reviews.filter(function (r) { return r.state === 'PENDING' || r.state === 'SUBMITTING'; }).length;
      var el = $('#nav-review-count');
      if (el) { el.textContent = n; el.hidden = n === 0; }
    }).catch(function () {});
  }

  // Contact Opus: a short form that opens a pre-filled email. The IDs support
  // needs (case, workflow, user, page) go into the email only, not the dialog.
  var TOPICS = ['Something is not working', 'Question about an alert or decision', 'Sign-in or account', 'Other'];
  function contactSupport(ctx) {
    ctx = ctx || state.caseCtx || {};
    var me = state.me || {};
    var u = me.user || {};
    var d = dialog('<form id="cf"><div class="dlg-head"><h2>Contact Opus</h2><button type="button" class="x" data-close aria-label="Close">×</button></div><div class="dlg-body">' +
      '<p class="muted" style="margin:0">Tell us what happened. Your email app opens with the message and the details support needs to find your case.</p>' +
      '<label class="field">Topic<select name="topic">' + TOPICS.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
      (ctx.alertId ? '<div class="callout info small">About alert <b>' + esc(ctx.alertId) + '</b></div>' : '') +
      '<label class="field">Message<span class="help">What you did, what you expected and what you saw.</span><textarea name="message" rows="5" maxlength="1500"></textarea></label>' +
      '<div class="err-text" id="cf-err" hidden></div>' +
      (me.supportEmail ? '' : '<div class="callout warn small">No support address is set up yet. Copy the details and send them to your Opus contact, or ask your administrator to set SUPPORT_EMAIL.</div>') +
      '</div><div class="dlg-foot"><button type="button" class="btn" id="cf-copy">Copy details</button>' + (me.supportEmail ? '<button class="btn btn-primary" type="submit">' + ICONS.mail + 'Open email</button>' : '') + '</div></form>');
    var f = $('#cf', d);
    f.message.addEventListener('input', function () { $('#cf-err', d).hidden = true; });
    function details() {
      var lines = [
        f.message.value.trim(), '', '---',
        'Topic: ' + f.topic.value,
        'App: ' + (me.appName || ''),
        'Page: ' + location.href,
        'User: ' + (u.name || '') + ' (' + (u.username || '') + ', ' + (u.roleLabel || '') + (u.officerId ? ', ' + u.officerId : '') + ')'
      ];
      if (ctx.alertId) lines.push('Alert ID: ' + ctx.alertId);
      if (ctx.caseId) lines.push('Case ID: ' + ctx.caseId);
      if (ctx.stage) lines.push('Status: ' + ctx.stage);
      if (me.workflowId) lines.push('Workflow ID: ' + me.workflowId);
      lines.push('Time (UTC): ' + new Date().toISOString());
      lines.push('Browser: ' + navigator.userAgent);
      return lines.join('\n');
    }
    function valid() {
      var e = $('#cf-err', d);
      if (f.message.value.trim().length < 5) { e.textContent = 'Write a short message first.'; e.hidden = false; return false; }
      e.hidden = true; return true;
    }
    $('#cf-copy', d).onclick = function () {
      if (!valid()) return;
      var text = 'Subject: ' + subject() + '\n\n' + details();
      try { navigator.clipboard.writeText(text).then(function () { toast('Details copied'); }, function () { toast('Copy failed — select and copy manually', true); }); } catch (e) { toast('Copy failed', true); }
    };
    function subject() { return '[' + (me.appName || 'AML') + '] ' + f.topic.value + (ctx.alertId ? ' — ' + ctx.alertId : ''); }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!valid()) return;
      location.href = 'mailto:' + encodeURIComponent(me.supportEmail).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject()) + '&body=' + encodeURIComponent(details());
      setTimeout(function () { d.close(); toast('Email opened in your mail app'); }, 300);
    });
  }

  function showHelp(me) {
    var contact = me.supportEmail
      ? '<p>Still stuck? Use <b>Contact Opus</b> in the menu, or on the alert page so the alert is attached.</p>'
      : '<p class="faint">Ask your administrator if something does not look right, and include the alert ID.</p>';
    dialog('<div class="dlg-head"><h2>Help</h2><button class="x" data-close aria-label="Close">×</button></div><div class="dlg-body">' +
      '<p><b>How an alert moves:</b> intake → evidence lookups → specialist analysis → risk scoring → narrative → officer review → routing.</p>' +
      '<p><b>Officer review:</b> each alert waits for a compliance officer for ' + me.reviewTimeoutMinutes + ' minutes. Confirm the recommendation, override it with a written rationale, or annotate it. After the window closes the decision can no longer be recorded.</p>' +
      '<p><b>Outcomes:</b> Escalate → SAR filing team (24 h SLA). Refer → L2 investigation (72 h SLA). Close → archived. An override without a valid rationale goes to supervisor review.</p>' +
      contact + '</div><div class="dlg-foot"><button class="btn" data-close>Close</button></div>');
  }

  function changePassword() {
    var d = dialog('<form method="dialog" id="pw-form"><div class="dlg-head"><h2>Change password</h2><button type="button" class="x" data-close aria-label="Close">×</button></div><div class="dlg-body">' +
      '<label class="field">Current password<input type="password" name="current" autocomplete="current-password" required></label>' +
      '<label class="field">New password<span class="help">At least 8 characters.</span><input type="password" name="next" autocomplete="new-password" minlength="8" required></label>' +
      '<div class="err-text" id="pw-err" hidden></div></div><div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>');
    $('#pw-form', d).addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      api('POST', '/api/me/password', { current: f.current.value, next: f.next.value }).then(function () { d.close(); toast('Password changed'); })
        .catch(function (err) { var el = $('#pw-err', d); el.textContent = err.message; el.hidden = false; });
    });
  }

  // Every page: ask /api/me first, render nothing until it answers.
  function boot(active, fn, opts) {
    opts = opts || {};
    api('GET', '/api/me').then(function (me) {
      state.me = me;
      if (opts.roles && opts.roles.indexOf(me.user.role) < 0) { location.replace('/dashboard.html'); return; }
      document.title = (opts.title ? opts.title + ' · ' : '') + me.appName;
      renderShell(active, me);
      fn(me);
    }).catch(function (e) {
      if (e.status === 401) location.replace('/?next=' + encodeURIComponent(location.pathname + location.search));
      else document.getElementById('root').innerHTML = '<div class="skeleton">Could not load: ' + esc(e.message) + '</div>';
    });
  }

  function downloadJson(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.UI = {
    ICONS: ICONS, esc: esc, $: $, $all: $all, api: api, fmtDate: fmtDate, ago: ago, dur: dur, money: money,
    pill: pill, dispPill: dispPill, casePill: casePill, isOpen: isOpen, scoreBadge: scoreBadge, levelPill: levelPill,
    riskWord: riskWord, countdown: countdown, contactSupport: contactSupport, toast: toast, dialog: dialog, boot: boot, lockup: lockup,
    DISP: DISP, QUEUES: QUEUES, ACTIONS: ACTIONS, downloadJson: downloadJson, refreshReviewCount: refreshReviewCount,
    state: state
  };
})();
