(function () {
  'use strict';
  var esc = UI.esc;
  UI.boot({ active: 'settings', title: 'Settings' }, function (user, me) {
    var rows = [['Name', esc(user.name)], ['Email', esc(user.email)], ['Role', esc(user.roleLabel)]];
    if (user.officerId && user.role !== 'analyst') rows.push(['Officer ID', '<span class="mono">' + esc(user.officerId) + '</span><span class="hint" style="display:block;margin-top:2px">Written into the audit trail with each decision.</span>']);
    document.getElementById('account').innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    var demo = user.kind === 'demo';
    document.getElementById('pw-wrap').hidden = demo;
    document.getElementById('pw-demo').hidden = !demo;
    var f = document.getElementById('pw-form');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = document.getElementById('pw-err'); err.hidden = true;
      UI.api('/api/me/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } })
        .then(function () { f.reset(); UI.toast('Password changed'); }, function (x) { UI.showError(err, x); });
    });

    function markTheme() {
      var t = ''; try { t = localStorage.getItem('aml-theme') || ''; } catch (e) { /* ignore */ }
      Array.prototype.forEach.call(document.querySelectorAll('#theme-choice button'), function (b) { b.setAttribute('aria-checked', b.getAttribute('data-theme') === t ? 'true' : 'false'); });
    }
    Array.prototype.forEach.call(document.querySelectorAll('#theme-choice button'), function (b) {
      b.addEventListener('click', function () {
        var t = b.getAttribute('data-theme');
        try { if (t) localStorage.setItem('aml-theme', t); else localStorage.removeItem('aml-theme'); } catch (e) { /* ignore */ }
        if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
        markTheme();
      });
    });
    markTheme();

    var rules = [
      ['Time to decide', me.reviewTimeoutMinutes + ' minutes from when a review packet arrives. After that the case times out and has to be resubmitted.'],
      ['Decisions', 'Confirm the recommendation, override it to Escalate, Refer or Close with a written rationale, or annotate it. The rationale is kept word for word in the audit trail.'],
      ['Own alerts', 'An officer cannot decide on an alert they submitted.'],
      ['Routing', 'Escalate goes to the SAR filing team (24 h SLA), Refer to L2 investigation (72 h), Close to the archive. An invalid decision goes to supervisor review (24 h).'],
      ['Who sees what', 'L1 analysts see the alerts they submitted. Compliance officers and admins see every alert.'],
      ['Sign-in', me.demo ? 'Pick an account on the sign-in page. Added users also enter their password.' : 'Email and password.']
    ];
    document.getElementById('rules').innerHTML = rules.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
  });
})();
