(function () {
  'use strict';
  var esc = UI.esc;
  var all = [];
  var params = new URLSearchParams(location.search);
  var filter = params.get('f') || 'all';
  var timer = null;

  var FILTERS = [
    { key: 'all', label: 'All', test: function () { return true; } },
    { key: 'running', label: 'Investigating', test: function (c) { return ['QUEUED', 'RUNNING', 'FINALISING'].indexOf(c.stage) >= 0; } },
    { key: 'review', label: 'Awaiting officer', test: function (c) { return c.stage === 'AWAITING_REVIEW'; } },
    { key: 'ESCALATE', label: 'Escalated', test: function (c) { return c.stage === 'COMPLETED' && c.finalDisposition === 'ESCALATE'; } },
    { key: 'REFER', label: 'Referred', test: function (c) { return c.stage === 'COMPLETED' && c.finalDisposition === 'REFER'; } },
    { key: 'CLOSE', label: 'Closed', test: function (c) { return c.stage === 'COMPLETED' && c.finalDisposition === 'CLOSE'; } },
    { key: 'problem', label: 'Needs attention', test: function (c) { return ['FAILED', 'TIMED_OUT', 'CANCELLED', 'COMPLETED_NO_RESULT'].indexOf(c.stage) >= 0 || c.queue === 'SUPERVISOR_REVIEW'; } }
  ];

  function renderFilters() {
    UI.$('#filters').innerHTML = '<div class="seg">' + FILTERS.map(function (f) {
      var n = all.filter(f.test).length;
      return '<button type="button" data-f="' + f.key + '" class="' + (f.key === filter ? 'on' : '') + '" aria-pressed="' + (f.key === filter) + '">' + esc(f.label) + ' <span class="faint">' + n + '</span></button>';
    }).join('') + '</div>';
    UI.$all('#filters [data-f]').forEach(function (b) {
      b.onclick = function () { filter = b.getAttribute('data-f'); history.replaceState(null, '', filter === 'all' ? location.pathname : '?f=' + filter); renderFilters(); renderList(); };
    });
  }

  function renderList() {
    var f = FILTERS.find(function (x) { return x.key === filter; }) || FILTERS[0];
    var q = UI.$('#q').value.trim().toLowerCase();
    var rows = all.filter(f.test).filter(function (c) {
      if (!q) return true;
      return [c.alertId, c.customerName, c.customerId, c.account, c.rule, c.submittedBy].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) {
      UI.$('#list').innerHTML = '<div class="empty"><h3>' + (all.length ? 'No alerts match' : 'No alerts yet') + '</h3>' + (all.length ? 'Try another filter or search.' : 'Submitted alerts appear here.') + '</div>';
      return;
    }
    UI.$('#list').innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Alert</th><th>Customer</th><th>Risk</th><th class="hide-sm">Recommended</th><th>Status</th><th class="hide-sm">Officer</th><th class="hide-sm">Submitted</th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr class="click" data-id="' + esc(c.id) + '"><td><div class="cell-main">' + esc(c.alertId) + (c.duplicateOf ? ' <span class="tag" title="Same alert ID as an earlier case">Repeat</span>' : '') + '</div><div class="cell-sub">' + esc(c.rule) + (c.priority ? ' · priority ' + esc(c.priority) : '') + '</div></td>' +
          '<td><div>' + esc(c.customerName || '—') + '</div><div class="cell-sub">' + esc([c.customerId, c.account].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td>' + UI.scoreBadge(c.riskScore) + '</td>' +
          '<td class="hide-sm">' + UI.dispPill(c.recommended) + '</td>' +
          '<td>' + UI.casePill(c) + (c.stage === 'AWAITING_REVIEW' && c.reviewState === 'PENDING' ? '<div class="cell-sub"><span class="countdown" data-deadline="' + esc(c.reviewDeadline) + '">' + UI.countdown(c.reviewDeadline) + '</span></div>' : '') + '</td>' +
          '<td class="hide-sm">' + (c.officerAction ? '<div>' + esc(UI.ACTIONS[c.officerAction] || c.officerAction) + '</div><div class="cell-sub">' + esc(c.officerId) + '</div>' : '<span class="faint">—</span>') + '</td>' +
          '<td class="hide-sm"><div>' + UI.fmtDate(c.createdAt, false) + '</div><div class="cell-sub">' + esc(c.submittedBy) + '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
    UI.$all('#list tr[data-id]').forEach(function (tr) { tr.onclick = function () { location.href = '/case.html?id=' + encodeURIComponent(tr.getAttribute('data-id')); }; });
  }

  function load() {
    UI.api('GET', '/api/cases').then(function (j) {
      all = j.cases; renderFilters(); renderList();
      clearTimeout(timer);
      if (all.some(UI.isOpen)) timer = setTimeout(load, 8000);
    }).catch(function (e) { UI.$('#list').innerHTML = '<div class="empty err-text">' + esc(e.message) + '</div>'; });
  }

  UI.boot('alerts', function (me) {
    var a = '';
    if (me.user.role === 'officer' || me.user.role === 'admin') a += '<a class="btn" href="/api/export.csv">' + UI.ICONS.download + 'Export CSV</a>';
    if (me.user.role !== 'officer') a += '<a class="btn btn-primary" href="/submit.html">' + UI.ICONS.plus + 'New alert</a>';
    UI.$('#actions').innerHTML = a;
    UI.$('#q').addEventListener('input', renderList);
    load();
  }, { title: 'Alerts' });
})();
