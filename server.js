'use strict';
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { db, DATA } = require('./db');

const PORT = process.env.PORT || 3000;
const TZ = process.env.KEY_TZ || 'UTC';
const ROLES = { member: 1, admin: 2 };
const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const MAX_UPLOAD = 8 * 1024 * 1024;

/* ---------- helpers ---------- */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const safeEq = (a, b) => {
  const x = Buffer.from(sha(String(a))), y = Buffer.from(sha(String(b)));
  return crypto.timingSafeEqual(x, y);
};
const likeEsc = (s) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%';
const audit = (actor, action, detail = '', ip = null) =>
  db.prepare('INSERT INTO audit(actor,action,detail,ip) VALUES(?,?,?,?)').run(actor, action, String(detail).slice(0, 500), ip);

/* ---------- daily keys ---------- */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newKey(role) {
  const part = () => Array.from({ length: 4 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');
  return `HYD-${role === 'admin' ? 'ADM' : 'MEM'}-${part()}-${part()}-${part()}`;
}
function keysForToday() {
  const d = today(), out = {};
  for (const role of Object.keys(ROLES)) {
    let row = db.prepare('SELECT key FROM daily_keys WHERE day=? AND role=?').get(d, role);
    if (!row) {
      row = { key: newKey(role) };
      db.prepare('INSERT INTO daily_keys(day,role,key) VALUES(?,?,?)').run(d, role, row.key);
    }
    out[role] = row.key;
  }
  return out;
}
function rotateIfNeeded(log) {
  const d = today();
  db.prepare('DELETE FROM daily_keys WHERE day < ?').run(d);
  db.prepare('DELETE FROM sessions WHERE day < ?').run(d);
  const had = db.prepare('SELECT COUNT(*) c FROM daily_keys WHERE day=?').get(d).c;
  const keys = keysForToday();
  if (log || had === 0) {
    console.log(`\n=== Hydra access keys for ${d} (${TZ}) ===`);
    for (const [r, k] of Object.entries(keys)) console.log(`  ${r.padEnd(7)} ${k}`);
    console.log('==========================================\n');
  }
}

/* ---------- bootstrap admin ---------- */
const bootAdmin = process.env.ADMIN_USERNAME;
if (bootAdmin) {
  if (!NAME_RE.test(bootAdmin)) { console.error('ADMIN_USERNAME must be 3-20 letters, numbers or underscores.'); process.exit(1); }
  if (!db.prepare('SELECT 1 FROM users WHERE username=?').get(bootAdmin)) {
    db.prepare("INSERT INTO users(username,role) VALUES(?, 'admin')").run(bootAdmin);
    audit('system', 'bootstrap_admin', bootAdmin);
  }
}
if (!db.prepare('SELECT 1 FROM users').get()) {
  console.error('No users exist. Set ADMIN_USERNAME=<your roblox username> and start again.');
  process.exit(1);
}
rotateIfNeeded(true);
setInterval(() => rotateIfNeeded(false), 60 * 1000).unref();

/* ---------- login rate limiting ---------- */
const attempts = new Map();
const LIMIT = 8, WINDOW = 10 * 60 * 1000;
function tooMany(k) { const a = attempts.get(k); return a && a.reset > Date.now() && a.count >= LIMIT; }
function noteFail(k) {
  const a = attempts.get(k);
  if (!a || a.reset < Date.now()) attempts.set(k, { count: 1, reset: Date.now() + WINDOW });
  else a.count++;
}
setInterval(() => { for (const [k, a] of attempts) if (a.reset < Date.now()) attempts.delete(k); }, 60000).unref();

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  next();
});
app.use(express.json({ limit: '100kb' }));

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function loadSession(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const s = db.prepare(`SELECT s.id, s.role, s.day, u.id uid, u.username, u.active FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sha(sid));
  if (!s || !s.active || s.day !== today()) return null;
  return { sid: s.id, id: s.uid, username: s.username, role: s.role };
}

// pages
app.get('/dashboard', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!loadSession(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore', index: 'index.html' }));

// CSRF defence: every state-changing API call must carry a custom header
// (cross-site pages cannot add it without a CORS preflight, which we never allow).
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'hydra')
    return res.status(403).json({ error: 'Blocked request.' });
  next();
});

/* ---------- auth routes ---------- */
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const username = clean(req.body.username, 40);
  const key = clean(req.body.key, 60).toUpperCase();
  const k1 = 'ip:' + ip, k2 = 'u:' + username.toLowerCase();
  if (tooMany(k1) || tooMany(k2)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });

  const keys = keysForToday();
  let role = null;
  for (const [r, k] of Object.entries(keys)) if (safeEq(k, key)) role = r;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);

  if (!role || !user || ROLES[user.role] < ROLES[role]) {
    noteFail(k1); noteFail(k2);
    audit(null, 'login_failed', username, ip);
    return res.status(401).json({ error: 'Invalid username or key.' });
  }
  attempts.delete(k1); attempts.delete(k2);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(id,user_id,role,day) VALUES(?,?,?,?)').run(sha(token), user.id, role, today());
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  audit(user.username, 'login', `as ${role}`, ip);
  res.cookie('sid', token, {
    httpOnly: true, sameSite: 'strict', path: '/',
    secure: req.secure || process.env.COOKIE_SECURE === 'true',
  });
  res.json({ user: { username: user.username, role } });
});

app.post('/api/logout', (req, res) => {
  const s = loadSession(req);
  if (s) { db.prepare('DELETE FROM sessions WHERE id = ?').run(s.sid); audit(s.username, 'logout', '', req.ip); }
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const s = loadSession(req);
  if (!s) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ username: s.username, role: s.role, day: today(), tz: TZ });
});

// everything below requires a session
app.use('/api', (req, res, next) => {
  const s = loadSession(req);
  if (!s) return res.status(401).json({ error: 'Not signed in.' });
  req.user = s;
  next();
});
const needAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });
const wrap = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
};
const idOf = (req) => { const n = parseInt(req.params.id, 10); return Number.isInteger(n) ? n : -1; };
const bad = (res, msg) => res.status(400).json({ error: msg });
const BL_ACTIVE = "active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))";

/* ---------- overview & lookup ---------- */
app.get('/api/overview', wrap((req, res) => {
  const c = (sql) => db.prepare(sql).get().c;
  const out = {
    openCases: c("SELECT COUNT(*) c FROM cases WHERE status='open'"),
    totalCases: c('SELECT COUNT(*) c FROM cases'),
    activeWarnings: c('SELECT COUNT(*) c FROM warnings WHERE revoked=0'),
    blacklisted: c(`SELECT COUNT(*) c FROM blacklist WHERE ${BL_ACTIVE}`),
    images: c('SELECT COUNT(*) c FROM images'),
    recentCases: db.prepare('SELECT id,title,subject,severity,status,created_at FROM cases ORDER BY id DESC LIMIT 6').all(),
    recentWarnings: db.prepare('SELECT id,subject,reason,points,revoked,created_at FROM warnings ORDER BY id DESC LIMIT 6').all(),
  };
  if (req.user.role === 'admin') out.users = c('SELECT COUNT(*) c FROM users WHERE active=1');
  res.json(out);
}));

app.get('/api/lookup', wrap((req, res) => {
  const name = clean(req.query.name, 20);
  if (!NAME_RE.test(name)) return bad(res, 'Enter a valid username (3-20 letters, numbers, underscores).');
  res.json({
    name,
    blacklist: db.prepare(`SELECT * FROM blacklist WHERE subject = ? AND ${BL_ACTIVE} ORDER BY id DESC`).all(name),
    warnings: db.prepare('SELECT * FROM warnings WHERE subject = ? ORDER BY id DESC').all(name),
    cases: db.prepare('SELECT id,title,severity,status,created_at FROM cases WHERE subject = ? ORDER BY id DESC').all(name),
  });
}));

/* ---------- cases ---------- */
app.get('/api/cases', wrap((req, res) => {
  const q = clean(req.query.q, 40), st = clean(req.query.status, 10);
  const where = [], args = [];
  if (q) { where.push("(subject LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')"); args.push(likeEsc(q), likeEsc(q)); }
  if (st) { where.push('status = ?'); args.push(st); }
  res.json(db.prepare(`SELECT id,title,subject,severity,status,created_by,created_at FROM cases
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(...args));
}));

