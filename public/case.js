(function () {
  'use strict';
  var esc = UI.esc;
  var id = new URLSearchParams(location.search).get('id');
  var me = null;
  var data = null;
  var tab = 'summary';
  var timer = null;
  var draft = { action: '', newDisposition: '', rationale: '' };
  var busy = false;

  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function txt(v) { return v == null ? '' : String(v); }
  function para(s) { return s ? '<p>' + esc(s) + '</p>' : '<p class="faint">Not provided.</p>'; }
  var KEY_LABELS = { pep_status: 'PEP status', annual_income_usd: 'Annual income', full_name: 'Full name', txn_ids: 'Transaction IDs', kyc: 'KYC' };
  function humanKey(k) { if (KEY_LABELS[k]) return KEY_LABELS[k]; return String(k).replace(/_usd$/, '').replace(/_/g, ' ').replace(/\b\w/, function (c) { return c.toUpperCase(); }); }

  // Generic, readable rendering of an analyst's structured findings.
  function renderValue(v, depth) {
    depth = depth || 0;
    if (v == null || v === '') return '<span class="faint">—</span>';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v !== 'object') return esc(v);
    if (depth > 2) return '<code>' + esc(JSON.stringify(v)).slice(0, 400) + '</code>';
    if (Array.isArray(v)) {
      if (!v.length) return '<span class="faint">None</span>';
      return '<ul class="clean">' + v.slice(0, 30).map(function (x) {
        if (obj(x)) {
          var keys = Object.keys(x).slice(0, 8);
          return '<li>' + keys.map(function (k) { return '<b>' + esc(humanKey(k)) + ':</b> ' + renderValue(x[k], depth + 2); }).join(' · ') + '</li>';
        }
        return '<li>' + renderValue(x, depth + 1) + '</li>';
      }).join('') + (v.length > 30 ? '<li class="faint">… ' + (v.length - 30) + ' more</li>' : '') + '</ul>';
    }
    return '<dl class="kv">' + Object.keys(v).map(function (k) { return '<dt>' + esc(humanKey(k)) + '</dt><dd>' + renderValue(v[k], depth + 1) + '</dd>'; }).join('') + '</dl>';
  }
  function raw(label, v) {
    if (v == null) return '';
    return '<details class="raw"><summary>' + esc(label) + '</summary><pre>' + esc(typeof v === 'string' ? v : JSON.stringify(v, null, 2)) + '</pre></details>';
  }

  function packet() {
    var ev = data.evidence || {}; var d = ev.data || {};
    var manifest = obj(d.manifest) || (data.review && obj(data.review.manifest)) || null;
    var narrative = obj(d.narrative) || null;
    return { manifest: manifest, narrative: narrative, d: d };
  }

  // ---------- header ----------
  function header() {
    var c = data.case;
    var p = packet();
    var h = (p.manifest && p.manifest.case_header) || {};
    var outcome = c.finalDisposition ? UI.dispPill(c.finalDisposition) : '<span class="faint">Pending</span>';
    var html = '<div class="page-head"><div><h1>Alert ' + esc(c.alertId) + '</h1><div class="sub">' + UI.casePill(c) +
      (c.duplicateOf ? ' <span class="tag">Repeat of an earlier submission' + (data.duplicateOfAlert ? '' : '') + '</span> <a class="small" href="/case.html?id=' + encodeURIComponent(c.duplicateOf) + '">open earlier case</a>' : '') +
      ' <span class="faint small">· submitted ' + UI.fmtDate(c.createdAt) + ' by ' + esc(c.submittedBy) + '</span></div></div><div class="row">' +
      '<button class="btn btn-sm" id="btn-contact-case">' + UI.ICONS.mail + 'Contact Opus</button>' +
      '<button class="btn btn-sm" id="btn-refresh">' + UI.ICONS.refresh + 'Refresh</button>' +
      (me.user.role === 'admin' ? '<button class="btn btn-sm btn-danger" id="btn-del">Delete</button>' : '') + '</div></div>';
    html += '<section class="card" style="margin-bottom:16px"><div class="facts">' +
      '<div><div class="k">Customer</div><div class="v">' + esc(c.customerName || '—') + '</div><div class="faint small">' + esc([c.customerId, c.account].filter(Boolean).join(' · ')) + '</div></div>' +
      '<div><div class="k">Rule · alert score</div><div class="v">' + esc(c.rule || '—') + '</div><div class="faint small">Score ' + esc(c.alertScore != null ? c.alertScore : '—') + (c.priority ? ' · priority ' + esc(c.priority) : '') + '</div></div>' +
      '<div><div class="k">Blended risk score</div><div class="v">' + UI.scoreBadge(c.riskScore != null ? c.riskScore : h.risk_score) + '</div></div>' +
      '<div><div class="k">Recommended → outcome</div><div class="v">' + UI.dispPill(c.recommended || h.recommended_disposition) + ' <span class="faint">→</span> ' + outcome + '</div>' + (c.queue ? '<div class="faint small">' + esc(UI.QUEUES[c.queue] || c.queue) + (c.slaHours ? ' · ' + esc(c.slaHours) + ' h SLA' : '') + '</div>' : '') + '</div>' +
      '</div></section>';
    return html;
  }

  function stages() {
    var ev = data.evidence || {};
    var st = ev.stages || [];
    var html = '<section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Progress</h2><span class="hint">' + progressHint() + '</span></div><div class="stages">' +
      st.map(function (s, i) {
        var cls = s.status === 'DONE' ? 'done' : s.status === 'RUNNING' ? 'running' : s.status === 'WAITING' ? 'waiting' : s.status === 'FAILED' ? 'failed' : s.status === 'STOPPED' ? 'stopped' : '';
        var icon = s.status === 'DONE' ? UI.ICONS.check : s.status === 'WAITING' ? UI.ICONS.pause : (s.status === 'FAILED' || s.status === 'STOPPED') ? UI.ICONS.xmark : String(i + 1);
        return '<div class="stage ' + cls + '"><div class="dot">' + icon + '</div><div><div class="lbl">' + esc(s.label) + '</div><div class="det">' + esc(s.status === 'DONE' && s.ms ? UI.dur(s.ms) : s.status === 'WAITING' ? 'Waiting for officer' : s.detail) + '</div></div></div>';
      }).join('') + '</div>' + (ev.error ? '<div class="card-pad faint small" style="padding-top:0">Step details are not available right now: ' + esc(ev.error) + '</div>' : '') + '</section>';
    return html;
  }

  function progressHint() {
    var c = data.case;
    if (c.stage === 'QUEUED') return 'Starting…';
    if (c.stage === 'RUNNING') return 'Investigation running — this page updates by itself.';
    if (c.stage === 'AWAITING_REVIEW') return 'Paused for the compliance officer.';
    if (c.stage === 'FINALISING') return 'Decision received — routing the case.';
    if (c.stage === 'COMPLETED') return 'Finished ' + UI.fmtDate(c.updatedAt);
    return '';
  }

  // ---------- tabs ----------
  var TABS = [
    { key: 'summary', label: 'Summary' },
    { key: 'findings', label: 'Findings' },
    { key: 'txns', label: 'Customer & transactions' },
    { key: 'alert', label: 'Original alert' },
    { key: 'outcome', label: 'Outcome & audit' }
  ];

  function tabSummary() {
    var p = packet(); var n = p.narrative; var m = p.manifest;
    if (!n && !m) return '<div class="empty"><h3>Narrative not ready yet</h3>The summary appears once the investigation narrative is drafted, usually 2–4 minutes after submission.</div>';
    var secs = (n && obj(n.narrative_sections)) || (m && obj(m.narrative_sections)) || {};
    var drl = (n && obj(n.domain_risk_levels)) || (m && obj(m.risk_dashboard)) || {};
    var disp = (n && obj(n.disposition)) || {};
    var rec = (m && m.disposition_recommendation) || {};
    var follow = disp.follow_up_actions || rec.follow_up_actions || [];
    var html = '<div class="section"><h3>Executive summary</h3>' + para(secs.executive_summary) + '</div>';
    html += '<div class="section"><h3>Risk by domain</h3><div class="grid grid-3">' +
      [['sanctions_pep', 'Sanctions / PEP'], ['adverse_media', 'Adverse media'], ['transaction_typology', 'Transaction typology']].map(function (x) {
        var dd = obj(drl[x[0]]) || {};
        return '<div class="domain"><div class="row"><b>' + x[1] + '</b>' + UI.levelPill(dd.risk_level) + '</div>' +
          (dd.data_available === false ? '<div class="callout warn small" style="margin-top:8px">Data gap — source unavailable; this raises risk.</div>' : '') +
          '<p>' + esc(dd.assessment_summary || 'No summary.') + '</p></div>';
      }).join('') + '</div></div>';
    var recommendation = disp.recommendation || rec.action;
    html += '<div class="section"><h3>Recommended disposition</h3><div class="row" style="margin-bottom:6px">' + UI.dispPill(recommendation, true) + '</div>' + para(disp.rationale || rec.rationale || secs.disposition_recommendation) +
      (follow && follow.length ? '<b class="small">Follow-up actions</b><ul class="clean">' + follow.map(function (f) { return '<li>' + esc(typeof f === 'string' ? f : JSON.stringify(f)) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    if (secs.data_gaps_limitations && !/^(none|n\/a)\.?$/i.test(String(secs.data_gaps_limitations).trim())) html += '<div class="section"><h3>Data gaps & limitations</h3><div class="callout warn">' + esc(secs.data_gaps_limitations) + '</div></div>';
    if (secs.alert_context) html += '<div class="section"><h3>Alert context</h3>' + para(secs.alert_context) + '</div>';
    if (secs.risk_assessment) html += '<div class="section"><h3>Risk assessment</h3>' + para(secs.risk_assessment) + '</div>';
    return html;
  }

  function tabFindings() {
    var p = packet(); var d = p.d;
    var secs = (p.narrative && obj(p.narrative.narrative_sections)) || (p.manifest && obj(p.manifest.narrative_sections)) || {};
    var blocks = [
      ['Sanctions & PEP screening', secs.sanctions_pep_findings, d.sanctionsFindings, d.sanctionsRaw, 'Raw sanctions/PEP lookup'],
      ['Adverse media', secs.adverse_media_findings, d.mediaFindings, d.mediaRaw, 'Raw adverse media results'],
      ['Transaction typology', secs.typology_findings, d.typologyFindings, null, '']
    ];
    var any = blocks.some(function (b) { return b[1] || b[2]; });
    if (!any) return '<div class="empty"><h3>Findings not ready yet</h3>The three specialist analysts report here as soon as they finish.</div>';
    var html = blocks.map(function (b) {
      var f = obj(b[2]) || (typeof b[2] === 'string' ? { analysis: b[2] } : null);
      var structured = '';
      if (f) {
        var keys = Object.keys(f).filter(function (k) { return ['risk_level', 'alert_id', 'customer_id'].indexOf(k) < 0; });
        var picked = {};
        keys.forEach(function (k) { picked[k] = f[k]; });
        structured = '<div style="margin-top:8px">' + renderValue(picked) + '</div>';
      }
      return '<div class="section card card-pad" style="box-shadow:none"><div class="row" style="justify-content:space-between"><h3>' + b[0] + '</h3>' + (f && f.risk_level ? UI.levelPill(f.risk_level) : '') + '</div>' +
        (b[1] ? para(b[1]) : '') + (f ? '<details class="raw"><summary>Analyst detail</summary><div style="padding:12px;border-top:1px solid var(--border)">' + structured + '</div></details>' : '') +
        (b[3] ? raw(b[4], b[3]) : '') + '</div>';
    }).join('');
    var rp = obj(d.riskPackage);
    if (rp && obj(rp.scoring)) {
      var s = rp.scoring;
      html += '<div class="section card card-pad" style="box-shadow:none"><h3>How the score was built</h3><dl class="kv" style="margin-top:8px">' +
        '<dt>Composite (domains)</dt><dd>' + esc(s.composite_score) + '/100</dd>' +
        '<dt>Alert score</dt><dd>' + esc(s.alert_score) + '/100</dd>' +
        '<dt>Blended (70% / 30%)</dt><dd><b>' + esc(s.blended_score) + '/100</b></dd>' +
        (s.data_penalty ? '<dt>Data-gap penalty</dt><dd>+' + esc(s.data_penalty) + '</dd>' : '') +
        '</dl>' + (obj(s.domain_scores) ? renderValue(s.domain_scores) : '') + raw('Full risk package', rp) + '</div>';
    }
    return html;
  }

  function tabTxns() {
    var cd = obj(packet().d.customerData);
    if (!cd) return '<div class="empty"><h3>Customer data not loaded yet</h3>The core-banking lookup fills this in during the evidence stage.</div>';
    var prof = obj(cd.customer_profile) || {};
    var t = obj(cd.transactions) || {};
    var alerted = Array.isArray(t.alerted_txns) ? t.alerted_txns : [];
    var bg = Array.isArray(t.background_txns) ? t.background_txns : [];
    var sum = obj(cd.transaction_summary) || {};
    var profKeys = ['full_name', 'customer_type', 'business_name', 'industry', 'occupation', 'nationality', 'country_of_residence', 'risk_rating', 'pep_status', 'source_of_funds', 'annual_income_usd', 'onboarding_date', 'last_review_date'];
    var html = '<div class="grid grid-2"><div class="section"><h3>KYC profile</h3><dl class="kv" style="margin-top:8px">' +
      profKeys.filter(function (k) { return prof[k] != null && prof[k] !== ''; }).map(function (k) { return '<dt>' + esc(humanKey(k)) + '</dt><dd>' + (k === 'annual_income_usd' ? UI.money(prof[k], 'USD') : k === 'risk_rating' ? UI.levelPill(prof[k]) : esc(prof[k])) + '</dd>'; }).join('') +
      '</dl></div><div class="section"><h3>Activity summary</h3><dl class="kv" style="margin-top:8px">' +
      Object.keys(sum).map(function (k) { return '<dt>' + esc(humanKey(k)) + '</dt><dd>' + (typeof sum[k] === 'number' && /total|amount/.test(k) ? UI.money(sum[k]) : renderValue(sum[k], 2)) + '</dd>'; }).join('') + '</dl></div></div>';
    function txTable(list) {
      return '<div class="table-wrap card" style="box-shadow:none"><table class="data"><thead><tr><th>Txn</th><th>Date</th><th>Type</th><th class="num">Amount</th><th>Counterparty</th><th class="hide-sm">Details</th></tr></thead><tbody>' +
        list.map(function (x) {
          return '<tr><td class="mono nowrap">' + esc(x.txn_id) + '</td><td class="nowrap">' + esc(txt(x.txn_date).slice(0, 10)) + '</td><td class="nowrap"><span class="tag">' + esc(txt(x.txn_type).replace(/_/g, ' ')) + '</span> <span class="faint small">' + esc(x.direction === 'DEBIT' ? 'out' : x.direction === 'CREDIT' ? 'in' : '') + '</span></td><td class="num nowrap">' + UI.money(x.amount, x.currency) + '</td><td>' + esc(x.counterparty_name || '—') + (x.counterparty_country ? '<div class="cell-sub">' + esc(x.counterparty_country) + '</div>' : '') + '</td><td class="hide-sm faint small">' + esc([x.description, x.branch_code].filter(Boolean).join(' · ')) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '<div class="section"><h3>Flagged transactions (' + alerted.length + ')</h3>' + (alerted.length ? txTable(alerted) : '<p class="faint">None matched the flagged IDs.</p>') + '</div>';
    if (bg.length) html += '<details class="raw"><summary>Background history (' + bg.length + (bg.length === 1 ? ' transaction' : ' transactions') + ')</summary><div style="padding:12px;border-top:1px solid var(--border)">' + txTable(bg) + '</div></details>';
    return html;
  }

  function tabAlert() {
    var a = data.alert || {};
    var order = ['alert_id', 'generated_at', 'rule_code', 'score', 'priority', 'subject_account', 'related_accounts', 'flagged_txns', 'system'];
    var rest = Object.keys(a).filter(function (k) { return order.indexOf(k) < 0 && k !== 'narrative'; });
    var html = '<div class="section"><h3>Alert narrative</h3>' + para(a.narrative) + '</div><dl class="kv">' +
      order.concat(rest).filter(function (k) { return a[k] != null && a[k] !== ''; }).map(function (k) { return '<dt>' + esc(humanKey(k)) + '</dt><dd>' + (k === 'flagged_txns' ? '<span class="mono">' + esc(String(a[k]).split(',').join(', ')) + '</span>' : renderValue(a[k], 1)) + '</dd>'; }).join('') + '</dl>';
    var pa = packet().d.parsedAlert;
    if (pa) html += raw('Parsed alert and extracted entities', pa);
    return html;
  }

  function tabOutcome() {
    var r = data.result;
    var rev = data.review;
    var html = '';
    if (!r || !r.final_disposition) {
      html += '<div class="empty"><h3>No final disposition yet</h3>' + (data.case.stage === 'AWAITING_REVIEW' ? 'Waiting for the compliance officer.' : data.case.stage === 'FAILED' || data.case.stage === 'TIMED_OUT' ? 'The case stopped before a disposition was recorded.' : 'The outcome and audit record appear here when the case finishes.') + '</div>';
      if (rev && rev.decision) html += decisionBlock(rev.decision);
      return html;
    }
    var rt = r.routing || {};
    var au = r.audit_trail || {};
    var dr = au.decision_record || {};
    html += '<div><div class="section"><h3>Routing</h3><dl class="kv" style="margin-top:8px">' +
      '<dt>Final disposition</dt><dd>' + UI.dispPill(r.final_disposition) + '</dd>' +
      '<dt>Queue</dt><dd>' + esc(UI.QUEUES[rt.queue] || rt.queue || '—') + '</dd>' +
      '<dt>SLA</dt><dd>' + (rt.sla_hours ? esc(rt.sla_hours) + ' hours' : 'None') + '</dd>' +
      '<dt>Reason</dt><dd>' + esc(rt.reason || '—') + '</dd>' +
      '<dt>Next action</dt><dd>' + esc(rt.next_action || '—') + '</dd></dl></div>' +
      '<div class="section"><h3>Decision record</h3><dl class="kv" style="margin-top:8px">' +
      '<dt>System recommendation</dt><dd>' + UI.dispPill(dr.system_recommendation) + '</dd>' +
      '<dt>Officer action</dt><dd>' + esc(UI.ACTIONS[dr.officer_action] || dr.officer_action || '—') + (dr.disposition_changed ? ' <span class="tag">changed</span>' : '') + '</dd>' +
      '<dt>Officer</dt><dd>' + esc(dr.officer_id || '—') + '</dd>' +
      '<dt>Rationale</dt><dd>' + esc(dr.officer_rationale || '—') + '</dd>' +
      '<dt>Risk at decision</dt><dd>' + esc(dr.risk_score_at_decision != null ? dr.risk_score_at_decision + '/100' : '—') + '</dd></dl></div></div>';
    if (Array.isArray(au.annotations) && au.annotations.length) html += '<div class="section"><h3>Annotations</h3>' + renderValue(au.annotations) + '</div>';
    if (obj(au.override_details) && Object.keys(au.override_details).length) html += '<div class="section"><h3>Override details</h3>' + renderValue(au.override_details) + '</div>';
    html += '<div class="section"><h3>Audit record</h3><dl class="kv" style="margin-top:8px"><dt>Audit ID</dt><dd class="mono">' + esc(au.audit_id || '—') + '</dd><dt>Recorded</dt><dd>' + UI.fmtDate(au.timestamp || r.completion_timestamp) + '</dd><dt>Workflow version</dt><dd>' + esc(au.workflow_version || '—') + '</dd></dl>' +
      '<div class="row" style="margin-top:12px"><button class="btn btn-sm" id="dl-audit">' + UI.ICONS.download + 'Download audit pack (JSON)</button></div></div>';
    return html;
  }

  function decisionBlock(d) {
    return '<div class="callout ok" style="margin-top:12px"><b>' + esc(UI.ACTIONS[d.action] || d.action) + '</b> by ' + esc(d.byName) + ' (' + esc(d.officerId) + ') · ' + UI.fmtDate(d.at) +
      '<div class="small" style="margin-top:4px">Final disposition: ' + UI.dispPill(d.finalDisposition) + '</div><div class="small" style="margin-top:4px">' + esc(d.rationale) + '</div></div>';
  }

  // ---------- right column ----------
  function side() {
    var c = data.case; var rev = data.review;
    var canDecide = me.user.role === 'officer' || me.user.role === 'admin';
    var p = packet(); var h = (p.manifest && p.manifest.case_header) || {};
    if (rev && rev.state === 'PENDING' && canDecide) return decisionPanel(rev, h);
    var html = '<section class="card decide"><div class="card-head"><h2>Officer review</h2></div><div class="card-pad">';
    if (rev && rev.decision) {
      html += decisionBlock(rev.decision).replace('style="margin-top:12px"', '');
      if (c.stage === 'FINALISING') html += '<p class="faint small" style="margin-top:10px"><span class="spin"></span> Routing the case — the outcome appears in a few seconds.</p>';
    } else if (rev && rev.state === 'EXPIRED') {
      html += '<div class="callout err"><b>Review window closed.</b> No decision was recorded in time, so the case timed out. Resubmit the alert to investigate it again.</div>' + (rev.error ? '<p class="small faint" style="margin-top:8px">' + esc(rev.error) + '</p>' : '');
    } else if (rev && rev.state === 'PENDING') {
      html += '<p>Waiting for a compliance officer. <span class="countdown" data-deadline="' + esc(rev.deadline) + '">' + UI.countdown(rev.deadline) + '</span></p>';
    } else if (c.stage === 'AWAITING_REVIEW') {
      html += '<p>The case is paused for the officer review.</p><p class="faint small">If no review packet appears here within a minute, the review step is not yet connected to this console — ask your administrator.</p>';
    } else if (c.stage === 'COMPLETED') {
      html += c.officerAction ? '<p><b>' + esc(UI.ACTIONS[c.officerAction] || c.officerAction) + '</b> by ' + esc(c.officerId || 'officer') + '.</p><p class="faint small">See Outcome & audit for the full record.</p>' : '<p class="faint">Completed.</p>';
    } else if (c.stage === 'FAILED' || c.stage === 'TIMED_OUT' || c.stage === 'CANCELLED') {
      html += '<div class="callout err">The case stopped (' + esc(c.stage.replace('_', ' ').toLowerCase()) + ').' + (c.error ? ' ' + esc(c.error) : '') + '</div>';
    } else {
      html += '<p class="muted">The officer decides once the narrative is ready. Expected in 2–4 minutes from submission.</p>';
    }
    html += '</div></section>';
    return html;
  }

  function decisionPanel(rev, h) {
    var rec = h.recommended_disposition || data.case.recommended || '';
    var others = ['ESCALATE', 'REFER', 'CLOSE'].filter(function (x) { return x !== rec; });
    if (draft.action === 'OVERRIDE' && others.indexOf(draft.newDisposition) < 0) draft.newDisposition = '';
    var html = '<section class="card decide" id="decide"><div class="card-head"><h2>Your decision</h2><span class="countdown" data-deadline="' + esc(rev.deadline) + '">' + UI.countdown(rev.deadline) + '</span></div><div class="card-pad stack" style="gap:12px">' +
      '<div><div class="faint small">Recommended</div><div class="row" style="margin-top:4px">' + UI.dispPill(rec, true) + ' ' + UI.scoreBadge(h.risk_score) + '</div></div>' +
      '<div class="actions" role="radiogroup" aria-label="Decision">' +
      choice('CONFIRM', 'Confirm', 'Accept') + choice('OVERRIDE', 'Override', 'Change') + choice('ANNOTATE', 'Annotate', 'Add notes') + '</div>';
    if (draft.action === 'OVERRIDE') {
      html += '<label class="field">New disposition<select id="d-new"><option value="">Choose…</option>' + others.map(function (o) { return '<option value="' + o + '"' + (draft.newDisposition === o ? ' selected' : '') + '>' + esc(UI.DISP[o].long) + '</option>'; }).join('') + '</select></label>';
    }
    if (draft.action) {
      var lbl = draft.action === 'CONFIRM' ? 'Rationale (one line)' : draft.action === 'OVERRIDE' ? 'Why the recommendation is wrong' : 'Notes for the record';
      html += '<label class="field">' + lbl + '<span class="help">Kept word for word in the audit trail. Plain text.</span><textarea id="d-text" rows="4" maxlength="1500">' + esc(draft.rationale) + '</textarea></label>' +
        '<div><div class="faint small" style="margin-bottom:4px">Recorded as</div><div class="preview" id="d-preview"></div></div>';
    }
    html += '<div class="err-text" id="d-err" role="alert" hidden></div>' +
      '<button class="btn btn-primary" id="d-go"' + (draft.action ? '' : ' disabled') + '>Record decision</button>' +
      '<p class="faint small" style="margin:0">This is a disposition sign-off, not a SAR filing decision.</p></div></section>';
    return html;
  }
  function choice(k, t, s) { return '<button type="button" class="choice' + (draft.action === k ? ' on' : '') + '" role="radio" aria-checked="' + (draft.action === k) + '" data-act="' + k + '"><b>' + t + '</b><span>' + s + '</span></button>'; }

  function preview() {
    var el = UI.$('#d-preview'); if (!el) return;
    var t = String(draft.rationale || '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '') || '…';
    var oid = me.user.officerId || me.user.username.toUpperCase();
    el.textContent = draft.action === 'OVERRIDE' ? 'OVERRIDE to ' + (draft.newDisposition || '…') + ': ' + t + '. Officer: ' + oid : draft.action + ': ' + t + '. Officer: ' + oid;
  }

  function wireDecision() {
    var box = UI.$('#decide'); if (!box) return;
    UI.$all('[data-act]', box).forEach(function (b) { b.onclick = function () { draft.action = b.getAttribute('data-act'); renderSide(); var t = UI.$('#d-text'); if (t) t.focus(); }; });
    var sel = UI.$('#d-new'); if (sel) sel.onchange = function () { draft.newDisposition = sel.value; preview(); };
    var ta = UI.$('#d-text'); if (ta) ta.oninput = function () { draft.rationale = ta.value; preview(); };
    preview();
    UI.$('#d-go').onclick = function () {
      var err = UI.$('#d-err'); err.hidden = true;
      if (draft.action === 'OVERRIDE' && !draft.newDisposition) { err.textContent = 'Choose the new disposition.'; err.hidden = false; return; }
      if (String(draft.rationale).trim().length < 10) { err.textContent = 'Write at least 10 characters — it is kept in the audit trail.'; err.hidden = false; return; }
      busy = true;
      var b = UI.$('#d-go'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Recording';
      UI.api('POST', '/api/reviews/' + encodeURIComponent(data.review.id) + '/decision', draft).then(function () {
        busy = false; UI.toast('Decision recorded'); draft = { action: '', newDisposition: '', rationale: '' }; load();
      }).catch(function (e) {
        busy = false; b.disabled = false; b.textContent = 'Record decision';
        err.textContent = e.message; err.hidden = false;
        if (e.status === 409 || e.status === 410) setTimeout(load, 1500);
      });
    };
  }

  function renderSide() { var s = UI.$('#side-col'); if (s) { s.innerHTML = side(); wireDecision(); } }

  function renderTab() {
    var fn = { summary: tabSummary, findings: tabFindings, txns: tabTxns, alert: tabAlert, outcome: tabOutcome }[tab];
    UI.$('#tab-body').innerHTML = fn();
    UI.$all('.tabs button').forEach(function (b) { var on = b.getAttribute('data-tab') === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    var dl = UI.$('#dl-audit');
    if (dl) dl.onclick = function () { UI.downloadJson('audit-' + data.case.alertId + '.json', { alert: data.alert, result: data.result, decision: data.review && data.review.decision, evidence: data.evidence && data.evidence.data }); };
  }

  function render() {
    var v = UI.$('#view');
    var keepScroll = window.scrollY;
    v.innerHTML = header() + stages() +
      '<div class="grid grid-main"><section class="card"><div class="tabs" role="tablist">' + TABS.map(function (t) { return '<button role="tab" data-tab="' + t.key + '">' + t.label + '</button>'; }).join('') + '</div><div class="tab-body" id="tab-body"></div></section>' +
      '<div id="side-col"></div></div>';
    UI.$all('.tabs button').forEach(function (b) { b.onclick = function () { tab = b.getAttribute('data-tab'); renderTab(); }; });
    renderTab(); renderSide();
    window.scrollTo(0, keepScroll);
    UI.state.caseCtx = { alertId: data.case.alertId, caseId: data.case.id, stage: data.case.stage };
    UI.$('#btn-contact-case').onclick = function () { UI.contactSupport(UI.state.caseCtx); };
    UI.$('#btn-refresh').onclick = function () { UI.api('POST', '/api/cases/' + encodeURIComponent(id) + '/refresh', {}).then(load); };
    var del = UI.$('#btn-del');
    if (del) del.onclick = function () {
      var d = UI.dialog('<div class="dlg-head"><h2>Delete this case?</h2><button class="x" data-close aria-label="Close">×</button></div><div class="dlg-body"><p>Alert <b>' + esc(data.case.alertId) + '</b> and its stored evidence are removed from this console. The record on the triage service is not changed.</p></div><div class="dlg-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="del-go">Delete</button></div>');
      UI.$('#del-go', d).onclick = function () { UI.api('DELETE', '/api/cases/' + encodeURIComponent(id)).then(function () { location.href = '/alerts.html'; }).catch(function (e) { UI.toast(e.message, true); }); };
    };
  }

  function load() {
    UI.api('GET', '/api/cases/' + encodeURIComponent(id)).then(function (j) {
      data = j;
      var typing = document.activeElement && (document.activeElement.id === 'd-text' || document.activeElement.id === 'd-new');
      if (busy || typing) { /* keep the officer's draft in place */ }
      else render();
      clearTimeout(timer);
      if (UI.isOpen(j.case) || (j.case.stage === 'COMPLETED' && !(j.evidence && j.evidence.hasAudit))) timer = setTimeout(load, j.case.stage === 'AWAITING_REVIEW' ? 10000 : 5000);
    }).catch(function (e) {
      UI.$('#view').innerHTML = '<div class="card empty"><h3>' + (e.status === 404 ? 'Case not found' : 'Could not load the case') + '</h3>' + esc(e.message) + '</div>';
    });
  }

  UI.boot('alerts', function (m) {
    me = m;
    if (!id) { UI.$('#view').innerHTML = '<div class="card empty"><h3>No case selected</h3><a href="/alerts.html">Go to alerts</a></div>'; return; }
    load();
  }, { title: 'Alert' });
})();
