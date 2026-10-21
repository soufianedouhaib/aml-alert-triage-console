(function () {
  'use strict';
  var esc = UI.esc;
  var cases = [];
  var filter = 'all';
  var term = '';
  var timer = null;
  var me = null;
  var BUCKETS = [
    { key: 'all', label: 'All alerts' },
    { key: 'progress', label: 'Investigating' },
    { key: 'review', label: 'Awaiting officer' },
    { key: 'completed', label: 'Completed' },
    { key: 'failed', label: 'Did not finish' }
  ];

  UI.boot({ active: 'cases', title: 'Alerts' }, function (user) {
    me = user;
    if (user.role === 'analyst') {
      document.getElementById('page-title').textContent = 'My alerts';
      document.title = 'My alerts · ' + UI.PRODUCT.name;
      document.getElementById('scope-text').textContent = 'Alerts you have submitted, most recent first.';
    }
    document.getElementById('new-btn').hidden = !(user.role === 'analyst' || user.role === 'admin');
    document.getElementById('export-link').hidden = user.role === 'analyst';
    if (user.role === 'admin') wireClear();
    var f = UI.qs('filter');
    if (f && /^(progress|review|completed|failed)$/.test(f)) filter = f;
    document.getElementById('search').addEventListener('input', function (e) { term = e.target.value.trim().toLowerCase(); render(); });
    load();
  });

  // Admin clean-up, asked on the page rather than in a browser dialog.
  // "Only unfinished" removes alerts that stopped without a disposition;
  // "All alerts" starts from an empty list. Alerts still running are kept.
  function wireClear() {
    var btn = document.getElementById('clear-runs');
    var box = document.getElementById('clear-confirm');
    var note = document.getElementById('clear-note');
    var buttons = [document.getElementById('clear-unfinished'), document.getElementById('clear-all')];
    btn.hidden = false;
    btn.addEventListener('click', function () { box.hidden = false; note.hidden = true; });
    document.getElementById('clear-no').addEventListener('click', function () { box.hidden = true; });
    buttons.forEach(function (b) {
      var label = b.textContent;
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-mode');
        buttons.forEach(function (x) { x.disabled = true; });
        b.textContent = 'Clearing…';
        UI.api('/api/cases/clear', { method: 'POST', body: { mode: mode } }).then(function (out) {
          box.hidden = true; note.hidden = false;
          var kept = out.running ? ' ' + UI.plural(out.running, 'alert') + ' still being investigated ' + (out.running === 1 ? 'was' : 'were') + ' kept.' : '';
          note.textContent = (out.cleared
            ? 'Cleared ' + UI.plural(out.cleared, mode === 'all' ? 'alert' : 'unfinished alert') + '.'
            : (mode === 'all' ? 'Nothing to clear.' : 'Nothing to clear: every alert finished.')) + kept;
          load();
          UI.refreshReviewBadge();
        }, function (err) {
          box.hidden = true; note.hidden = false;
          note.textContent = 'Nothing was cleared: ' + err.message;
        }).then(function () { buttons.forEach(function (x) { x.disabled = false; }); b.textContent = label; });
      });
    });
  }

  // Same buttons as Needs attention and the Review queue.
  function actionCell(c) {
    var href = '/case.html?id=' + encodeURIComponent(c.id);
    var decide = c.stage === 'AWAITING_REVIEW' && c.reviewState === 'PENDING' && me && me.role !== 'analyst' && c.submittedByUser !== me.email;
    var label = decide ? 'Decide' : 'View';
    return '<a class="btn small row-act' + (decide ? ' primary' : '') + '" href="' + href + '" aria-label="' + label + ' ' + esc(c.alertId) + '"><span class="act-text">' + label + '</span><span class="act-icon" aria-hidden="true">›</span></a>';
  }

  function load() {
    UI.api('/api/cases').then(function (d) {
      cases = d.cases || [];
      document.getElementById('error').hidden = true;
      render();
      clearTimeout(timer);
      timer = setTimeout(load, cases.some(UI.isOpen) ? 8000 : 30000);
    }, function (err) { UI.showError(document.getElementById('error'), err); });
  }

  function matches(c) {
    if (filter !== 'all' && UI.statusBucket(c) !== filter) return false;
    if (!term) return true;
    return [c.alertId, c.customerName, c.customerId, c.account, c.rule, c.submittedBy, c.id].join(' ').toLowerCase().indexOf(term) !== -1;
  }

  function statusCell(c) {
    var sub = '';
    if (c.stage === 'AWAITING_REVIEW' && c.reviewState === 'PENDING') sub = '<span class="sub">' + UI.countdown(c.reviewDeadline) + '</span>';
    else if (c.officerName || c.officerId) sub = '<span class="sub">' + esc((UI.ACTIONS[c.officerAction] || 'Reviewed') + ' by ' + (c.officerName || c.officerId)) + '</span>';
    return UI.casePill(c) + sub.replace('<span class="sub">', '<span class="sub status-sub">');
  }

  function render() {
    var counts = { all: cases.length, progress: 0, review: 0, completed: 0, failed: 0 };
    cases.forEach(function (c) { counts[UI.statusBucket(c)]++; });
    document.getElementById('stats').innerHTML = BUCKETS.map(function (b) {
      return '<button type="button" class="stat' + (filter === b.key ? ' active' : '') + '" data-key="' + b.key + '" aria-pressed="' + (filter === b.key) + '"><span class="label">' + esc(b.label) + '</span><span class="value">' + counts[b.key] + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.stat'), function (el) {
      el.addEventListener('click', function () { filter = el.getAttribute('data-key'); render(); });
    });
    var rows = cases.filter(matches);
    document.getElementById('count-text').textContent = rows.length === cases.length ? '' : rows.length + ' of ' + cases.length + ' shown';
    var wrap = document.getElementById('table-wrap');
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty">' + (cases.length ? 'No alerts match this filter.' : 'No alerts yet. Submitted alerts will appear here.') + '</div>';
      return;
    }
    wrap.innerHTML = '<table class="alerts-table"><thead><tr><th>Alert</th><th class="hide-sm">Customer</th><th>Risk</th><th>Status</th><th class="hide-sm">Submitted</th><th class="num hide-sm">Duration</th><th class="num"><span class="sr-only">Action</span></th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr class="clickable" data-id="' + esc(c.id) + '" tabindex="0">' +
          '<td><strong class="nowrap">' + esc(c.alertId) + '</strong>' + (c.duplicateOf ? '<span class="tag" title="Same alert ID as an earlier submission">Repeat</span>' : '') +
            '<span class="sub">' + UI.metaLine([c.rule, 'Case ' + UI.shortId(c.id)]) + '</span></td>' +
          '<td class="hide-sm">' + esc(c.customerName || '—') + '<span class="sub">' + UI.metaLine([c.customerId, c.account]) + '</span></td>' +
          '<td class="risk-cell">' + UI.scoreBadge(c.riskScore, true) + '</td>' +
          '<td>' + statusCell(c) + '</td>' +
          '<td class="hide-sm">' + esc(c.submittedBy || '—') + '<span class="sub nowrap">' + UI.fmtDate(c.createdAt) + '</span></td>' +
          '<td class="num hide-sm">' + (c.durationMs != null ? UI.fmtMs(c.durationMs) : UI.isOpen(c) ? '<span class="muted">running</span>' : '—') + '</td>' +
          '<td class="num">' + actionCell(c) + '</td></tr>';
      }).join('') + '</tbody></table>';
    Array.prototype.forEach.call(wrap.querySelectorAll('tr.clickable'), function (tr) {
      var go = function () { location.href = '/case.html?id=' + encodeURIComponent(tr.getAttribute('data-id')); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
  }
})();
