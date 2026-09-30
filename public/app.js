/* The Dolce Life — a house-sitting companion. Plain JS, no build step. */
(() => {
'use strict';

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const pinUser = (m) => String(m.email || '').endsWith('@pin.invalid');
const first = (name) => String(name || '').split(' ')[0];

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { state.me = null; go('#/login'); throw new Error(data.error || 'Please sign in.'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}
const fail = (e) => toast(e.message || String(e));

function fmtTime(t) {
  if (!t) return '';
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
}
function fmtDate(s, o = { weekday: 'long', month: 'long', day: 'numeric' }) {
  if (!s) return '';
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
}
const shortDate = (s) => fmtDate(s, { weekday: 'short', month: 'short', day: 'numeric' });
function addDays(s, n) { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function localNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
function clock(iso, tz) { return new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }); }
function isoDay(iso, tz) { return localNowAt(iso, tz); }
function localNowAt(iso, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const plusMin = (t, m) => { const [h, mm] = t.split(':').map(Number); const x = h * 60 + mm + m; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const freq = (t) => (t.every_n || 1) <= 1 ? 'Every day' : t.every_n === 7 ? 'Once a week' : `Every ${t.every_n} days`;
const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
const smsHref = (p) => 'sms:' + String(p).replace(/[^\d+]/g, '');
const mapHref = (a) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a);

// ---------- icons ----------
const P = {
  dog: '<path d="M7.3 6.8C5.9 4.9 3.4 5.2 2.8 7.6c-.5 2 .4 4.3 2.3 5.2"/><path d="M16.7 6.8c1.4-1.9 3.9-1.6 4.5.8.5 2-.4 4.3-2.3 5.2"/><path d="M12 5.3c3.4 0 6 2.4 6.3 6.2.3 4.3-2.5 8.8-6.3 8.8s-6.6-4.5-6.3-8.8C6 7.7 8.6 5.3 12 5.3z"/><path d="M9.6 11.3v.2M14.4 11.3v.2"/><path d="M10.6 15.1h2.8L12 16.6z"/><path d="M12 16.6v1.1"/>',
  cat: '<path d="M4.6 3.8l3.3 3.9a8.6 8.6 0 0 1 8.2 0l3.3-3.9.7 7.3c.3.9.4 1.8.4 2.6 0 4-3.7 6.8-8.5 6.8s-8.5-2.8-8.5-6.8c0-.8.1-1.7.4-2.6z"/><path d="M9.3 12.3v.2M14.7 12.3v.2"/><path d="M11 15h2l-1 1.1z"/><path d="M2.5 14.6l4.2.5M2.9 17.5l4-.9M21.5 14.6l-4.2.5M21.1 17.5l-4-.9"/>',
  plant: '<path d="M6.8 13.5h10.4l-1.4 6.6a1.2 1.2 0 0 1-1.2.9H9.4a1.2 1.2 0 0 1-1.2-.9z"/><path d="M12 13.5V8.5"/><path d="M12 9.8C12 6.6 9.4 4.4 5.6 4.4c0 3.4 2.6 5.4 6.4 5.4z"/><path d="M12 11.3c0-3 2.4-4.9 5.9-4.9 0 3.2-2.4 4.9-5.9 4.9z"/>',
  paw: '<path d="M12 21c-3.2 0-5.5-1.8-5.5-4.2 0-2.3 2.4-4.8 5.5-4.8s5.5 2.5 5.5 4.8C17.5 19.2 15.2 21 12 21z"/><ellipse cx="5" cy="10.5" rx="2" ry="2.6"/><ellipse cx="19" cy="10.5" rx="2" ry="2.6"/><ellipse cx="9" cy="5.5" rx="2" ry="2.6"/><ellipse cx="15" cy="5.5" rx="2" ry="2.6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  today: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17M8.5 15l2.2 2.2 4.8-4.7"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  phone: '<path d="M5 3.5h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.6 6.6l1.4-2.3 4.5 1.8V19a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4.5V16h0A1.5 1.5 0 0 1 4 14.5z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  alert: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  camera: '<path d="M4 7.5h3l1.5-2.5h7L17 7.5h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.8"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
  home: '<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
  cross: '<path d="M9 3.5h6v5.5h5.5v6H15v5.5H9V15H3.5V9H9z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3.5-3.5a4 4 0 0 0-5.7-5.7L12 6.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-3.5 3.5a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  out: '<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 16.5L5.5 12 10 7.5M5.5 12H16"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 15-14-0.5 10-6 15-14 15"/><path d="M5 19l7-7"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;
const pawFill = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.5c-3.4 0-5.9-1.9-5.9-4.4 0-2.5 2.6-5.1 5.9-5.1s5.9 2.6 5.9 5.1c0 2.5-2.5 4.4-5.9 4.4z"/><ellipse cx="4.6" cy="10.4" rx="2.3" ry="2.9"/><ellipse cx="19.4" cy="10.4" rx="2.3" ry="2.9"/><ellipse cx="8.8" cy="5" rx="2.3" ry="2.9"/><ellipse cx="15.2" cy="5" rx="2.3" ry="2.9"/></svg>`;
const kindIcon = (k) => ({ dog: 'dog', cat: 'cat', plants: 'plant', house: 'home' })[k] || 'paw';
const kindCls = (k) => 'k-' + (['dog', 'cat', 'plants', 'house'].includes(k) ? k : 'other');
const secChip = (kind, title) => title ? `<span class="chip ${kindCls(kind)}">${icon(kindIcon(kind))}${esc(title)}</span>` : '';

// ---------- state & routing ----------
const state = { me: null, stays: [], emailReady: false, bundle: null, day: null, dayDate: null, open: new Set(), draft: null, updates: null };
const go = (h) => { if (location.hash !== h) location.hash = h; else render(); };
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(qs || '') };
}

async function loadMe() {
  const r = await fetch('/api/me').then((x) => x.json());
  state.me = r.user; state.stays = r.stays || []; state.emailReady = !!r.emailReady;
}
async function loadBundle(id, force) {
  if (!force && state.bundle && state.bundle.stay.id === id) return state.bundle;
  state.bundle = await api('GET', `/api/stays/${id}`);
  return state.bundle;
}
async function loadDay(id, date) {
  state.day = await api('GET', `/api/stays/${id}/day${date ? `?date=${date}` : ''}`);
  state.dayDate = state.day.info.date;
  return state.day;
}
const isOwner = () => state.bundle && state.bundle.role === 'owner';
const B = () => state.bundle;
const stayUrl = (p = 'today') => `#/s/${B().stay.id}/${p}`;

// ---------- theme ----------
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch (e) {}
  document.querySelectorAll('[data-theme-icon]').forEach((el) => { el.innerHTML = icon(next === 'dark' ? 'sun' : 'moon'); });
}
const themeIcon = () => `<span data-theme-icon>${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</span>`;

// ---------- shell ----------
const NAV = [['today', 'Today', 'today'], ['care', 'Care', 'heart'], ['guides', 'Guides', 'book'], ['contacts', 'Contacts', 'phone'], ['updates', 'Updates', 'chat']];

function shell(active, html, opts = {}) {
  const s = B().stay;
  const nav = NAV.map(([k, label, ic]) => `<a href="${stayUrl(k)}" class="${active === k ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`).join('');
  const brand = `<a class="brand" href="${stayUrl()}"><span class="mark">${pawFill}</span><span class="words"><span class="name">The Dolce Life</span><span class="stayname">${esc(s.name)}</span></span></a>`;
  const multi = state.stays.length > 1 || (state.me && state.me.admin);
  return `<div class="shell">
    <aside class="side">${brand}<nav>${nav}<a href="${stayUrl('settings')}" class="${active === 'settings' ? 'on' : ''}">${icon('gear')}<span>Settings</span></a></nav>
      <div class="foot">
        ${multi ? `<a href="#/">${icon('grid')}<span>All stays</span></a>` : ''}
        <button data-act="theme">${themeIcon()}<span>Light / dark</span></button>
      </div>
    </aside>
    <div class="col">
      <header class="topbar">${brand}<span class="spacer"></span>
        <button class="sos" data-act="emergency" aria-label="Emergency contacts">${icon('cross')}<span>Emergency</span></button>
        <button class="iconbtn" data-act="theme" aria-label="Switch light or dark mode">${themeIcon()}</button>
        <a class="iconbtn settings-link" href="${stayUrl('settings')}" aria-label="Settings">${icon('gear')}</a>
      </header>
      <main class="content">${html}</main>
    </div>
    <nav class="tabbar">${nav}</nav>
  </div>`;
}

function mount(html) {
  $('#app').innerHTML = html;
  window.scrollTo({ top: 0 });
}

// ---------- views ----------
async function render() {
  const { parts, query } = route();
  closeSheet();
  try {
    if (state.me === null) await loadMe();
    if (!state.me) return viewLogin(query);
    if (parts[0] === 'login') return go('#/');
    if (parts[0] !== 's') return viewStays();
    const id = Number(parts[1]);
    await loadBundle(id);
    const page = parts[2] || 'today';
    document.title = `${B().stay.name} · The Dolce Life`;
    if (page === 'today') return viewToday(query);
    if (page === 'care') return viewCare(Number(parts[3]) || null);
    if (page === 'guides') return viewGuides(query);
    if (page === 'guide') return parts[4] === 'edit' ? viewGuideEdit(Number(parts[3])) : viewGuide(Number(parts[3]));
    if (page === 'contacts') return viewContacts();
    if (page === 'updates') return viewUpdates();
    if (page === 'settings') return viewSettings();
    return go(stayUrl());
  } catch (e) {
    if (state.me) mount(`<div class="login"><div class="box card pad"><h2>Hmm.</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back</a></div></div>`);
  }
}

// ----- login -----
function viewLogin(query) {
  document.title = 'The Dolce Life';
  mount(`<div class="login"><div class="box">
    <div class="logo"><span class="mark">${pawFill}</span></div>
    <h1>The Dolce Life</h1>
    <p class="tag">Your house-sitting companion. Everything the pets, plants and house need, one day at a time.</p>
    ${query.get('expired') ? `<div class="warn" style="margin-bottom:14px">${icon('alert')}<span>That sign-in link has expired. Enter your email for a new one.</span></div>` : ''}
    <div id="homes"></div>
    <form class="card pad form" id="loginform">
      <label class="f"><span>Your email</span><input class="in" type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label>
      <button class="btn primary block" type="submit">${icon('mail')} Email me a sign-in link</button>
      <p class="small muted" style="margin:10px 0 0">No password needed. We'll send a link that signs you in.</p>
    </form>
    <div class="features">
      <div>${icon('today')} Today's to-dos, in order, with checkboxes</div>
      <div>${icon('book')} Photo guides for the feeder, the laundry, the stove…</div>
      <div>${icon('mail')} A morning email for the sitter, a report for the owner</div>
    </div>
  </div></div>`);
  fetch('/api/public-stays').then((r) => r.json()).then((homes) => {
    if (!Array.isArray(homes) || !homes.length || !$('#homes')) return;
    $('#homes').innerHTML = `<div class="eyebrow" style="margin-bottom:8px">Homes</div><div class="stack" style="margin-bottom:22px">${homes.map((h) => `
      <button class="card homebtn" data-act="pinHome" data-id="${h.id}" data-name="${esc(h.name)}">
        <span class="kbadge k-dog">${icon('home')}</span>
        <span class="grow"><b>${esc(h.name)}</b>${h.pet_names ? `<span class="muted small">${esc(h.pet_names)}</span>` : ''}</span>
        ${icon('key')}
      </button>`).join('')}</div>
      <div class="eyebrow" style="margin-bottom:8px">Or sign in with email</div>`;
  }).catch(() => {});
  $('#loginform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const r = await api('POST', '/api/login', { email: e.target.email.value });
      e.target.outerHTML = `<div class="card pad"><h2 style="font-size:24px">Check your email</h2><p>We sent a sign-in link to <b>${esc(e.target.email.value)}</b>. Open it on this device.</p>
        ${r.emailReady ? '' : `<p class="small muted">Email isn't switched on yet, so ask the owner to send you your sign-in link.</p>`}</div>`;
    } catch (err) { fail(err); btn.disabled = false; }
  });
}

