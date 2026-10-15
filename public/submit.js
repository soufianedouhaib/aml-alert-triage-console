(function () {
  'use strict';
  var esc = UI.esc;
  var FIELDS = ['alert_id', 'rule_code', 'generated_at', 'subject_account', 'score', 'priority', 'flagged_txns', 'related_accounts', 'narrative', 'system'];
  var mode = 'form';
  var form;
  var samples = [];

  function newAlertId() { return 'ALT-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-5); }

  function fill(alert) {
    FIELDS.forEach(function (k) { if (form[k]) form[k].value = alert[k] == null ? '' : alert[k]; });
    form.json.value = JSON.stringify(alert, null, 2);
  }
  function loose() {
    var a = {};
    FIELDS.forEach(function (k) { var v = String(form[k].value).trim(); if (v !== '') a[k] = k === 'score' ? Number(v) : v; });
    return a;
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
    var a = loose();
    var miss = ['alert_id', 'rule_code', 'subject_account', 'narrative'].filter(function (k) { return !a[k]; });
    if (miss.length) throw new Error('Fill in: ' + miss.map(function (k) { return k.replace(/_/g, ' '); }).join(', ') + '.');
    if (a.score != null && (isNaN(a.score) || a.score < 0 || a.score > 100)) throw new Error('Alert score must be from 0 to 100.');
    return a;
  }
  function setMode(m) {
    if (m === mode) return;
    if (m === 'json') form.json.value = JSON.stringify(loose(), null, 2);
    else { try { fill(JSON.parse(form.json.value)); } catch (e) { /* keep the form */ } }
    mode = m;
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (b) { b.setAttribute('aria-checked', b.getAttribute('data-mode') === m ? 'true' : 'false'); });
    document.getElementById('mode-form').hidden = m !== 'form';
    document.getElementById('mode-json').hidden = m !== 'json';
  }
  function showErr(html) {
    var e = document.getElementById('err');
    e.innerHTML = html; e.hidden = !html;
    if (html) e.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function submit(allowDuplicate) {
    showErr('');
    var alert;
    try { alert = collect(); } catch (e) { showErr(esc(e.message)); return; }
    var b = document.getElementById('go');
    b.disabled = true; b.textContent = 'Starting…';
    UI.api('/api/alerts', { method: 'POST', body: { alert: alert, note: form.note.value, allowDuplicate: !!allowDuplicate } })
      .then(function (j) { location.href = '/case.html?id=' + encodeURIComponent(j.case.id); })
      .catch(function (e) {
        b.disabled = false; b.textContent = 'Run investigation';
        if (e.status === 409) {
          showErr('<strong>' + esc(e.message) + '</strong>' + (e.data && e.data.existingId ? '<a href="/case.html?id=' + encodeURIComponent(e.data.existingId) + '">Open the earlier alert</a>, change' : 'Change') + ' the alert ID, or <button type="button" class="link-btn" id="dup-go" style="border:0;background:none;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer">submit it again anyway</button> (it is marked as a repeat).');
          document.getElementById('dup-go').onclick = function () { submit(true); };
        } else showErr(esc(e.message));
      });
  }

  UI.boot({ active: 'submit', title: 'New alert', roles: ['analyst', 'admin'] }, function () {
    form = document.getElementById('form');
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
    document.getElementById('clear').addEventListener('click', function () {
      form.reset(); form.json.value = ''; showErr('');
      Array.prototype.forEach.call(document.querySelectorAll('.sample'), function (s) { s.classList.remove('active'); });
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(false); });
    UI.api('/api/samples').then(function (j) {
      samples = j.samples;
      document.getElementById('samples').innerHTML = samples.map(function (s, i) {
        return '<button type="button" class="sample" data-i="' + i + '"><span class="sample-title">' + esc(s.title) + '</span><span class="sample-desc">' + UI.prose(s.desc) + '</span>' + UI.pill(s.expectTone || 'info', s.expect) + '</button>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('.sample'), function (btn) {
        btn.addEventListener('click', function () {
          var a = JSON.parse(JSON.stringify(samples[Number(btn.getAttribute('data-i'))].alert));
          a.alert_id = newAlertId();
          fill(a); showErr('');
          Array.prototype.forEach.call(document.querySelectorAll('.sample'), function (s) { s.classList.toggle('active', s === btn); });
          form.note.value = samples[Number(btn.getAttribute('data-i'))].title;
          UI.toast('Example loaded with alert ID ' + a.alert_id);
        });
      });
    }, function (e) { document.getElementById('samples').innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; });
  });
})();
