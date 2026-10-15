(function () {
  'use strict';
  var esc = UI.esc;
  var data = null;
  var timer = null;

  UI.boot({ active: 'reviews', title: 'Review queue', roles: ['officer', 'admin'] }, function (user, me) {
    document.getElementById('wait-note').textContent = 'Oldest first. Each review has to be answered within ' + me.reviewTimeoutMinutes + ' minutes of arriving; after that the case times out.';
    load();
    var open = UI.qs('r');
    if (open) setTimeout(function () { openExternal(open); }, 400);
  });

  function header(h) { return h || {}; }

  function render() {
    var pending = data.pending;
    var pw = document.getElementById('pending');
    pw.innerHTML = pending.length
      ? '<table><thead><tr><th>Alert</th><th class="hide-sm">Recommended</th><th>Risk</th><th class="hide-sm">Arrived</th><th>Time left</th><th></th></tr></thead><tbody>' + pending.map(function (r) {
          var h = header(r.manifest && r.manifest.case_header);
          return '<tr><td><strong class="nowrap">' + esc(r.alertId || 'Unknown alert') + '</strong>' + (!r.linkedCaseId ? '<span class="tag" title="Not submitted from this console">External</span>' : '') + (r.ownAlert ? '<span class="tag" title="You submitted this alert">Yours</span>' : '') +
            '<span class="sub">' + UI.metaLine([r.customerName || r.customerId, r.rule, r.submittedBy]) + '</span></td>' +
            '<td class="hide-sm">' + UI.dispPill(h.recommended_disposition) + '</td><td>' + UI.scoreBadge(h.risk_score, true) + '</td>' +
            '<td class="hide-sm nowrap">' + UI.fmtAgo(r.receivedAt) + '</td><td class="nowrap">' + UI.countdown(r.deadline) + '</td>' +
            '<td class="num">' + (r.ownAlert ? '<a class="btn small" href="/case.html?id=' + encodeURIComponent(r.linkedCaseId) + '">View</a>'
              : r.linkedCaseId ? '<a class="btn small primary" href="/case.html?id=' + encodeURIComponent(r.linkedCaseId) + '">Decide</a>'
              : '<button type="button" class="btn small primary" data-ext="' + esc(r.id) + '">Decide</button>') + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="empty">Nothing is waiting for a decision.</div>';

    var expired = data.reviews.filter(function (r) { return r.state === 'EXPIRED'; });
    document.getElementById('expired-card').hidden = !expired.length;
    document.getElementById('expired').innerHTML = expired.length ? '<table><thead><tr><th>Alert</th><th>Arrived</th><th>Window closed</th><th></th></tr></thead><tbody>' + expired.slice(0, 20).map(function (r) {
      return '<tr><td><strong>' + esc(r.alertId || '—') + '</strong><span class="sub">' + UI.metaLine([r.customerName || r.customerId]) + '</span></td><td class="nowrap">' + UI.fmtDate(r.receivedAt) + '</td><td class="nowrap">' + UI.fmtDate(r.deadline) + '</td><td class="num">' + (r.linkedCaseId ? '<a class="btn small" href="/case.html?id=' + encodeURIComponent(r.linkedCaseId) + '">View</a>' : '') + '</td></tr>';
    }).join('') + '</tbody></table>' : '';

    var log = data.log;
    document.getElementById('log').innerHTML = log.length
      ? '<table><thead><tr><th>Alert</th><th>Decision</th><th class="hide-sm">Reviewed by</th><th>Case status</th></tr></thead><tbody>' + log.map(function (r) {
          var d = r.decision;
          var stage = { stage: r.caseStage || 'FINALISING', finalDisposition: r.finalDisposition, queue: r.queue };
          return '<tr' + (r.linkedCaseId ? ' class="clickable" data-id="' + esc(r.linkedCaseId) + '"' : '') + '><td><strong class="nowrap">' + esc(r.alertId || '—') + '</strong><span class="sub">' + UI.metaLine([r.customerName || r.customerId]) + '</span></td>' +
            '<td>' + esc(UI.ACTIONS[d.action] || d.action) + (d.action === 'OVERRIDE' ? ' to ' + esc((UI.DISP[d.finalDisposition] || {}).label || d.finalDisposition) : '') + '<span class="sub hide-sm">' + esc(d.rationale) + '</span></td>' +
            '<td class="hide-sm">' + esc(d.byName) + '<span class="sub">' + UI.metaLine([d.officerId, UI.fmtDate(d.at)]) + '</span></td>' +
            '<td>' + (r.linkedCaseId ? UI.casePill(stage) : UI.pill('', 'External')) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="empty">No decisions yet.</div>';

    Array.prototype.forEach.call(document.querySelectorAll('[data-ext]'), function (b) { b.addEventListener('click', function () { openExternal(b.getAttribute('data-ext')); }); });
    Array.prototype.forEach.call(document.querySelectorAll('#log tr.clickable'), function (tr) { tr.addEventListener('click', function () { location.href = '/case.html?id=' + encodeURIComponent(tr.getAttribute('data-id')); }); });
  }

  // Reviews for alerts that were not submitted from this console: show the
  // packet and take the decision in a dialog.
  function openExternal(rid) {
    UI.api('/api/reviews/' + encodeURIComponent(rid)).then(function (j) {
      var r = j.review;
      if (r.linkedCaseId) { location.href = '/case.html?id=' + encodeURIComponent(r.linkedCaseId); return; }
      var h = header(r.manifest && r.manifest.case_header);
      var rec = h.recommended_disposition || '';
      var others = ['ESCALATE', 'REFER', 'CLOSE'].filter(function (x) { return x !== rec; });
      var pending = r.state === 'PENDING';
      var m = UI.modal('<form id="ext" class="stack" novalidate><h2 style="margin:0">Alert ' + esc(r.alertId || '') + '</h2>' +
        '<div class="toolbar">' + UI.dispPill(rec, true) + UI.scoreBadge(h.risk_score) + (pending ? UI.countdown(r.deadline) : '') + '</div>' +
        '<details class="raw" open style="margin:0"><summary>Case packet</summary><pre>' + esc(r.presentation || 'No packet text was received.') + '</pre></details>' +
        (pending
          ? '<label class="field"><span>Decision</span><select name="action"><option value="">Choose…</option><option value="CONFIRM">Confirm the recommendation</option><option value="OVERRIDE">Override</option><option value="ANNOTATE">Annotate (keep the recommendation)</option></select></label>' +
            '<label class="field" id="nd" hidden><span>New disposition</span><select name="newDisposition"><option value="">Choose…</option>' + others.map(function (o) { return '<option value="' + o + '">' + esc(UI.DISP[o].long) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field"><span>Rationale or notes</span><textarea name="rationale" rows="3"></textarea><span class="hint">Kept word for word in the audit trail.</span></label><div class="alert bad" id="ext-err" hidden></div>'
          : (r.decision ? '<div class="alert ok"><strong>' + esc(UI.ACTIONS[r.decision.action]) + ' by ' + esc(r.decision.byName) + '</strong>' + esc(r.decision.rationale) + '</div>' : '<div class="alert bad">The review window closed.</div>')) +
        '<div class="actions" style="margin-top:0"><button type="button" class="btn" data-close>Close</button>' + (pending ? '<button class="btn primary" type="submit">Record decision</button>' : '') + '</div></form>');
      var f = m.el.querySelector('#ext');
      if (f.action) f.action.addEventListener('change', function () { m.el.querySelector('#nd').hidden = f.action.value !== 'OVERRIDE'; });
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var err = m.el.querySelector('#ext-err'); err.hidden = true;
        UI.api('/api/reviews/' + encodeURIComponent(rid) + '/decision', { method: 'POST', body: { action: f.action.value, newDisposition: f.newDisposition.value, rationale: f.rationale.value } })
          .then(function () { m.close(); UI.toast('Decision recorded'); load(); }, function (x) { UI.showError(err, x); });
      });
    }, function (e) { UI.toast(e.message); });
  }

  function load() {
    UI.api('/api/reviews').then(function (d) {
      data = d; render(); UI.refreshReviewBadge();
      clearTimeout(timer); timer = setTimeout(load, 15000);
    }, function (err) { UI.showError(document.getElementById('error'), err); });
  }
})();