// ----- stays list -----
async function viewStays() {
  await loadMe();
  if (state.stays.length === 1 && !state.me.admin) return go(`#/s/${state.stays[0].id}/today`);
  document.title = 'The Dolce Life';
  const cards = state.stays.map((s) => `<a class="card staycard" href="#/s/${s.id}/today">
      <div class="eyebrow">${s.role === 'owner' ? 'Your home' : 'Sitting'}</div>
      <h3 style="margin-top:6px">${esc(s.name)}</h3>
      ${s.pet_names ? `<p class="muted small" style="margin:6px 0 0">${esc(s.pet_names)}</p>` : ''}
      <p class="small" style="margin:10px 0 0">${s.start_date ? `${shortDate(s.start_date)} – ${shortDate(s.end_date)}` : 'Dates not set yet'}</p>
    </a>`).join('');
  mount(`<div class="login" style="place-items:start center"><div style="width:100%;max-width:960px">
    <div class="pagehead"><div class="row grow"><span class="brand"><span class="mark">${pawFill}</span><span class="words"><span class="name" style="font-size:26px">The Dolce Life</span><span class="stayname">Signed in as ${esc(pinUser(state.me) ? state.me.name : state.me.email)}</span></span></span></div>
      <button class="iconbtn" data-act="theme" aria-label="Switch light or dark mode">${themeIcon()}</button>
      <button class="btn small" data-act="logout">${icon('out')} Sign out</button></div>
    ${state.stays.length ? `<div class="stays">${cards}</div>` : `<div class="card empty"><h3>No stays yet</h3><p>Set up your home so a sitter knows exactly what to do.</p></div>`}
    <div style="margin-top:16px"><button class="btn primary" data-act="newStay">${icon('plus')} Set up a new stay</button></div>
  </div></div>`);
}

// ----- today -----
function taskState(t, date, now) {
  const isToday = date === now.date;
  const ends = t.time_end || (t.time_start ? plusMin(t.time_start, 60) : '');
  return { late: isToday && !t.done && ends && ends < now.time };
}

function taskRow(t, date, now) {
  const st = taskState(t, date, now);
  const open = state.open.has(t.id);
  const tz = B().stay.tz;
  const hasMore = t.details || t.guide_id || isOwner();
  return `<div class="task ${t.done ? 'done' : ''} ${st.late ? 'late' : ''} ${open ? 'open' : ''}" id="task-${t.id}">
    <div class="top" ${hasMore ? `data-act="openTask" data-id="${t.id}"` : ''}>
      <button class="check" data-act="check" data-id="${t.id}" aria-pressed="${t.done}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${icon('check')}</button>
      <div class="body">
        <div class="title">${esc(t.title)}</div>
        <div class="meta"><span class="when">${esc(t.when)}${st.late ? ' · late' : ''}</span>
          ${secChip(t.section_kind, t.section_title)}
          ${t.recurring ? `<span class="chip accent">${icon('clock')}${esc(freq(t))}</span>` : ''}
          ${t.optional ? '<span class="chip">If needed</span>' : ''}
          ${t.guide_id ? `<span class="chip olive">${icon('book')}How-to</span>` : ''}
        </div>
        ${t.warning && !t.done ? `<div class="warn">${icon('alert')}<span>${esc(t.warning)}</span></div>` : ''}
        ${t.done && t.done_at ? `<div class="done-by">Done ${clock(t.done_at, tz)}${t.done_by_name ? ' by ' + esc(first(t.done_by_name)) : ''}</div>` : ''}
      </div>
      ${hasMore ? icon('right', 'chev') : ''}
    </div>
    ${hasMore ? `<div class="more">
      ${t.details ? `<p>${esc(t.details)}</p>` : ''}
      <div class="actions">
        ${t.guide_id ? `<a class="btn small" href="${stayUrl('guide/' + t.guide_id)}">${icon('book')} ${esc(t.guide_title || 'How-to')}</a>` : ''}
        ${isOwner() ? `<button class="btn small ghost" data-act="editTask" data-id="${t.id}">${icon('edit')} Edit</button>` : ''}
      </div></div>` : ''}
  </div>`;
}

