(function () {
  'use strict';
  var esc = UI.esc;
  var cases = [];
  var filter = 'all';
  var term = '';
  var timer = null;
  var BUCKETS = [
    { key: 'all', label: 'All alerts' },
    { key: 'progress', label: 'Investigating' },
    { key: 'review', label: 'Awaiting officer' },
    { key: 'completed', label: 'Completed' },
    { key: 'failed', label: 'Did not finish' }
  ];

  UI.boot({ active: 'cases', title: 'Alerts' }, function (user) {
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

  // Admin clean-up: keeps the 3 newest alerts and deletes the rest. Asked on
  // the page rather than in a browser dialog, so the list stays readable.
  function wireClear() {
    var btn = document.getElementById('clear-runs');
    var box = document.getElementById('clear-confirm');
    var note = document.getElementById('clear-note');
    var yes = document.getElementById('clear-yes');
    btn.hidden = false;
    btn.addEventListener('click', function () { box.hidden = false; note.hidden = true; });
    document.getElementById('clear-no').addEventListener('click', function () { box.hidden = true; });
    yes.addEventListener('click', function () {
      yes.disabled = true; yes.textContent = 'Clearing…';
      UI.api('/api/cases/clear', { method: 'POST', body: {} }).then(function (out) {
        box.hidden = true; note.hidden = false;
        note.textContent = out.cleared
          ? 'Cleared ' + UI.plural(out.cleared, 'alert') + ', keeping the ' + out.kept + ' newest.'
          : 'Nothing to clear: there ' + (out.kept === 1 ? 'is only 1 alert' : 'are only ' + out.kept + ' alerts') + '.';
        load();
        UI.refreshReviewBadge();
      }, function (err) {
        box.hidden = true; note.hidden = false;
        note.textContent = 'Nothing was cleared: ' + err.message;
      }).then(function () { yes.disabled = false; yes.textContent = 'Yes, clear them'; });
    });
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
    return UI.casePill(c) + sub;
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
    wrap.innerHTML = '<table><thead><tr><th>Alert</th><th class="hide-sm">Customer</th><th>Risk</th><th>Status</th><th class="hide-sm">Submitted by</th><th class="hide-sm">Submitted</th><th class="num hide-sm">Duration</th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr class="clickable" data-id="' + esc(c.id) + '" tabindex="0">' +
          '<td><strong class="nowrap">' + esc(c.alertId) + '</strong>' + (c.duplicateOf ? '<span class="tag" title="Same alert ID as an earlier submission">Repeat</span>' : '') +
            '<span class="sub">' + UI.metaLine([c.rule, 'Case ' + UI.shortId(c.id)]) + '</span></td>' +
          '<td class="hide-sm">' + esc(c.customerName || '—') + '<span class="sub">' + UI.metaLine([c.customerId, c.account]) + '</span></td>' +
          '<td>' + UI.scoreBadge(c.riskScore, true) + '</td>' +
          '<td>' + statusCell(c) + '</td>' +
          '<td class="hide-sm">' + esc(c.submittedBy || '—') + '</td>' +
          '<td class="hide-sm nowrap">' + UI.fmtDate(c.createdAt) + '</td>' +
          '<td class="num hide-sm">' + (c.durationMs != null ? UI.fmtMs(c.durationMs) : UI.isOpen(c) ? '<span class="muted">running</span>' : '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
    Array.prototype.forEach.call(wrap.querySelectorAll('tr.clickable'), function (tr) {
      var go = function () { location.href = '/case.html?id=' + encodeURIComponent(tr.getAttribute('data-id')); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
  }
})();
