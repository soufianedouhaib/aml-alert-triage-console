(function () {
  'use strict';
  var esc = UI.esc;
  var FIELDS = ['alert_id', 'rule_code', 'generated_at', 'subject_account', 'score', 'priority', 'flagged_txns', 'related_accounts', 'narrative', 'system'];
  var mode = 'form';
  var form;

  function newAlertId() {
    var d = new Date();
    return 'ALT-' + d.getFullYear() + '-' + String(Date.now()).slice(-5);
  }

  function fill(alert) {
    FIELDS.forEach(function (k) { if (form[k]) form[k].value = alert[k] == null ? '' : alert[k]; });
    form.json.value = JSON.stringify(alert, null, 2);
  }

  function collect() {
    if (mode === 'json') {
      var raw = form.json.value.trim();
      if (!raw) throw new Error('Paste the alert JSON first.');
      var obj;
      try { obj = JSON.parse(raw); } catch (e) { throw new Error('That is not valid JSON: ' + e.message); }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Paste one JSON object, not a list.');
      return obj;
    }
    var a = {};
    FIELDS.forEach(function (k) {
      var v = form[k].value.trim();
      if (v !== '') a[k] = k === 'score' ? Number(v) : v;
    });
    var miss = ['alert_id', 'rule_code', 'subject_account', 'narrative'].filter(function (k) { return !a[k]; });
    if (miss.length) throw new Error('Fill in: ' + miss.map(function (k) { return k.replace(/_/g, ' '); }).join(', ') + '.');
    if (a.score != null && (isNaN(a.score) || a.score < 0 || a.score > 100)) throw new Error('Alert score must be from 0 to 100.');
    return a;
  }

  function setMode(m) {
    try { if (m === 'json' && mode === 'form') form.json.value = JSON.stringify(collectLoose(), null, 2); } catch (e) {}
    if (m === 'form' && mode === 'json') { try { fill(JSON.parse(form.json.value)); } catch (e) {} }
    mode = m;
    UI.$all('.seg button').forEach(function (b) { var on = b.getAttribute('data-mode') === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    UI.$('#mode-form').hidden = m !== 'form';
    UI.$('#mode-json').hidden = m !== 'json';
  }
  function collectLoose() {
    var a = {};
    FIELDS.forEach(function (k) { var v = form[k].value.trim(); if (v !== '') a[k] = k === 'score' ? Number(v) : v; });
    return a;
  }

  function showErr(html) { var e = UI.$('#err'); e.innerHTML = html; e.hidden = !html; if (html) e.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  function submit(allowDuplicate) {
    showErr('');
    var alert;
    try { alert = collect(); } catch (e) { showErr(esc(e.message)); return; }
    var b = UI.$('#go'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Submitting';
    UI.api('POST', '/api/alerts', { alert: alert, allowDuplicate: !!allowDuplicate })
      .then(function (j) { location.href = '/case.html?id=' + encodeURIComponent(j.case.id) + '&new=1'; })
      .catch(function (e) {
        b.disabled = false; b.textContent = 'Submit for investigation';
        if (e.status === 409 && e.body && e.body.existingId) {
          showErr(esc(e.message) + ' <a href="/case.html?id=' + encodeURIComponent(e.body.existingId) + '">Open the earlier case</a>, change the alert ID, or <a href="#" id="dup-go">submit it again anyway</a> (it will be marked as a repeat).');
          UI.$('#dup-go').onclick = function (ev) { ev.preventDefault(); submit(true); };
        } else showErr(esc(e.message));
      });
  }

  UI.boot('submit', function () {
    form = UI.$('#form');
    UI.$all('.seg button').forEach(function (b) { b.onclick = function () { setMode(b.getAttribute('data-mode')); }; });
    UI.$('#clear').onclick = function () { form.reset(); form.json.value = ''; showErr(''); };
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(false); });
    UI.api('GET', '/api/samples').then(function (j) {
      UI.$('#samples').innerHTML = j.samples.map(function (s, i) {
        return '<div class="card sample"><div class="t">' + esc(s.title) + '</div><div class="c">' + esc(s.customer) + ' · rule ' + esc(s.alert.rule_code) + ' · score ' + esc(s.alert.score) + '</div><div class="e">' + esc(s.expect) + '</div><div><button type="button" class="btn btn-sm" data-i="' + i + '">Use this example</button></div></div>';
      }).join('');
      UI.$all('#samples [data-i]').forEach(function (btn) {
        btn.onclick = function () {
          var a = JSON.parse(JSON.stringify(j.samples[Number(btn.getAttribute('data-i'))].alert));
          a.alert_id = newAlertId();
          fill(a); showErr('');
          UI.toast('Example loaded with a new alert ID');
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
      });
    }).catch(function (e) { UI.$('#samples').innerHTML = '<div class="err-text">' + esc(e.message) + '</div>'; });
  }, { title: 'New alert', roles: ['analyst', 'admin'] });
})();
