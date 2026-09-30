// Email: Resend over HTTPS, the morning list, the owner's evening report, and sign-in links.
const { all, one, q } = require('./db');
const { localNow, buildDay, fmtDate, fmtTime } = require('./schedule');

const APP_URL = () => (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');
const FROM = () => process.env.MAIL_FROM || 'The Dolce Life <dolce@princellama.com>';
const emailReady = () => !!process.env.RESEND_API_KEY;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function send({ to, subject, html, text }) {
  if (!emailReady()) {
    console.log(`[email not configured] to=${to} subject="${subject}"\n${text || ''}`);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM(), to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${await res.text()}`);
  return res.json();
}

function shell(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#f2f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#15302c">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="font-family:Georgia,serif;font-size:22px;color:#1b7a72;margin-bottom:4px">The Dolce Life</div>
  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6c827d;margin-bottom:20px">${esc(title)}</div>
  <div style="background:#ffffff;border-radius:14px;padding:20px;border:1px solid #dbe6e1">${body}</div>
  <div style="font-size:12px;color:#6c827d;margin-top:16px">You get this because you're part of a stay on The Dolce Life. The owner can turn these emails off in Settings.</div>
</div></body></html>`;
}

const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:#1b7a72;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">${esc(label)}</a>`;

async function loginEmail(user, token) {
  const link = `${APP_URL()}/l/${token}`;
  await send({
    to: user.email,
    subject: 'Your sign-in link for The Dolce Life',
    text: `Tap to sign in: ${link}\nThis link works for 30 days.`,
    html: shell('Sign in', `<p style="margin-top:0">Hi${user.name ? ' ' + esc(user.name.split(' ')[0]) : ''}, tap below to sign in.</p>
      <p>${button(link, 'Open The Dolce Life')}</p><p style="font-size:13px;color:#6c827d">This link works for 30 days on this device.</p>`),
  });
  return link;
}

async function inviteEmail(user, stay, role, token, inviter) {
  const link = `${APP_URL()}/l/${token}`;
  const what = role === 'owner' ? `help manage the stay "${stay.name}"` : `look after ${stay.pet_names || 'the house'} at "${stay.name}"`;
  await send({
    to: user.email,
    subject: `${inviter || 'Someone'} invited you to ${stay.name}`,
    text: `${inviter || 'Someone'} invited you to ${what} on The Dolce Life.\nOpen it: ${link}`,
    html: shell("You're invited", `<p style="margin-top:0">${esc(inviter || 'Someone')} invited you to ${esc(what)}.</p>
      <p>Everything you need is in one place: today's to-dos, the pets, the house guides and who to call.</p>
      <p>${button(link, 'Open the stay')}</p>`),
  });
  return link;
}

function taskRows(tasks) {
  const groups = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening'], ['anytime', 'Anytime']];
  return groups.map(([k, label]) => {
    const list = tasks.filter((t) => t.part === k);
    if (!list.length) return '';
    return `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6c827d;margin:16px 0 6px">${label}</div>` +
      list.map((t) => `<div style="padding:8px 0;border-top:1px solid #e4ede9">
        <div style="font-weight:600">${t.done ? '✅ ' : ''}${esc(t.title)}${t.recurring ? ' <span style="font-size:11px;color:#1b7a72;border:1px solid #a9d8d1;border-radius:6px;padding:1px 5px">today</span>' : ''}</div>
        <div style="font-size:13px;color:#6c827d">${esc(t.when)}${t.section_title ? ' · ' + esc(t.section_title) : ''}</div>
        ${t.warning ? `<div style="font-size:13px;color:#93440f;margin-top:4px">⚠ ${esc(t.warning)}</div>` : ''}
      </div>`).join('');
  }).join('');
}

async function morningEmail(stay, user, date, role) {
  const { info, tasks } = await buildDay(stay, date);
  const dayLine = info.index ? `Day ${info.index} of ${info.total} · ${fmtDate(date)}` : fmtDate(date);
  const first = user.name ? esc(user.name.split(' ')[0]) : 'there';
  const lead = role === 'owner'
    ? `Here's what's on the list at home today.`
    : info.isLast ? `Last day! Here's the morning, and the owners are home around ${fmtTime(stay.end_time)}.`
    : `Here's today at ${esc(stay.name)}. ${tasks.length} things on the list.`;
  const link = `${APP_URL()}/#/s/${stay.id}/today`;
  const text = `${dayLine}\n${tasks.map((t) => `- ${t.when}: ${t.title}`).join('\n')}\nOpen: ${link}`;
  await send({
    to: user.email,
    subject: `${stay.pet_names ? stay.pet_names.split(',')[0].trim() + "'s day" : 'Today'} · ${fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}`,
    text,
    html: shell(dayLine, `<p style="margin-top:0">Good morning, ${first}! ${lead}</p>${taskRows(tasks)}
      <p style="margin-top:20px">${button(link, 'Open today')}</p>`),
  });
}

async function eveningReport(stay, user, date) {
  const { info, tasks } = await buildDay(stay, date);
  const arrivals = await all(
    `SELECT up.created_at, u.name FROM updates up LEFT JOIN users u ON u.id = up.user_id
      WHERE up.stay_id=$1 AND up.day=$2 AND up.kind='arrival' ORDER BY up.created_at`, [stay.id, date]);
  const notes = await all(
    `SELECT up.*, u.name FROM updates up LEFT JOIN users u ON u.id = up.user_id
      WHERE up.stay_id=$1 AND up.day=$2 AND up.kind='note' ORDER BY up.created_at`, [stay.id, date]);
  const t = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: stay.tz, hour: 'numeric', minute: '2-digit' });
  const done = tasks.filter((x) => x.done), open = tasks.filter((x) => !x.done && !x.optional);
  const body = `
    <p style="margin-top:0;font-size:17px"><b>${done.length} of ${tasks.length}</b> things done today.</p>
    ${arrivals.length ? `<p>🏠 Visits: ${arrivals.map((a) => `${t(a.created_at)}${a.name ? ' (' + esc(a.name.split(' ')[0]) + ')' : ''}`).join(', ')}</p>` : '<p>🏠 No visits checked in today.</p>'}
    ${notes.map((n) => `<div style="padding:10px 0;border-top:1px solid #e4ede9">
      <div style="font-size:13px;color:#6c827d">${esc(n.name ? n.name.split(' ')[0] : 'Sitter')} · ${t(n.created_at)}</div>
      ${n.text ? `<div style="margin-top:4px">${esc(n.text)}</div>` : ''}
      ${n.photo ? `<img src="${APP_URL()}${n.photo}" alt="" style="margin-top:8px;max-width:100%;border-radius:10px">` : ''}
    </div>`).join('')}
    ${done.length ? `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6c827d;margin:16px 0 6px">Done</div>
      ${done.map((x) => `<div style="padding:4px 0">✅ ${esc(x.title)} <span style="color:#6c827d;font-size:13px">${t(x.done_at)}</span></div>`).join('')}` : ''}
    ${open.length ? `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6c827d;margin:16px 0 6px">Not checked off</div>
      ${open.map((x) => `<div style="padding:4px 0">○ ${esc(x.title)}</div>`).join('')}` : ''}
    <p style="margin-top:20px">${button(`${APP_URL()}/#/s/${stay.id}/updates`, 'See updates')}</p>`;
  await send({
    to: user.email,
    subject: `Today at home: ${done.length}/${tasks.length} done${notes.some((n) => n.photo) ? ' 📷' : ''}`,
    text: `${done.length} of ${tasks.length} done. Visits: ${arrivals.length}. Notes: ${notes.map((n) => n.text).join(' | ')}`,
    html: shell(`Evening report · ${info.index ? `Day ${info.index} of ${info.total}` : fmtDate(date)}`, body),
  });
}