async function viewToday(query) {
  const s = B().stay;
  if (!state.day || state.day.stayId !== s.id || query.get('fresh')) {
    const now = localNow(s.tz);
    let date = state.dayDate && state.day && state.day.stayId === s.id ? state.dayDate : now.date;
    // Before the stay starts, preview day 1.
    if (!state.day && s.start_date && now.date < s.start_date) date = s.start_date;
    await loadDay(s.id, date);
    state.day.stayId = s.id;
  }
  const d = state.day, info = d.info, date = info.date;
  const now = localNow(s.tz);
  const isToday = date === now.date;
  const tasks = d.tasks;
  const doneN = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((doneN / tasks.length) * 100) : 0;

  const groups = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']];
  const timed = groups.map(([k, label]) => {
    const list = tasks.filter((t) => t.part === k);
    if (!list.length) return '';
    return `<section class="group"><div class="ghead"><h2>${label}</h2><span class="muted small">${list.filter((t) => t.done).length}/${list.length}</span></div>
      <div class="card tasks">${list.map((t) => taskRow(t, date, now)).join('')}</div></section>`;
  }).join('');
  const due = tasks.filter((t) => t.part === 'anytime' && t.recurring);
  const any = tasks.filter((t) => t.part === 'anytime' && !t.recurring);
  const dueHtml = due.length ? `<section class="group"><div class="ghead"><h2>Due today</h2><span class="muted small">not every day</span></div><div class="card tasks">${due.map((t) => taskRow(t, date, now)).join('')}</div></section>` : '';
  const anyHtml = any.length ? `<section class="group"><div class="ghead"><h2>Anytime today</h2></div><div class="card tasks">${any.map((t) => taskRow(t, date, now)).join('')}</div></section>` : '';

  let next = null;
  if (isToday) next = tasks.find((t) => !t.done && t.time_start && (t.time_end || plusMin(t.time_start, 60)) >= now.time);

  let notice = '';
  if (info.before) notice = `Preview: the stay starts ${fmtDate(s.start_date)} at ${fmtTime(s.start_time)}.`;
  else if (info.after) notice = `This stay ended on ${fmtDate(s.end_date)}.`;
  else if (info.isFirst) notice = `First day. You take over at ${fmtTime(s.start_time)}, so the morning is already done.`;
  else if (info.isLast) notice = `Last day! The owners are home around ${fmtTime(s.end_time)}.`;

  const arrivals = d.updates.filter((u) => u.kind === 'arrival');
  const notes = d.updates.filter((u) => u.kind === 'note');
  const canPrev = !s.start_date || date > addDays(s.start_date, -1);
  const canNext = !s.end_date || date < s.end_date;

  const side = `<div class="today-side stack">
    ${isToday ? `<button class="arrive" data-act="arrive"><span class="ic">${icon('key')}</span><span><b>I'm here</b><span>${arrivals.length ? `Last check-in ${clock(arrivals[arrivals.length - 1].created_at, s.tz)}` : esc(s.arrival_title || 'Whenever you arrive')}</span></span></button>` : ''}
    ${next ? `<div class="card pad next"><div class="eyebrow">Up next · ${esc(next.when)}</div><div style="font-weight:600;font-size:18px;margin-top:4px">${esc(next.title)}</div>
      <div class="row" style="margin-top:10px"><button class="btn small" data-act="jump" data-id="${next.id}">Details</button>${next.guide_id ? `<a class="btn small ghost" href="${stayUrl('guide/' + next.guide_id)}">${icon('book')} How-to</a>` : ''}</div></div>` : ''}
    <div class="card pad sidecard">
      <h3>Today's visits</h3>
      ${arrivals.length ? arrivals.map((a) => `<div class="visit">${icon('key')}<span>${clock(a.created_at, s.tz)}</span><span class="muted">${esc(first(a.name))}</span></div>`).join('') : `<p class="muted small" style="margin:0">${isToday ? 'Nobody has checked in yet.' : 'No check-ins this day.'}</p>`}
      ${notes.length ? `<p class="small" style="margin:10px 0 0">${notes.length} update${notes.length > 1 ? 's' : ''} posted. <a href="${stayUrl('updates')}">See them</a></p>` : ''}
      <a class="btn small block" style="margin-top:12px" href="${stayUrl('updates')}">${icon('camera')} Send an update</a>
    </div>
  </div>`;

  mount(shell('today', `<div class="today-grid"><div>
    <div class="card hero">
      <svg class="paw" viewBox="0 0 24 24">${pawFill.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
      <div class="dayline"><span class="eyebrow">${info.index && info.inStay ? `Day ${info.index} of ${info.total}` : isToday ? 'Today' : ''}</span>
        <div class="daynav">
          <button data-act="day" data-d="-1" ${canPrev ? '' : 'disabled'} aria-label="Previous day">${icon('left')}</button>
          ${isToday ? '' : `<button class="today" data-act="day" data-d="0">Today</button>`}
          <button data-act="day" data-d="1" ${canNext ? '' : 'disabled'} aria-label="Next day">${icon('right')}</button>
        </div></div>
      <h1>${isToday ? 'Today, ' + fmtDate(date, { month: 'long', day: 'numeric' }) : fmtDate(date)}</h1>
      <div class="muted small">${isToday ? fmtDate(date, { weekday: 'long' }) + ' · ' : ''}${esc(s.pet_names || s.name)}</div>
      ${info.isFirst && s.welcome ? `<p class="welcome">${esc(s.welcome)}</p>` : ''}
      <div class="progress"><div class="bar"><span style="width:${pct}%"></span></div><div class="lbl"><span>${doneN} of ${tasks.length} done</span><span>${pct === 100 && tasks.length ? 'All done. Grazie!' : ''}</span></div></div>
    </div>
    ${notice ? `<div class="notice" style="margin-top:14px">${icon('clock')}<span>${esc(notice)}</span></div>` : ''}
    <div class="mobile-side" style="margin-top:14px"></div>
    ${tasks.length ? timed + dueHtml + anyHtml : `<div class="card empty" style="margin-top:18px"><h3>Nothing on the list</h3><p>${isOwner() ? 'Add to-dos from the Care tab.' : 'Enjoy the quiet.'}</p></div>`}
    ${isOwner() ? `<div style="margin-top:18px"><button class="btn small" data-act="newTask">${icon('plus')} Add a to-do</button></div>` : ''}
  </div>${side}</div>`));
  placeSide();
}
// On phones the side column (I'm here, next up) goes above the list; on desktop it sits on the right.
function placeSide() {
  const side = $('.today-side'), slot = $('.mobile-side');
  if (!side || !slot) return;
  const grid = $('.today-grid');
  if (matchMedia('(min-width: 1000px)').matches) { if (side.parentElement !== grid) grid.appendChild(side); }
  else if (side.parentElement !== slot) slot.appendChild(side);
}
addEventListener('resize', placeSide);

// ----- care -----
function viewCare(sectionId) {
  const b = B();
  const sections = b.sections;
  const sec = sections.find((x) => x.id === sectionId) || sections[0];
  if (!sec) {
    return mount(shell('care', `<div class="pagehead"><h1 class="grow">Care</h1></div><div class="card empty"><h3>No sections yet</h3>${isOwner() ? `<button class="btn primary" data-act="newSection">${icon('plus')} Add a section</button>` : ''}</div>`));
  }
  const segs = sections.map((x) => `<a href="${stayUrl('care/' + x.id)}" class="${x.id === sec.id ? 'on' : ''}">${icon(kindIcon(x.kind))}${esc(x.title)}</a>`).join('') +
    (isOwner() ? `<button data-act="newSection">${icon('plus')}Section</button>` : '');
  const pets = b.pets.filter((p) => p.section_id === sec.id);
  const tasks = b.tasks.filter((t) => t.section_id === sec.id);
  const guides = b.guides.filter((g) => g.section_id === sec.id && (g.steps.length || g.intro));
  const O = isOwner();
  const html = `
    <div class="pagehead"><span class="kbadge ${kindCls(sec.kind)}">${icon(kindIcon(sec.kind))}</span><div class="grow"><div class="eyebrow">Care</div><h1>${esc(sec.title)}</h1></div>
      ${O ? `<button class="btn small" data-act="editSection" data-id="${sec.id}">${icon('edit')} Edit section</button>` : ''}</div>
    <div class="segs">${segs}</div>
    ${pets.length || O ? `<div class="pets">${pets.map((p) => `<div class="card pet">
        <div class="avatar ${p.photo ? '' : kindCls(sec.kind)}">${p.photo ? `<img src="${esc(p.photo)}" alt="" data-zoom>` : icon(kindIcon(sec.kind))}</div>
        <div class="grow"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>
        ${O ? `<button class="btn small ghost" style="margin:6px 0 0 -10px" data-act="editPet" data-id="${p.id}">${icon('edit')} Edit</button>` : ''}</div>
      </div>`).join('')}
      ${O ? `<button class="card pet" style="cursor:pointer;border-style:dashed;box-shadow:none;background:transparent;align-items:center" data-act="newPet" data-section="${sec.id}"><span class="avatar" style="background:var(--bg-2);color:var(--muted)">${icon('plus')}</span><b>Add ${sec.kind === 'plants' || sec.kind === 'house' ? 'an item' : 'a pet'}</b></button>` : ''}
    </div>` : ''}
    ${lines(sec.notes).length ? `<div class="section-title"><h2>Good to know</h2><span class="line"></span></div>
      <div class="card pad"><ul class="lines">${lines(sec.notes).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
    <div class="section-title"><h2>Routine</h2><span class="line"></span>${O ? `<button class="btn small ghost" data-act="newTask" data-section="${sec.id}">${icon('plus')} Add</button>` : ''}</div>
    ${tasks.length ? `<div class="card sched">${tasks.map((t) => `<div class="it">
        <div class="when">${esc(t.when)}<div class="muted" style="font-weight:500">${esc(freq(t))}</div></div>
        <div class="what"><b>${esc(t.title)}</b>
          ${t.warning ? `<div class="warn" style="margin-top:6px">${icon('alert')}<span>${esc(t.warning)}</span></div>` : ''}
          ${t.details ? `<p>${esc(t.details)}</p>` : ''}
          ${t.next_due ? `<p class="small" style="color:var(--accent-text)">Next: ${shortDate(t.next_due)}</p>` : ''}
          <div class="row wrap" style="margin-top:6px;gap:6px">
            ${t.guide_id ? `<a class="btn small" href="${stayUrl('guide/' + t.guide_id)}">${icon('book')} How-to</a>` : ''}
            ${O ? `<button class="btn small ghost" data-act="editTask" data-id="${t.id}">${icon('edit')} Edit</button>` : ''}
          </div>
        </div></div>`).join('')}</div>` : `<div class="card empty small">No routine for ${esc(sec.title)} yet.</div>`}
    ${guides.length ? `<div class="section-title"><h2>How-to guides</h2><span class="line"></span></div>
      <div class="glist">${guides.map(guideCard).join('')}</div>` : ''}
  `;
  mount(shell('care', html));
}

// ----- guides -----
function guideCard(g) {
  const ph = g.steps.find((s) => s.photo);
  const sec = B().sections.find((x) => x.id === g.section_id);
  return `<a class="card gcard ${g.steps.length ? '' : 'suggested'}" href="${stayUrl('guide/' + g.id + (g.steps.length || !isOwner() ? '' : '/edit'))}" data-title="${esc((g.title + ' ' + g.intro + ' ' + g.steps.map((s) => s.text).join(' ')).toLowerCase())}">
    <span class="gthumb ${ph || !sec ? '' : kindCls(sec.kind)}">${ph ? `<img src="${esc(ph.photo)}" alt="" loading="lazy">` : icon(sec ? kindIcon(sec.kind) : 'book')}</span>
    <span class="grow"><b>${esc(g.title)}</b><span class="muted">${g.steps.length ? `${g.steps.length} step${g.steps.length > 1 ? 's' : ''}${sec ? ' · ' + esc(sec.title) : ''}` : 'Add steps and photos'}</span></span>
  </a>`;
}
function viewGuides(query) {
  const b = B(), O = isOwner();
  const filter = Number(query.get('sec')) || 0;
  const ready = b.guides.filter((g) => g.steps.length || g.intro);
  const todo = O ? b.guides.filter((g) => !g.steps.length && !g.intro) : [];
  const secs = b.sections.filter((s) => b.guides.some((g) => g.section_id === s.id));
  const list = (arr) => arr.filter((g) => !filter || g.section_id === filter);
  const html = `
    <div class="pagehead"><div class="grow"><div class="eyebrow">House manual</div><h1>Guides</h1></div>
      ${O ? `<button class="btn small primary" data-act="newGuide">${icon('plus')} New guide</button>` : ''}</div>
    <div class="search">${icon('search')}<input id="gsearch" type="search" placeholder="Search: stove, feeder, Wi-Fi…" aria-label="Search guides"></div>
    <div class="segs"><a href="${stayUrl('guides')}" class="${filter ? '' : 'on'}">All</a>${secs.map((s) => `<a href="${stayUrl('guides?sec=' + s.id)}" class="${filter === s.id ? 'on' : ''}">${icon(kindIcon(s.kind))}${esc(s.title)}</a>`).join('')}</div>
    ${list(ready).length ? `<div class="glist" id="glist">${list(ready).map(guideCard).join('')}</div>` : `<div class="card empty"><h3>No guides yet</h3><p>${O ? 'Start with the suggestions below: a few photos and a line each.' : 'The owner hasn\'t added any guides yet.'}</p></div>`}
    ${list(todo).length ? `<div class="section-title"><h2>Still to fill in</h2><span class="line"></span></div>
      <p class="small muted" style="margin:-4px 0 12px">Only you can see these. Once a guide has steps, your sitter sees it too. Delete any that don't apply.</p>
      <div class="glist">${list(todo).map(guideCard).join('')}</div>` : ''}
    <p id="gnone" class="muted" style="display:none;margin-top:14px">No guides match that search.</p>`;
  mount(shell('guides', html));
  $('#gsearch').addEventListener('input', (e) => {
    const v = e.target.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('.gcard').forEach((c) => { const ok = !v || c.dataset.title.includes(v); c.style.display = ok ? '' : 'none'; if (ok) shown++; });
    $('#gnone').style.display = shown ? 'none' : '';
  });
}

function viewGuide(id) {
  const g = B().guides.find((x) => x.id === id);
  if (!g) return go(stayUrl('guides'));
  if (!g.steps.length && isOwner()) return go(stayUrl(`guide/${g.id}/edit`));
  const sec = B().sections.find((x) => x.id === g.section_id);
  const html = `<div class="guide-wrap">
    <div style="margin:6px 0 0"><a class="btn small ghost" style="margin-left:-10px" href="javascript:history.back()">${icon('left')} Back</a></div>
    <div class="pagehead" style="margin-top:4px"><div class="grow">${sec ? `<div style="margin-bottom:8px">${secChip(sec.kind, sec.title)}</div>` : ''}<h1>${esc(g.title)}</h1></div>
      ${isOwner() ? `<div class="editbar"><a class="btn small" href="${stayUrl(`guide/${g.id}/edit`)}">${icon('edit')} Edit</a></div>` : ''}</div>
    ${g.intro ? `<p style="font-size:17px;color:var(--ink-2);margin:-6px 0 16px">${esc(g.intro)}</p>` : ''}
    <div class="card pad"><ol class="steps">${g.steps.map((s) => `<li class="step ${s.warning ? 'warning' : ''}"><span class="n"></span><div>
        <div class="t">${s.warning ? '⚠ ' : ''}${esc(s.text)}</div>
        ${s.photo ? `<img src="${esc(s.photo)}" alt="Photo for this step" loading="lazy" data-zoom>` : ''}
      </div></li>`).join('')}</ol></div>
  </div>`;
  mount(shell('guides', html));
}

function viewGuideEdit(id) {
  if (!isOwner()) return go(stayUrl('guide/' + id));
  const g = B().guides.find((x) => x.id === id);
  if (!g) return go(stayUrl('guides'));
  if (!state.draft || state.draft.id !== id) state.draft = { id, steps: g.steps.length ? g.steps.map((s) => ({ text: s.text, photo: s.photo, warning: s.warning })) : [{ text: '', photo: '', warning: false }] };
  const steps = state.draft.steps;
  const sec = B().sections.find((x) => x.id === g.section_id);
  const html = `<div class="guide-wrap">
    <div class="pagehead"><div class="grow"><div class="eyebrow">Editing guide${sec ? ' · ' + esc(sec.title) : ''}</div><h1>${esc(g.title)}</h1></div>
      <button class="btn small" data-act="editGuideInfo" data-id="${g.id}">${icon('edit')} Title & intro</button></div>
    <p class="small muted" style="margin:-6px 0 14px">One short step per line of action. Add a photo wherever it helps (the dial, the button, the drawer).</p>
    <div class="card pad" id="stepsed">${steps.map((s, i) => `<div class="editstep" data-i="${i}">
        <div class="n">${i + 1}</div>
        <div>
          <textarea class="in" data-field="text" placeholder="What to do in this step">${esc(s.text)}</textarea>
          ${s.photo ? `<img class="ph" src="${esc(s.photo)}" alt="">` : ''}
          <div class="tools">
            <label class="btn small">${icon('camera')} ${s.photo ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" data-act-change="stepPhoto" data-i="${i}" hidden></label>
            ${s.photo ? `<button class="btn small ghost" data-act="stepNoPhoto" data-i="${i}">Remove photo</button>` : ''}
            <label class="toggle small"><input type="checkbox" data-field="warning" ${s.warning ? 'checked' : ''}> Important</label>
            <span class="spacer grow"></span>
            <button class="iconbtn" data-act="stepMove" data-i="${i}" data-d="-1" aria-label="Move up" ${i ? '' : 'disabled'}>${icon('up')}</button>
            <button class="iconbtn" data-act="stepMove" data-i="${i}" data-d="1" aria-label="Move down" ${i < steps.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
            <button class="iconbtn" data-act="stepDel" data-i="${i}" aria-label="Delete step">${icon('trash')}</button>
          </div>
        </div></div>`).join('')}
      <button class="btn small" style="margin-top:12px" data-act="stepAdd">${icon('plus')} Add a step</button>
    </div>
    <div class="row wrap" style="margin-top:16px">
      <button class="btn primary" data-act="stepsSave">${icon('check')} Save guide</button>
      <a class="btn" href="${stayUrl(g.steps.length ? 'guide/' + g.id : 'guides')}" data-act="stepsCancel">Cancel</a>
      <span class="grow"></span>
      <button class="btn danger" data-act="deleteGuide" data-id="${g.id}">${icon('trash')} Delete guide</button>
    </div></div>`;
  const y = window.scrollY;
  mount(shell('guides', html));
  window.scrollTo({ top: y });
}
function syncDraft() {
  document.querySelectorAll('#stepsed .editstep').forEach((el) => {
    const s = state.draft.steps[Number(el.dataset.i)];
    s.text = el.querySelector('[data-field=text]').value;
    s.warning = el.querySelector('[data-field=warning]').checked;
  });
}

// ----- contacts -----
function viewContacts() {
  const b = B(), s = b.stay, O = isOwner();
  const card = (c) => `<div class="card contact ${c.emergency ? 'em' : ''}">
    <div class="row"><div class="grow"><h3>${esc(c.name)}</h3>${c.role ? `<div class="role muted">${esc(c.role)}</div>` : ''}</div>
      ${O ? `<button class="iconbtn" data-act="editContact" data-id="${c.id}" aria-label="Edit ${esc(c.name)}">${icon('edit')}</button>` : ''}</div>
    ${c.phone ? `<div style="font-size:18px;font-weight:600">${esc(c.phone)}</div>` : ''}
    ${c.address ? `<div class="addr">${esc(c.address)}</div>` : ''}
    ${c.notes ? `<div class="note">${esc(c.notes)}</div>` : ''}
    <div class="acts">
      ${c.phone ? `<a class="btn small ${c.emergency ? 'primary' : ''}" href="${telHref(c.phone)}">${icon('phone')} Call</a><a class="btn small" href="${smsHref(c.phone)}">${icon('chat')} Text</a>` : ''}
      ${c.email ? `<a class="btn small" href="mailto:${esc(c.email)}">${icon('mail')} Email</a>` : ''}
      ${c.address ? `<a class="btn small" href="${mapHref(c.address)}" target="_blank" rel="noopener">${icon('pin')} Map</a>` : ''}
    </div></div>`;
  const em = b.contacts.filter((c) => c.emergency), rest = b.contacts.filter((c) => !c.emergency);
  const html = `
    <div class="pagehead"><div class="grow"><div class="eyebrow">Who to call</div><h1>Contacts</h1></div>
      ${O ? `<button class="btn small primary" data-act="newContact">${icon('plus')} Add contact</button>` : ''}</div>
    <div class="card homecard"><span class="ic">${icon('home')}</span><div class="grow">
      <div class="eyebrow">The house</div>
      ${s.address ? `<div style="font-weight:600;font-size:17px;margin-top:2px">${esc(s.address)}</div>` : `<div class="muted" style="margin-top:2px">${O ? 'Add the home address in Settings so the sitter can give it to a vet or 911.' : 'No address saved yet.'}</div>`}
      ${s.address_notes ? `<div class="small muted" style="margin-top:4px;white-space:pre-line">${esc(s.address_notes)}</div>` : ''}
      <div class="row wrap" style="margin-top:10px">${s.address ? `<a class="btn small" href="${mapHref(s.address)}" target="_blank" rel="noopener">${icon('pin')} Map</a><button class="btn small" data-act="copy" data-text="${esc(s.address)}">${icon('copy')} Copy</button>` : O ? `<a class="btn small" href="${stayUrl('settings')}">Add address</a>` : ''}</div>
    </div></div>
    ${em.length ? `<div class="section-title"><h2 style="color:var(--danger)">Emergency</h2><span class="line"></span></div><div class="contacts">${em.map(card).join('')}</div>` : ''}
    <div class="section-title"><h2>People</h2><span class="line"></span></div>
    ${rest.length ? `<div class="contacts">${rest.map(card).join('')}</div>` : '<div class="card empty small">No contacts yet.</div>'}`;
  mount(shell('contacts', html));
}

// ----- updates -----
async function viewUpdates() {
  const s = B().stay;
  const ups = await api('GET', `/api/stays/${s.id}/updates`);
  const byDay = {};
  for (const u of ups) (byDay[u.day] = byDay[u.day] || []).push(u);
  const draftPhoto = state.updPhoto || '';
  const html = `
    <div class="pagehead"><div class="grow"><div class="eyebrow">Notes & photos</div><h1>Updates</h1></div></div>
    <form class="card pad composer" id="updform">
      <textarea name="text" placeholder="${isOwner() ? 'Leave a note for the sitter…' : 'How did it go? Owners love a photo 🐾'}"></textarea>
      ${draftPhoto ? `<img class="ph" src="${esc(draftPhoto)}" alt="">` : ''}
      <div class="row" style="margin-top:10px">
        <label class="btn small">${icon('camera')} ${draftPhoto ? 'Change photo' : 'Photo'}<input type="file" accept="image/*" data-act-change="updPhoto" hidden></label>
        <span class="grow"></span>
        <button class="btn primary small" type="submit">${icon('send')} Post</button>
      </div>
      <p class="small muted" style="margin:10px 0 0">Owners get today's updates in their evening report.</p>
    </form>
    ${Object.keys(byDay).length ? Object.entries(byDay).map(([day, list]) => `<div class="feedday"><h3>${esc(fmtDate(day))}</h3><div class="card">
      ${list.map((u) => u.kind === 'arrival'
        ? `<div class="upd arrival">${icon('key')}<span><b>${esc(first(u.name) || 'Someone')}</b> checked in at ${clock(u.created_at, s.tz)}</span></div>`
        : `<div class="upd"><div class="who"><b style="color:var(--ink)">${esc(first(u.name) || 'Someone')}</b><span>${clock(u.created_at, s.tz)}</span><span class="grow"></span>
            ${isOwner() || u.user_id === state.me.id ? `<button class="iconbtn" style="width:32px;height:32px" data-act="delUpdate" data-id="${u.id}" aria-label="Delete">${icon('trash')}</button>` : ''}</div>
          ${u.text ? `<div class="txt">${esc(u.text)}</div>` : ''}${u.photo ? `<img src="${esc(u.photo)}" alt="" loading="lazy" data-zoom>` : ''}</div>`).join('')}
    </div></div>`).join('') : '<div class="card empty" style="margin-top:18px"><h3>No updates yet</h3><p>Check-ins and notes show up here.</p></div>'}`;
  mount(shell('updates', html));
  $('#updform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text && !state.updPhoto) return toast('Write a note or add a photo.');
    try { await api('POST', `/api/stays/${s.id}/updates`, { text, photo: state.updPhoto || '' }); state.updPhoto = ''; toast('Posted'); state.day = null; viewUpdates(); } catch (err) { fail(err); }
  });
}

// ----- settings -----
function viewSettings() {
  const b = B(), s = b.stay, O = isOwner();
  const me = state.me;
  const tzs = ['Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Asia/Tokyo', 'Asia/Seoul', 'Europe/London', 'Australia/Sydney'];
  if (!tzs.includes(s.tz)) tzs.unshift(s.tz);
  const members = b.members.map((m) => `<div class="member">
      <div class="who"><b>${esc(m.name || m.email)}</b><span class="muted small">${pinUser(m) ? 'Signed in with the PIN' : esc(m.email || '')}${m.phone ? ' · ' + esc(m.phone) : ''}</span></div>
      <span class="chip ${m.role === 'owner' ? 'accent' : 'olive'}">${m.role === 'owner' ? 'Owner' : 'Sitter'}</span>
      <div class="opts" style="width:100%">
        ${pinUser(m) ? '<span class="muted small">No email on file</span>' : `<label class="toggle"><input type="checkbox" data-act-change="memberFlag" data-uid="${m.id}" data-f="morning_email" ${m.morning_email ? 'checked' : ''}> Morning email</label>
        <label class="toggle"><input type="checkbox" data-act-change="memberFlag" data-uid="${m.id}" data-f="evening_report" ${m.evening_report ? 'checked' : ''}> Evening report</label>`}
        <span class="grow"></span>
        ${pinUser(m) ? '' : `<button class="btn small" data-act="memberLink" data-uid="${m.id}">${icon('link')} Sign-in link</button>`}
        <button class="btn small ghost" data-act="memberEdit" data-uid="${m.id}">${icon('edit')}</button>
      </div></div>`).join('');
  const ownerHtml = `
    <form class="card pad form" id="stayform">
      <div><h2>The stay</h2><p class="desc">The dates drive everything: day numbers, what's due, and when emails start and stop.</p></div>
      <label class="f"><span>Name</span><input class="in" name="name" value="${esc(s.name)}" required></label>
      <label class="f"><span>Pets' names</span><input class="in" name="pet_names" value="${esc(s.pet_names)}" placeholder="Dolce, Twinzy, Spicy"><small>The first name is used in email subjects ("Dolce's day").</small></label>
      <div class="grid2">
        <label class="f"><span>Sitter starts</span><input class="in" type="date" name="start_date" value="${esc(s.start_date || '')}"></label>
        <label class="f"><span>at</span><input class="in" type="time" name="start_time" value="${esc(s.start_time)}"></label>
        <label class="f"><span>Owners home</span><input class="in" type="date" name="end_date" value="${esc(s.end_date || '')}"></label>
        <label class="f"><span>at</span><input class="in" type="time" name="end_time" value="${esc(s.end_time)}"></label>
      </div>
      <label class="f"><span>Home time zone</span><select class="in" name="tz">${tzs.map((z) => `<option ${z === s.tz ? 'selected' : ''}>${z}</option>`).join('')}</select><small>Times are always the home's time, even while you travel.</small></label>
      <div><h2 style="margin-top:14px">The home</h2></div>
      <label class="f"><span>Address</span><input class="in" name="address" value="${esc(s.address)}" placeholder="123 Street, Honolulu, HI 96814" autocomplete="street-address"><small>Only shown inside the app, never in emails.</small></label>
      <label class="f"><span>Getting there / parking</span><textarea class="in" name="address_notes" placeholder="Park on the street. Side gate is unlocked.">${esc(s.address_notes)}</textarea></label>
      <div><h2 style="margin-top:14px">Sign-in screen</h2><p class="desc">A public home shows its name and pets' names on the sign-in page. Anyone with the PIN can open it as a sitter: they can check things off and post updates, but only owners can change anything.</p></div>
      <label class="toggle"><input type="checkbox" name="is_public" ${s.is_public ? 'checked' : ''}> Show this home on the sign-in screen</label>
      <label class="f"><span>${s.has_pin ? 'Change PIN' : 'PIN'}</span><input class="in" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" autocomplete="new-password" placeholder="${s.has_pin ? 'Leave empty to keep the current PIN' : '4 to 8 digits'}"><small>${s.has_pin ? 'A PIN is set.' : 'The home only shows on the sign-in screen once it has a PIN.'}</small></label>
      <div><h2 style="margin-top:14px">"I'm here" routine</h2><p class="desc">Shown every time the sitter taps I'm here.</p></div>
      <label class="f"><span>Title</span><input class="in" name="arrival_title" value="${esc(s.arrival_title)}"></label>
      <label class="f"><span>Steps (one per line)</span><textarea class="in" name="arrival_text">${esc(s.arrival_text)}</textarea></label>
      <label class="f"><span>Welcome note (shown on day 1)</span><textarea class="in" name="welcome">${esc(s.welcome)}</textarea></label>
      <div><h2 style="margin-top:14px">Emails</h2><p class="desc">${state.emailReady ? 'Email is on.' : "Email isn't switched on for the app yet. Settings are saved and start working once it is."}</p></div>
      <div class="grid2">
        <label class="f"><span>Morning email</span><input class="in" type="time" name="email_time" value="${esc(s.email_time)}"></label>
        <label class="f"><span>Evening report</span><input class="in" type="time" name="report_time" value="${esc(s.report_time)}"></label>
      </div>
      <div class="row wrap"><button class="btn primary" type="submit">${icon('check')} Save</button>
        ${state.emailReady ? `<button class="btn small" type="button" data-act="testEmail" data-kind="morning">Send me a test morning email</button><button class="btn small" type="button" data-act="testEmail" data-kind="report">Test evening report</button>` : ''}</div>
    </form>
    <div class="card pad">
      <div class="row"><div class="grow"><h2>People</h2><p class="desc" style="margin:4px 0 0">Sitters get the morning email. Owners can get the evening report too.</p></div>
        <button class="btn small primary" data-act="memberAdd">${icon('plus')} Add</button></div>
      <div style="margin-top:8px">${members || '<p class="muted">Nobody yet.</p>'}</div>
    </div>`;
  const html = `<div class="pagehead"><div class="grow"><div class="eyebrow">${esc(s.name)}</div><h1>Settings</h1></div></div>
    <div class="settings-grid">
      ${O ? ownerHtml : `<div class="card pad"><h2>The stay</h2><p class="desc">${s.start_date ? `${fmtDate(s.start_date)} at ${fmtTime(s.start_time)} to ${fmtDate(s.end_date)} at ${fmtTime(s.end_time)}.` : 'Dates not set yet.'}</p>
        <p class="small muted" style="margin:0">Morning email at ${fmtTime(s.email_time)}. Ask the owner to change your email settings.</p></div>`}
      <form class="card pad form" id="meform">
        <div><h2>You</h2><p class="desc">${pinUser(me) ? 'Signed in with the home PIN' : esc(me.email)}</p></div>
        <label class="f"><span>Your name</span><input class="in" name="name" value="${esc(me.name)}" placeholder="First name is fine"></label>
        <div class="row wrap"><button class="btn" type="submit">Save name</button><span class="grow"></span>
          <button class="btn small" type="button" data-act="theme">${themeIcon()} Light / dark</button>
          ${state.stays.length > 1 || me.admin ? `<a class="btn small" href="#/">${icon('grid')} All stays</a>` : ''}
          <button class="btn small" type="button" data-act="logout">${icon('out')} Sign out</button></div>
      </form>
      ${O ? `<div class="card pad"><h2>Delete this stay</h2><p class="desc">Removes the stay, its guides, photos list and history for everyone.</p><button class="btn danger small" data-act="deleteStay">${icon('trash')} Delete stay</button></div>` : ''}
    </div>`;
  mount(shell('settings', html));
  if (O) $('#stayform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.is_public = e.target.is_public.checked;
    if (!body.pin) delete body.pin;
    if (body.start_date && body.end_date && body.end_date < body.start_date) return toast('The end date is before the start date.');
    try { await api('PUT', `/api/stays/${s.id}`, body); await loadBundle(s.id, true); state.day = null; await loadMe(); toast('Saved'); viewSettings(); } catch (err) { fail(err); }
  });
  $('#meform').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/me', { name: e.target.name.value }); await loadMe(); toast('Saved'); } catch (err) { fail(err); }
  });
}