app.post('/api/cases', wrap((req, res) => {
  const title = clean(req.body.title, 120), subject = clean(req.body.subject, 20);
  const description = clean(req.body.description, 4000);
  const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : 'low';
  if (!title) return bad(res, 'Title is required.');
  if (!NAME_RE.test(subject)) return bad(res, 'Subject must be a valid username (3-20 letters, numbers, underscores).');
  const r = db.prepare('INSERT INTO cases(title,subject,severity,description,created_by) VALUES(?,?,?,?,?)')
    .run(title, subject, severity, description, req.user.username);
  audit(req.user.username, 'case_create', `#${r.lastInsertRowid} ${subject}`, req.ip);
  res.json({ id: r.lastInsertRowid });
}));

app.get('/api/cases/:id', wrap((req, res) => {
  const id = idOf(req);
  const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  res.json({
    case: c,
    notes: db.prepare('SELECT * FROM case_notes WHERE case_id = ? ORDER BY id').all(id),
    images: db.prepare('SELECT id,caption,original_name,uploaded_by,created_at FROM images WHERE case_id = ? ORDER BY id DESC').all(id),
  });
}));

app.patch('/api/cases/:id', wrap((req, res) => {
  const id = idOf(req);
  const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  const b = req.body;
  const title = b.title !== undefined ? clean(b.title, 120) : c.title;
  const description = b.description !== undefined ? clean(b.description, 4000) : c.description;
  const severity = SEVERITIES.includes(b.severity) ? b.severity : c.severity;
  const status = ['open', 'closed'].includes(b.status) ? b.status : c.status;
  if (!title) return bad(res, 'Title is required.');
  db.prepare("UPDATE cases SET title=?,description=?,severity=?,status=?,updated_at=datetime('now') WHERE id=?")
    .run(title, description, severity, status, id);
  audit(req.user.username, 'case_update', `#${id} status=${status} severity=${severity}`, req.ip);
  res.json({ ok: true });
}));

