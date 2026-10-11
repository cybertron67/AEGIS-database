(function () {
  'use strict';
  var main = document.getElementById('main'), nav = document.getElementById('nav'), dlg = document.getElementById('dlg');
  var me = null;

  /* ---------- helpers ---------- */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    });
    Array.prototype.slice.call(arguments, 2).flat(Infinity).forEach(function (c) {
      if (c == null || c === false) return;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return e;
  }
  function api(path, o) {
    o = o || {};
    var hd = { 'X-Requested-With': 'hydra' }, body;
    if (o.json) { hd['Content-Type'] = 'application/json'; body = JSON.stringify(o.json); }
    else if (o.form) body = o.form;
    return fetch('/api' + path, { method: o.method || 'GET', headers: hd, body: body, credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) { location.href = '/'; return new Promise(function () {}); }
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || 'Request failed.');
          return d;
        });
      });
  }
  var toastT;
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = ''; }, 3200);
  }
  function fail(e) { toast(e.message || 'Something went wrong.', true); }
  function when(d) { if (!d) return '—'; var x = new Date(d.replace(' ', 'T') + 'Z'); return isNaN(x) ? d : x.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
  function pill(text, cls) { return h('span', { class: 'pill ' + (cls || '') }, text); }
  var isAdmin = function () { return me && me.role === 'admin'; };
  function userLink(name) { return h('a', { class: 'lnk', href: '#/lookup/' + encodeURIComponent(name) }, name); }
  function empty(msg) { return h('div', { class: 'empty' }, msg); }
  function table(cols, rows, onRow) {
    if (!rows.length) return null;
    return h('div', { class: 'wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, cols.map(function (c) { return h('th', {}, c); }))),
      h('tbody', {}, rows.map(function (r) {
        var tr = h('tr', { class: onRow ? 'click' : '' }, r.cells.map(function (c) { var w = c !== null && typeof c === 'object' && !c.nodeType && !Array.isArray(c) && 'r' in c; return h('td', { class: w ? 'r' : '' }, w ? c.r : c); }));
        if (onRow) tr.addEventListener('click', function (e) { if (!e.target.closest('button,a')) onRow(r); });
        return tr;
      }))));
  }

  /* ---------- modal ---------- */
  function modal(title, body, actions, wide) {
    dlg.className = wide ? 'wide' : '';
    dlg.replaceChildren(h('h2', {}, title), body, actions ? h('div', { class: 'acts' }, actions) : null);
    if (!dlg.open) dlg.showModal();
    return dlg;
  }
  function closeModal() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeModal(); });
  function field(label, input) {
    var id = 'f' + Math.random().toString(36).slice(2, 8); input.id = id;
    return h('div', { class: 'fld' }, h('label', { for: id }, label), input);
  }
  function form(title, fields, submitLabel, onSubmit) {
    var btn = h('button', { class: 'primary', type: 'button' }, submitLabel);
    btn.addEventListener('click', function () {
      btn.disabled = true;
      Promise.resolve(onSubmit()).then(function () { closeModal(); }).catch(function (e) { fail(e); }).then(function () { btn.disabled = false; });
    });
    modal(title, h('div', {}, fields), [h('button', { type: 'button', onclick: closeModal }, 'Cancel'), btn]);
    var first = dlg.querySelector('input,textarea,select'); if (first) first.focus();
  }
  function confirmBox(msg, label, fn) {
    var b = h('button', { class: 'danger', type: 'button' }, label);
    b.addEventListener('click', function () { b.disabled = true; Promise.resolve(fn()).then(closeModal).catch(fail); });
    modal('Are you sure?', h('p', {}, msg), [h('button', { type: 'button', onclick: closeModal }, 'Cancel'), b]);
  }

  /* ---------- layout / routing ---------- */
  var SECTIONS = [
    ['Workspace', [['overview', 'Overview'], ['lookup', 'Lookup']]],
    ['Records', [['cases', 'Cases'], ['warnings', 'Warnings'], ['blacklist', 'Blacklist'], ['images', 'Images']]],
    ['Admin', [['users', 'Users'], ['keys', 'Daily keys'], ['audit', 'Audit log']]],
  ];
  function drawNav(active) {
    var parts = [
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), 'Hydra'),
      h('div', { class: 'who' }, h('b', {}, me.username), h('span', {}, me.role === 'admin' ? 'Admin' : 'Member')),
      SECTIONS.map(function (s) {
        if (s[0] === 'Admin' && !isAdmin()) return null;
        return [h('div', { class: 'grp' }, s[0]), s[1].map(function (l) {
          return h('a', { href: '#/' + l[0], class: l[0] === active ? 'on' : '' }, l[1]);
        })];
      }),
      h('div', { class: 'sp' }),
      h('div', { class: 'foot' }, 'Session ends with today\u2019s key (' + me.day + ' ' + me.tz + ')'),
      h('button', { onclick: function () { api('/logout', { method: 'POST' }).then(function () { location.href = '/'; }); } }, 'Sign out')
    ];
    nav.replaceChildren.apply(nav, parts.flat(Infinity).filter(Boolean));
  }
  var VIEWS = {};
  function route() {
    var parts = (location.hash || '#/overview').slice(2).split('/');
    var name = parts[0] || 'overview', arg = parts[1] ? decodeURIComponent(parts[1]) : null;
    if (!VIEWS[name] || (['users', 'keys', 'audit'].indexOf(name) >= 0 && !isAdmin())) { location.hash = '#/overview'; return; }
    drawNav(name);
    main.replaceChildren(h('p', { class: 'lead' }, 'Loading…'));
    Promise.resolve(VIEWS[name](arg)).then(function (node) { main.replaceChildren(node); main.scrollTop = 0; }).catch(function (e) {
      main.replaceChildren(h('h1', {}, 'Error'), h('p', { class: 'lead' }, e.message));
    });
  }
  function reload() { route(); }
  function head(title, lead, actions) {
    return h('div', {}, h('div', { class: 'bar' }, h('div', { class: 'grow' }, h('h1', {}, title), lead ? h('p', { class: 'lead', style: 'margin:0' }, lead) : null), actions), h('div', { style: 'height:14px' }));
  }
  var sevPill = function (s) { return pill(s, 'p-' + s); };
  var stPill = function (s) { return pill(s, 'p-' + s); };

  /* ---------- Overview ---------- */
  VIEWS.overview = function () {
    return api('/overview').then(function (d) {
      var stats = [['Open cases', d.openCases], ['Total cases', d.totalCases], ['Active warnings', d.activeWarnings], ['Blacklisted', d.blacklisted], ['Images', d.images]];
      if (d.users != null) stats.push(['Active users', d.users]);
      return h('div', {}, head('Overview', 'Signed in as ' + me.username + ' (' + me.role + ')'),
        h('div', { class: 'cards' }, stats.map(function (s) { return h('div', { class: 'card' }, h('div', { class: 'n' }, s[1]), h('div', { class: 'l' }, s[0])); })),
        h('div', { class: 'cols' },
          h('div', {}, h('h2', {}, 'Recent cases'), table(['Case', 'Subject', 'Status'], d.recentCases.map(function (c) {
            return { id: c.id, cells: [h('span', {}, '#' + c.id + ' ' + c.title), c.subject, stPill(c.status)] };
          }), function (r) { location.hash = '#/cases/' + r.id; }) || empty('No cases yet.')),
          h('div', {}, h('h2', {}, 'Recent warnings'), table(['Subject', 'Reason', 'Pts'], d.recentWarnings.map(function (w) {
            return { cells: [userLink(w.subject), w.reason.slice(0, 60), w.revoked ? pill('revoked', 'p-off') : w.points] };
          })) || empty('No warnings yet.'))));
    });
  };

  /* ---------- Lookup ---------- */
  VIEWS.lookup = function (name) {
    var input = h('input', { placeholder: 'Roblox username', maxlength: 20, value: name || '', 'aria-label': 'Username' });
    var out = h('div', {});
    function run() {
      var n = input.value.trim(); if (!n) return;
      history.replaceState(null, '', '#/lookup/' + encodeURIComponent(n));
      api('/lookup?name=' + encodeURIComponent(n)).then(function (d) {
        var bl = d.blacklist.length;
        out.replaceChildren(
          h('div', { class: 'banner ' + (bl ? 'bad' : 'good') }, bl ? d.name + ' is BLACKLISTED' : d.name + ' is not blacklisted'),
          bl ? table(['Reason', 'By', 'Expires'], d.blacklist.map(function (b) { return { cells: [b.reason, b.issued_by, b.expires_at ? when(b.expires_at) : 'Never'] }; })) : null,
          h('h2', { style: 'margin-top:18px' }, 'Warnings (' + d.warnings.length + ')'),
          table(['Reason', 'Pts', 'By', 'Date', ''], d.warnings.map(function (w) { return { cells: [w.reason, w.points, w.issued_by, when(w.created_at), w.revoked ? pill('revoked', 'p-off') : ''] }; })) || empty('No warnings.'),
          h('h2', { style: 'margin-top:18px' }, 'Cases (' + d.cases.length + ')'),
          table(['Case', 'Severity', 'Status', 'Date'], d.cases.map(function (c) { return { id: c.id, cells: ['#' + c.id + ' ' + c.title, sevPill(c.severity), stPill(c.status), when(c.created_at)] }; }), function (r) { location.hash = '#/cases/' + r.id; }) || empty('No cases.'));
      }).catch(function (e) { out.replaceChildren(empty(e.message)); });
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    var node = h('div', {}, head('Lookup', 'Check any player\u2019s blacklist status, warnings and cases.'),
      h('div', { class: 'bar' }, input, h('button', { class: 'primary', onclick: run }, 'Search')), out);
    if (name) run();
    return node;
  };

  /* ---------- Cases ---------- */
  VIEWS.cases = function (id) {
    if (id) return caseDetail(id);
    var q = h('input', { placeholder: 'Search subject or title', 'aria-label': 'Search' });
    var st = h('select', { 'aria-label': 'Status' }, h('option', { value: '' }, 'All statuses'), h('option', { value: 'open' }, 'Open'), h('option', { value: 'closed' }, 'Closed'));
    var list = h('div', {});
    function load() {
      api('/cases?q=' + encodeURIComponent(q.value) + '&status=' + st.value).then(function (rows) {
        list.replaceChildren(table(['#', 'Title', 'Subject', 'Severity', 'Status', 'By', 'Created'], rows.map(function (c) {
          return { id: c.id, cells: [c.id, c.title, c.subject, sevPill(c.severity), stPill(c.status), c.created_by, when(c.created_at)] };
        }), function (r) { location.hash = '#/cases/' + r.id; }) || empty('No cases found.'));
      }).catch(fail);
    }
    q.addEventListener('input', debounce(load, 250)); st.addEventListener('change', load);
    var node = h('div', {}, head('Cases', 'Investigations and reports.', h('button', { class: 'primary', onclick: newCase }, 'New case')),
      h('div', { class: 'bar' }, q, st), list);
    load(); return node;
  };
  function newCase() {
    var f = { title: h('input', { maxlength: 120 }), subject: h('input', { maxlength: 20, placeholder: 'Roblox username' }),
      severity: h('select', {}, ['low', 'medium', 'high', 'critical'].map(function (s) { return h('option', { value: s }, s); })),
      description: h('textarea', { maxlength: 4000 }) };
    form('New case', [field('Title', f.title), field('Subject (username)', f.subject), field('Severity', f.severity), field('Description', f.description)], 'Create case', function () {
      return api('/cases', { method: 'POST', json: { title: f.title.value, subject: f.subject.value, severity: f.severity.value, description: f.description.value } })
        .then(function (r) { location.hash = '#/cases/' + r.id; });
    });
  }
  function caseDetail(id) {
    return api('/cases/' + id).then(function (d) {
      var c = d.case;
      var sev = h('select', { 'aria-label': 'Severity', onchange: function () { api('/cases/' + id, { method: 'PATCH', json: { severity: sev.value } }).then(function () { toast('Severity updated'); }).catch(fail); } },
        ['low', 'medium', 'high', 'critical'].map(function (s) { return h('option', { value: s, selected: s === c.severity }, s); }));
      var noteIn = h('textarea', { placeholder: 'Add a note…', maxlength: 2000, 'aria-label': 'Note' });
      var fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', 'aria-label': 'Image' });
      var cap = h('input', { placeholder: 'Caption (optional)', maxlength: 300, 'aria-label': 'Caption' });
      return h('div', {}, h('p', { class: 'meta' }, h('a', { class: 'lnk', href: '#/cases' }, '← All cases')),
        head('#' + c.id + ' ' + c.title, null, [
          stPill(c.status), sev,
          h('button', { onclick: function () { api('/cases/' + id, { method: 'PATCH', json: { status: c.status === 'open' ? 'closed' : 'open' } }).then(reload).catch(fail); } }, c.status === 'open' ? 'Close case' : 'Reopen'),
          isAdmin() ? h('button', { class: 'danger', onclick: function () { confirmBox('Delete case #' + id + ' and its notes?', 'Delete', function () { return api('/cases/' + id, { method: 'DELETE' }).then(function () { location.hash = '#/cases'; }); }); } }, 'Delete') : null]),
        h('div', { class: 'panel' }, h('div', { class: 'meta' }, 'Subject: ', userLink(c.subject), ' · opened by ' + c.created_by + ' · ' + when(c.created_at)),
          h('div', { class: 'desc' }, c.description || 'No description.')),
        h('div', { class: 'cols' },
          h('div', { class: 'panel' }, h('h2', {}, 'Notes (' + d.notes.length + ')'),
            d.notes.map(function (n) { return h('div', { class: 'note' }, h('small', {}, n.author + ' · ' + when(n.created_at)), n.body); }),
            noteIn, h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: function () {
              api('/cases/' + id + '/notes', { method: 'POST', json: { body: noteIn.value } }).then(reload).catch(fail); } }, 'Add note'))),
          h('div', { class: 'panel' }, h('h2', {}, 'Evidence (' + d.images.length + ')'),
            d.images.length ? h('div', { class: 'grid' }, d.images.map(thumb)) : h('p', { class: 'meta' }, 'No images attached.'),
            h('div', { style: 'height:12px' }), fileIn, h('div', { style: 'height:6px' }), cap,
            h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: function () {
              uploadImage(fileIn, cap.value, id).then(reload).catch(fail); } }, 'Upload image')))));
    });
  }

  /* ---------- Warnings ---------- */
  VIEWS.warnings = function () {
    var q = h('input', { placeholder: 'Search username', 'aria-label': 'Search' }), list = h('div', {});
    function load() {
      api('/warnings?q=' + encodeURIComponent(q.value)).then(function (rows) {
        list.replaceChildren(table(['Subject', 'Reason', 'Pts', 'Issued by', 'Date', 'Status', ''], rows.map(function (w) {
          return { cells: [userLink(w.subject), w.reason, w.points, w.issued_by, when(w.created_at), w.revoked ? pill('revoked', 'p-off') : pill('active', 'p-open'),
            { r: isAdmin() ? [!w.revoked ? h('button', { class: 'small', onclick: function () { api('/warnings/' + w.id + '/revoke', { method: 'POST' }).then(load).catch(fail); } }, 'Revoke') : null, ' ',
              h('button', { class: 'small danger', onclick: function () { confirmBox('Delete this warning permanently?', 'Delete', function () { return api('/warnings/' + w.id, { method: 'DELETE' }).then(load); }); } }, 'Delete')] : '' }] };
        })) || empty('No warnings found.'));
      }).catch(fail);
    }
    q.addEventListener('input', debounce(load, 250));
    var node = h('div', {}, head('Warnings', 'Formal warnings issued to players.', h('button', { class: 'primary', onclick: function () {
      var f = { subject: h('input', { maxlength: 20, placeholder: 'Roblox username' }), points: h('select', {}, [1, 2, 3, 4, 5].map(function (n) { return h('option', { value: n }, n + (n === 1 ? ' point' : ' points')); })), reason: h('textarea', { maxlength: 1000 }) };
      form('Issue warning', [field('Subject (username)', f.subject), field('Severity', f.points), field('Reason', f.reason)], 'Issue warning', function () {
        return api('/warnings', { method: 'POST', json: { subject: f.subject.value, points: f.points.value, reason: f.reason.value } }).then(load);
      });
    } }, 'Issue warning')), h('div', { class: 'bar' }, q), list);
    load(); return node;
  };

  /* ---------- Blacklist ---------- */
  VIEWS.blacklist = function () {
    var q = h('input', { placeholder: 'Search username', 'aria-label': 'Search' }), all = h('input', { type: 'checkbox', id: 'allbl' }), list = h('div', {});
    function load() {
      api('/blacklist?q=' + encodeURIComponent(q.value) + (all.checked ? '&all=1' : '')).then(function (rows) {
        list.replaceChildren(table(['Subject', 'Reason', 'Issued by', 'Date', 'Expires', 'Status', ''], rows.map(function (b) {
          var live = b.active && (!b.expires_at || new Date(b.expires_at.replace(' ', 'T') + 'Z') > new Date());
          return { cells: [userLink(b.subject), b.reason, b.issued_by, when(b.created_at), b.expires_at ? when(b.expires_at) : 'Never', live ? pill('active', 'p-critical') : pill(b.active ? 'expired' : 'removed', 'p-off'),
            { r: isAdmin() && b.active ? h('button', { class: 'small', onclick: function () { confirmBox('Remove ' + b.subject + ' from the blacklist?', 'Remove', function () { return api('/blacklist/' + b.id + '/remove', { method: 'POST' }).then(load); }); } }, 'Remove') : '' }] };
        })) || empty('Nobody is blacklisted.'));
      }).catch(fail);
    }
    q.addEventListener('input', debounce(load, 250)); all.addEventListener('change', load);
    var add = isAdmin() ? h('button', { class: 'primary', onclick: function () {
      var f = { subject: h('input', { maxlength: 20, placeholder: 'Roblox username' }), reason: h('textarea', { maxlength: 1000 }), expires: h('input', { type: 'date' }) };
      form('Add to blacklist', [field('Subject (username)', f.subject), field('Reason', f.reason), field('Expires (optional)', f.expires)], 'Blacklist', function () {
        return api('/blacklist', { method: 'POST', json: { subject: f.subject.value, reason: f.reason.value, expires: f.expires.value } }).then(load);
      });
    } }, 'Add to blacklist') : null;
    var node = h('div', {}, head('Blacklist', isAdmin() ? 'Players barred from the community.' : 'Players barred from the community. Only admins can change this list.', add),
      h('div', { class: 'bar' }, q, h('label', { for: 'allbl', class: 'meta' }, all, ' Show removed and expired')), list);
    load(); return node;
  };

  /* ---------- Images ---------- */
  function thumb(i) {
    return h('button', { class: 'thumb', type: 'button', onclick: function () { viewImage(i); } },
      h('img', { src: '/api/images/' + i.id + '/file', alt: i.caption || i.original_name, loading: 'lazy' }),
      h('div', {}, i.caption || i.original_name, h('span', {}, i.uploaded_by + ' · ' + when(i.created_at))));
  }
  function viewImage(i) {
    var acts = [h('button', { type: 'button', onclick: closeModal }, 'Close')];
    if (isAdmin()) acts.unshift(h('button', { class: 'danger', type: 'button', onclick: function () { api('/images/' + i.id, { method: 'DELETE' }).then(function () { closeModal(); reload(); }).catch(fail); } }, 'Delete'));
    modal(i.caption || i.original_name, h('div', {}, h('img', { class: 'full', src: '/api/images/' + i.id + '/file', alt: i.caption || i.original_name }),
      h('p', { class: 'meta' }, 'Uploaded by ' + i.uploaded_by + ' · ' + when(i.created_at) + (i.case_id ? ' · case #' + i.case_id : ''))), acts, true);
  }
  function uploadImage(fileInput, caption, caseId) {
    var f = fileInput.files[0];
    if (!f) return Promise.reject(new Error('Choose an image first.'));
    var fd = new FormData(); fd.append('caption', caption || ''); if (caseId) fd.append('case_id', caseId); fd.append('file', f);
    return api('/images', { method: 'POST', form: fd });
  }
  VIEWS.images = function () {
    return api('/images').then(function (rows) {
      return h('div', {}, head('Images', 'Screenshots and evidence. PNG, JPEG, GIF or WebP up to 8 MB.', h('button', { class: 'primary', onclick: function () {
        var fi = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' }), cap = h('input', { maxlength: 300 }), cs = h('input', { type: 'number', min: 1, placeholder: 'Case number (optional)' });
        form('Upload image', [field('Image', fi), field('Caption', cap), field('Attach to case', cs)], 'Upload', function () {
          return uploadImage(fi, cap.value, cs.value).then(reload);
        });
      } }, 'Upload image')), rows.length ? h('div', { class: 'grid' }, rows.map(thumb)) : empty('No images uploaded yet.'));
    });
  };

  /* ---------- Admin: users ---------- */
  VIEWS.users = function () {
    return api('/users').then(function (rows) {
      return h('div', {}, head('Users', 'Only people listed here can sign in, and only with a key for their role or lower.', h('button', { class: 'primary', onclick: function () {
        var f = { username: h('input', { maxlength: 20, placeholder: 'Roblox username' }), role: h('select', {}, h('option', { value: 'member' }, 'Member'), h('option', { value: 'admin' }, 'Admin')) };
        form('Add user', [field('Roblox username', f.username), field('Role', f.role)], 'Add user', function () {
          return api('/users', { method: 'POST', json: { username: f.username.value, role: f.role.value } }).then(reload);
        });
      } }, 'Add user')),
        table(['Username', 'Role', 'Status', 'Last sign-in', ''], rows.map(function (u) {
          var self = u.username.toLowerCase() === me.username.toLowerCase();
          return { cells: [u.username + (self ? ' (you)' : ''), pill(u.role, u.role === 'admin' ? 'p-high' : ''), u.active ? pill('active', 'p-open') : pill('disabled', 'p-off'), u.last_login ? when(u.last_login) : 'Never',
            { r: self ? '' : [
              h('button', { class: 'small', onclick: function () { api('/users/' + u.id, { method: 'PATCH', json: { role: u.role === 'admin' ? 'member' : 'admin' } }).then(reload).catch(fail); } }, u.role === 'admin' ? 'Make member' : 'Make admin'), ' ',
              h('button', { class: 'small', onclick: function () { api('/users/' + u.id, { method: 'PATCH', json: { active: !u.active } }).then(reload).catch(fail); } }, u.active ? 'Disable' : 'Enable'), ' ',
              h('button', { class: 'small danger', onclick: function () { confirmBox('Remove ' + u.username + '? They will no longer be able to sign in.', 'Remove', function () { return api('/users/' + u.id, { method: 'DELETE' }).then(reload); }); } }, 'Remove')] }] };
        })));
    });
  };

  /* ---------- Admin: daily keys ---------- */
  VIEWS.keys = function () {
    return api('/keys').then(function (d) {
      function card(role, label, blurb) {
        var k = h('div', { class: 'key' }, d.keys[role]);
        return h('div', { class: 'panel' }, h('h2', {}, label), h('p', { class: 'meta', style: 'margin:0' }, blurb), k,
          h('div', { class: 'bar' },
            h('button', { onclick: function () { navigator.clipboard.writeText(d.keys[role]).then(function () { toast('Copied'); }, function () { toast('Copy failed', true); }); } }, 'Copy'),
            h('button', { class: 'danger', onclick: function () { confirmBox('Make a new ' + role + ' key now? The current one stops working for new sign-ins.', 'New key', function () { return api('/keys/regenerate', { method: 'POST', json: { role: role } }).then(reload); }); } }, 'Generate new key')));
      }
      return h('div', {}, head('Daily keys', 'Keys for ' + d.day + ' (' + d.tz + '). They change automatically at midnight and everyone is signed out then.'),
        h('div', { class: 'cols' }, card('member', 'Member key', 'Gives member access to listed members and admins.'), card('admin', 'Admin key', 'Gives full access to listed admins only.')),
        h('div', { class: 'panel' }, h('h2', {}, 'Sign everyone out'), h('p', { class: 'meta' }, 'Ends every other active session right now. Use this if a key leaks, after generating a new key.'),
          h('button', { class: 'danger', onclick: function () { confirmBox('Sign out all other users?', 'Sign out everyone', function () { return api('/sessions/revoke-all', { method: 'POST' }).then(function (r) { toast(r.revoked + ' session(s) ended'); }); }); } }, 'Sign everyone else out')));
    });
  };

  /* ---------- Admin: audit ---------- */
  VIEWS.audit = function () {
    return api('/audit').then(function (rows) {
      return h('div', {}, head('Audit log', 'The latest 300 actions.'), table(['When', 'Who', 'Action', 'Detail', 'IP'], rows.map(function (a) {
        return { cells: [when(a.created_at), a.actor || '—', a.action, a.detail, a.ip || ''] };
      })) || empty('Nothing logged yet.'));
    });
  };

  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  /* ---------- boot ---------- */
  window.addEventListener('hashchange', route);
  api('/me').then(function (u) { me = u; route(); });
})();