// Runs every minute. Sends each email once per person per day, within 3 hours of its set time.
function withinWindow(now, at) {
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const d = toMin(now) - toMin(at);
  return d >= 0 && d < 180;
}

async function tick() {
  if (!emailReady()) return;
  const stays = await all('SELECT * FROM stays WHERE start_date IS NOT NULL AND end_date IS NOT NULL');
  for (const stay of stays) {
    const now = localNow(stay.tz);
    if (now.date < stay.start_date || now.date > stay.end_date) continue;
    const members = await all(
      `SELECT u.*, m.role, m.morning_email, m.evening_report FROM members m JOIN users u ON u.id=m.user_id WHERE m.stay_id=$1`, [stay.id]);
    for (const m of members) {
      if (m.email.endsWith('@pin.invalid')) continue;
      const jobs = [];
      // No morning email on the first day if the sitter only starts in the afternoon.
      const morningToday = !(now.date === stay.start_date && stay.start_time > '10:00');
      if (m.morning_email && morningToday && withinWindow(now.time, stay.email_time)) jobs.push(['morning', () => morningEmail(stay, m, now.date, m.role)]);
      if (m.evening_report && !(now.date === stay.end_date) && withinWindow(now.time, stay.report_time)) jobs.push(['report', () => eveningReport(stay, m, now.date)]);
      for (const [kind, fn] of jobs) {
        const claimed = await q(
          `INSERT INTO email_log (stay_id,user_id,kind,day) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING 1`,
          [stay.id, m.id, kind, now.date]);
        if (!claimed.rowCount) continue;
        try { await fn(); } catch (e) {
          console.error('email', kind, m.email, e.message);
          await q('DELETE FROM email_log WHERE stay_id=$1 AND user_id=$2 AND kind=$3 AND day=$4', [stay.id, m.id, kind, now.date]);
        }
      }
    }
  }
}

function startScheduler() {
  setInterval(() => tick().catch((e) => console.error('scheduler', e)), 60 * 1000);
  setTimeout(() => tick().catch((e) => console.error('scheduler', e)), 5000);
}

module.exports = { send, emailReady, loginEmail, inviteEmail, morningEmail, eveningReport, startScheduler, APP_URL };