app.post('/api/cases/:id/notes', wrap((req, res) => {
  const id = idOf(req), body = clean(req.body.body, 2000);
  if (!db.prepare('SELECT 1 FROM cases WHERE id = ?').get(id)) return res.status(404).json({ error: 'Case not found.' });
  if (!body) return bad(res, 'Note cannot be empty.');
  db.prepare('INSERT INTO case_notes(case_id,body,author) VALUES(?,?,?)').run(id, body, req.user.username);
  db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(id);
  audit(req.user.username, 'case_note', `#${id}`, req.ip);
  res.json({ ok: true });
}));

app.delete('/api/cases/:id', needAdmin, wrap((req, res) => {
  const id = idOf(req);
  db.prepare('DELETE FROM cases WHERE id = ?').run(id);
  audit(req.user.username, 'case_delete', `#${id}`, req.ip);
  res.json({ ok: true });
}));

/* ---------- warnings ---------- */
app.get('/api/warnings', wrap((req, res) => {
  const q = clean(req.query.q, 40);
  const rows = q
    ? db.prepare("SELECT * FROM warnings WHERE subject LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 500").all(likeEsc(q))
    : db.prepare('SELECT * FROM warnings ORDER BY id DESC LIMIT 500').all();
  res.json(rows);
}));

app.post('/api/warnings', wrap((req, res) => {
  const subject = clean(req.body.subject, 20), reason = clean(req.body.reason, 1000);
  const points = Math.min(5, Math.max(1, parseInt(req.body.points, 10) || 1));
  if (!NAME_RE.test(subject)) return bad(res, 'Subject must be a valid username.');
  if (!reason) return bad(res, 'Reason is required.');
  const r = db.prepare('INSERT INTO warnings(subject,reason,points,issued_by) VALUES(?,?,?,?)')
    .run(subject, reason, points, req.user.username);
  audit(req.user.username, 'warning_issue', `${subject} (${points}pt)`, req.ip);
  res.json({ id: r.lastInsertRowid });
}));

