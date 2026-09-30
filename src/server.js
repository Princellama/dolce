const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { q, one, all, migrate, runPatches } = require('./db');
const { localNow, buildDay, dayInfo, nextDueDay, timeText, addDays, isDue } = require('./schedule');
const email = require('./email');
const { seedIfEmpty, createStarterStay } = require('./seed');
const { buildIcs } = require('./calendar');

const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ADMINS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const token = () => crypto.randomBytes(24).toString('base64url');
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

async function startSession(res, userId) {
  const t = token();
  await q(`INSERT INTO sessions (token,user_id,expires_at) VALUES ($1,$2,now()+interval '180 days')`, [t, userId]);
  res.setHeader('Set-Cookie', `sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

async function loginLink(userId) {
  const existing = await one(`SELECT token FROM login_links WHERE user_id=$1 AND expires_at > now() + interval '7 days' ORDER BY expires_at DESC LIMIT 1`, [userId]);
  if (existing) return existing.token;
  const t = token();
  await q(`INSERT INTO login_links (token,user_id,expires_at) VALUES ($1,$2,now()+interval '30 days')`, [t, userId]);
  return t;
}

async function findOrCreateUser(emailAddr, name = '') {
  const e = cleanEmail(emailAddr);
  let u = await one('SELECT * FROM users WHERE email=$1', [e]);
  if (!u) u = await one('INSERT INTO users (email,name) VALUES ($1,$2) RETURNING *', [e, name || '']);
  else if (name && !u.name) u = await one('UPDATE users SET name=$2 WHERE id=$1 RETURNING *', [u.id, name]);
  return u;
}

// ---------- auth ----------
app.use(async (req, res, next) => {
  const sid = cookies(req).sid;
  if (sid) {
    req.user = await one(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at > now()`, [sid]);
    if (req.user) req.user.admin = ADMINS.includes(req.user.email);
  }
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const needUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in.' }));

// Sign-in link from an email or an invite.
app.get('/l/:token', wrap(async (req, res) => {
  const link = await one(`SELECT * FROM login_links WHERE token=$1 AND expires_at > now()`, [req.params.token]);
  if (!link) return res.redirect('/#/login?expired=1');
  await startSession(res, link.user_id);
  res.redirect('/');
}));

// One-time setup door for the app's admin, before email is set up.
app.get('/setup/:key', wrap(async (req, res) => {
  if (!process.env.SETUP_KEY || req.params.key !== process.env.SETUP_KEY || !ADMINS[0]) return res.status(404).send('Not found');
  const u = await findOrCreateUser(ADMINS[0]);
  await startSession(res, u.id);
  res.redirect('/');
}));

app.post('/api/login', wrap(async (req, res) => {
  const e = cleanEmail(req.body.email);
  if (!validEmail(e)) return res.status(400).json({ error: "That email doesn't look right." });
  const u = await findOrCreateUser(e, String(req.body.name || '').trim());
  const t = await loginLink(u.id);
  await email.loginEmail(u, t);
  res.json({ ok: true, emailReady: email.emailReady() });
}));

app.post('/api/logout', wrap(async (req, res) => {
  const sid = cookies(req).sid;
  if (sid) await q('DELETE FROM sessions WHERE token=$1', [sid]);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
}));

app.get('/api/me', wrap(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const stays = req.user.admin
    ? await all(`SELECT s.id,s.name,s.pet_names,s.start_date,s.end_date,COALESCE(m.role,'owner') AS role FROM stays s LEFT JOIN members m ON m.stay_id=s.id AND m.user_id=$1 ORDER BY s.start_date DESC NULLS LAST, s.id`, [req.user.id])
    : await all(`SELECT s.id,s.name,s.pet_names,s.start_date,s.end_date,m.role FROM stays s JOIN members m ON m.stay_id=s.id WHERE m.user_id=$1 ORDER BY s.start_date DESC NULLS LAST, s.id`, [req.user.id]);
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, admin: req.user.admin }, stays, emailReady: email.emailReady() });
}));

app.put('/api/me', needUser, wrap(async (req, res) => {
  await q('UPDATE users SET name=$2 WHERE id=$1', [req.user.id, String(req.body.name || '').trim()]);
  res.json({ ok: true });
}));