// ---------- sheets & forms ----------
function closeSheet() { $('#sheet-root').innerHTML = ''; document.body.style.overflow = ''; if (state.pin && !state.pinKeep) state.pin = null; }
function openSheet(title, body, foot = '') {
  $('#sheet-root').innerHTML = `<div class="sheet-bg" data-act="sheetBg"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="grab"></div><div class="shead"><h2>${esc(title)}</h2><button class="iconbtn" data-act="closeSheet" aria-label="Close">${icon('x')}</button></div>
    ${body}${foot ? `<div class="sfoot">${foot}</div>` : ''}</div></div>`;
  document.body.style.overflow = 'hidden';
}

function field(f, v) {
  const val = v ?? f.value ?? '';
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : '';
  if (f.type === 'checkbox') return `<label class="toggle"><input type="checkbox" name="${f.name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
  if (f.type === 'textarea') return `<label class="f"><span>${esc(f.label)}</span><textarea class="in" name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>${hint}</label>`;
  if (f.type === 'select') return `<label class="f"><span>${esc(f.label)}</span><select class="in" name="${f.name}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(val ?? '') ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>${hint}</label>`;
  if (f.type === 'photo') return `<div class="f"><span style="display:block;font-size:13.5px;font-weight:600;color:var(--ink-2);margin-bottom:6px">${esc(f.label)}</span>
    <input type="hidden" name="${f.name}" value="${esc(val)}"><div class="row"><span class="avatar" data-photo-preview>${val ? `<img src="${esc(val)}" alt="">` : icon('camera')}</span>
    <label class="btn small">${icon('camera')} Choose photo<input type="file" accept="image/*" data-act-change="formPhoto" data-name="${f.name}" hidden></label></div></div>`;
  if (f.type === 'row') return `<div class="grid2">${f.fields.map((x) => field(x, f.values ? f.values[x.name] : undefined)).join('')}</div>`;
  return `<label class="f"><span>${esc(f.label)}</span><input class="in" type="${f.type || 'text'}" name="${f.name}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''} ${f.min != null ? `min="${f.min}"` : ''}>${hint}</label>`;
}

