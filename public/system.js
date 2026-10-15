(function () {
  'use strict';
  var esc = UI.esc;
  function render(s) {
    var html = '<div class="stack">';
    html += s.missing.length
      ? '<div class="callout err"><b>Setup incomplete.</b> Add these in the hosting environment variables, then redeploy:<ul class="clean">' + s.missing.map(function (m) { return '<li><code>' + esc(m) + '</code></li>'; }).join('') + '</ul></div>'
      : '<div class="callout ok"><b>All required settings are present.</b></div>';
    html += '<section class="card card-pad"><h2 style="margin-bottom:10px">Officer review connection</h2><p class="muted">Point the workflow\'s officer review step at this webhook (an off-platform review task). Send the header below with the value of <code>REVIEW_WEBHOOK_SECRET</code>.</p><dl class="kv" style="margin-top:10px">' +
      '<dt>Webhook URL</dt><dd><code>' + esc(s.webhookUrl) + '</code> <button class="btn btn-sm" id="copy">Copy</button></dd>' +
      '<dt>Header name</dt><dd><code>' + esc(s.webhookHeader) + '</code></dd>' +
      '<dt>Decision field</dt><dd><code>' + esc(s.officerResponseVar) + '</code> (Officer Response, text)</dd>' +
      '<dt>Review window</dt><dd>' + esc(s.reviewTimeoutMinutes) + ' minutes (<code>REVIEW_TIMEOUT_MINUTES</code> — keep it equal to the review step\'s timeout)</dd></dl></section>';
    html += '<section class="card card-pad"><h2 style="margin-bottom:10px">Workflow</h2><dl class="kv">' +
      '<dt>Workflow ID</dt><dd><code>' + esc(s.workflowId) + '</code></dd><dt>API base</dt><dd><code>' + esc(s.apiBase) + '</code></dd>' +
      '<dt>Input variable</dt><dd><code>' + esc(s.inputVar) + '</code></dd><dt>Output variable</dt><dd><code>' + esc(s.outputVar) + '</code></dd>' +
      '<dt>Storage</dt><dd>' + esc(s.storage === 'memory' ? 'Not configured (temporary memory)' : 'Redis (' + s.storage + ')') + '</dd>' +
      '<dt>Records</dt><dd>' + s.counts.cases + ' cases · ' + s.counts.reviews + ' reviews</dd></dl></section>';
    html += '<section class="card"><div class="card-head"><h2>Reviews not linked to a case</h2><span class="hint">Packets for alerts not submitted from this console.</span></div>' +
      (s.unlinked.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>Alert</th><th>Arrived</th><th>State</th><th></th></tr></thead><tbody>' + s.unlinked.map(function (r) {
        return '<tr><td>' + esc(r.alertId || '—') + '</td><td>' + UI.fmtDate(r.receivedAt) + '</td><td>' + esc({ PENDING: 'Waiting', DECIDED: 'Decided', EXPIRED: 'Window closed', SUBMITTING: 'Submitting' }[r.state] || r.state) + '</td><td style="text-align:right"><button class="btn btn-sm btn-danger" data-del="' + esc(r.id) + '">Remove</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">None.</div>') + '</section></div>';
    UI.$('#view').innerHTML = html;
    UI.$('#copy').onclick = function () { try { navigator.clipboard.writeText(s.webhookUrl); UI.toast('Copied'); } catch (e) {} };
    UI.$all('[data-del]').forEach(function (b) { b.onclick = function () { UI.api('DELETE', '/api/reviews/' + encodeURIComponent(b.getAttribute('data-del'))).then(load); }; });
  }
  function load() { UI.api('GET', '/api/system').then(render).catch(function (e) { UI.$('#view').innerHTML = '<div class="card empty err-text">' + esc(e.message) + '</div>'; }); }
  UI.boot('', load, { title: 'System', roles: ['admin'] });
})();
