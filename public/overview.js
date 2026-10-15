(function () {
  'use strict';
  var esc = UI.esc;
  var me = null;
  var timer = null;

  UI.boot({ active: 'overview', title: 'Overview' }, function (user) {
    me = user;
    var now = new Date();
    document.getElementById('today').textContent = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    var h = now.getHours();
    document.getElementById('hello').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + ', ' + String(user.name || '').split(' ')[0];
    if (user.role === 'analyst' || user.role === 'admin') document.getElementById('head-actions').innerHTML = '<a class="btn primary" href="/submit.html">' + UI.icon('submit') + 'New alert</a>';
    else document.getElementById('head-actions').innerHTML = '<a class="btn primary" href="/reviews.html">' + UI.icon('reviews') + 'Open review queue</a>';
    if (user.role === 'analyst') document.getElementById('all-link').textContent = 'My alerts';
    load();
  });

  function thisMonth(c) { var d = new Date(c.createdAt), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); }

  function kpi(label, value, sub, href, tone) {
    return '<a class="kpi' + (tone ? ' ' + tone : '') + '" href="' + href + '"><span class="kpi-label">' + esc(label) + '</span><span class="kpi-value">' + esc(value) + '</span><span class="kpi-sub">' + esc(sub) + '</span></a>';
  }

  function attentionItems(cases) {
    var items = [];
    cases.forEach(function (c) {
      var link = '/case.html?id=' + encodeURIComponent(c.id);
      var meta = UI.metaLine([c.customerName || c.customerId, c.rule, c.submittedBy, UI.fmtAgo(c.createdAt)]);
      if (c.stage === 'AWAITING_REVIEW' && c.reviewState === 'PENDING') {
        items.push({ order: 0, pill: UI.pill('warn', 'Awaiting officer'), title: c.alertId, meta: meta, text: 'Recommended: ' + (UI.DISP[c.recommended] ? UI.DISP[c.recommended].long : '—') + '. Decide before the window closes: ', deadline: c.reviewDeadline, link: link, action: me.role === 'analyst' ? 'View' : 'Decide' });
      } else if (c.stage === 'AWAITING_REVIEW' && c.reviewState === 'EXPIRED' || c.stage === 'TIMED_OUT') {
        items.push({ order: 1, pill: UI.pill('bad', 'Timed out'), title: c.alertId, meta: meta, text: 'No officer decision was recorded in time. Resubmit the alert to investigate it again.', link: link, action: 'View' });
      } else if (['FAILED', 'COMPLETED_NO_RESULT', 'CANCELLED'].indexOf(c.stage) >= 0) {
        items.push({ order: 1, pill: UI.pill('bad', 'Did not finish'), title: c.alertId, meta: meta, text: c.error || 'The investigation stopped before a disposition was recorded. Use Report a problem on the alert page.', link: link, action: 'View' });
      } else if (c.stage === 'COMPLETED' && c.queue === 'SUPERVISOR_REVIEW') {
        items.push({ order: 2, pill: UI.pill('bad', 'Supervisor review'), title: c.alertId, meta: meta, text: 'The officer decision could not be validated, so the case went to a supervisor (24 h SLA).', link: link, action: 'View' });
      } else if (c.stage === 'COMPLETED' && c.finalDisposition === 'ESCALATE' && Date.now() - Date.parse(c.finishedAt || c.createdAt) < 24 * 3600 * 1000) {
        items.push({ order: 3, pill: UI.pill('bad', 'Escalated · SAR'), title: c.alertId, meta: meta, text: 'Routed to the SAR filing team. The 24 h SLA runs from ' + UI.fmtDate(c.finishedAt) + '.', link: link, action: 'View' });
      }
    });
    return items.sort(function (a, b) { return a.order - b.order; });
  }

  function render(cases) {
    var month = cases.filter(thisMonth);
    var awaiting = cases.filter(function (c) { return c.stage === 'AWAITING_REVIEW' && c.reviewState === 'PENDING'; });
    var esc_ = month.filter(function (c) { return c.stage === 'COMPLETED' && c.finalDisposition === 'ESCALATE'; });
    var clo = month.filter(function (c) { return c.stage === 'COMPLETED' && c.finalDisposition === 'CLOSE'; });
    var fin = month.filter(function (c) { return c.stage === 'COMPLETED' && c.finalDisposition; });
    document.getElementById('kpis').innerHTML =
      kpi('Submitted this month', month.length, 'alerts', '/', '') +
      kpi('Awaiting officer', awaiting.length, awaiting.length ? 'waiting for a decision' : 'nothing waiting', me.role === 'analyst' ? '/?filter=review' : '/reviews.html', awaiting.length ? 'warn' : '') +
      kpi('Escalated to SAR', esc_.length, esc_.length === 1 ? '1 this month' : esc_.length + ' this month', '/report.html', esc_.length ? 'bad' : '') +
      kpi('Closed as false positive', fin.length ? Math.round(clo.length / fin.length * 100) + '%' : '—', fin.length ? clo.length + ' of ' + fin.length + ' finished' : 'none finished yet', '/report.html', fin.length ? 'ok' : '');

    var items = attentionItems(cases);
    document.getElementById('att-count').textContent = items.length ? UI.plural(items.length, 'item') + (items.length === 1 ? ' needs' : ' need') + ' action.' : 'You are up to date.';
    var shown = items.slice(0, 6);
    document.getElementById('attention').innerHTML = items.length
      ? shown.map(function (i) {
          return '<li class="att-item">' + i.pill + '<div class="att-body"><strong>' + esc(i.title) + '</strong><span class="att-meta">' + i.meta + '</span><span class="att-text">' + esc(i.text) + (i.deadline ? UI.countdown(i.deadline) : '') + '</span></div>' +
            '<div class="att-actions"><a class="btn small' + (i.action === 'Decide' ? ' primary' : '') + '" href="' + i.link + '">' + esc(i.action) + '</a></div></li>';
        }).join('') + (items.length > shown.length ? '<li class="att-more"><a href="/">' + (items.length - shown.length) + ' more in the alert list</a></li>' : '')
      : '<li class="att-empty">' + UI.icon('check') + '<div><strong>Nothing needs your attention</strong>New officer reviews, timed-out alerts and fresh escalations show up here.</div></li>';

    var recent = cases.slice(0, 6);
    document.getElementById('recent-count').textContent = cases.length ? 'The latest ' + recent.length + ' of ' + cases.length + '.' : '';
    document.getElementById('recent').innerHTML = recent.length
      ? '<table><thead><tr><th>Alert</th><th class="num">Risk</th><th>Status</th></tr></thead><tbody>' + recent.map(function (c) {
          return '<tr class="clickable" data-id="' + esc(c.id) + '"><td><strong class="nowrap">' + esc(c.alertId) + '</strong><span class="sub">' + UI.metaLine([c.customerName || c.customerId, UI.fmtAgo(c.createdAt)]) + '</span></td><td class="num">' + UI.scoreBadge(c.riskScore, true) + '</td><td>' + UI.casePill(c) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="empty"><strong>No alerts yet</strong>' + (me.role === 'officer' ? 'Alerts submitted by analysts appear here.' : '<a href="/submit.html">Submit an alert</a> to start an investigation.') + '</div>';
    Array.prototype.forEach.call(document.querySelectorAll('#recent tr.clickable'), function (tr) {
      tr.addEventListener('click', function () { location.href = '/case.html?id=' + encodeURIComponent(tr.getAttribute('data-id')); });
    });
    clearTimeout(timer);
    timer = setTimeout(load, cases.some(UI.isOpen) ? 8000 : 30000);
  }

  function load() {
    UI.api('/api/cases').then(function (d) { render(d.cases || []); UI.refreshReviewBadge(); }, function (err) { UI.showError(document.getElementById('error'), err); });
  }
})();
