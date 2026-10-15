(function () {
  'use strict';
  var esc = UI.esc;
  var form = document.getElementById('login-form');
  var btn = document.getElementById('login-btn');
  var errEl = document.getElementById('login-error');

  // A deep link (a case, a review) wins; otherwise each role lands on its own
  // home: an analyst on Overview, an officer on the review queue.
  function destination(home) {
    var n = UI.qs('next');
    var safe = n && n.charAt(0) === '/' && n.charAt(1) !== '/' && n !== '/' && n.indexOf('/login') !== 0;
    return safe ? n : (home || '/');
  }

  UI.api('/api/me', { allow401: true }).then(function (me) { if (me && me.user) location.replace(destination(me.home)); }, function () {});

  function brand(p) {
    document.getElementById('signin-brand').innerHTML = UI.productMark(36) + '<span class="signin-name">' + esc(p.name) + '<small>' + esc(p.unit) + ' · ' + esc(p.company) + '</small></span>';
    document.getElementById('signin-footer').innerHTML = '<span><b>' + esc(p.name) + '</b> · ' + esc(p.unit) + ' · ' + esc(p.company) + '</span>';
    document.title = 'Sign in · ' + p.name;
  }
  brand(UI.PRODUCT);
  UI.api('/api/config', { allow401: true }).then(function (c) { if (c && c.product) brand(c.product); }, function () {});

  var initial = function (name) { return esc(String(name || '?').charAt(0).toUpperCase()); };

  UI.api('/api/demo', { allow401: true }).then(function (d) {
    if (!d || !d.enabled || !d.accounts.length) return;
    document.getElementById('demo').hidden = false;
    // Quick sign-in: accounts are picked from the list, so the email form is
    // hidden. It comes back when DEMO_MODE=false.
    form.hidden = true;
    var wrap = document.getElementById('demo-buttons');
    wrap.innerHTML = d.accounts.map(function (a, i) {
      return '<div class="demo-item">' +
        '<button type="button" class="demo-account" data-i="' + i + '">' +
          '<span class="avatar">' + initial(a.name) + '</span>' +
          '<span class="who"><b>' + esc(a.name) + '</b><span>' + esc(a.email) + '</span></span>' +
          '<span class="pill plain">' + esc(UI.ROLE_LABEL[a.role] || a.role) + '</span></button>' +
        (a.kind === 'user'
          ? '<form class="demo-pass" data-i="' + i + '" hidden novalidate><input type="password" autocomplete="current-password" placeholder="Password for ' + esc(a.name) + '" aria-label="Password"><button class="btn primary small" type="submit">Sign in</button></form>'
          : '') +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(wrap.querySelectorAll('.demo-account'), function (b) {
      b.addEventListener('click', function () {
        var a = d.accounts[Number(b.getAttribute('data-i'))];
        var err = document.getElementById('demo-error');
        err.hidden = true;
        if (a.kind === 'user') {
          // Added users sign in with the password their admin gave them.
          Array.prototype.forEach.call(wrap.querySelectorAll('.demo-pass'), function (f) { f.hidden = f !== b.nextElementSibling ? true : !f.hidden; });
          var f = b.nextElementSibling;
          if (!f.hidden) f.querySelector('input').focus();
          return;
        }
        b.disabled = true;
        UI.api('/api/demo-login', { method: 'POST', body: { role: a.role }, allow401: true })
          .then(function (out) { location.replace(destination(out && out.home)); })
          .catch(function (e) { b.disabled = false; UI.showError(err, e); });
      });
    });

    Array.prototype.forEach.call(wrap.querySelectorAll('.demo-pass'), function (f) {
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var a = d.accounts[Number(f.getAttribute('data-i'))];
        var input = f.querySelector('input');
        var b2 = f.querySelector('button');
        var err = document.getElementById('demo-error');
        err.hidden = true;
        if (!input.value) { input.focus(); return; }
        b2.disabled = true; b2.textContent = 'Signing in…';
        UI.api('/api/login', { method: 'POST', body: { email: a.email, password: input.value }, allow401: true })
          .then(function (out) { location.replace(destination(out && out.home)); })
          .catch(function (e2) { b2.disabled = false; b2.textContent = 'Sign in'; input.value = ''; input.focus(); UI.showError(err, e2); });
      });
    });
  }, function () { /* no quick sign-in */ });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errEl.hidden = true;
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    if (!email || !password) { UI.showError(errEl, new Error('Enter your email and password.')); return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    UI.api('/api/login', { method: 'POST', body: { email: email, password: password }, allow401: true })
      .then(function (out) { location.replace(destination(out && out.home)); })
      .catch(function (err) { UI.showError(errEl, err); btn.disabled = false; btn.textContent = 'Sign in'; });
  });
})();
