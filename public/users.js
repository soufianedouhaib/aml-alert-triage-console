(function () {
  'use strict';
  var esc = UI.esc;
  var me = null;
  var users = [];
  var ROLE = { analyst: 'L1 Analyst', officer: 'Compliance Officer', admin: 'Administrator' };

  function render() {
    UI.$('#list').innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Role</th><th>Officer ID</th><th>Status</th><th></th></tr></thead><tbody>' +
      users.map(function (u) {
        return '<tr><td><div class="cell-main">' + esc(u.name) + '</div><div class="cell-sub">' + esc(u.username) + (u.username === me.user.username ? ' · you' : '') + '</div></td><td>' + esc(ROLE[u.role] || u.role) + '</td><td class="mono">' + esc(u.officerId || '—') + '</td><td>' + (u.active ? UI.pill('green', 'Active') : UI.pill('grey', 'Disabled')) + '</td>' +
          '<td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-edit="' + esc(u.username) + '">Edit</button> ' + (u.username !== me.user.username ? '<button class="btn btn-sm btn-danger" data-del="' + esc(u.username) + '">Delete</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    UI.$all('[data-edit]').forEach(function (b) { b.onclick = function () { edit(users.find(function (u) { return u.username === b.getAttribute('data-edit'); })); }; });
    UI.$all('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var name = b.getAttribute('data-del');
        var d = UI.dialog('<div class="dlg-head"><h2>Delete ' + esc(name) + '?</h2><button class="x" data-close aria-label="Close">×</button></div><div class="dlg-body"><p>They can no longer sign in. Their past decisions stay in the audit trail.</p></div><div class="dlg-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="go">Delete</button></div>');
        UI.$('#go', d).onclick = function () { UI.api('DELETE', '/api/users/' + encodeURIComponent(name)).then(function () { d.close(); UI.toast('User deleted'); load(); }).catch(function (e) { UI.toast(e.message, true); }); };
      };
    });
  }

  function edit(u) {
    var isNew = !u; u = u || { role: 'analyst', active: true };
    var d = UI.dialog('<form id="uf"><div class="dlg-head"><h2>' + (isNew ? 'Add user' : 'Edit ' + esc(u.username)) + '</h2><button type="button" class="x" data-close aria-label="Close">×</button></div><div class="dlg-body">' +
      '<label class="field">Username<input name="username" value="' + esc(u.username || '') + '"' + (isNew ? '' : ' disabled') + ' autocomplete="off"></label>' +
      '<label class="field">Full name<input name="name" value="' + esc(u.name || '') + '"></label>' +
      '<label class="field">Role<select name="role">' + Object.keys(ROLE).map(function (k) { return '<option value="' + k + '"' + (u.role === k ? ' selected' : '') + '>' + ROLE[k] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field">Officer ID<span class="help">Required for compliance officers, for example OFF-2147.</span><input name="officerId" value="' + esc(u.officerId || '') + '"></label>' +
      '<label class="field">' + (isNew ? 'Password' : 'New password') + '<span class="help">' + (isNew ? 'At least 8 characters.' : 'Leave empty to keep the current one.') + '</span><input name="password" type="password" autocomplete="new-password"></label>' +
      '<label class="row" style="font-weight:550"><input type="checkbox" name="active" style="width:auto"' + (u.active !== false ? ' checked' : '') + '> Can sign in</label>' +
      '<div class="err-text" id="uerr" hidden></div></div><div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>');
    var f = UI.$('#uf', d);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { username: isNew ? f.username.value : u.username, name: f.name.value, role: f.role.value, officerId: f.officerId.value, active: f.active.checked };
      if (f.password.value) body.password = f.password.value;
      UI.api('POST', '/api/users', body).then(function () { d.close(); UI.toast(isNew ? 'User added' : 'Saved'); load(); })
        .catch(function (x) { var el = UI.$('#uerr', d); el.textContent = x.message; el.hidden = false; });
    });
  }

  function load() { UI.api('GET', '/api/users').then(function (j) { users = j.users; render(); }).catch(function (e) { UI.toast(e.message, true); }); }

  UI.boot('users', function (m) { me = m; UI.$('#add').onclick = function () { edit(null); }; load(); }, { title: 'Users', roles: ['admin'] });
})();
