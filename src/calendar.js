// Calendar feed (.ics) for a stay: each timed to-do as an event with a 10-minute reminder,
// plus one all-day event per day listing the "anytime" and "due today" to-dos.
const { all } = require('./db');
const { dayInfo, isDue, addDays, timeText } = require('./schedule');

const EMOJI = { dog: '🐶', cat: '🐱', plants: '🌿', house: '🏠' };

function zonedToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (asTz - guess));
}
const stamp = (dt) => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = []; let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

async function buildIcs(stay, appUrl) {
  const tasks = await all(
    `SELECT t.*, s.kind AS section_kind, s.title AS section_title FROM tasks t LEFT JOIN sections s ON s.id=t.section_id
      WHERE t.stay_id=$1 ORDER BY (t.time_start=''), t.time_start, t.sort, t.id`, [stay.id]);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Dolce Life//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(stay.pet_names ? stay.pet_names.split(',')[0].trim() + ' · ' + stay.name : stay.name)}`,
    `X-WR-TIMEZONE:${stay.tz}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT4H', 'X-PUBLISHED-TTL:PT4H'];
  const now = stamp(new Date());
  if (!stay.start_date || !stay.end_date) { lines.push('END:VCALENDAR'); return lines.map(fold).join('\r\n') + '\r\n'; }
  const link = `${appUrl}/#/s/${stay.id}/today`;
  for (let date = stay.start_date; date <= stay.end_date; date = addDays(date, 1)) {
    const info = dayInfo(stay, date);
    const due = tasks.filter((t) => isDue(t, stay, info));
    const loose = [];
    for (const t of due) {
      const tag = `${EMOJI[t.section_kind] || '🐾'} `;
      if (!t.time_start) { loose.push(t); continue; }
      const start = zonedToUtc(date, t.time_start, stay.tz);
      const end = t.time_end && t.time_end > t.time_start ? zonedToUtc(date, t.time_end, stay.tz) : new Date(start.getTime() + 30 * 60000);
      const desc = [t.warning ? `⚠ ${t.warning}` : '', t.details, `Open today: ${link}`].filter(Boolean).join('\n\n');
      lines.push('BEGIN:VEVENT', `UID:task-${t.id}-${date}@dolce`, `DTSTAMP:${now}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
        `SUMMARY:${esc(tag + t.title + (t.time_label ? ` (${t.time_label})` : ''))}`, `DESCRIPTION:${esc(desc)}`, `URL:${link}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.title)}`, 'TRIGGER:-PT10M', 'END:VALARM', 'END:VEVENT');
    }
    if (loose.length) {
      const d = date.replace(/-/g, ''), next = addDays(date, 1).replace(/-/g, '');
      const recurring = loose.filter((t) => t.every_n > 1);
      const title = recurring.length ? `🐾 Also today: ${recurring.map((t) => t.title).join(', ')}` : `🐾 Anytime today (${loose.length})`;
      const desc = loose.map((t) => `• ${t.title}${t.every_n > 1 ? ' (not every day)' : ''}`).join('\n') + `\n\nOpen today: ${link}`;
      lines.push('BEGIN:VEVENT', `UID:day-${stay.id}-${date}@dolce`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
        `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs, zonedToUtc };