// ---------- public homes + PIN sign-in ----------
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
}
function checkPin(pin, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const a = crypto.scryptSync(String(pin), salt, 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const first = (n) => String(n || '').trim().split(/\s+/)[0];
function publicStay(s) { const { pin_hash, ...rest } = s; return { ...rest, has_pin: !!pin_hash }; }

// Slow down PIN guessing: 6 wrong tries per home per device-address, then a 15-minute wait.
const pinTries = new Map();
function pinLocked(key) {
  const t = pinTries.get(key);
  return t && t.count >= 6 && Date.now() - t.first < 15 * 60 * 1000;
}
function pinFailed(key) {
  const t = pinTries.get(key);
  if (!t || Date.now() - t.first > 15 * 60 * 1000) pinTries.set(key, { count: 1, first: Date.now() });
  else t.count++;
}

app.get('/api/public-stays', wrap(async (req, res) => {
  res.json(await all(`SELECT id, name, pet_names FROM stays WHERE is_public AND pin_hash <> '' ORDER BY name`));
}));

app.post('/api/pin-login', wrap(async (req, res) => {
  const stay = await one(`SELECT * FROM stays WHERE id=$1 AND is_public AND pin_hash <> ''`, [Number(req.body.stay_id)]);
  if (!stay) return res.status(404).json({ error: 'That home is not available.' });
  const key = `${req.ip}|${stay.id}`;
  if (pinLocked(key)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
  if (!checkPin(req.body.pin, stay.pin_hash)) { pinFailed(key); return res.status(403).json({ error: "That PIN didn't work.", wrongPin: true }); }
  pinTries.delete(key);
  // The sitters the owner added (by email). PIN sign-in uses them, so nobody has to type a name.
  const roster = await all(
    `SELECT u.id, u.name FROM members m JOIN users u ON u.id=m.user_id
      WHERE m.stay_id=$1 AND m.role='sitter' AND u.email NOT LIKE '%@pin.invalid' ORDER BY u.name`, [stay.id]);
  const name = String(req.body.name || '').trim().slice(0, 60);
  let u = null;
  if (req.body.user_id) u = roster.find((r) => r.id === Number(req.body.user_id));
  else if (!name && roster.length === 1) u = roster[0];
  if (!u && !name) {
    return res.json({ ok: true, needWho: true, sitters: roster.map((r) => ({ id: r.id, name: first(r.name) || 'Sitter' })) });
  }
  if (!u) {
    // "Someone else": reuse a PIN sitter with the same first name, otherwise add one.
    const pinned = await all(`SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.stay_id=$1 AND m.role='sitter'`, [stay.id]);
    u = pinned.find((m) => first(m.name).toLowerCase() === first(name).toLowerCase());
    if (!u) {
      u = await one('INSERT INTO users (email,name) VALUES ($1,$2) RETURNING *', [`pin-${stay.id}-${crypto.randomBytes(6).toString('hex')}@pin.invalid`, name]);
      await q(`INSERT INTO members (stay_id,user_id,role,morning_email,evening_report) VALUES ($1,$2,'sitter',false,false)`, [stay.id, u.id]);
    }
  }
  await startSession(res, u.id);
  res.json({ ok: true, stay_id: stay.id });
}));

// ---------- stays ----------
async function loadStay(req, res, next) {
  const id = Number(req.params.stayId);
  const stay = await one('SELECT * FROM stays WHERE id=$1', [id]);
  if (!stay) return res.status(404).json({ error: 'Stay not found.' });
  const m = await one('SELECT role FROM members WHERE stay_id=$1 AND user_id=$2', [id, req.user.id]);
  const role = m ? m.role : req.user.admin ? 'owner' : null;
  if (!role) return res.status(403).json({ error: "You're not part of this stay." });
  req.stay = stay;
  req.role = role;
  next();
}
const ownerOnly = (req, res, next) => (req.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can change this.' }));
const S = '/api/stays/:stayId';

app.post('/api/stays', needUser, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim() || 'My home';
  const stay = await createStarterStay(name, req.user.id);
  res.json({ id: stay.id });
}));

app.get(S, needUser, wrap(loadStay), wrap(async (req, res) => {
  const id = req.stay.id;
  const [sections, pets, tasks, guides, steps, contacts, members] = await Promise.all([
    all('SELECT * FROM sections WHERE stay_id=$1 ORDER BY sort,id', [id]),
    all('SELECT * FROM pets WHERE stay_id=$1 ORDER BY sort,id', [id]),
    all(`SELECT * FROM tasks WHERE stay_id=$1 ORDER BY (time_start=''), time_start, sort, id`, [id]),
    all('SELECT * FROM guides WHERE stay_id=$1 ORDER BY sort,id', [id]),
    all('SELECT st.* FROM guide_steps st JOIN guides g ON g.id=st.guide_id WHERE g.stay_id=$1 ORDER BY st.sort,st.id', [id]),
    all('SELECT * FROM contacts WHERE stay_id=$1 ORDER BY emergency DESC, sort, id', [id]),
    all(`SELECT u.id,u.name,u.email,m.role,m.morning_email,m.evening_report,m.phone FROM members m JOIN users u ON u.id=m.user_id WHERE m.stay_id=$1 ORDER BY m.role, u.name`, [id]),
  ]);
  const today = localNow(req.stay.tz).date;
  const info = dayInfo(req.stay, today);
  for (const t of tasks) {
    t.when = timeText(t);
    if (t.every_n > 1) t.next_due = nextDueDay(t, req.stay, info.index == null ? info : { ...info, index: Math.max(0, info.index - 1) });
  }
  for (const g of guides) g.steps = steps.filter((s) => s.guide_id === g.id);
  const isOwner = req.role === 'owner';
  res.json({
    report_to: (await email.reportRecipients(id)).map((u) => first(u.name) || u.email),
    stay: publicStay(req.stay), role: req.role, today, sections, pets, tasks,
    guides: isOwner ? guides : guides.filter((g) => g.steps.length || g.intro),
    contacts,
    // Sitters see names and phones of the people on the stay, not everyone's email settings.
    members: isOwner ? members : members.map(({ id, name, role, phone }) => ({ id, name, role, phone })),
  });
}));

const STAY_FIELDS = ['name', 'pet_names', 'address', 'address_notes', 'tz', 'start_date', 'start_time', 'end_date', 'end_time', 'email_time', 'report_time', 'arrival_title', 'arrival_text', 'welcome'];
app.put(S, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res) => {
  const sets = [], vals = [req.stay.id];
  for (const f of STAY_FIELDS) if (f in req.body) {
    let v = req.body[f];
    if (f.endsWith('_date')) v = v || null;
    else v = String(v ?? '');
    if (f === 'tz') { try { new Intl.DateTimeFormat('en', { timeZone: v }); } catch { return res.status(400).json({ error: 'Unknown time zone.' }); } }
    vals.push(v); sets.push(`${f}=$${vals.length}`);
  }
  if ('is_public' in req.body) { vals.push(!!req.body.is_public); sets.push(`is_public=$${vals.length}`); }
  if (req.body.pin) {
    if (!/^\d{4,8}$/.test(String(req.body.pin))) return res.status(400).json({ error: 'The PIN must be 4 to 8 digits.' });
    vals.push(hashPin(String(req.body.pin))); sets.push(`pin_hash=$${vals.length}`);
  }
  if (sets.length) await q(`UPDATE stays SET ${sets.join(',')} WHERE id=$1`, vals);
  res.json({ ok: true });
}));