function openForm({ title, fields, values = {}, submit = 'Save', onSubmit, onDelete, extra = '' }) {
  const flat = [];
  const withVals = fields.map((f) => { if (f.type === 'row') { f.fields.forEach((x) => flat.push(x)); return { ...f, values }; } flat.push(f); return f; });
  openSheet(title, `<form class="form" id="sheetform">${withVals.map((f) => field(f, values[f.name])).join('')}${extra}</form>`,
    `${onDelete ? `<button class="btn danger" data-act="formDelete">${icon('trash')} Delete</button>` : ''}<span class="grow"></span><button class="btn" data-act="closeSheet">Cancel</button><button class="btn primary" data-act="formSubmit">${esc(submit)}</button>`);
  const form = $('#sheetform');
  const collect = () => {
    const out = {};
    for (const f of flat) {
      const el = form.elements[f.name];
      if (!el) continue;
      out[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? Number(el.value || 0) : el.value;
    }
    return out;
  };
  state.formHandlers = {
    submit: async () => {
      if (!form.reportValidity()) return;
      try { await onSubmit(collect()); } catch (e) { fail(e); }
    },
    del: onDelete ? async () => { if (confirm('Delete this? This can’t be undone.')) { try { await onDelete(); } catch (e) { fail(e); } } } : null,
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); state.formHandlers.submit(); });
  setTimeout(() => { const el = form.querySelector('input:not([type=hidden]):not([type=checkbox]),textarea'); if (el && matchMedia('(min-width: 700px)').matches) el.focus(); }, 60);
}