app.post('/api/warnings/:id/revoke', needAdmin, wrap((req, res) => {
  const id = idOf(req);
  db.prepare('UPDATE warnings SET revoked = 1 WHERE id = ?').run(id);
  audit(req.user.username, 'warning_revoke', `#${id}`, req.ip);
  res.json({ ok: true });
}));

app.delete('/api/warnings/:id', needAdmin, wrap((req, res) => {
  const id = idOf(req);
  db.prepare('DELETE FROM warnings WHERE id = ?').run(id);
  audit(req.user.username, 'warning_delete', `#${id}`, req.ip);
  res.json({ ok: true });
}));

/* ---------- blacklist ---------- */
app.get('/api/blacklist', wrap((req, res) => {
  const q = clean(req.query.q, 40), all = req.query.all === '1';
  const where = [], args = [];
  if (q) { where.push("subject LIKE ? ESCAPE '\\'"); args.push(likeEsc(q)); }
  if (!all) where.push(BL_ACTIVE);
  res.json(db.prepare(`SELECT * FROM blacklist ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(...args));
}));

app.post('/api/blacklist', needAdmin, wrap((req, res) => {
  const subject = clean(req.body.subject, 20), reason = clean(req.body.reason, 1000);
  let expires = clean(req.body.expires, 10) || null;
  if (!NAME_RE.test(subject)) return bad(res, 'Subject must be a valid username.');
  if (!reason) return bad(res, 'Reason is required.');
  if (expires) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return bad(res, 'Expiry must be a date.');
    expires += ' 23:59:59';
  }
  const r = db.prepare('INSERT INTO blacklist(subject,reason,expires_at,issued_by) VALUES(?,?,?,?)')
    .run(subject, reason, expires, req.user.username);
  audit(req.user.username, 'blacklist_add', subject, req.ip);
  res.json({ id: r.lastInsertRowid });
}));

app.post('/api/blacklist/:id/remove', needAdmin, wrap((req, res) => {
  const id = idOf(req);
  db.prepare('UPDATE blacklist SET active = 0 WHERE id = ?').run(id);
  audit(req.user.username, 'blacklist_remove', `#${id}`, req.ip);
  res.json({ ok: true });
}));

/* ---------- images ---------- */
function sniff(buf) {
  if (buf.length > 12) {
    if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return ['image/png', 'png'];
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['image/jpeg', 'jpg'];
    if (buf.toString('ascii', 0, 4) === 'GIF8') return ['image/gif', 'gif'];
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return ['image/webp', 'webp'];
  }
  return null;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD, files: 1 } });

app.get('/api/images', wrap((req, res) => {
  const cid = parseInt(req.query.case_id, 10);
  const rows = Number.isInteger(cid)
    ? db.prepare('SELECT id,caption,original_name,case_id,uploaded_by,created_at FROM images WHERE case_id=? ORDER BY id DESC').all(cid)
    : db.prepare('SELECT id,caption,original_name,case_id,uploaded_by,created_at FROM images ORDER BY id DESC LIMIT 300').all();
  res.json(rows);
}));

app.post('/api/images', (req, res) => {
  upload.single('file')(req, res, (err) => {
    try {
      if (err) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'Image is larger than 8 MB.' : 'Upload failed.');
      if (!req.file) return bad(res, 'Choose an image.');
      const type = sniff(req.file.buffer);
      if (!type) return bad(res, 'Only PNG, JPEG, GIF or WebP images are allowed.');
      let caseId = null;
      if (req.body.case_id) {
        caseId = parseInt(req.body.case_id, 10);
        if (!db.prepare('SELECT 1 FROM cases WHERE id=?').get(caseId)) return bad(res, 'Case not found.');
      }
      const file = crypto.randomBytes(16).toString('hex') + '.' + type[1];
      fs.writeFileSync(path.join(DATA, 'uploads', file), req.file.buffer);
      const r = db.prepare('INSERT INTO images(file,mime,original_name,size,caption,case_id,uploaded_by) VALUES(?,?,?,?,?,?,?)')
        .run(file, type[0], clean(path.basename(req.file.originalname), 120), req.file.size, clean(req.body.caption, 300), caseId, req.user.username);
      audit(req.user.username, 'image_upload', `#${r.lastInsertRowid}`, req.ip);
      res.json({ id: r.lastInsertRowid });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
  });
});

