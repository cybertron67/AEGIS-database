(function () {
  var f = document.getElementById('f'), note = document.getElementById('note'), go = document.getElementById('go');
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { if (r.ok) location.replace('/dashboard'); });
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    note.hidden = true; go.disabled = true; go.textContent = 'Signing in…';
    fetch('/api/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'hydra' },
      body: JSON.stringify({ username: f.username.value, key: f.key.value })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (x.ok) { location.href = '/dashboard'; return; }
        note.textContent = x.d.error || 'Sign-in failed.'; note.hidden = false;
        go.disabled = false; go.textContent = 'Sign in'; f.key.select();
      })
      .catch(function () { note.textContent = 'Could not reach the server.'; note.hidden = false; go.disabled = false; go.textContent = 'Sign in'; });
  });
})();
