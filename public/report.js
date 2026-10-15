/* Reports: a ribbon of figures that stays put, and chapters that slide in
   beside it. Everyone has this page; what it covers is decided by the server
   (an analyst's own alerts, or every alert for an officer or admin), and the
   scope comes back in the payload so the headings never claim more.

   Three series throughout: closed (blue), referred (slate) and escalated
   (orange), never green against red. Colour is never the only channel:
   every series is named in a legend, bars carry figures, and the time
   chapter has a table behind it. */
(function () {
  'use strict';
  var esc = UI.esc;
  var current = null;
  var chapter = 0;
  var me = null;
  var SERIES = [['CLOSE', 'Closed', 'close'], ['REFER', 'Referred', 'refer'], ['ESCALATE', 'Escalated', 'escalate']];

  var CHAPTERS = [
    { title: 'Headline', blurb: 'The period at a glance', render: headline },
    { title: 'Over time', blurb: 'Dispositions by day or week', render: overTime },
    { title: 'By rule', blurb: 'Which rules raise noise', render: byRule },
    { title: 'Recommendation vs decision', blurb: 'Where officers changed the call', render: matrix },
    { title: 'By analyst', blurb: 'Who submitted what', render: byAnalyst },
    { title: 'By officer', blurb: 'Who decided what', render: byOfficer }
  ];

  function pct(x) { return x == null ? '—' : Math.round(x * 100) + '%'; }
  function legend() { return '<div class="legend">' + SERIES.map(function (s) { return '<span class="legend-item"><span class="swatch sw-' + s[2] + '"></span>' + s[1] + '</span>'; }).join('') + '</div>'; }
  function scopeWord() { return current.scope === 'mine' ? 'your alerts' : 'all alerts'; }
  function eyebrow(label) {
    var p = current.period;
    var span = p.from ? UI.fmtDate(p.from, true) + ' to ' + UI.fmtDate(p.to || new Date().toISOString(), true) : 'All time';
    return '<div><div class="ch-eyebrow">' + esc(span + ' · ' + scopeWord()) + '</div><div class="ch-title">' + esc(label) + '</div></div>';
  }
  function emptyNote(t) { return '<div class="empty">' + esc(t || 'Nothing finished in this period yet.') + '</div>'; }

  // --------------------------------- chapters --------------------------------
  function headline() {
    var t = current.totals;
    var r = t.closedRate == null ? 0 : t.closedRate;
    var C = 2 * Math.PI * 50;
    return '<div class="ch-panel"><div class="ch-head">' + eyebrow('The period at a glance') + '</div>' +
      '<div class="headline"><div class="headline-nums">' +
        '<div class="big big-close">' + t.CLOSE + '</div><div class="big-sub">closed as a false positive</div>' +
        '<div class="big big-escalate">' + t.ESCALATE + '</div><div class="big-sub">escalated to the SAR filing team</div>' +
        '<div class="big big-refer">' + t.REFER + '</div><div class="big-sub">referred to L2 investigation</div>' +
      '</div><figure class="ring-wrap">' +
        '<svg class="ring" viewBox="0 0 120 120" role="img" aria-label="' + pct(t.closedRate) + ' closed as false positive"><circle class="ring-track" cx="60" cy="60" r="50"/>' +
        '<circle class="ring-arc" cx="60" cy="60" r="50" stroke-dasharray="' + (C * r).toFixed(1) + ' ' + C.toFixed(1) + '"/>' +
        '<text class="ring-pct" x="60" y="62" text-anchor="middle">' + pct(t.closedRate) + '</text><text class="ring-cap" x="60" y="78" text-anchor="middle">False positive</text></svg>' +
        '<figcaption class="ring-note">' + (t.finished ? t.CLOSE + ' of ' + UI.plural(t.finished, 'finished alert') + ' needed no further action' : 'No finished alerts yet') + '</figcaption></figure></div>' +
      '<div class="head-facts">' +
        fact('Officer overrides', t.overrides, t.decided ? 'of ' + UI.plural(t.decided, 'decision') : 'no decisions yet') +
        fact('Awaiting an officer', t.awaiting, t.awaiting ? 'waiting now' : 'nothing waiting') +
        fact('Did not finish', UI.plural(t.stopped, 'alert'), t.stopped ? 'failed or timed out' : 'no failures') +
        fact('Average decision time', t.avgDecisionMs != null ? UI.fmtMs(t.avgDecisionMs) : '—', 'from packet to decision') +
      '</div></div>';
  }
  function fact(k, v, s) { return '<div class="fact"><span class="fact-k">' + esc(k) + '</span><span class="fact-v">' + esc(v) + '</span><span class="fact-s">' + esc(s) + '</span></div>'; }

  function overTime() {
    var data = current.overTime;
    var head = '<div class="ch-panel"><div class="ch-head">' + eyebrow('Dispositions ' + (current.byWeek ? 'by week' : 'by day')) + legend() + '</div>';
    if (!data.length) return head + emptyNote() + '</div>';
    var W = 640, H = 240, padL = 34, padB = 26, padT = 14;
    var max = Math.max.apply(null, data.map(function (d) { return d.total; })) || 1;
    var step = Math.max(1, Math.ceil(max / 4));
    var top = step * Math.ceil(max / step);
    var bw = Math.min(42, (W - padL) / data.length * 0.6);
    var gap = (W - padL) / data.length;
    var y = function (v) { return padT + (H - padT - padB) * (1 - v / top); };
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Dispositions over time">';
    for (var g = 0; g <= top; g += step) svg += '<line class="grid-line" x1="' + padL + '" x2="' + W + '" y1="' + y(g) + '" y2="' + y(g) + '"/><text class="axis-text" x="' + (padL - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + g + '</text>';
    data.forEach(function (d, i) {
      var x = padL + gap * i + (gap - bw) / 2;
      var base = 0;
      SERIES.forEach(function (s) {
        var v = d[s[0]]; if (!v) return;
        svg += '<rect class="b-' + s[2] + '" x="' + x.toFixed(1) + '" y="' + y(base + v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(base) - y(base + v)).toFixed(1) + '"><title>' + esc(label(d.start) + ': ' + v + ' ' + s[1].toLowerCase()) + '</title></rect>';
        base += v;
      });
      svg += '<text class="value-text" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y(d.total) - 5).toFixed(1) + '" text-anchor="middle">' + d.total + '</text>';
      if (data.length <= 16 || i % Math.ceil(data.length / 12) === 0) svg += '<text class="axis-text" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(label(d.start)) + '</text>';
    });
    svg += '</svg>';
    return head + svg + '<details class="chart-data"><summary>Show the numbers</summary><div class="table-wrap"><table><thead><tr><th>' + (current.byWeek ? 'Week of' : 'Day') + '</th><th class="num">Closed</th><th class="num">Referred</th><th class="num">Escalated</th><th class="num">Total</th></tr></thead><tbody>' +
      data.map(function (d) { return '<tr><td>' + esc(label(d.start)) + '</td><td class="num">' + d.CLOSE + '</td><td class="num">' + d.REFER + '</td><td class="num">' + d.ESCALATE + '</td><td class="num">' + d.total + '</td></tr>'; }).join('') + '</tbody></table></div></details></div>';
  }
  function label(iso) { var d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }

  function rank(rows, nameFn, subFn, valueFn) {
    if (!rows.length) return emptyNote('No alerts in this period.');
    var max = Math.max.apply(null, rows.map(function (r) { return r.total + (r.open || 0); })) || 1;
    return '<div class="rank">' + rows.map(function (r) {
      var bars = SERIES.map(function (s) { var v = r[s[0]]; return v ? '<span class="rank-bar r-' + s[2] + '" style="width:' + (v / max * 100).toFixed(1) + '%" title="' + esc(v + ' ' + s[1].toLowerCase()) + '"></span>' : ''; }).join('');
      return '<div class="rank-row"><span class="rank-name" title="' + esc(nameFn(r)) + '">' + esc(nameFn(r)) + '</span><span class="rank-track">' + bars + '</span>' +
        '<span class="rank-value">' + esc(valueFn ? valueFn(r) : UI.plural(r.total, 'finished alert')) + '</span><span class="rank-runs">' + esc(subFn(r)) + '</span></div>';
    }).join('') + '</div>';
  }
  function split(r) { return r.CLOSE + ' closed · ' + r.REFER + ' referred · ' + r.ESCALATE + ' escalated' + (r.open ? ' · ' + r.open + ' open' : ''); }
  function fpValue(r) { return r.total + ' finished' + (r.fpRate != null ? ' · ' + pct(r.fpRate) + ' false positive' : ''); }

  function byRule() {
    return '<div class="ch-panel"><div class="ch-head">' + eyebrow('Alerts per monitoring rule') + legend() + '</div>' +
      rank(current.byRule, function (r) { return r.key; }, split, fpValue) +
      '<p class="hint" style="margin-top:16px">A rule that is mostly closed as a false positive is a candidate for threshold tuning in the monitoring system.</p></div>';
  }

  function byAnalyst() {
    return '<div class="ch-panel"><div class="ch-head">' + eyebrow('Alerts submitted per analyst') + legend() + '</div>' + rank(current.byAnalyst, function (r) { return r.key; }, split) + '</div>';
  }

  function matrix() {
    var m = current.matrix;
    var L = { CLOSE: 'Close', REFER: 'Refer', ESCALATE: 'Escalate' };
    var keys = ['CLOSE', 'REFER', 'ESCALATE'];
    var any = keys.some(function (a) { return keys.some(function (b) { return m[a][b]; }); });
    var html = '<div class="ch-panel"><div class="ch-head">' + eyebrow('System recommendation against the final disposition') + '</div>';
    if (!any) return html + emptyNote() + '</div>';
    html += '<div class="table-wrap" style="border:1px solid var(--line);border-radius:var(--radius-sm)"><table class="matrix"><thead><tr><th>Recommended ↓ / Final →</th>' + keys.map(function (k) { return '<th>' + L[k] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      keys.map(function (a) { return '<tr><td><strong>' + L[a] + '</strong></td>' + keys.map(function (b) { var v = m[a][b]; return '<td class="' + (v ? (a === b ? 'diag' : 'off') : '') + '">' + v + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div><p class="hint" style="margin-top:10px">The diagonal is where the officer agreed with the system. Off the diagonal, an officer changed the disposition (' + UI.plural(current.totals.changed, 'alert') + ').</p>' +
      '<h3 style="margin:22px 0 10px">Final disposition by risk band</h3>' + legend() + '<div style="margin-top:12px">' + rank(current.bands.filter(function (b) { return b.total; }), function (r) { return r.key; }, split) + '</div></div>';
    return html;
  }

  function byOfficer() {
    var rows = current.byOfficer;
    var html = '<div class="ch-panel"><div class="ch-head">' + eyebrow('Decisions per compliance officer') + '</div>';
    if (!rows.length) return html + emptyNote('No officer decisions in this period.') + '</div>';
    return html + '<div class="table-wrap" style="border:1px solid var(--line);border-radius:var(--radius-sm)"><table><thead><tr><th>Officer</th><th class="num">Decided</th><th class="num">Confirmed</th><th class="num">Overridden</th><th class="num">Annotated</th><th class="num">Average time to decide</th></tr></thead><tbody>' +
      rows.map(function (o) { return '<tr><td><strong>' + esc(o.key) + '</strong><span class="sub mono">' + esc(o.officerId || '') + '</span></td><td class="num">' + o.decided + '</td><td class="num">' + o.CONFIRM + '</td><td class="num">' + o.OVERRIDE + '</td><td class="num">' + o.ANNOTATE + '</td><td class="num">' + UI.fmtMs(o.avgDecisionMs) + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>';
  }

  // ---------------------------------- frame -----------------------------------
  function renderRibbon() {
    var t = current.totals;
    document.getElementById('k-rate').textContent = pct(t.closedRate);
    document.getElementById('k-rate-sub').textContent = t.finished ? t.CLOSE + ' of ' + UI.plural(t.finished, 'finished alert') : 'none finished';
    document.getElementById('k-esc').textContent = t.ESCALATE;
    document.getElementById('k-esc-sub').textContent = t.supervisor ? t.supervisor + ' via supervisor review' : 'to the SAR filing team';
    document.getElementById('k-ref').textContent = t.REFER;
    document.getElementById('k-ref-sub').textContent = 'to L2 investigation';
    document.getElementById('k-count').textContent = t.alerts;
    document.getElementById('k-count-sub').textContent = t.alerts === t.finished ? (t.alerts ? 'all finished' : 'none in this period') : t.finished + ' finished, ' + (t.alerts - t.finished) + ' not';
    document.getElementById('k-time').textContent = t.avgRunMs != null ? UI.fmtMs(t.avgRunMs) : '—';
    document.getElementById('k-time-sub').textContent = t.timed ? UI.plural(t.timed, 'alert') + ' timed, incl. review' : 'nothing timed yet';
  }
  function renderChapters() {
    document.getElementById('chapter-list').innerHTML = CHAPTERS.map(function (c, i) {
      return '<button type="button" class="chapter' + (i === chapter ? ' is-current' : '') + '" data-i="' + i + '" aria-current="' + (i === chapter) + '"><span class="chapter-num">' + (i + 1) + '</span><span class="chapter-text"><span class="chapter-title">' + esc(c.title) + '</span><span class="chapter-blurb">' + esc(c.blurb) + '</span></span></button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.chapter'), function (b) {
      b.addEventListener('click', function () { chapter = Number(b.getAttribute('data-i')); renderChapters(); });
    });
    document.getElementById('chapter-body').innerHTML = CHAPTERS[chapter].render();
  }

  function query() {
    var p = document.getElementById('filter-preset').value;
    var q = 'preset=' + encodeURIComponent(p);
    if (p === 'custom') q += '&from=' + encodeURIComponent(document.getElementById('filter-from').value) + '&to=' + encodeURIComponent(document.getElementById('filter-to').value);
    return q;
  }
  function load() {
    var q = query();
    document.getElementById('export-link').href = '/api/export.csv?' + q;
    UI.api('/api/report?' + q).then(function (d) {
      current = d;
      document.getElementById('error').hidden = true;
      document.getElementById('report-lede').textContent = d.scope === 'mine'
        ? 'Your alerts: how they were disposed, how often they were false positives, and which rules raised them.'
        : 'Every alert: how it was disposed, how often it was a false positive, which rules raised it, and who submitted and decided what.';
      renderRibbon(); renderChapters();
    }, function (err) { UI.showError(document.getElementById('error'), err); });
  }

  UI.boot({ active: 'report', title: 'Reports' }, function (user) {
    me = user;
    document.getElementById('export-link').hidden = user.role === 'analyst';
    var preset = document.getElementById('filter-preset');
    var today = new Date().toISOString().slice(0, 10);
    document.getElementById('filter-to').value = today;
    document.getElementById('filter-from').value = today.slice(0, 8) + '01';
    preset.addEventListener('change', function () { document.getElementById('custom-wrap').hidden = preset.value !== 'custom'; load(); });
    document.getElementById('filter-from').addEventListener('change', load);
    document.getElementById('filter-to').addEventListener('change', load);
    load();
  });
})();
