(function () {
  'use strict';
  var esc = UI.esc;
  var me = null;
  var timer = null;

  function kpi(label, value, note, href) {
    return '<div class="card kpi"><a href="' + href + '"><div class="label">' + esc(label) + '</div><div class="value">' + value + '</div><div class="note">' + esc(note) + '</div></a></div>';
  }

  function render(cases, reviews) {
    var open = cases.filter(UI.isOpen);
    var waiting = cases.filter(function (c) { return c.stage === 'AWAITING_REVIEW' && c.reviewState !== 'EXPIRED'; });
    var done = cases.filter(function (c) { return c.stage === 'COMPLETED'; });
    var esc_ = done.filter(function (c) { return c.finalDisposition === 'ESCALATE'; }).length;
    var ref = done.filter(function (c) { return c.finalDisposition === 'REFER'; }).length;
    var clo = done.filter(function (c) { return c.finalDisposition === 'CLOSE'; }).length;
    UI.$('#kpis').innerHTML =
      kpi('Investigating', open.length - waiting.length, 'Pipeline running', '/alerts.html?f=running') +
      kpi('Awaiting officer', waiting.length, 'Need a decision', '/alerts.html?f=review') +
      kpi('Escalated', esc_, 'To SAR filing team', '/alerts.html?f=ESCALATE') +
      kpi('Referred', ref, 'To L2 investigation', '/alerts.html?f=REFER') +
      kpi('Closed', clo, 'No suspicious activity', '/alerts.html?f=CLOSE');

    var canDecide = me.user.role === 'officer' || me.user.role === 'admin';
    var left = UI.$('#left');
    if (canDecide) {
      var pend = (reviews || []).filter(function (r) { return r.state === 'PENDING' || r.state === 'SUBMITTING'; });
      if (!pend.length) left.innerHTML = '<div class="empty"><h3>Nothing to review</h3>New alerts appear here once the investigation narrative is ready.</div>';
      else left.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Alert</th><th class="hide-sm">Recommended</th><th>Risk</th><th>Time left</th></tr></thead><tbody>' +
        pend.map(function (r) {
          var h = (r.manifest && r.manifest.case_header) || {};
          var href = r.linkedCaseId ? '/case.html?id=' + encodeURIComponent(r.linkedCaseId) : '/reviews.html?r=' + encodeURIComponent(r.id);
          return '<tr class="click" data-href="' + href + '"><td><div class="cell-main">' + esc(r.alertId || 'Unknown alert') + '</div><div class="cell-sub">' + esc(r.customerName || r.customerId || '') + '</div></td><td class="hide-sm">' + UI.dispPill(h.recommended_disposition) + '</td><td>' + UI.scoreBadge(h.risk_score, true) + '</td><td class="nowrap"><span class="countdown" data-deadline="' + esc(r.deadline) + '">' + UI.countdown(r.deadline) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      UI.$('#left-title').textContent = 'My open alerts';
      UI.$('#left-link').href = '/alerts.html';
      UI.$('#left-link').textContent = 'All alerts';
      var mine = open.filter(function (c) { return c.submittedByUser === me.user.username; });
      if (!mine.length) left.innerHTML = '<div class="empty"><h3>No open alerts</h3><a href="/submit.html">Submit an alert</a> to start an investigation.</div>';
      else left.innerHTML = table(mine.slice(0, 8));
    }
    UI.$('#recent').innerHTML = cases.length ? table(cases.slice(0, 8)) : '<div class="empty"><h3>No alerts yet</h3>Submitted alerts and their outcomes show here.</div>';
    UI.$all('tr[data-href]').forEach(function (tr) { tr.onclick = function () { location.href = tr.getAttribute('data-href'); }; });

    clearTimeout(timer);
    if (open.length) timer = setTimeout(load, 8000);
  }

  function table(rows) {
    return '<div class="table-wrap"><table class="data"><thead><tr><th>Alert</th><th>Status</th><th class="hide-sm">Risk</th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr class="click" data-href="/case.html?id=' + encodeURIComponent(c.id) + '"><td><div class="cell-main">' + esc(c.alertId) + '</div><div class="cell-sub">' + esc(c.customerName || c.customerId || c.account) + ' · ' + UI.ago(c.createdAt) + '</div></td><td>' + UI.casePill(c) + '</td><td class="hide-sm">' + UI.scoreBadge(c.riskScore, true) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function load() {
    var canDecide = me.user.role === 'officer' || me.user.role === 'admin';
    Promise.all([UI.api('GET', '/api/cases'), canDecide ? UI.api('GET', '/api/reviews') : Promise.resolve({ reviews: [] })])
      .then(function (r) { render(r[0].cases, r[1].reviews); if (canDecide) UI.refreshReviewCount(); })
      .catch(function (e) { UI.toast(e.message, true); });
  }

  UI.boot('dashboard', function (m) {
    me = m;
    UI.$('#hello').textContent = 'Welcome, ' + (m.user.name || m.user.username).split(' ')[0];
    UI.$('#sub').textContent = m.user.role === 'officer' ? 'Alerts waiting for your decision and recent outcomes.' : 'Alert triage at a glance.';
    if (m.user.role !== 'officer') UI.$('#head-actions').innerHTML = '<a class="btn btn-primary" href="/submit.html">' + UI.ICONS.plus + 'New alert</a>';
    load();
  }, { title: 'Dashboard' });
})();
