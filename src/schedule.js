// Dates, times and "what's due today" — shared by the API and the emails.
const { all } = require('./db');

function localNow(tz, d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const dayNum = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / 86400000);
const addDays = (s, n) => new Date((dayNum(s) + n) * 86400000).toISOString().slice(0, 10);

function fmtTime(t) {
  if (!t) return '';
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
}

function timeText(t) {
  if (t.time_label) return t.time_label;
  if (t.time_start && t.time_end) {
    const a = fmtTime(t.time_start), b = fmtTime(t.time_end);
    return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
  }
  if (t.time_start) return fmtTime(t.time_start);
  return 'Anytime';
}

function fmtDate(s, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

function dayInfo(stay, date) {
  if (!stay.start_date || !stay.end_date) return { date, index: null, total: null, inStay: true };
  const index = dayNum(date) - dayNum(stay.start_date) + 1;
  const total = dayNum(stay.end_date) - dayNum(stay.start_date) + 1;
  return {
    date, index, total,
    inStay: index >= 1 && index <= total,
    isFirst: index === 1,
    isLast: index === total,
    before: index < 1,
    after: index > total,
  };
}

function isDue(task, stay, info) {
  const idx = info.index == null ? 1 : info.index;
  const n = Math.max(1, task.every_n || 1);
  if (n > 1) {
    const first = task.first_day || 1;
    if (idx < first || (idx - first) % n !== 0) return false;
  }
  // First day: skip anything that is over before the sitter takes over.
  if (info.isFirst && task.time_start) {
    const ends = task.time_end || task.time_start;
    if (ends <= stay.start_time) return false;
  }
  // Last day: skip anything that starts after the owners are home.
  if (info.isLast && task.time_start && task.time_start >= stay.end_time) return false;
  return true;
}

function partOfDay(t) {
  if (!t.time_start) return 'anytime';
  if (t.time_start < '12:00') return 'morning';
  if (t.time_start < '17:00') return 'afternoon';
  return 'evening';
}

function nextDueDay(task, stay, fromInfo) {
  if (fromInfo.index == null || (task.every_n || 1) <= 1) return null;
  for (let i = Math.max(1, fromInfo.index + 1); i <= fromInfo.total; i++) {
    if (isDue(task, stay, { ...fromInfo, index: i, isFirst: i === 1, isLast: i === fromInfo.total })) {
      return addDays(stay.start_date, i - 1);
    }
  }
  return null;
}

async function buildDay(stay, date) {
  const info = dayInfo(stay, date);
  const tasks = await all(
    `SELECT t.*, s.title AS section_title, s.kind AS section_kind, g.title AS guide_title,
            c.done_at, c.user_id AS done_by, u.name AS done_by_name
       FROM tasks t
       LEFT JOIN sections s ON s.id = t.section_id
       LEFT JOIN guides g ON g.id = t.guide_id
       LEFT JOIN completions c ON c.task_id = t.id AND c.day = $2
       LEFT JOIN users u ON u.id = c.user_id
      WHERE t.stay_id = $1
      ORDER BY (t.time_start = ''), t.time_start, t.sort, t.id`,
    [stay.id, date],
  );
  const due = tasks
    .filter((t) => isDue(t, stay, info))
    .map((t) => ({ ...t, part: partOfDay(t), when: timeText(t), done: !!t.done_at, recurring: t.every_n > 1 }));
  return { info, tasks: due };
}

module.exports = { localNow, addDays, dayNum, fmtTime, fmtDate, timeText, dayInfo, isDue, partOfDay, nextDueDay, buildDay };