async function uploadPhoto(file) {
  const fd = new FormData(); fd.append('photo', file);
  toast('Uploading photo…');
  const r = await api('POST', '/api/upload', fd);
  toast('Photo added');
  return r.url;
}

const sectionOpts = () => [['', '—'], ...B().sections.map((s) => [s.id, s.title])];
const guideOpts = () => [['', 'None'], ...B().guides.map((g) => [g.id, g.title])];
async function refresh() { await loadBundle(B().stay.id, true); if (state.day) await loadDay(B().stay.id, state.dayDate).then(() => { state.day.stayId = B().stay.id; }); closeSheet(); render(); }

function taskForm(t = {}, sectionId) {
  const isNew = !t.id;
  openForm({
    title: isNew ? 'New to-do' : 'Edit to-do',
    values: { every_n: 1, first_day: 1, section_id: sectionId || '', ...t },
    fields: [
      { name: 'title', label: 'What to do', required: true, placeholder: 'Evening walk' },
      { name: 'section_id', label: 'Section', type: 'select', options: sectionOpts() },
      { type: 'row', fields: [{ name: 'time_start', label: 'From', type: 'time' }, { name: 'time_end', label: 'Until (optional)', type: 'time' }] },
      { name: 'time_label', label: 'Show as (optional)', placeholder: 'After the walk', hint: 'Replaces the time on screen. Leave both times empty for "anytime".' },
      { type: 'row', fields: [
        { name: 'every_n', label: 'How often', type: 'select', options: [[1, 'Every day'], [2, 'Every 2 days'], [3, 'Every 3 days'], [4, 'Every 4 days'], [7, 'Once a week']] },
        { name: 'first_day', label: 'First time on day #', type: 'number', min: 1 }] },
      { name: 'details', label: 'Details', type: 'textarea', placeholder: 'How, where, how much…' },
      { name: 'warning', label: 'Important warning (shown in orange)', type: 'textarea' },
      { name: 'guide_id', label: 'Link a how-to guide', type: 'select', options: guideOpts() },
      { name: 'optional', label: 'Only if needed', type: 'checkbox' },
    ],
    onSubmit: async (v) => {
      v.every_n = Number(v.every_n); v.first_day = Math.max(1, Number(v.first_day) || 1);
      if (isNew) await api('POST', `/api/stays/${B().stay.id}/tasks`, v); else await api('PUT', `/api/stays/${B().stay.id}/tasks/${t.id}`, v);
      toast('Saved'); await refresh();
    },
    onDelete: isNew ? null : async () => { await api('DELETE', `/api/stays/${B().stay.id}/tasks/${t.id}`); toast('Deleted'); await refresh(); },
  });
}

function emergencySheet() {
  const b = B(), s = b.stay;
  const em = b.contacts.filter((c) => c.emergency);
  const owners = b.contacts.filter((c) => !c.emergency && /owner/i.test(c.role));
  const row = (c) => `<div class="card contact em" style="box-shadow:none"><h3>${esc(c.name)}</h3>
      ${c.address ? `<div class="addr">${esc(c.address)}</div>` : ''}${c.notes ? `<div class="note">${esc(c.notes)}</div>` : ''}
      <div class="acts">${c.phone ? `<a class="btn small primary" href="${telHref(c.phone)}">${icon('phone')} Call ${esc(c.phone)}</a>` : ''}${c.address ? `<a class="btn small" href="${mapHref(c.address)}" target="_blank" rel="noopener">${icon('pin')} Directions</a>` : ''}</div></div>`;
  openSheet('Emergency', `<div class="stack">
    ${s.address ? `<div class="warn" style="background:var(--olive-soft);border-color:transparent;color:var(--olive)">${icon('home')}<span>This house: <b>${esc(s.address)}</b></span></div>` : ''}
    ${em.length ? em.map(row).join('') : '<p class="muted">No emergency contacts saved yet.</p>'}
    ${owners.length ? `<div class="eyebrow" style="margin-top:18px">The owners</div>${owners.map((c) => `<div class="row" style="padding:8px 0"><b class="grow">${esc(c.name)}</b>${c.phone ? `<a class="btn small" href="${telHref(c.phone)}">${icon('phone')} Call</a><a class="btn small" href="${smsHref(c.phone)}">Text</a>` : ''}</div>`).join('')}` : ''}
    <p class="small muted">Life-threatening emergency for a person: call 911.</p>
  </div>`);
}

