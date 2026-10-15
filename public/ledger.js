/* The read-only neighbour views: customers, monitoring rules and case
   queues. They are built from the alerts in the console; the records
   themselves live in core banking, the monitoring system and case management. */
(function () {
  'use strict';
  var esc = UI.esc;
  var kind = document.body.getAttribute('data-kind');
  var rows = [];
  var term = '';

  function counts(g) {
    return '<td class="num">' + g.alerts + '</td><td class="num">' + (g.ESCALATE || 0) + '</td><td class="num">' + (g.REFER || 0) + '</td><td class="num">' + (g.CLOSE || 0) + '</td><td class="num hide-sm">' + (g.open || 0) + '</td>';
  }
  var COUNT_HEAD = '<th class="num">Alerts</th><th class="num">Escalated</th><th class="num">Referred</th><th class="num">Closed</th><th class="num hide-sm">Open</th>';

  var VIEWS = {
    customers: {
      api: '/api/customers', key: 'customers', active: 'customers', title: 'Customers',
      note: 'Customer and KYC records are kept in core banking. To change a profile or its risk rating, raise a request with the KYC team.',
      search: 'Search customer or account',
      text: function (r) { return [r.key, r.name, r.account].join(' '); },
      head: '<th>Customer</th><th>KYC risk</th>' + COUNT_HEAD + '<th class="hide-sm">Last alert</th>',
      row: function (r) {
        return '<td><strong>' + esc(r.name || '—') + '</strong><span class="sub">' + UI.metaLine([r.key, r.account]) + '</span></td><td>' + (r.kycRisk ? UI.levelPill(r.kycRisk) : '<span class="muted">—</span>') + '</td>' + counts(r) + '<td class="hide-sm nowrap">' + UI.fmtDate(r.last) + '</td>';
      }
    },
    rules: {
      api: '/api/rules', key: 'rules', active: 'rules', title: 'Monitoring rules',
      note: 'Rules and thresholds are maintained in the transaction-monitoring system by the tuning team. A rule that is mostly closed as a false positive is a tuning candidate.',
      search: 'Search rule code',
      text: function (r) { return r.key; },
      head: '<th>Rule</th>' + COUNT_HEAD + '<th class="num">False-positive rate</th><th class="hide-sm">Last fired</th>',
      row: function (r) {
        var fp = r.fpRate == null ? '<span class="muted">—</span>' : Math.round(r.fpRate * 100) + '%<span class="sub">' + r.CLOSE + ' of ' + r.finished + ' closed</span>';
        return '<td><strong class="mono">' + esc(r.key) + '</strong></td>' + counts(r) + '<td class="num">' + fp + '</td><td class="hide-sm nowrap">' + UI.fmtDate(r.last) + '</td>';
      }
    },
    queues: {
      api: '/api/queues', key: 'items', active: 'queues', title: 'Case queues',
      note: 'Cases are worked in the case management system. This view shows where each finished alert was routed and when its SLA runs out.',
      search: 'Search alert, customer or queue',
      text: function (r) { return [r.alertId, r.customerName, r.customerId, r.queue, UI.QUEUES[r.queue]].join(' '); },
      head: '<th>Alert</th><th>Queue</th><th class="hide-sm">Decided by</th><th class="hide-sm">Routed</th><th>SLA</th>',
      row: function (r) {
        var sla = '<span class="muted">No SLA</span>';
        if (r.dueAt) {
          var left = Date.parse(r.dueAt) - Date.now();
          sla = left > 0 ? UI.pill(left < 6 * 3600000 ? 'warn' : 'info', 'Due in ' + UI.fmtMs(left)) : UI.pill('bad', 'Overdue');
          sla += '<span class="sub">' + UI.fmtDate(r.dueAt) + '</span>';
        }
        return '<td><strong class="nowrap">' + esc(r.alertId) + '</strong><span class="sub">' + UI.metaLine([r.customerName || r.customerId]) + '</span></td><td>' + esc(UI.QUEUES[r.queue] || r.queue) + '<span class="sub">' + esc((UI.DISP[r.finalDisposition] || {}).label || '') + '</span></td>' +
          '<td class="hide-sm">' + esc(r.officerName || r.officerId || '—') + '</td><td class="nowrap hide-sm">' + UI.fmtDate(r.routedAt) + '</td><td>' + sla + '</td>';
      }
    }
  };
  var V = VIEWS[kind];

  function render() {
    var list = rows.filter(function (r) { return !term || V.text(r).toLowerCase().indexOf(term) !== -1; });
    document.getElementById('count-text').textContent = rows.length ? (list.length === rows.length ? rows.length + ' total' : list.length + ' of ' + rows.length + ' shown') : '';
    var wrap = document.getElementById('table-wrap');
    if (!list.length) { wrap.innerHTML = '<div class="empty">' + (rows.length ? 'Nothing matches the search.' : 'Nothing here yet. It fills in as alerts are investigated.') + '</div>'; return; }
    wrap.innerHTML = '<table><thead><tr>' + V.head + '</tr></thead><tbody>' + list.map(function (r) {
      var link = r.id ? ' class="clickable" data-id="' + esc(r.id) + '"' : '';
      return '<tr' + link + '>' + V.row(r) + '</tr>';
    }).join('') + '</tbody></table>';
    Array.prototype.forEach.call(wrap.querySelectorAll('tr.clickable'), function (tr) { tr.addEventListener('click', function () { location.href = '/case.html?id=' + encodeURIComponent(tr.getAttribute('data-id')); }); });
  }

  UI.boot({ active: V.active, title: V.title }, function (user) {
    document.getElementById('source-note').textContent = V.note + (user.role === 'analyst' ? ' You see the alerts you submitted.' : '');
    document.getElementById('search').placeholder = V.search;
    document.getElementById('search').addEventListener('input', function (e) { term = e.target.value.trim().toLowerCase(); render(); });
    UI.api(V.api).then(function (d) { rows = d[V.key] || []; render(); }, function (err) { UI.showError(document.getElementById('error'), err); });
  });
})();
