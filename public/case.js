(function () {
  'use strict';
  var esc = UI.esc;
  var id = UI.qs('id');
  var me = null;
  var data = null;
  var timer = null;
  var busy = false;
  var draft = { action: '', newDisposition: '', rationale: '' };

  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function para(s) { return s ? '<p class="prose">' + UI.prose(s) + '</p>' : '<p class="muted">Not provided.</p>'; }

  function packet() {
    var d = (data.evidence && data.evidence.data) || {};
    return { manifest: obj(d.manifest) || (data.review && obj(data.review.manifest)) || null, narrative: obj(d.narrative), d: d };
  }
  function sections() { var p = packet(); return (p.narrative && obj(p.narrative.narrative_sections)) || (p.manifest && obj(p.manifest.narrative_sections)) || {}; }

  // ---------------- main column ----------------
  function runningCard() {
    var c = data.case;
    if (['QUEUED', 'RUNNING', 'FINALISING'].indexOf(c.stage) < 0) return '';
    var st = (data.evidence && data.evidence.stages) || [];
    var cur = st.find(function (s) { return s.status === 'RUNNING'; }) || st.find(function (s) { return s.status === 'PENDING'; });
    var text = c.stage === 'FINALISING' ? 'Decision received. Routing the case and writing the audit record.' : c.stage === 'QUEUED' ? 'Starting the investigation.' : 'Working on: ' + (cur ? cur.label.toLowerCase() : 'the investigation') + '.';
    return '<section class="card"><div class="card-head" style="margin-bottom:10px"><div><h2>Investigation in progress</h2><p>' + esc(text) + ' This page updates by itself.</p></div></div><div class="progress indeterminate"><div></div></div></section>';
  }

  function decisionCard() {
    var d = data.review && data.review.decision;
    if (!d) return '';
    return '<section class="card"><div class="card-head" style="margin-bottom:10px"><div><h2>Officer decision</h2><p>' + UI.metaLine([d.byName, d.officerId, UI.fmtDate(d.at)]) + '</p></div>' + UI.pill(d.action === 'OVERRIDE' ? 'warn' : 'ok', UI.ACTIONS[d.action] || d.action) + '</div>' +
      '<div class="preview">' + esc(d.responseText || (d.action + ': ' + d.rationale)) + '</div></section>';
  }

  function outcomeCard() {
    var r = data.result; var c = data.case;
    if (!r || !r.final_disposition) {
      if (['FAILED', 'TIMED_OUT', 'CANCELLED', 'COMPLETED_NO_RESULT'].indexOf(c.stage) >= 0 || c.reviewState === 'EXPIRED') {
        return '<section class="card"><h2 style="margin-bottom:10px">Outcome</h2><div class="alert bad"><strong>' + (c.stage === 'TIMED_OUT' || c.reviewState === 'EXPIRED' ? 'Timed out' : 'Did not finish') + '</strong>' +
          esc(c.error || (c.stage === 'TIMED_OUT' || c.reviewState === 'EXPIRED' ? 'No officer decision was recorded before the review window closed. Resubmit the alert to investigate it again.' : 'The investigation stopped before a disposition was recorded. Use Report a problem so support can look at it.')) + '</div></section>';
      }
      return '';
    }
    var rt = r.routing || {};
    var dr = (r.audit_trail && r.audit_trail.decision_record) || {};
    return '<section class="card"><h2 style="margin-bottom:14px">Outcome</h2><div class="tiles">' +
      '<div class="tile"><div class="label">Disposition</div><div class="value">' + esc((UI.DISP[r.final_disposition] || {}).label || r.final_disposition) + '</div><div class="sub">' + (dr.disposition_changed ? 'changed by the officer' : 'as recommended') + '</div></div>' +
      '<div class="tile"><div class="label">Queue</div><div class="value">' + esc(UI.QUEUES[rt.queue] || rt.queue || '—') + '</div></div>' +
      '<div class="tile"><div class="label">SLA</div><div class="value">' + (rt.sla_hours ? esc(rt.sla_hours) + ' hours' : 'None') + '</div></div>' +
      '<div class="tile"><div class="label">Risk at decision</div><div class="value">' + esc(dr.risk_score_at_decision != null ? dr.risk_score_at_decision + ' / 100' : (c.riskScore != null ? c.riskScore + ' / 100' : '—')) + '</div></div>' +
      '</div><dl class="kv" style="margin-top:16px"><dt>Reason</dt><dd>' + esc(rt.reason || '—') + '</dd><dt>Next action</dt><dd>' + esc(rt.next_action || '—') + '</dd></dl></section>';
  }

  function summaryCard() {
    var p = packet(); var n = p.narrative; var m = p.manifest;
    if (!n && !m) {
      if (['QUEUED', 'RUNNING'].indexOf(data.case.stage) >= 0) return '<section class="card"><h2 style="margin-bottom:8px">Investigation summary</h2><p class="muted">The summary appears once the narrative is drafted, usually 2–4 minutes after submission.</p></section>';
      return '';
    }
    var secs = sections();
    var drl = (n && obj(n.domain_risk_levels)) || (m && obj(m.risk_dashboard)) || {};
    var disp = (n && obj(n.disposition)) || {};
    var rec = (m && m.disposition_recommendation) || {};
    var follow = disp.follow_up_actions || rec.follow_up_actions || [];
    var recommendation = disp.recommendation || rec.action;
    var html = '<section class="card"><div class="card-head"><div><h2>Investigation summary</h2><p>Drafted from the findings; every claim cites a finding or transaction.</p></div></div>' +
      '<div class="section"><h3>Executive summary</h3>' + para(secs.executive_summary) + '</div>' +
      '<div class="section"><h3>Risk by domain</h3><div class="domains">' +
      [['sanctions_pep', 'Sanctions / PEP'], ['adverse_media', 'Adverse media'], ['transaction_typology', 'Transaction typology']].map(function (x) {
        var dd = obj(drl[x[0]]) || {};
        return '<div class="domain"><div class="domain-head"><b>' + x[1] + '</b>' + UI.levelPill(dd.risk_level) + '</div>' +
          (dd.data_available === false ? '<div class="alert warn small" style="margin-top:8px;padding:8px 10px">Data gap: source unavailable, which raises risk.</div>' : '') +
          '<p>' + UI.prose(dd.assessment_summary || 'No summary.') + '</p></div>';
      }).join('') + '</div></div>' +
      '<div class="section"><h3>Recommended disposition</h3><div style="margin-bottom:6px">' + UI.dispPill(recommendation, true) + '</div>' + para(disp.rationale || rec.rationale || secs.disposition_recommendation) +
      (follow.length ? '<p class="small" style="margin-top:8px;font-weight:600">Follow-up actions</p><ul class="clean">' + follow.map(function (f) { return '<li>' + esc(typeof f === 'string' ? f : JSON.stringify(f)) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    if (secs.data_gaps_limitations && !/^(none|n\/a)\.?$/i.test(String(secs.data_gaps_limitations).trim())) html += '<div class="section"><h3>Data gaps and limitations</h3><div class="alert warn">' + esc(secs.data_gaps_limitations) + '</div></div>';
    if (secs.alert_context) html += '<div class="section"><h3>Alert context</h3>' + para(secs.alert_context) + '</div>';
    if (secs.risk_assessment) html += '<div class="section"><h3>Risk assessment</h3>' + para(secs.risk_assessment) + '</div>';
    return html + '</section>';
  }

  function findingsCard() {
    var p = packet(); var d = p.d; var secs = sections();
    var blocks = [
      ['Sanctions and PEP screening', secs.sanctions_pep_findings, d.sanctionsFindings, d.sanctionsRaw, 'Sanctions/PEP lookup results'],
      ['Adverse media', secs.adverse_media_findings, d.mediaFindings, d.mediaRaw, 'Adverse media search results'],
      ['Transaction typology', secs.typology_findings, d.typologyFindings, null, '']
    ];
    if (!blocks.some(function (b) { return b[1] || b[2]; })) return '';
    var html = '<section class="card"><div class="card-head"><div><h2>Findings</h2><p>What the three specialist analysts concluded, with their working.</p></div></div>';
    html += blocks.map(function (b, i) {
      var f = obj(b[2]) || (typeof b[2] === 'string' ? { analysis: b[2] } : null);
      var rest = {};
      if (f) Object.keys(f).forEach(function (k) { if (['risk_level', 'alert_id', 'customer_id'].indexOf(k) < 0) rest[k] = f[k]; });
      return '<div class="section"' + (i ? ' style="border-top:1px solid var(--line);padding-top:16px"' : '') + '><div class="card-head" style="margin-bottom:6px"><h3 style="margin:0">' + b[0] + '</h3>' + (f && f.risk_level ? UI.levelPill(f.risk_level) : '') + '</div>' +
        (b[1] ? para(b[1]) : '') +
        (f ? '<details class="raw"><summary>Analyst detail</summary><div>' + UI.jsonBlock(rest) + '</div></details>' : '') +
        (b[3] ? '<details class="raw"><summary>' + esc(b[4]) + '</summary><div>' + UI.jsonBlock(b[3]) + '</div></details>' : '') + '</div>';
    }).join('');
    var rp = obj(d.riskPackage);
    if (rp && obj(rp.scoring)) {
      var s = rp.scoring;
      html += '<div class="section" style="border-top:1px solid var(--line);padding-top:16px"><h3>How the score was built</h3><dl class="kv" style="margin-top:8px">' +
        '<dt>Domain score</dt><dd>' + esc(s.composite_score) + ' / 100</dd><dt>Alert score</dt><dd>' + esc(s.alert_score) + ' / 100</dd>' +
        '<dt>Blended (70% domains, 30% alert)</dt><dd><strong>' + esc(s.blended_score) + ' / 100</strong></dd>' + (s.data_penalty ? '<dt>Data-gap penalty</dt><dd>+' + esc(s.data_penalty) + '</dd>' : '') + '</dl>' +
        (obj(s.domain_scores) ? '<details class="raw"><summary>Per-domain weights</summary><div>' + UI.jsonBlock(s.domain_scores) + '</div></details>' : '') + '</div>';
    }
    return html + '</section>';
  }

  function txnCard() {
    var cd = obj(packet().d.customerData);
    if (!cd) return '';
    var prof = obj(cd.customer_profile) || {};
    var t = obj(cd.transactions) || {};
    var alerted = Array.isArray(t.alerted_txns) ? t.alerted_txns : [];
    var bg = Array.isArray(t.background_txns) ? t.background_txns : [];
    var keys = ['full_name', 'customer_type', 'business_name', 'industry', 'occupation', 'nationality', 'country_of_residence', 'risk_rating', 'pep_status', 'source_of_funds', 'annual_income_usd', 'onboarding_date', 'last_review_date'];
    function table(list) {
      return '<div class="table-wrap" style="border:1px solid var(--line);border-radius:var(--radius-sm)"><table><thead><tr><th>Transaction</th><th class="hide-sm">Date</th><th class="hide-sm">Type</th><th class="num">Amount</th><th>Counterparty</th></tr></thead><tbody>' +
        list.map(function (x) {
          return '<tr><td class="mono nowrap">' + esc(x.txn_id) + '</td><td class="nowrap hide-sm">' + esc(String(x.txn_date || '').slice(0, 10)) + '</td><td class="nowrap hide-sm">' + esc(String(x.txn_type || '').replace(/_/g, ' ').toLowerCase()) + '<span class="sub">' + esc([x.direction === 'DEBIT' ? 'outgoing' : x.direction === 'CREDIT' ? 'incoming' : '', x.branch_code].filter(Boolean).join(' · ')) + '</span></td>' +
            '<td class="num">' + UI.money(x.amount, x.currency) + '</td><td>' + esc(x.counterparty_name || '—') + '<span class="sub">' + esc([x.counterparty_country, x.description].filter(Boolean).join(' · ')) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return '<section class="card"><div class="card-head"><div><h2>Customer and transactions</h2><p>From core banking, as the lookup step returned it.</p></div>' + (prof.risk_rating ? '<span class="pill plain">KYC risk: ' + esc(String(prof.risk_rating).toLowerCase()) + '</span>' : '') + '</div>' +
      '<dl class="kv">' + keys.filter(function (k) { return prof[k] != null && prof[k] !== ''; }).map(function (k) {
        return '<dt>' + esc(UI.humanKey(k)) + '</dt><dd>' + (k === 'annual_income_usd' ? UI.money(prof[k], 'USD') : esc(prof[k])) + '</dd>';
      }).join('') + '</dl>' +
      '<h3 style="margin:18px 0 8px">Flagged transactions (' + alerted.length + ')</h3>' + (alerted.length ? table(alerted) : '<p class="muted">None matched the flagged IDs.</p>') +
      (bg.length ? '<details class="raw"><summary>Background history (' + UI.plural(bg.length, 'transaction') + ')</summary><div>' + table(bg) + '</div></details>' : '') + '</section>';
  }

  function alertCard() {
    var a = data.alert || {};
    var order = ['alert_id', 'generated_at', 'rule_code', 'score', 'priority', 'subject_account', 'related_accounts', 'flagged_txns', 'system'];
    var rest = Object.keys(a).filter(function (k) { return order.indexOf(k) < 0 && k !== 'narrative'; });
    return '<section class="card"><div class="card-head"><div><h2>Original alert</h2><p>As received from the monitoring system.</p></div></div>' +
      '<div class="section"><h3>Alert narrative</h3>' + para(a.narrative) + '</div>' +
      '<dl class="kv" style="margin-top:14px">' + order.concat(rest).filter(function (k) { return a[k] != null && a[k] !== ''; }).map(function (k) {
        var v = a[k];
        if (k === 'priority') v = { H: 'High', M: 'Medium', L: 'Low' }[v] || v;
        if (k === 'generated_at' && !isNaN(Date.parse(v))) v = UI.fmtDate(v);
        return '<dt>' + esc(UI.humanKey(k)) + '</dt><dd>' + (k === 'flagged_txns' ? '<span class="mono">' + esc(String(v).split(',').join(', ')) + '</span>' : typeof v === 'object' ? UI.renderValue(v) : esc(v)) + '</dd>';
      }).join('') + '</dl>' +
      (packet().d.parsedAlert ? '<details class="raw"><summary>Parsed alert and extracted entities</summary><div>' + UI.jsonBlock(packet().d.parsedAlert) + '</div></details>' : '') + '</section>';
  }

  function auditCard() {
    var r = data.result;
    if (!r || !r.audit_trail) return '';
    var au = r.audit_trail;
    return '<section class="card"><div class="card-head"><div><h2>Audit trail</h2><p>The immutable record written for this alert.</p></div><button type="button" class="btn small" id="dl-audit">' + UI.icon('download') + 'Download audit pack</button></div>' +
      '<dl class="kv"><dt>Audit ID</dt><dd class="mono">' + esc(au.audit_id || '—') + '</dd><dt>Recorded</dt><dd>' + UI.fmtDate(au.timestamp || r.completion_timestamp) + '</dd><dt>Workflow version</dt><dd>' + esc(au.workflow_version || '—') + '</dd></dl>' +
      '<details class="raw"><summary>Decision record, annotations and processing chain</summary><div>' + UI.jsonBlock({ decision_record: au.decision_record, annotations: au.annotations, override_details: au.override_details, processing_chain: au.processing_chain }) + '</div></details></section>';
  }

  // ---------------- side column ----------------
  function decisionPanel(rev, h) {
    var rec = h.recommended_disposition || data.case.recommended || '';
    var others = ['ESCALATE', 'REFER', 'CLOSE'].filter(function (x) { return x !== rec; });
    if (draft.action === 'OVERRIDE' && others.indexOf(draft.newDisposition) < 0) draft.newDisposition = '';
    var html = '<section class="card" id="decide"><div class="card-head" style="margin-bottom:12px"><div><h2>Your decision</h2><p>' + UI.countdown(rev.deadline) + '</p></div></div><div class="stack" style="gap:12px">' +
      '<div><div class="muted small">Recommended</div><div class="toolbar" style="margin-top:4px">' + UI.dispPill(rec, true) + UI.scoreBadge(h.risk_score) + '</div></div>' +
      '<div class="decide-actions" role="radiogroup" aria-label="Decision">' + choice('CONFIRM', 'Confirm', 'Accept') + choice('OVERRIDE', 'Override', 'Change') + choice('ANNOTATE', 'Annotate', 'Add notes') + '</div>';
    if (draft.action === 'OVERRIDE') html += '<label class="field"><span>New disposition</span><select id="d-new"><option value="">Choose…</option>' + others.map(function (o) { return '<option value="' + o + '"' + (draft.newDisposition === o ? ' selected' : '') + '>' + esc(UI.DISP[o].long) + '</option>'; }).join('') + '</select></label>';
    if (draft.action) {
      html += '<label class="field"><span>' + (draft.action === 'CONFIRM' ? 'Rationale (one line)' : draft.action === 'OVERRIDE' ? 'Why the recommendation is wrong' : 'Notes for the record') + '</span><textarea id="d-text" rows="4" maxlength="1500">' + esc(draft.rationale) + '</textarea><span class="hint">Kept word for word in the audit trail. Plain text.</span></label>' +
        '<div><div class="muted small" style="margin-bottom:4px">Recorded as</div><div class="preview" id="d-preview"></div></div>';
    }
    return html + '<div class="alert bad" id="d-err" hidden></div><button class="btn primary block" id="d-go"' + (draft.action ? '' : ' disabled') + '>Record decision</button>' +
      '<p class="muted small">This is a disposition sign-off, not a SAR filing decision.</p></div></section>';
  }
  function choice(k, t, s) { return '<button type="button" class="choice" role="radio" aria-checked="' + (draft.action === k) + '" data-act="' + k + '"><b>' + t + '</b><span>' + s + '</span></button>'; }

  function reviewCard() {
    var c = data.case; var rev = data.review;
    var canDecide = me.role === 'officer' || me.role === 'admin';
    var h = (packet().manifest && packet().manifest.case_header) || {};
    if (rev && rev.state === 'PENDING' && canDecide && !rev.ownAlert) return decisionPanel(rev, h);
    var body = '';
    if (rev && rev.decision) body = '<p><strong>' + esc(UI.ACTIONS[rev.decision.action] || rev.decision.action) + '</strong> by ' + esc(rev.decision.byName) + '.</p>' + (c.stage === 'FINALISING' ? '<p class="muted small" style="margin-top:6px">Routing the case; the outcome appears in a few seconds.</p>' : '');
    else if (rev && rev.state === 'EXPIRED') body = '<div class="alert bad"><strong>Review window closed.</strong>No decision was recorded in time.</div>';
    else if (rev && rev.state === 'PENDING') body = '<p>Waiting for a compliance officer. ' + UI.countdown(rev.deadline) + '</p>' + (rev.ownAlert && canDecide ? '<p class="muted small" style="margin-top:6px">You submitted this alert, so another officer must decide it.</p>' : '');
    else if (c.stage === 'AWAITING_REVIEW') body = '<p>Paused for the officer review.</p><p class="muted small" style="margin-top:6px">If no review packet appears within a minute, the review step is not connected to this console yet. Ask your administrator.</p>';
    else if (c.stage === 'COMPLETED') body = c.officerAction ? '<p><strong>' + esc(UI.ACTIONS[c.officerAction] || c.officerAction) + '</strong> by ' + esc(c.officerName || c.officerId) + '.</p>' : '<p class="muted">Completed.</p>';
    else if (UI.isOpen(c)) body = '<p class="muted">An officer decides once the narrative is ready, usually 2–4 minutes after submission.</p>';
    else body = '<p class="muted">No officer decision was recorded.</p>';
    return '<section class="card"><h2 style="margin-bottom:10px">Officer review</h2>' + body + '</section>';
  }

  function stagesCard() {
    var st = (data.evidence && data.evidence.stages) || [];
    var c = data.case;
    return '<section class="card"><h2 style="margin-bottom:10px">Stages</h2><ul class="steps">' + st.map(function (s) {
      var cls = s.status === 'DONE' ? 'done' : s.status === 'RUNNING' ? 'current' : s.status === 'WAITING' ? 'waiting' : (s.status === 'FAILED' || s.status === 'STOPPED') ? 'failed' : '';
      if (s.key === 'review' && c.reviewState === 'EXPIRED') cls = 'failed';
      var when = s.status === 'DONE' && s.ms ? UI.fmtMs(s.ms) : s.status === 'WAITING' ? 'waiting' : '';
      return '<li class="' + cls + '"><span class="dot"></span><span>' + esc(s.label) + '</span>' + (when ? '<span class="when">' + esc(when) + '</span>' : '') + '</li>';
    }).join('') + '</ul>' + (data.evidence && data.evidence.error ? '<p class="muted small" style="margin-top:8px">Step details are not available right now.</p>' : '') + '</section>';
  }

  function detailsCard() {
    var c = data.case;
    var rows = [
      ['Case id', '<span class="mono">' + esc(UI.shortId(c.id)) + '</span>'],
      ['Customer', esc([c.customerName, c.customerId].filter(Boolean).join(' · ') || '—')],
      ['Account', esc(c.account || '—')],
      ['Rule', esc(c.rule || '—') + (c.alertScore != null ? ' <span class="muted">· score ' + esc(c.alertScore) + '</span>' : '')],
      ['Submitted', UI.fmtDate(c.createdAt)],
      ['Finished', c.finishedAt ? UI.fmtDate(c.finishedAt) : '—'],
      ['Duration', c.durationMs != null ? UI.fmtMs(c.durationMs) : '—']
    ];
    if (c.note) rows.push(['Note', esc(c.note)]);
    if (c.officerName || c.officerId) rows.push(['Reviewed by', esc(c.officerName || c.officerId) + (c.decisionAt ? '<span class="muted small" style="display:block">' + UI.fmtDate(c.decisionAt) + '</span>' : '')]);
    if (c.duplicateOf) rows.push(['Repeat of', '<a href="/case.html?id=' + encodeURIComponent(c.duplicateOf) + '">' + esc(data.duplicateOfAlert || 'earlier alert') + '</a>']);
    return '<section class="card"><h2 style="margin-bottom:12px">Case details</h2><dl class="kv">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl></section>';
  }

  // ---------------- render ----------------
  function render() {
    var c = data.case;
    document.getElementById('crumb-case').textContent = 'Case ' + UI.shortId(c.id);
    document.getElementById('title').textContent = c.alertId;
    document.title = c.alertId + ' · ' + UI.PRODUCT.name;
    document.getElementById('subtitle').innerHTML = 'Submitted by ' + esc(c.submittedBy || '—') + ' · ' + UI.fmtDate(c.createdAt) + (c.duplicateOf ? ' <span class="tag">Repeat</span>' : '');
    document.getElementById('head-tools').innerHTML = UI.casePill(c) +
      '<button type="button" class="btn small" id="btn-refresh">' + UI.icon('refresh') + 'Refresh</button>' +
      (me.role === 'admin' ? '<a class="btn small" href="/system.html?run=' + encodeURIComponent(data.case.id) + '#runlogs">Run log</a> <button type="button" class="btn small danger" id="btn-del">Delete</button>' : '');
    var y = window.scrollY;
    document.getElementById('view').innerHTML = '<div class="layout-main-side"><div class="stack">' +
      runningCard() + decisionCard() + outcomeCard() + summaryCard() + findingsCard() + txnCard() + alertCard() + auditCard() +
      '</div><div class="stack sticky-side" id="side">' + reviewCard() + stagesCard() + detailsCard() + '</div></div>';
    window.scrollTo(0, y);
    wire();
  }

  function preview() {
    var el = document.getElementById('d-preview'); if (!el) return;
    var t = String(draft.rationale || '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '') || '…';
    var oid = me.officerId || me.email.split('@')[0].toUpperCase();
    el.textContent = draft.action === 'OVERRIDE' ? 'OVERRIDE to ' + (draft.newDisposition || '…') + ': ' + t + '. Officer: ' + oid : draft.action + ': ' + t + '. Officer: ' + oid;
  }

  function wire() {
    document.getElementById('btn-refresh').addEventListener('click', function () { UI.api('/api/cases/' + encodeURIComponent(id) + '/refresh', { method: 'POST', body: {} }).then(load); });
    var del = document.getElementById('btn-del');
    if (del) del.addEventListener('click', function () {
      var m = UI.modal('<h2>Delete this alert?</h2><p>Alert <strong>' + esc(data.case.alertId) + '</strong>, its officer review and its stored evidence are removed from this console. The record on the triage service is not changed.</p><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn danger-solid" id="del-go">Delete</button></div>');
      m.el.querySelector('#del-go').addEventListener('click', function () { UI.api('/api/cases/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { location.href = '/'; }, function (e) { UI.toast(e.message); }); });
    });
    var dl = document.getElementById('dl-audit');
    if (dl) dl.addEventListener('click', function () { UI.downloadJson('audit-' + data.case.alertId + '.json', { alert: data.alert, note: data.case.note, result: data.result, decision: data.review && data.review.decision, evidence: data.evidence && data.evidence.data }); });

    var box = document.getElementById('decide'); if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-act]'), function (b) {
      b.addEventListener('click', function () {
        draft.action = b.getAttribute('data-act');
        document.getElementById('decide').outerHTML = decisionPanel(data.review, (packet().manifest && packet().manifest.case_header) || {});
        wire();
        var t = document.getElementById('d-text'); if (t) t.focus();
      });
    });
    var sel = document.getElementById('d-new'); if (sel) sel.addEventListener('change', function () { draft.newDisposition = sel.value; preview(); });
    var ta = document.getElementById('d-text'); if (ta) ta.addEventListener('input', function () { draft.rationale = ta.value; preview(); });
    preview();
    document.getElementById('d-go').addEventListener('click', function () {
      var err = document.getElementById('d-err'); err.hidden = true;
      if (draft.action === 'OVERRIDE' && !draft.newDisposition) { UI.showError(err, new Error('Choose the new disposition.')); return; }
      if (String(draft.rationale).trim().length < 10) { UI.showError(err, new Error('Write at least 10 characters. It is kept in the audit trail.')); return; }
      busy = true;
      var b = this; b.disabled = true; b.textContent = 'Recording…';
      UI.api('/api/reviews/' + encodeURIComponent(data.review.id) + '/decision', { method: 'POST', body: draft }).then(function () {
        busy = false; draft = { action: '', newDisposition: '', rationale: '' }; UI.toast('Decision recorded'); UI.refreshReviewBadge(); load();
      }, function (e) {
        busy = false; b.disabled = false; b.textContent = 'Record decision'; UI.showError(err, e);
        if (e.status === 409 || e.status === 410) setTimeout(load, 1500);
      });
    });
  }

  function load() {
    UI.api('/api/cases/' + encodeURIComponent(id)).then(function (j) {
      data = j;
      var typing = document.activeElement && (document.activeElement.id === 'd-text' || document.activeElement.id === 'd-new');
      if (!busy && !typing) render();
      clearTimeout(timer);
      if (UI.isOpen(j.case) || (j.case.stage === 'COMPLETED' && !(j.evidence && j.evidence.hasAudit))) timer = setTimeout(load, j.case.stage === 'AWAITING_REVIEW' ? 10000 : 5000);
    }, function (e) {
      document.getElementById('view').innerHTML = '<div class="card empty"><strong>' + (e.status === 404 ? 'Alert not found' : 'Could not load the alert') + '</strong>' + esc(e.message) + '</div>';
    });
  }

  UI.boot({ active: 'cases', title: 'Alert' }, function (user) {
    me = user;
    if (user.role === 'analyst') document.getElementById('crumb-list').textContent = 'My alerts';
    if (!id) { document.getElementById('view').innerHTML = '<div class="card empty"><strong>No alert selected</strong><a href="/">Go to the alert list</a></div>'; return; }
    UI.setSupportContext(function () { return UI.api('/api/cases/' + encodeURIComponent(id) + '/support'); });
    load();
  });
})();