// ---------- PIN sign-in ----------
function pinSheet(id, name) {
  state.pin = { id, name, digits: '', step: 'pin', error: '' };
  drawPin();
}
function drawPin() {
  const p = state.pin;
  if (p.step === 'name') {
    let saved = ''; try { saved = localStorage.getItem('pinName') || ''; } catch (e) {}
    openSheet(p.name, `<form id="pinname" class="form">
        <p style="margin:0">PIN accepted. What's your first name? It shows next to what you check off.</p>
        <label class="f"><span>Your first name</span><input class="in" name="name" value="${esc(saved)}" required autocomplete="given-name" maxlength="60"></label>
        ${p.error ? `<div class="warn">${icon('alert')}<span>${esc(p.error)}</span></div>` : ''}
      </form>`, `<span class="grow"></span><button class="btn primary" data-act="pinName">Continue</button>`);
    const f = $('#pinname');
    f.addEventListener('submit', (e) => { e.preventDefault(); A.pinName(); });
    setTimeout(() => f.name.focus(), 50);
    return;
  }
  const dots = Array.from({ length: Math.max(4, p.digits.length) }, (_, i) => `<span class="${i < p.digits.length ? 'on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  openSheet(p.name, `<p class="muted" style="margin:-6px 0 0;text-align:center">Enter the home's PIN</p>
    <div class="pindots ${p.error ? 'shake' : ''}">${dots}</div>
    <p class="pinerr">${esc(p.error)}</p>
    <div class="pinpad">${keys.map((k) => k === '' ? '<span></span>' : k === 'del'
      ? `<button data-act="pinKey" data-k="del" aria-label="Delete">${icon('left')}</button>`
      : `<button data-act="pinKey" data-k="${k}">${k}</button>`).join('')}</div>`,
    `<button class="btn primary block" data-act="pinGo" ${p.digits.length >= 4 ? '' : 'disabled'}>${icon('key')} Unlock</button>`);
}
async function pinSubmit(name) {
  const p = state.pin;
  const body = { stay_id: p.id, pin: p.digits };
  if (name) body.name = name;
  try {
    const r = await api('POST', '/api/pin-login', body);
    if (r.needName) { p.step = 'name'; p.error = ''; return drawPin(); }
    try { localStorage.setItem('pinName', name); } catch (e) {}
    closeSheet(); state.pin = null; state.me = null; state.bundle = null; state.day = null;
    await loadMe(); go(`#/s/${r.stay_id}/today`);
  } catch (e) {
    p.error = e.message; if (p.step === 'pin') p.digits = ''; drawPin();
  }
}
document.addEventListener('keydown', (e) => {
  if (!state.pin || state.pin.step !== 'pin' || !$('.pinpad')) return;
  if (/^\d$/.test(e.key)) A.pinKey({ dataset: { k: e.key } });
  else if (e.key === 'Backspace') A.pinKey({ dataset: { k: 'del' } });
  else if (e.key === 'Enter' && state.pin.digits.length >= 4) pinSubmit();
});

// ---------- actions ----------
const A = {
  pinHome: (el) => pinSheet(Number(el.dataset.id), el.dataset.name),
  pinKey: (el) => {
    const p = state.pin; if (!p) return;
    const k = el.dataset.k;
    if (k === 'del') p.digits = p.digits.slice(0, -1);
    else if (p.digits.length < 8) p.digits += k;
    p.error = ''; drawPin();
  },
  pinGo: () => pinSubmit(),
  pinName: () => { const v = $('#pinname').name.value.trim(); if (v) pinSubmit(v); },
  theme: toggleTheme,
  closeSheet,
  sheetBg: (el, e) => { if (e.target === el) closeSheet(); },
  emergency: emergencySheet,
  copy: async (el) => { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); } catch { toast(el.dataset.text); } },
  logout: async () => { await api('POST', '/api/logout'); state.me = null; state.bundle = null; state.day = null; go('#/login'); },
  newStay: async () => openForm({
    title: 'New stay', submit: 'Create', fields: [{ name: 'name', label: 'Name for the home', required: true, placeholder: "Aunty Joy's house" }],
    onSubmit: async (v) => { const r = await api('POST', '/api/stays', v); await loadMe(); closeSheet(); go(`#/s/${r.id}/settings`); toast('Created. Set the dates and address next.'); },
  }),
  day: async (el) => {
    const s = B().stay, d = Number(el.dataset.d);
    const date = d === 0 ? localNow(s.tz).date : addDays(state.dayDate, d);
    try { await loadDay(s.id, date); state.day.stayId = s.id; state.open.clear(); viewToday(new URLSearchParams()); } catch (e) { fail(e); }
  },
  openTask: (el) => {
    const id = Number(el.dataset.id);
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    $('#task-' + id).classList.toggle('open');
  },
  jump: (el) => {
    const id = Number(el.dataset.id), row = $('#task-' + id);
    state.open.add(id); row.classList.add('open', 'hl');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => row.classList.remove('hl'), 1700);
  },
  check: async (el, e) => {
    e.stopPropagation();
    const id = Number(el.dataset.id), t = state.day.tasks.find((x) => x.id === id);
    if (!t.done && state.dayDate > localNow(B().stay.tz).date) return toast(`That's a future day. You can check it off on ${shortDate(state.dayDate)}.`);
    t.done = !t.done;
    t.done_at = t.done ? new Date().toISOString() : null; t.done_by_name = t.done ? state.me.name : null;
    const y = window.scrollY;
    viewToday(new URLSearchParams()); window.scrollTo({ top: y });
    const left = state.day.tasks.filter((x) => !x.done).length;
    if (t.done) toast(left ? `Nice. ${left} to go.` : 'All done for today. Grazie! 🐾');
    try { await api('POST', `/api/stays/${B().stay.id}/complete`, { task_id: id, date: state.dayDate, done: t.done }); }
    catch (err) { t.done = !t.done; fail(err); viewToday(new URLSearchParams()); }
  },
  arrive: async () => {
    const s = B().stay;
    openSheet(s.arrival_title || 'Whenever you arrive', `<ul class="lines" style="font-size:17px">${lines(s.arrival_text).map((l) => `<li>${esc(l)}</li>`).join('') || '<li>Welcome back!</li>'}</ul>`,
      `<span class="grow"></span><button class="btn primary" data-act="closeSheet">${icon('check')} Got it</button>`);
    try { await api('POST', `/api/stays/${s.id}/arrive`); await loadDay(s.id, state.dayDate); state.day.stayId = s.id; const y = window.scrollY; const sh = $('#sheet-root').innerHTML; viewToday(new URLSearchParams()); $('#sheet-root').innerHTML = sh; document.body.style.overflow = 'hidden'; window.scrollTo({ top: y }); } catch (e) { fail(e); }
  },
  formSubmit: () => state.formHandlers && state.formHandlers.submit(),
  formDelete: () => state.formHandlers && state.formHandlers.del && state.formHandlers.del(),
  newTask: (el) => taskForm({}, el.dataset.section ? Number(el.dataset.section) : ''),
  editTask: (el) => taskForm(B().tasks.find((t) => t.id === Number(el.dataset.id))),
  newSection: () => openForm({
    title: 'New section', fields: [{ name: 'title', label: 'Name', required: true, placeholder: 'Fish tank' }, { name: 'kind', label: 'Kind', type: 'select', options: [['dog', 'Dog'], ['cat', 'Cat'], ['plants', 'Plants / garden'], ['house', 'House'], ['other', 'Other']] }, { name: 'notes', label: 'Good to know (one per line)', type: 'textarea' }],
    onSubmit: async (v) => { const r = await api('POST', `/api/stays/${B().stay.id}/sections`, { ...v, sort: B().sections.length + 1 }); await loadBundle(B().stay.id, true); closeSheet(); go(stayUrl('care/' + r.id)); },
  }),
  editSection: (el) => {
    const sec = B().sections.find((x) => x.id === Number(el.dataset.id));
    openForm({
      title: 'Edit section', values: sec,
      fields: [{ name: 'title', label: 'Name', required: true }, { name: 'notes', label: 'Good to know (one per line)', type: 'textarea' }],
      onSubmit: async (v) => { await api('PUT', `/api/stays/${B().stay.id}/sections/${sec.id}`, v); toast('Saved'); await refresh(); },
      onDelete: async () => { await api('DELETE', `/api/stays/${B().stay.id}/sections/${sec.id}`); await loadBundle(B().stay.id, true); closeSheet(); go(stayUrl('care')); },
    });
  },
  newPet: (el) => petForm({ section_id: Number(el.dataset.section) }),
  editPet: (el) => petForm(B().pets.find((p) => p.id === Number(el.dataset.id))),
  newContact: () => contactForm({}),
  editContact: (el) => contactForm(B().contacts.find((c) => c.id === Number(el.dataset.id))),
  newGuide: () => openForm({
    title: 'New guide', submit: 'Next: add steps',
    fields: [{ name: 'title', label: 'Title', required: true, placeholder: 'How to use the washer' }, { name: 'section_id', label: 'Section', type: 'select', options: sectionOpts() }, { name: 'intro', label: 'Intro (optional)', type: 'textarea' }],
    onSubmit: async (v) => { const g = await api('POST', `/api/stays/${B().stay.id}/guides`, v); await loadBundle(B().stay.id, true); closeSheet(); state.draft = null; go(stayUrl(`guide/${g.id}/edit`)); },
  }),
  editGuideInfo: (el) => {
    const g = B().guides.find((x) => x.id === Number(el.dataset.id));
    syncDraft();
    openForm({
      title: 'Guide details', values: g,
      fields: [{ name: 'title', label: 'Title', required: true }, { name: 'section_id', label: 'Section', type: 'select', options: sectionOpts() }, { name: 'intro', label: 'Intro (optional)', type: 'textarea' }],
      onSubmit: async (v) => { await api('PUT', `/api/stays/${B().stay.id}/guides/${g.id}`, v); await loadBundle(B().stay.id, true); closeSheet(); viewGuideEdit(g.id); },
    });
  },
  deleteGuide: async (el) => {
    if (!confirm('Delete this guide?')) return;
    try { await api('DELETE', `/api/stays/${B().stay.id}/guides/${el.dataset.id}`); state.draft = null; await loadBundle(B().stay.id, true); go(stayUrl('guides')); toast('Deleted'); } catch (e) { fail(e); }
  },
  stepAdd: () => { syncDraft(); state.draft.steps.push({ text: '', photo: '', warning: false }); viewGuideEdit(state.draft.id); const all = document.querySelectorAll('#stepsed textarea'); all[all.length - 1].focus(); },
  stepDel: (el) => { syncDraft(); state.draft.steps.splice(Number(el.dataset.i), 1); viewGuideEdit(state.draft.id); },
  stepMove: (el) => { syncDraft(); const i = Number(el.dataset.i), j = i + Number(el.dataset.d), s = state.draft.steps; [s[i], s[j]] = [s[j], s[i]]; viewGuideEdit(state.draft.id); },
  stepNoPhoto: (el) => { syncDraft(); state.draft.steps[Number(el.dataset.i)].photo = ''; viewGuideEdit(state.draft.id); },
  stepsSave: async () => {
    syncDraft();
    const id = state.draft.id;
    try { await api('PUT', `/api/stays/${B().stay.id}/guides/${id}/steps`, { steps: state.draft.steps }); state.draft = null; await loadBundle(B().stay.id, true); toast('Guide saved'); go(stayUrl('guide/' + id)); } catch (e) { fail(e); }
  },
  stepsCancel: () => { state.draft = null; },
  delUpdate: async (el) => { if (!confirm('Delete this update?')) return; try { await api('DELETE', `/api/stays/${B().stay.id}/updates/${el.dataset.id}`); viewUpdates(); } catch (e) { fail(e); } },
  memberAdd: () => openForm({
    title: 'Add a person', submit: 'Add',
    fields: [{ name: 'name', label: 'Name', placeholder: 'Kharis' }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone (optional)', type: 'tel' },
      { name: 'role', label: 'Role', type: 'select', options: [['sitter', 'Sitter: sees everything, checks things off'], ['owner', 'Owner: can also edit and gets the evening report']] },
      { name: 'send_invite', label: 'Email them an invite now', type: 'checkbox', value: true }],
    onSubmit: async (v) => {
      const r = await api('POST', `/api/stays/${B().stay.id}/members`, v);
      await loadBundle(B().stay.id, true);
      openSheet('Added', `<p>${r.sent ? 'We emailed them an invite.' : 'You can text them this sign-in link:'}</p>
        <div class="row"><input class="in" readonly value="${esc(r.link)}" onclick="this.select()"><button class="btn" data-act="copy" data-text="${esc(r.link)}">${icon('copy')}</button></div>
        <p class="small muted">The link signs them in for 30 days. Only share it with them.</p>`, `<span class="grow"></span><button class="btn primary" data-act="closeSheet">Done</button>`);
      viewSettings();
    },
  }),
  memberEdit: (el) => {
    const m = B().members.find((x) => x.id === Number(el.dataset.uid));
    openForm({
      title: m.name || m.email, values: m,
      fields: [{ name: 'name', label: 'Name' }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'role', label: 'Role', type: 'select', options: [['sitter', 'Sitter'], ['owner', 'Owner']] }],
      submit: 'Save',
      onSubmit: async (v) => { await api('PUT', `/api/stays/${B().stay.id}/members/${m.id}`, v); toast('Saved'); await refresh(); },
      onDelete: async () => { await api('DELETE', `/api/stays/${B().stay.id}/members/${m.id}`); toast('Removed'); await refresh(); },
    });
  },
  memberLink: async (el) => {
    try {
      const r = await api('POST', `/api/stays/${B().stay.id}/members/${el.dataset.uid}/link`);
      openSheet('Sign-in link', `<div class="row"><input class="in" readonly value="${esc(r.link)}" onclick="this.select()"><button class="btn" data-act="copy" data-text="${esc(r.link)}">${icon('copy')}</button></div>
        <p class="small muted">Text or email this to them. It signs them in on their phone for 30 days. Only share it with that person.</p>`);
    } catch (e) { fail(e); }
  },
  testEmail: async (el) => { try { await api('POST', `/api/stays/${B().stay.id}/test-email`, { kind: el.dataset.kind }); toast('Sent. Check your inbox.'); } catch (e) { fail(e); } },
  deleteStay: async () => {
    if (prompt(`Type DELETE to remove "${B().stay.name}" for everyone.`) !== 'DELETE') return;
    try { await api('DELETE', `/api/stays/${B().stay.id}`); state.bundle = null; await loadMe(); go('#/'); } catch (e) { fail(e); }
  },
};