app.delete(S, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res) => {
  await q('DELETE FROM stays WHERE id=$1', [req.stay.id]);
  res.json({ ok: true });
}));

// ---------- today ----------
app.get(`${S}/day`, needUser, wrap(loadStay), wrap(async (req, res) => {
  const now = localNow(req.stay.tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : now.date;
  const day = await buildDay(req.stay, date);
  const updates = await all(
    `SELECT up.*, u.name FROM updates up LEFT JOIN users u ON u.id=up.user_id WHERE up.stay_id=$1 AND up.day=$2 ORDER BY up.created_at`, [req.stay.id, date]);
  res.json({ ...day, now, updates });
}));

app.post(`${S}/complete`, needUser, wrap(loadStay), wrap(async (req, res) => {
  const task = await one('SELECT id FROM tasks WHERE id=$1 AND stay_id=$2', [req.body.task_id, req.stay.id]);
  if (!task || !/^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '')) return res.status(400).json({ error: 'Bad request.' });
  if (req.body.done && req.body.date > localNow(req.stay.tz).date) return res.status(400).json({ error: 'You can check this off on the day.' });
  if (req.body.done) await q(`INSERT INTO completions (task_id,day,user_id) VALUES ($1,$2,$3) ON CONFLICT (task_id,day) DO UPDATE SET user_id=$3, done_at=now()`, [task.id, req.body.date, req.user.id]);
  else await q('DELETE FROM completions WHERE task_id=$1 AND day=$2', [task.id, req.body.date]);
  res.json({ ok: true });
}));