app.get('/api/images/:id/file', wrap((req, res) => {
  const img = db.prepare('SELECT * FROM images WHERE id = ?').get(idOf(req));
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' });
  res.sendFile(path.join(DATA, 'uploads', img.file));
}));

app.delete('/api/images/:id', needAdmin, wrap((req, res) => {
  const img = db.prepare('SELECT * FROM images WHERE id = ?').get(idOf(req));
  if (img) {
    db.prepare('DELETE FROM images WHERE id = ?').run(img.id);
    fs.rm(path.join(DATA, 'uploads', img.file), () => {});
    audit(req.user.username, 'image_delete', `#${img.id}`, req.ip);
  }
  res.json({ ok: true });
}));

/* ---------- admin: users, keys, audit ---------- */
app.get('/api/users', needAdmin, wrap((req, res) =>
  res.json(db.prepare('SELECT id,username,role,active,created_at,last_login FROM users ORDER BY username').all())));

app.post('/api/users', needAdmin, wrap((req, res) => {
  const username = clean(req.body.username, 20), role = req.body.role;
  if (!NAME_RE.test(username)) return bad(res, 'Enter a valid username (3-20 letters, numbers, underscores).');
  if (!ROLES[role]) return bad(res, 'Invalid role.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return bad(res, 'That user already exists.');
  db.prepare('INSERT INTO users(username,role) VALUES(?,?)').run(username, role);
  audit(req.user.username, 'user_add', `${username} as ${role}`, req.ip);
  res.json({ ok: true });
}));

app.patch('/api/users/:id', needAdmin, wrap((req, res) => {
  const id = idOf(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const role = req.body.role !== undefined ? req.body.role : u.role;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : u.active;
  if (!ROLES[role]) return bad(res, 'Invalid role.');
  if (id === req.user.id && (role !== 'admin' || !active)) return bad(res, "You can't demote or disable yourself.");
  db.prepare('UPDATE users SET role=?, active=? WHERE id=?').run(role, active, id);
  if (!active || role !== u.role) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  audit(req.user.username, 'user_update', `${u.username} role=${role} active=${active}`, req.ip);
  res.json({ ok: true });
}));

app.delete('/api/users/:id', needAdmin, wrap((req, res) => {
  const id = idOf(req);
  if (id === req.user.id) return bad(res, "You can't delete yourself.");
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (u) { db.prepare('DELETE FROM users WHERE id = ?').run(id); audit(req.user.username, 'user_delete', u.username, req.ip); }
  res.json({ ok: true });
}));

app.get('/api/keys', needAdmin, wrap((req, res) => res.json({ day: today(), tz: TZ, keys: keysForToday() })));

app.post('/api/keys/regenerate', needAdmin, wrap((req, res) => {
  const role = req.body.role;
  if (!ROLES[role]) return bad(res, 'Invalid role.');
  keysForToday();
  db.prepare('UPDATE daily_keys SET key = ? WHERE day = ? AND role = ?').run(newKey(role), today(), role);
  audit(req.user.username, 'key_regenerate', role, req.ip);
  res.json({ day: today(), tz: TZ, keys: keysForToday() });
}));

app.post('/api/sessions/revoke-all', needAdmin, wrap((req, res) => {
  const r = db.prepare('DELETE FROM sessions WHERE id != ?').run(req.user.sid);
  audit(req.user.username, 'sessions_revoke_all', `${r.changes} sessions`, req.ip);
  res.json({ revoked: r.changes });
}));

app.get('/api/audit', needAdmin, wrap((req, res) =>
  res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all())));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(PORT, () => console.log(`Hydra listening on http://localhost:${PORT}`));