const CHANGE = {
  stepPhoto: async (el) => { const f = el.files[0]; if (!f) return; syncDraft(); try { state.draft.steps[Number(el.dataset.i)].photo = await uploadPhoto(f); viewGuideEdit(state.draft.id); } catch (e) { fail(e); } },
  updPhoto: async (el) => {
    const f = el.files[0]; if (!f) return;
    const text = $('#updform').text.value;
    try { state.updPhoto = await uploadPhoto(f); await viewUpdates(); $('#updform').text.value = text; } catch (e) { fail(e); }
  },
  formPhoto: async (el) => {
    const f = el.files[0]; if (!f) return;
    try { const url = await uploadPhoto(f); $('#sheetform').elements[el.dataset.name].value = url; $('[data-photo-preview]').innerHTML = `<img src="${esc(url)}" alt="">`; } catch (e) { fail(e); }
  },
  memberFlag: async (el) => {
    try { await api('PUT', `/api/stays/${B().stay.id}/members/${el.dataset.uid}`, { [el.dataset.f]: el.checked }); const m = B().members.find((x) => x.id === Number(el.dataset.uid)); m[el.dataset.f] = el.checked; toast('Saved'); } catch (e) { el.checked = !el.checked; fail(e); }
  },
};

function petForm(p) {
  const isNew = !p.id;
  openForm({
    title: isNew ? 'Add' : `Edit ${p.name}`, values: p,
    fields: [{ name: 'name', label: 'Name', required: true }, { name: 'section_id', label: 'Section', type: 'select', options: sectionOpts() }, { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Looks like… likes… careful with…' }, { name: 'photo', label: 'Photo', type: 'photo' }],
    onSubmit: async (v) => { if (isNew) await api('POST', `/api/stays/${B().stay.id}/pets`, v); else await api('PUT', `/api/stays/${B().stay.id}/pets/${p.id}`, v); toast('Saved'); await refresh(); },
    onDelete: isNew ? null : async () => { await api('DELETE', `/api/stays/${B().stay.id}/pets/${p.id}`); await refresh(); },
  });
}
function contactForm(c) {
  const isNew = !c.id;
  openForm({
    title: isNew ? 'New contact' : `Edit ${c.name}`, values: c,
    fields: [{ name: 'name', label: 'Name', required: true, placeholder: 'Pool guy, plumber, neighbor…' }, { name: 'role', label: 'Role', placeholder: 'Plumber' },
      { type: 'row', fields: [{ name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' }] },
      { name: 'address', label: 'Address' }, { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'When to call them, what to say' },
      { name: 'emergency', label: 'Emergency contact (shown first and on the Emergency button)', type: 'checkbox' }],
    onSubmit: async (v) => { if (isNew) await api('POST', `/api/stays/${B().stay.id}/contacts`, v); else await api('PUT', `/api/stays/${B().stay.id}/contacts/${c.id}`, v); toast('Saved'); await refresh(); },
    onDelete: isNew ? null : async () => { await api('DELETE', `/api/stays/${B().stay.id}/contacts/${c.id}`); await refresh(); },
  });
}

document.addEventListener('click', (e) => {
  const z = e.target.closest('img[data-zoom]');
  if (z) { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${z.src}" alt="">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); return; }
  const el = e.target.closest('[data-act]');
  if (!el || !A[el.dataset.act]) return;
  if (el.tagName === 'BUTTON' || el.dataset.act === 'openTask') e.preventDefault();
  A[el.dataset.act](el, e);
});
document.addEventListener('change', (e) => { const el = e.target.closest('[data-act-change]'); if (el && CHANGE[el.dataset.actChange]) CHANGE[el.dataset.actChange](el, e); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const lb = $('.lightbox'); if (lb) lb.remove(); else closeSheet(); } });
addEventListener('scroll', () => { const t = $('.topbar'); if (t) t.classList.toggle('scrolled', scrollY > 4); }, { passive: true });
addEventListener('hashchange', render);
// Refresh today when the phone comes back to the app (so checkmarks from others show up).
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.bundle && route().parts[2] === 'today' && !$('.sheet-bg')) {
    try { await loadDay(B().stay.id, state.dayDate); state.day.stayId = B().stay.id; const y = scrollY; viewToday(new URLSearchParams()); scrollTo({ top: y }); } catch (e) {}
  }
});
render();
})();
