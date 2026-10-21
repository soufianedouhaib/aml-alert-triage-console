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
      '<dt>No header option?</dt><dd>Use this URL instead: <code>' + esc(s.webhookUrl) + '?key=</code> followed by the value of <code>REVIEW_WEBHOOK_SECRET</code></dd>' +
      '<dt>Decision field</dt><dd><code>' + esc(s.officerResponseVar) + '</code> (Officer Response, text; the field list Opus sends with each review takes priority)</dd>' +
      '<dt>Review window</dt><dd>' + esc(s.reviewTimeoutMinutes) + ' minutes (<code>REVIEW_TIMEOUT_MINUTES</code>; keep it equal to the review step\'s timeout)</dd></dl></section>';
    html += '<section class="card"><h2 style="margin-bottom:14px">Workflow and storage</h2><dl class="kv">' +
      '<dt>Workflow ID</dt><dd><code>' + esc(s.workflowId) + '</code></dd><dt>API base</dt><dd><code>' + esc(s.apiBase) + '</code></dd>' +
      '<dt>Input variable</dt><dd><code>' + esc(s.inputVar) + '</code> sent as <code>' + esc(s.inputType) + '</code>' + (s.inputTypeFromWorkflow ? ' (read from the workflow)' : ' (default; the workflow could not be read)') + '</dd><dt>Output variable</dt><dd><code>' + esc(s.outputVar) + '</code></dd>' +
      '<dt>Storage</dt><dd>' + esc(s.storage === 'memory' ? 'Not configured (temporary memory)' : 'Redis (' + s.storage + ')') + '</dd>' +
      '<dt>Sign-in</dt><dd>' + (s.demo ? 'Account list on the sign-in page (<code>DEMO_MODE</code>)' : 'Email and password only') + '</dd>' +
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
    html += '<section class="card flush" id="runlogs"><div class="card-head pad"><div><h2>Run logs</h2><p>Every run from submission to the end, failures included: what the console sent, each workflow step with its time and any error, the officer hand-over and the decision. For the engineering team.</p></div></div><div id="runlog-list"><div class="empty">Loading…</div></div></section>';
    document.getElementById('view').innerHTML = html;
    loadRuns();
    document.getElementById('copy').addEventListener('click', function () { try { navigator.clipboard.writeText(s.webhookUrl); UI.toast('Copied'); } catch (e) { /* ignore */ } });
    Array.prototype.forEach.call(document.querySelectorAll('[data-del]'), function (b) { b.addEventListener('click', function () { UI.api('/api/reviews/' + encodeURIComponent(b.getAttribute('data-del')), { method: 'DELETE' }).then(load); }); });
  }
  // ---------- run logs ----------
  var SRC = { console: 'Console', opus: 'Opus', webhook: 'Webhook', officer: 'Officer' };
  var LVL = { info: ['ok', 'Info'], warn: ['warn', 'Warning'], error: ['bad', 'Error'] };
  var STAGE = { QUEUED: ['info', 'Queued'], PENDING: ['info', 'Queued'], RUNNING: ['info', 'Investigating'], IN_PROGRESS: ['info', 'Investigating'], AWAITING_REVIEW: ['warn', 'Awaiting officer'], WAITING: ['warn', 'Awaiting officer'],
    FINALISING: ['info', 'Routing decision'], COMPLETED: ['ok', 'Completed'], COMPLETED_NO_RESULT: ['bad', 'No result'], FAILED: ['bad', 'Did not finish'], TIMED_OUT: ['bad', 'Timed out'],
    CANCELLED: ['', 'Cancelled'], NOT_STARTED: ['bad', 'Not started'], REMOVED: ['', 'Removed'] };
  function stagePill(st) { var x = STAGE[st] || ['', st || '—']; return UI.pill(x[0], x[1]); }
  function time(iso) { if (!iso) return '—'; var d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  function loadRuns() {
    UI.api('/api/runlogs').then(function (j) {
      var runs = j.runs || [];
      var el = document.getElementById('runlog-list');
      if (!runs.length) { el.innerHTML = '<div class="empty">No runs logged yet. Every alert submitted from now on is logged here, kept ' + j.keptDays + ' days.</div>'; return; }
      el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Started</th><th>Alert</th><th class="hide-sm">Case</th><th>Status</th><th class="num hide-sm">Events</th><th>Problems</th><th class="hide-sm">Last event</th><th class="num"><span class="sr-only">Action</span></th></tr></thead><tbody>' + runs.map(function (r) {
        var prob = r.errors ? UI.pill('bad', r.errors + (r.errors === 1 ? ' error' : ' errors')) : r.warnings ? UI.pill('warn', r.warnings + (r.warnings === 1 ? ' warning' : ' warnings')) : '<span class="muted small">None</span>';
        return '<tr><td class="nowrap">' + time(r.firstAt) + '</td><td><strong class="nowrap">' + esc(r.alertId || '—') + '</strong><span class="sub">' + UI.metaLine([r.customerName, r.submittedBy]) + '</span></td>' +
          '<td class="hide-sm"><code>' + esc(r.id) + '</code></td><td>' + stagePill(r.stage) + '</td><td class="num hide-sm">' + (r.events || 0) + '</td><td>' + prob + (r.lastError ? '<span class="sub">' + esc(r.lastError) + '</span>' : '') + '</td>' +
          '<td class="hide-sm small">' + esc(r.lastMessage || '') + '<span class="sub">' + time(r.lastAt) + '</span></td><td class="num"><button type="button" class="btn small" data-run="' + esc(r.id) + '">View log</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="muted small pad" style="margin:0">Kept ' + j.keptDays + ' days, also after an alert is cleared. Up to 400 events per run.</p>';
      Array.prototype.forEach.call(el.querySelectorAll('[data-run]'), function (b) { b.addEventListener('click', function () { openRun(b.getAttribute('data-run')); }); });
      var want = UI.qs('run'); if (want) { openRun(want); history.replaceState(null, '', location.pathname); }
    }, function (e) { document.getElementById('runlog-list').innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; });
  }
  function openRun(id) {
    var m = UI.modal('<div class="card-head" style="margin-bottom:12px"><div><h2 style="margin:0">Run log</h2><p class="muted small" style="margin:4px 0 0"><code>' + esc(id) + '</code></p></div></div><div id="rl-body"><div class="empty">Loading…</div></div>' +
      '<div class="actions"><button type="button" class="btn" id="rl-copy">Copy as text</button><button type="button" class="btn" id="rl-dl">Download JSON</button><button type="button" class="btn primary" data-close>Close</button></div>', 'runlog');
    UI.api('/api/runlogs/' + encodeURIComponent(id)).then(function (d) {
      // Step events carry the time Opus reports for them; show everything in time order.
      (d.events || []).forEach(function (e, i) { e._i = i; });
      (d.events || []).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : a._i - b._i; });
      (d.events || []).forEach(function (e) { delete e._i; });
      var c = d.case;
      var head = '<dl class="kv" style="margin-bottom:14px">' +
        '<dt>Alert</dt><dd>' + esc((c && c.alertId) || (d.meta && d.meta.alertId) || '—') + (c ? ' · <a href="/case.html?id=' + encodeURIComponent(c.id) + '">open alert</a>' : ' <span class="muted">(alert removed from the console)</span>') + '</dd>' +
        '<dt>Status</dt><dd>' + stagePill(c ? c.stage : (d.meta && (d.meta.removed ? 'REMOVED' : d.meta.status))) + (c && c.error ? ' <span class="muted">' + esc(c.error) + '</span>' : '') + '</dd>' +
        '<dt>Workflow</dt><dd><code>' + esc(d.workflowId) + '</code></dd>' +
        '<dt>Case ID</dt><dd><code>' + esc(id) + '</code></dd>' +
        (c && c.finalDisposition ? '<dt>Outcome</dt><dd>' + esc(c.finalDisposition + ' → ' + (c.queue || '—')) + '</dd>' : '') + '</dl>';
      var steps = (d.steps || []).length ? '<h3 style="margin:6px 0 8px">Workflow steps (from the Opus audit log)</h3><div class="table-wrap"><table class="rl-steps"><thead><tr><th>Step</th><th>Status</th><th>Started</th><th class="num">Took</th></tr></thead><tbody>' +
        d.steps.map(function (n) {
          var bad = /FAIL|CANCEL|TIMED/.test(n.status);
          return '<tr><td>' + esc(n.name) + (n.error ? '<span class="sub rl-err">' + esc(n.error) + '</span>' : '') + '</td><td>' + UI.pill(bad ? 'bad' : n.status === 'COMPLETED' ? 'ok' : n.status === 'WAITING' ? 'warn' : 'info', n.status.charAt(0) + n.status.slice(1).toLowerCase().replace('_', ' ')) + '</td><td class="nowrap small">' + time(n.startedAt) + '</td><td class="num">' + (n.ms != null ? (n.ms / 1000).toFixed(1) + ' s' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted small">No step data from the Opus audit log' + (c ? ' yet.' : ' (the alert was removed; the events below are kept).') + '</p>';
      var events = '<h3 style="margin:16px 0 8px">Events</h3><ol class="rl-events">' + (d.events || []).map(function (e) {
        var l = LVL[e.level] || LVL.info;
        return '<li class="rl-' + esc(e.level) + '"><div class="rl-line"><span class="rl-time">' + time(e.at) + '</span>' + UI.pill(l[0], SRC[e.source] || e.source) + '<span class="rl-msg">' + esc(e.message) + '</span></div>' +
          (e.detail != null ? '<details><summary>Details</summary><pre>' + esc(typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail, null, 2)) + '</pre></details>' : '') + '</li>';
      }).join('') + '</ol>';
      m.el.querySelector('#rl-body').innerHTML = head + steps + events;
      var text = function () {
        return ['Run log ' + id, 'Workflow ' + d.workflowId, 'Alert ' + ((c && c.alertId) || (d.meta && d.meta.alertId) || ''), '', 'STEPS'].concat((d.steps || []).map(function (n) { return [n.startedAt || '', n.name, n.status, n.ms != null ? n.ms + ' ms' : '', n.error || ''].join(' | '); }))
          .concat(['', 'EVENTS']).concat((d.events || []).map(function (e) { return [e.at, e.level.toUpperCase(), e.source, e.message, e.detail != null ? JSON.stringify(e.detail) : ''].join(' | '); })).join('\n');
      };
      m.el.querySelector('#rl-dl').addEventListener('click', function () { UI.downloadJson('run-log-' + id + '.json', d); });
      m.el.querySelector('#rl-copy').addEventListener('click', function () { try { navigator.clipboard.writeText(text()); UI.toast('Copied'); } catch (e) { /* ignore */ } });
    }, function (e) { m.el.querySelector('#rl-body').innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; });
  }

  function load() { UI.api('/api/system').then(render, function (e) { document.getElementById('view').innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; }); }
  UI.boot({ active: '', title: 'System', roles: ['admin'] }, load);
})();