app.post(`${S}/arrive`, needUser, wrap(loadStay), wrap(async (req, res) => {
  const now = localNow(req.stay.tz);
  const recent = await one(`SELECT id FROM updates WHERE stay_id=$1 AND user_id=$2 AND kind='arrival' AND created_at > now() - interval '20 minutes'`, [req.stay.id, req.user.id]);
  if (!recent) await q(`INSERT INTO updates (stay_id,user_id,kind,day) VALUES ($1,$2,'arrival',$3)`, [req.stay.id, req.user.id, now.date]);
  res.json({ ok: true });
}));

// ---------- calendar ----------
// Each person gets a private feed link, so calendar apps can fetch it without signing in.
app.post(`${S}/calendar-link`, needUser, wrap(loadStay), wrap(async (req, res) => {
  let row = await one('SELECT token FROM cal_tokens WHERE user_id=$1 AND stay_id=$2', [req.user.id, req.stay.id]);
  if (!row) row = await one('INSERT INTO cal_tokens (token,user_id,stay_id) VALUES ($1,$2,$3) RETURNING token', [token(), req.user.id, req.stay.id]);
  res.json({ url: `${email.APP_URL()}/cal/${row.token}.ics` });
}));
app.get('/cal/:token.ics', wrap(async (req, res) => {
  const row = await one(`SELECT s.* FROM cal_tokens c JOIN stays s ON s.id=c.stay_id
    JOIN members m ON m.stay_id=c.stay_id AND m.user_id=c.user_id WHERE c.token=$1`, [req.params.token]);
  const admin = !row && await one(`SELECT s.* FROM cal_tokens c JOIN stays s ON s.id=c.stay_id JOIN users u ON u.id=c.user_id WHERE c.token=$1 AND lower(u.email) = ANY($2)`, [req.params.token, ADMINS]);
  const stay = row || admin;
  if (!stay) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="dolce-${stay.id}.ics"`);
  res.send(await buildIcs(stay, email.APP_URL()));
}));

// ---------- end-of-day check-out ----------
app.post(`${S}/checkout`, needUser, wrap(loadStay), wrap(async (req, res) => {
  const date = localNow(req.stay.tz).date;
  const note = String(req.body.note || '').trim().slice(0, 4000);
  const photos = (Array.isArray(req.body.photos) ? req.body.photos : []).map(cleanPhoto).filter(Boolean).slice(0, 12);
  const { tasks } = await buildDay(req.stay, date);
  const reasons = {};
  for (const [id, r] of Object.entries(req.body.reasons || {})) {
    const t = tasks.find((x) => x.id === Number(id));
    const txt = String(r || '').trim().slice(0, 500);
    if (t && !t.done && txt) reasons[t.id] = txt;
  }
  const extra = { photos, reasons, done: tasks.filter((t) => t.done).length, total: tasks.length };
  const row = await one(`INSERT INTO updates (stay_id,user_id,kind,text,photo,day,extra) VALUES ($1,$2,'checkout',$3,$4,$5,$6) RETURNING *`,
    [req.stay.id, req.user.id, note, photos[0] || '', date, extra]);
  const sent = await email.sendCheckout(req.stay, date);
  res.json({ ok: true, update: row, sent, emailReady: email.emailReady() });
}));

// ---------- updates (notes + photos for the owner) ----------
app.get(`${S}/updates`, needUser, wrap(loadStay), wrap(async (req, res) => {
  res.json(await all(`SELECT up.*, u.name FROM updates up LEFT JOIN users u ON u.id=up.user_id WHERE up.stay_id=$1 ORDER BY up.created_at DESC LIMIT 300`, [req.stay.id]));
}));
app.post(`${S}/updates`, needUser, wrap(loadStay), wrap(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 4000), photo = cleanPhoto(req.body.photo);
  if (!text && !photo) return res.status(400).json({ error: 'Add a note or a photo.' });
  const now = localNow(req.stay.tz);
  res.json(await one(`INSERT INTO updates (stay_id,user_id,kind,text,photo,day) VALUES ($1,$2,'note',$3,$4,$5) RETURNING *`, [req.stay.id, req.user.id, text, photo, now.date]));
}));
app.delete(`${S}/updates/:id`, needUser, wrap(loadStay), wrap(async (req, res) => {
  const cond = req.role === 'owner' ? '' : ' AND user_id=$3';
  const params = [req.params.id, req.stay.id]; if (cond) params.push(req.user.id);
  await q(`DELETE FROM updates WHERE id=$1 AND stay_id=$2${cond}`, params);
  res.json({ ok: true });
}));

// ---------- owner editing: one small CRUD for every kind of thing ----------
const cleanPhoto = (p) => (typeof p === 'string' && /^\/u\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(p) ? p : '');
const KINDS = {
  sections: { table: 'sections', fields: { kind: 's', title: 's', notes: 's', sort: 'i' } },
  pets: { table: 'pets', fields: { section_id: 'ref', name: 's', location: 's', description: 's', photo: 'p', photos: 'photos', sort: 'i' } },
  tasks: { table: 'tasks', fields: { section_id: 'ref', title: 's', details: 's', warning: 's', time_start: 't', time_end: 't', time_label: 's', every_n: 'i', first_day: 'i', guide_id: 'ref', optional: 'b', photos: 'photos', sort: 'i' } },
  guides: { table: 'guides', fields: { section_id: 'ref', title: 's', intro: 's', sort: 'i' } },
  contacts: { table: 'contacts', fields: { name: 's', role: 's', phone: 's', email: 's', address: 's', notes: 's', emergency: 'b', sort: 'i' } },
};
function cleanVal(type, v) {
  if (type === 'i') return Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0;
  if (type === 'b') return !!v;
  if (type === 'ref') return v ? Number(v) : null;
  if (type === 'p') return cleanPhoto(v);
  if (type === 'photos') return JSON.stringify((Array.isArray(v) ? v : []).map(cleanPhoto).filter(Boolean).slice(0, 12));
  if (type === 't') return /^\d{2}:\d{2}$/.test(v || '') ? v : '';
  return String(v ?? '').slice(0, 8000);
}
async function checkRefs(stayId, body) {
  for (const [f, table] of [['section_id', 'sections'], ['guide_id', 'guides']]) {
    if (body[f]) {
      const ok = await one(`SELECT 1 FROM ${table} WHERE id=$1 AND stay_id=$2`, [body[f], stayId]);
      if (!ok) return false;
    }
  }
  return true;
}
app.post(`${S}/:kind`, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res, next) => {
  const k = KINDS[req.params.kind]; if (!k) return next();
  if (!(await checkRefs(req.stay.id, req.body))) return res.status(400).json({ error: 'Bad reference.' });
  const cols = ['stay_id'], vals = [req.stay.id];
  for (const [f, type] of Object.entries(k.fields)) if (f in req.body) { cols.push(f); vals.push(cleanVal(type, req.body[f])); }
  if (k.table === 'tasks' && !('first_day' in req.body)) { cols.push('first_day'); vals.push(1); }
  res.json(await one(`INSERT INTO ${k.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, vals));
}));
app.put(`${S}/:kind/:id`, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res, next) => {
  const k = KINDS[req.params.kind]; if (!k) return next();
  if (!(await checkRefs(req.stay.id, req.body))) return res.status(400).json({ error: 'Bad reference.' });
  const sets = [], vals = [req.params.id, req.stay.id];
  for (const [f, type] of Object.entries(k.fields)) if (f in req.body) { vals.push(cleanVal(type, req.body[f])); sets.push(`${f}=$${vals.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const row = await one(`UPDATE ${k.table} SET ${sets.join(',')} WHERE id=$1 AND stay_id=$2 RETURNING *`, vals);
  row ? res.json(row) : res.status(404).json({ error: 'Not found.' });
}));
app.delete(`${S}/:kind/:id`, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res, next) => {
  const k = KINDS[req.params.kind]; if (!k) return next();
  await q(`DELETE FROM ${k.table} WHERE id=$1 AND stay_id=$2`, [req.params.id, req.stay.id]);
  res.json({ ok: true });
}));

// Guide steps: replace the whole list at once (simplest for reordering).
app.put(`${S}/guides/:id/steps`, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res) => {
  const g = await one('SELECT id FROM guides WHERE id=$1 AND stay_id=$2', [req.params.id, req.stay.id]);
  if (!g) return res.status(404).json({ error: 'Not found.' });
  const steps = Array.isArray(req.body.steps) ? req.body.steps.slice(0, 60) : [];
  await q('DELETE FROM guide_steps WHERE guide_id=$1', [g.id]);
  let i = 0;
  for (const s of steps) {
    const text = String(s.text || '').slice(0, 4000), photo = cleanPhoto(s.photo);
    if (!text && !photo) continue;
    await q('INSERT INTO guide_steps (guide_id,text,photo,warning,sort) VALUES ($1,$2,$3,$4,$5)', [g.id, text, photo, !!s.warning, i++]);
  }
  await q('UPDATE guides SET suggested=false WHERE id=$1', [g.id]);
  res.json({ ok: true });
}));

// ---------- people on the stay ----------
app.post(`${S}/members`, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res) => {
  const e = cleanEmail(req.body.email);
  if (!validEmail(e)) return res.status(400).json({ error: "That email doesn't look right." });
  const role = req.body.role === 'owner' ? 'owner' : 'sitter';
  const u = await findOrCreateUser(e, String(req.body.name || '').trim());
  await q(`INSERT INTO members (stay_id,user_id,role,morning_email,evening_report,phone) VALUES ($1,$2,$3,true,$4,$5)
           ON CONFLICT (stay_id,user_id) DO UPDATE SET role=$3`, [req.stay.id, u.id, role, role === 'owner', String(req.body.phone || '')]);
  const t = await loginLink(u.id);
  let sent = false;
  if (req.body.send_invite !== false) {
    try { await email.inviteEmail(u, req.stay, role, t, req.user.name || req.user.email); sent = email.emailReady(); } catch (err) { console.error(err); }
  }
  res.json({ ok: true, link: `${email.APP_URL()}/l/${t}`, sent });
}));
app.put(`${S}/members/:uid`, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res) => {
  const b = req.body, sets = [], vals = [req.stay.id, req.params.uid];
  if ('role' in b) { vals.push(b.role === 'owner' ? 'owner' : 'sitter'); sets.push(`role=$${vals.length}`); }
  for (const f of ['morning_email', 'evening_report']) if (f in b) { vals.push(!!b[f]); sets.push(`${f}=$${vals.length}`); }
  if ('phone' in b) { vals.push(String(b.phone || '')); sets.push(`phone=$${vals.length}`); }
  if (sets.length) await q(`UPDATE members SET ${sets.join(',')} WHERE stay_id=$1 AND user_id=$2`, vals);
  if ('name' in b) await q('UPDATE users SET name=$2 WHERE id=$1 AND id IN (SELECT user_id FROM members WHERE stay_id=$3)', [req.params.uid, String(b.name).trim(), req.stay.id]);
  res.json({ ok: true });
}));
app.delete(`${S}/members/:uid`, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res) => {
  await q('DELETE FROM members WHERE stay_id=$1 AND user_id=$2', [req.stay.id, req.params.uid]);
  res.json({ ok: true });
}));
app.post(`${S}/members/:uid/link`, needUser, wrap(loadStay), ownerOnly, wrap(async (req, res) => {
  const m = await one('SELECT 1 FROM members WHERE stay_id=$1 AND user_id=$2', [req.stay.id, req.params.uid]);
  if (!m) return res.status(404).json({ error: 'Not found.' });
  res.json({ link: `${email.APP_URL()}/l/${await loginLink(Number(req.params.uid))}` });
}));
app.post(`${S}/test-email`, needUser, wrap(loadStay), wrap(async (req, res) => {
  if (!email.emailReady()) return res.status(400).json({ error: "Email isn't set up on the server yet." });
  const date = localNow(req.stay.tz).date;
  if (req.body.kind === 'report') await email.eveningReport(req.stay, req.user, date);
  else await email.morningEmail(req.stay, req.user, date, req.role);
  res.json({ ok: true });
}));

// ---------- photos ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.post('/api/upload', needUser, upload.single('photo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo.' });
  const name = crypto.randomBytes(16).toString('hex') + '.jpg';
  try {
    await sharp(req.file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(path.join(UPLOAD_DIR, name));
  } catch { return res.status(400).json({ error: "That file isn't a photo we can read." }); }
  res.json({ url: `/u/${name}` });
}));
// Photo names are long and random, so they can load in emails without signing in.
app.use('/u', express.static(UPLOAD_DIR, { maxAge: '365d', immutable: true, fallthrough: false }));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
});

(async () => {
  await migrate();
  await seedIfEmpty(ADMINS);
  await runPatches();
  email.startScheduler();
  app.listen(PORT, () => console.log(`The Dolce Life on :${PORT}`));
})();
