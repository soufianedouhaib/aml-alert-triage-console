(function () {
  'use strict';
  var esc = UI.esc;
  var all = [];
  var filter = 'pending';
  var me = null;
  var timer = null;
  var openId = new URLSearchParams(location.search).get('r');

  var FILTERS = [
    { key: 'pending', label: 'Waiting', test: function (r) { return r.state === 'PENDING' || r.state === 'SUBMITTING'; } },
    { key: 'decided', label: 'Decided', test: function (r) { return r.state === 'DECIDED'; } },
    { key: 'expired', label: 'Window closed', test: function (r) { return r.state === 'EXPIRED'; } },
    { key: 'all', label: 'All', test: function () { return true; } }
  ];

  function statePill(r) {
    if (r.state === 'PENDING') return UI.pill('amber', 'Waiting');
    if (r.state === 'SUBMITTING') return UI.pill('blue', 'Submitting', 'live');
    if (r.state === 'DECIDED') return UI.pill('green', UI.ACTIONS[r.decision && r.decision.action] || 'Decided');
    if (r.state === 'EXPIRED') return UI.pill('red', 'Window closed');
    return UI.pill('grey', r.state);
  }

  function render() {
    UI.$('#filters').innerHTML = '<div class="seg">' + FILTERS.map(function (f) {
      return '<button type="button" data-f="' + f.key + '" class="' + (f.key === filter ? 'on' : '') + '">' + esc(f.label) + ' <span class="faint">' + all.filter(f.test).length + '</span></button>';
    }).join('') + '</div>';
    UI.$all('#filters [data-f]').forEach(function (b) { b.onclick = function () { filter = b.getAttribute('data-f'); render(); }; });
    var f = FILTERS.find(function (x) { return x.key === filter; });
    var rows = all.filter(f.test);
    if (!rows.length) {
      UI.$('#list').innerHTML = '<div class="empty"><h3>' + (filter === 'pending' ? 'Nothing waiting' : 'Nothing here') + '</h3>' + (filter === 'pending' ? 'Alerts arrive here once their investigation narrative is ready.' : '') + '</div>';
      return;
    }
    UI.$('#list').innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Alert</th><th class="hide-sm">Recommended</th><th>Risk</th><th class="hide-sm">Arrived</th><th>Status</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var h = (r.manifest && r.manifest.case_header) || {};
        var timeCell = r.state === 'PENDING' ? '<div class="cell-sub"><span class="countdown" data-deadline="' + esc(r.deadline) + '">' + UI.countdown(r.deadline) + '</span></div>' : r.decision ? '<div class="cell-sub">' + esc(r.decision.officerId) + ' · ' + UI.ago(r.decision.at) + '</div>' : '';
        return '<tr class="click" data-id="' + esc(r.id) + '"><td><div class="cell-main">' + esc(r.alertId || 'Unknown alert') + (!r.linkedCaseId ? ' <span class="tag" title="Not submitted from this console">External</span>' : '') + '</div><div class="cell-sub">' + esc([r.customerName, r.customerId].filter(Boolean).join(' · ') || '—') + (r.rule ? ' · ' + esc(r.rule) : '') + '</div></td>' +
          '<td class="hide-sm">' + UI.dispPill(h.recommended_disposition) + '</td><td>' + UI.scoreBadge(h.risk_score, true) + '</td><td class="hide-sm">' + UI.fmtDate(r.receivedAt) + '</td><td>' + statePill(r) + timeCell + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    UI.$all('#list tr[data-id]').forEach(function (tr) {
      tr.onclick = function () {
        var r = all.find(function (x) { return x.id === tr.getAttribute('data-id'); });
        if (r.linkedCaseId) location.href = '/case.html?id=' + encodeURIComponent(r.linkedCaseId);
        else openExternal(r.id);
      };
    });
  }

  // Reviews for alerts that were not submitted from this console (for example
  // started elsewhere): show the packet and take the decision in a dialog.
  function openExternal(rid) {
    UI.api('GET', '/api/reviews/' + encodeURIComponent(rid)).then(function (j) {
      var r = j.review; var h = (r.manifest && r.manifest.case_header) || {};
      var rec = h.recommended_disposition || '';
      var others = ['ESCALATE', 'REFER', 'CLOSE'].filter(function (x) { return x !== rec; });
      var pending = r.state === 'PENDING';
      var d = UI.dialog('<form id="ext"><div class="dlg-head"><h2>Alert ' + esc(r.alertId || '') + '</h2><button type="button" class="x" data-close aria-label="Close">×</button></div><div class="dlg-body">' +
        '<div class="row">' + UI.dispPill(rec, true) + UI.scoreBadge(h.risk_score) + (pending ? '<span class="countdown" data-deadline="' + esc(r.deadline) + '">' + UI.countdown(r.deadline) + '</span>' : '') + '</div>' +
        '<details class="raw" open><summary>Case packet</summary><pre>' + esc(r.presentation || 'No packet text was received.') + '</pre></details>' +
        (pending ? '<label class="field">Decision<select name="action" required><option value="">Choose…</option><option value="CONFIRM">Confirm the recommendation</option><option value="OVERRIDE">Override</option><option value="ANNOTATE">Annotate (keep recommendation)</option></select></label>' +
          '<label class="field" id="nd" hidden>New disposition<select name="newDisposition"><option value="">Choose…</option>' + others.map(function (o) { return '<option value="' + o + '">' + esc(UI.DISP[o].long) + '</option>'; }).join('') + '</select></label>' +
          '<label class="field">Rationale / notes<span class="help">Kept word for word in the audit trail.</span><textarea name="rationale" rows="3"></textarea></label><div class="err-text" id="ext-err" hidden></div>'
          : (r.decision ? '<div class="callout ok"><b>' + esc(UI.ACTIONS[r.decision.action]) + '</b> by ' + esc(r.decision.byName) + ' · ' + esc(r.decision.rationale) + '</div>' : '<div class="callout err">The review window closed.</div>')) +
        '</div><div class="dlg-foot"><button type="button" class="btn" data-close>Close</button>' + (pending ? '<button class="btn btn-primary" type="submit">Record decision</button>' : '') + '</div></form>');
      var f = UI.$('#ext', d);
      if (f.action) f.action.onchange = function () { UI.$('#nd', d).hidden = f.action.value !== 'OVERRIDE'; };
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var err = UI.$('#ext-err', d); err.hidden = true;
        UI.api('POST', '/api/reviews/' + encodeURIComponent(rid) + '/decision', { action: f.action.value, newDisposition: f.newDisposition.value, rationale: f.rationale.value })
          .then(function () { d.close(); UI.toast('Decision recorded'); load(); })
          .catch(function (x) { err.textContent = x.message; err.hidden = false; });
      });
    }).catch(function (e) { UI.toast(e.message, true); });
  }

  function load() {
    UI.api('GET', '/api/reviews').then(function (j) {
      all = j.reviews; render(); UI.refreshReviewCount();
      if (openId) { var r = all.find(function (x) { return x.id === openId; }); openId = null; if (r) { if (r.linkedCaseId) location.href = '/case.html?id=' + encodeURIComponent(r.linkedCaseId); else openExternal(r.id); } }
      clearTimeout(timer); timer = setTimeout(load, 15000);
    }).catch(function (e) { UI.$('#list').innerHTML = '<div class="empty err-text">' + esc(e.message) + '</div>'; });
  }

  UI.boot('reviews', function (m) {
    me = m;
    UI.$('#window-note').innerHTML = '<b>Decide within ' + m.reviewTimeoutMinutes + ' minutes.</b> Each alert waits for an officer for ' + m.reviewTimeoutMinutes + ' minutes after its packet arrives. After that the case times out and the decision can no longer be recorded.';
    load();
  }, { title: 'Review queue', roles: ['officer', 'admin'] });
})();
