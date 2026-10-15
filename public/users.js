(function () {
  'use strict';
  var esc = UI.esc;
  var me = null;
  var users = [];
  var demo = [];

  function row(u, isDemo) {
    return '<tr><td><strong>' + esc(u.name) + '</strong>' + (u.email === me.email ? ' <span class="muted">(you)</span>' : '') + (isDemo ? '<span class="tag">Demo</span>' : '') + '</td>' +
      '<td>' + esc(u.email) + '</td><td class="nowrap">' + esc(UI.ROLE_LABEL[u.role] || u.role) + '</td><td class="mono">' + esc(u.officerId && u.role !== 'analyst' ? u.officerId : '—') + '</td>' +
      '<td>' + (u.active ? UI.pill('ok', 'Active') : UI.pill('', 'Disabled')) + '</td><td class="nowrap hide-sm">' + (u.createdAt ? UI.fmtDate(u.createdAt) : '<span class="muted">built in</span>') + '</td>' +
      '<td class="num">' + (isDemo ? '' : '<span class="row-actions"><button type="button" class="btn small" data-edit="' + esc(u.email) + '">Edit</button>' + (u.email !== me.email ? ' <button type="button" class="btn small danger" data-del="' + esc(u.email) + '">Delete</button>' : '') + '</span>') + '</td></tr>';
  }

  function render() {
    var all = demo.map(function (u) { return row(u, true); }).concat(users.map(function (u) { return row(u, false); }));
    document.getElementById('list').innerHTML = '<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Officer ID</th><th>Status</th><th class="hide-sm">Added</th><th></th></tr></thead><tbody>' + all.join('') + '</tbody></table>';
    document.getElementById('demo-note').textContent = demo.length ? 'Demo accounts are picked on the sign-in page without a password. Turn them off with DEMO_MODE=false when the console goes live.' : '';
    Array.prototype.forEach.call(document.querySelectorAll('[data-edit]'), function (b) { b.addEventListener('click', function () { edit(users.find(function (u) { return u.email === b.getAttribute('data-edit'); })); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var email = b.getAttribute('data-del');
        var m = UI.modal('<h2>Delete ' + esc(email) + '?</h2><p>They can no longer sign in. Their past decisions stay in the audit trail.</p><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn danger-solid" id="go">Delete</button></div>');
        m.el.querySelector('#go').addEventListener('click', function () { UI.api('/api/users/' + encodeURIComponent(email), { method: 'DELETE' }).then(function () { m.close(); UI.toast('User deleted'); load(); }, function (e) { UI.toast(e.message); }); });
      });
    });
  }

  function edit(u) {
    var isNew = !u; u = u || { role: 'analyst', active: true };
    var m = UI.modal('<form id="uf" class="stack" novalidate><h2 style="margin:0">' + (isNew ? 'Add user' : 'Edit ' + esc(u.name)) + '</h2>' +
      '<label class="field"><span>Full name</span><input type="text" name="name" value="' + esc(u.name || '') + '"></label>' +
      '<label class="field"><span>Email</span><input type="email" name="email" value="' + esc(u.email || '') + '"' + (isNew ? '' : ' disabled') + '></label>' +
      '<label class="field"><span>Role</span><select name="role">' + Object.keys(UI.ROLE_LABEL).map(function (k) { return '<option value="' + k + '"' + (u.role === k ? ' selected' : '') + '>' + UI.ROLE_LABEL[k] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Officer ID</span><input type="text" name="officerId" value="' + esc(u.officerId || '') + '" placeholder="e.g. OFF-2147"><span class="hint">Required for compliance officers. It goes into the audit trail.</span></label>' +
      '<label class="field"><span>' + (isNew ? 'Password' : 'New password') + '</span><input type="password" name="password" autocomplete="new-password"><span class="hint">' + (isNew ? 'At least 10 characters. Give it to the person directly.' : 'Leave empty to keep the current one.') + '</span></label>' +
      '<label class="toolbar" style="font-size:14px"><input type="checkbox" name="active" style="width:auto"' + (u.active !== false ? ' checked' : '') + '> Can sign in</label>' +
      '<div class="alert bad" id="uerr" hidden></div>' +
      '<div class="actions" style="margin-top:0"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">' + (isNew ? 'Add user' : 'Save') + '</button></div></form>');
    var f = m.el.querySelector('#uf');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { name: f.name.value, email: isNew ? f.email.value : u.email, role: f.role.value, officerId: f.officerId.value, active: f.active.checked, isNew: isNew };
      if (f.password.value) body.password = f.password.value;
      UI.api('/api/users', { method: 'POST', body: body }).then(function () { m.close(); UI.toast(isNew ? 'User added' : 'Saved'); load(); }, function (x) { UI.showError(m.el.querySelector('#uerr'), x); });
    });
  }

  function load() { UI.api('/api/users').then(function (j) { users = j.users; demo = j.demo || []; render(); }, function (e) { UI.toast(e.message); }); }

  UI.boot({ active: 'users', title: 'Users', roles: ['admin'] }, function (user) {
    me = user;
    document.getElementById('add').addEventListener('click', function () { edit(null); });
    load();
  });
})();
