(function () {
  'use strict';
  var esc = UI.esc;
  var STATE = { PENDING: 'Waiting', DECIDED: 'Decided', EXPIRED: 'Window closed', SUBMITTING: 'Submitting' };
  function render(s) {
    var html = s.missing.length
      ? '<div class="alert warn"><strong>Setup incomplete.</strong>Add these in the hosting environment variables, then redeploy:<ul class="clean">' + s.missing.map(function (m) { return '<li><code>' + esc(m) + '</code></li>'; }).join('') + '</ul></div>'
      : '<div class="alert ok"><strong>All required settings are present.</strong>The console is fully connected.</div>';
    html += '<section class="card"><h2 style="margin-bottom:6px">Officer review connection</h2><p class="muted small" style="margin-bottom:14px">Point the workflow\'s officer review step at this webhook (an off-platform review task) and send the header below with the value of <code>REVIEW_WEBHOOK_SECRET</code>.</p><dl class="kv">' +
      '<dt>Webhook URL</dt><dd><code>' + esc(s.webhookUrl) + '</code> <button type="button" class="btn small" id="copy">Copy</button></dd>' +
      '<dt>Header name</dt><dd><code>' + esc(s.webhookHeader) + '</code></dd>' +
      '<dt>Decision field</dt><dd><code>' + esc(s.officerResponseVar) + '</code> (Officer Response, text; the field list Opus sends with each review takes priority)</dd>' +
      '<dt>Review window</dt><dd>' + esc(s.reviewTimeoutMinutes) + ' minutes (<code>REVIEW_TIMEOUT_MINUTES</code>; keep it equal to the review step\'s timeout)</dd></dl></section>';
    html += '<section class="card"><h2 style="margin-bottom:14px">Workflow and storage</h2><dl class="kv">' +
      '<dt>Workflow ID</dt><dd><code>' + esc(s.workflowId) + '</code></dd><dt>API base</dt><dd><code>' + esc(s.apiBase) + '</code></dd>' +
      '<dt>Input variable</dt><dd><code>' + esc(s.inputVar) + '</code> sent as <code>' + esc(s.inputType) + '</code>' + (s.inputTypeFromWorkflow ? ' (read from the workflow)' : ' (default; the workflow could not be read)') + '</dd><dt>Output variable</dt><dd><code>' + esc(s.outputVar) + '</code></dd>' +
      '<dt>Storage</dt><dd>' + esc(s.storage === 'memory' ? 'Not configured (temporary memory)' : 'Redis (' + s.storage + ')') + '</dd>' +
      '<dt>Sign-in</dt><dd>' + (s.demo ? 'Demo accounts on (<code>DEMO_MODE</code>)' : 'Email and password only') + '</dd>' +
      '<dt>Support email</dt><dd>' + esc(s.supportEmail || 'not set') + '</dd>' +
      '<dt>Records</dt><dd>' + s.counts.cases + ' alerts · ' + s.counts.reviews + ' reviews</dd></dl></section>';
    html += '<section class="card flush"><div class="card-head pad"><div><h2>Reviews not linked to an alert</h2><p>Packets for alerts that were not submitted from this console.</p></div></div>' +
      (s.unlinked.length ? '<div class="table-wrap"><table><thead><tr><th>Alert</th><th>Arrived</th><th>State</th><th></th></tr></thead><tbody>' + s.unlinked.map(function (r) {
        return '<tr><td>' + esc(r.alertId || '—') + '</td><td class="nowrap">' + UI.fmtDate(r.receivedAt) + '</td><td>' + esc(STATE[r.state] || r.state) + '</td><td class="num"><button type="button" class="btn small danger" data-del="' + esc(r.id) + '">Remove</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">None.</div>') + '</section>';
    var log = s.webhookLog || [];
    html += '<section class="card flush" id="hooklog"><div class="card-head pad"><div><h2>Last calls from Opus to the webhook</h2><p>When Opus hands an alert to the officer, it calls the webhook above. A failed call shows here with the reason.</p></div></div>' +
      (log.length ? '<div class="table-wrap"><table><thead><tr><th>When</th><th>Result</th><th>Reason</th><th class="hide-sm">Headers sent (names only)</th></tr></thead><tbody>' + log.map(function (l) {
        return '<tr><td class="nowrap">' + UI.fmtDate(l.at) + '</td><td><span class="pill ' + (l.status === 200 ? 'ok' : 'bad') + '">' + esc(l.status === 200 ? 'Accepted' : 'Rejected ' + l.status) + '</span></td><td>' + esc(l.reason) + '</td><td class="hide-sm small muted">' + esc((l.headers || []).join(', ')) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">No calls yet. If a run fails at the officer review step and nothing shows here, Opus is not calling this URL: check the review task\'s webhook URL.</div>') + '</section>';
    document.getElementById('view').innerHTML = html;
    document.getElementById('copy').addEventListener('click', function () { try { navigator.clipboard.writeText(s.webhookUrl); UI.toast('Copied'); } catch (e) { /* ignore */ } });
    Array.prototype.forEach.call(document.querySelectorAll('[data-del]'), function (b) { b.addEventListener('click', function () { UI.api('/api/reviews/' + encodeURIComponent(b.getAttribute('data-del')), { method: 'DELETE' }).then(load); }); });
  }
  function load() { UI.api('/api/system').then(render, function (e) { document.getElementById('view').innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; }); }
  UI.boot({ active: '', title: 'System', roles: ['admin'] }, load);
})();
