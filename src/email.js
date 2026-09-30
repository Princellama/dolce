// Email: Resend over HTTPS, the morning list, the owner's evening report, and sign-in links.
const { all, one, q } = require('./db');
const { localNow, buildDay, fmtDate, fmtTime } = require('./schedule');

const APP_URL = () => (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');
const FROM = () => process.env.MAIL_FROM || 'The Dolce Life <dolce@princellama.com>';
const emailReady = () => !!process.env.RESEND_API_KEY;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function send({ to, subject, html, text, replyTo }) {
  if (!emailReady()) {
    console.log(`[email not configured] to=${to} subject="${subject}"\n${text || ''}`);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM(), to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
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

const firstName = (n) => String(n || '').trim().split(/\s+/)[0];
const realEmail = (e) => e && !String(e).endsWith('@pin.invalid');

// The owner's report for a day. With a check-out, it leads with the sitter's note and photos;
// without one (the 9 PM safety net) it says so plainly.
async function eveningReport(stay, user, date) {
  const { info, tasks } = await buildDay(stay, date);
  const ups = await all(
    `SELECT up.*, u.name, u.email FROM updates up LEFT JOIN users u ON u.id = up.user_id
      WHERE up.stay_id=$1 AND up.day=$2 ORDER BY up.created_at`, [stay.id, date]);
  const arrivals = ups.filter((u) => u.kind === 'arrival');
  const notes = ups.filter((u) => u.kind === 'note');
  const checkout = ups.filter((u) => u.kind === 'checkout').pop();
  const t = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: stay.tz, hour: 'numeric', minute: '2-digit' });
  const done = tasks.filter((x) => x.done), open = tasks.filter((x) => !x.done && !x.optional);
  const reasons = (checkout && checkout.extra && checkout.extra.reasons) || {};
  const who = checkout ? firstName(checkout.name) || 'Your sitter' : '';
  const photos = [
    ...((checkout && checkout.extra && checkout.extra.photos) || []),
    ...notes.filter((n) => n.photo).map((n) => n.photo),
  ];
  const label = (s) => `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6c827d;margin:18px 0 6px">${s}</div>`;
  const body = `
    ${checkout
      ? `<p style="margin:0;font-size:18px"><b>${esc(who)} checked out at ${t(checkout.created_at)}</b></p>`
      : `<p style="margin:0;font-size:18px;color:#93440f"><b>No check-out today</b></p><p style="margin:6px 0 0;color:#6c827d;font-size:14px">This is the automatic ${esc(t(new Date()))} report. Here's what the app shows.</p>`}
    <p style="margin:10px 0 0;font-size:16px"><b>${done.length} of ${tasks.length}</b> things done${arrivals.length ? ` · ${arrivals.length} visit${arrivals.length > 1 ? 's' : ''} (${arrivals.map((a) => t(a.created_at)).join(', ')})` : ' · no check-ins'}</p>
    ${checkout && checkout.text ? `<div style="margin:16px 0 0;padding:14px 16px;background:#f2f6f4;border-radius:12px;border-left:4px solid #1b7a72;white-space:pre-line">${esc(checkout.text)}<div style="font-size:13px;color:#6c827d;margin-top:6px">${esc(who)}</div></div>` : ''}
    ${photos.map((ph) => `<img src="${APP_URL()}${ph}" alt="" style="display:block;margin-top:12px;width:100%;border-radius:12px">`).join('')}
    ${notes.filter((n) => n.text).length ? label('Updates during the day') + notes.filter((n) => n.text).map((n) => `<div style="padding:6px 0"><span style="color:#6c827d;font-size:13px">${t(n.created_at)} · ${esc(firstName(n.name) || 'Sitter')}</span><br>${esc(n.text)}</div>`).join('') : ''}
    ${open.length ? label('Not done') + open.map((x) => `<div style="padding:5px 0">○ <b>${esc(x.title)}</b>${reasons[x.id] ? `<div style="color:#5f5147;font-size:14px;margin-left:18px">${esc(reasons[x.id])}</div>` : ''}</div>`).join('') : ''}
    ${done.length ? label('Done') + done.map((x) => `<div style="padding:4px 0">✅ ${esc(x.title)} <span style="color:#6c827d;font-size:13px">${t(x.done_at)}${x.done_by_name ? ' · ' + esc(firstName(x.done_by_name)) : ''}</span></div>`).join('') : ''}
    <p style="margin-top:22px">${button(`${APP_URL()}/#/s/${stay.id}/updates`, 'Open in The Dolce Life')}</p>
    ${checkout && realEmail(checkout.email) ? `<p style="font-size:13px;color:#6c827d">Reply to this email to answer ${esc(who)} directly.</p>` : ''}`;
  const petName = (stay.pet_names || '').split(',')[0].trim();
  await send({
    to: user.email,
    replyTo: checkout && realEmail(checkout.email) ? checkout.email : undefined,
    subject: checkout
      ? `${who} checked out: ${done.length}/${tasks.length} done${photos.length ? ' 📷' : ''}`
      : `No check-out today${petName ? ` at ${petName}'s` : ''}: ${done.length}/${tasks.length} done`,
    text: `${checkout ? `${who} checked out at ${t(checkout.created_at)}.` : 'No check-out today.'} ${done.length} of ${tasks.length} done.${checkout && checkout.text ? `\n\n${checkout.text}` : ''}\n\n${APP_URL()}/#/s/${stay.id}/updates`,
    html: shell(`${checkout ? 'End of day' : 'Evening report'} · ${info.index ? `Day ${info.index} of ${info.total}` : fmtDate(date)}`, body),
  });
}

// Who gets the owner's report: owners with the evening report on and a real email.
async function reportRecipients(stayId) {
  return (await all(
    `SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.stay_id=$1 AND m.role='owner' AND m.evening_report`, [stayId],
  )).filter((u) => realEmail(u.email));
}

// Sent the moment a sitter checks out. Marks the day's report as sent so the 9 PM one is skipped.
async function sendCheckout(stay, date) {
  const people = await reportRecipients(stay.id);
  const sent = [];
  for (const u of people) {
    await q(`INSERT INTO email_log (stay_id,user_id,kind,day) VALUES ($1,$2,'report',$3) ON CONFLICT DO NOTHING`, [stay.id, u.id, date]);
    if (!emailReady()) continue;
    try { await eveningReport(stay, u, date); sent.push(firstName(u.name) || u.email); } catch (e) { console.error('checkout email', u.email, e.message); }
  }
  return sent;
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

module.exports = { send, emailReady, loginEmail, inviteEmail, morningEmail, eveningReport, sendCheckout, reportRecipients, startScheduler, APP_URL };
