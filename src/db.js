const { Pool, types } = require('pg');

// Keep DATE columns as plain 'YYYY-MM-DD' strings so time zones never shift them.
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/dolce',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await pool.query(text, params)).rows[0];
const all = async (text, params) => (await pool.query(text, params)).rows;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS login_links (
  token TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS stays (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  pet_names TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  address_notes TEXT NOT NULL DEFAULT '',
  tz TEXT NOT NULL DEFAULT 'Pacific/Honolulu',
  start_date DATE,
  start_time TEXT NOT NULL DEFAULT '12:00',
  end_date DATE,
  end_time TEXT NOT NULL DEFAULT '12:00',
  email_time TEXT NOT NULL DEFAULT '06:30',
  report_time TEXT NOT NULL DEFAULT '20:00',
  arrival_title TEXT NOT NULL DEFAULT 'Whenever you arrive',
  arrival_text TEXT NOT NULL DEFAULT '',
  welcome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  stay_id INT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','sitter')),
  morning_email BOOLEAN NOT NULL DEFAULT true,
  evening_report BOOLEAN NOT NULL DEFAULT false,
  phone TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (stay_id, user_id)
);
CREATE TABLE IF NOT EXISTS sections (
  id SERIAL PRIMARY KEY,
  stay_id INT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'house',
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  sort INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pets (
  id SERIAL PRIMARY KEY,
  stay_id INT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  section_id INT REFERENCES sections(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  sort INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guides (
  id SERIAL PRIMARY KEY,
  stay_id INT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  section_id INT REFERENCES sections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  suggested BOOLEAN NOT NULL DEFAULT false,
  sort INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guide_steps (
  id SERIAL PRIMARY KEY,
  guide_id INT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  warning BOOLEAN NOT NULL DEFAULT false,
  sort INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  stay_id INT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  section_id INT REFERENCES sections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  warning TEXT NOT NULL DEFAULT '',
  time_start TEXT NOT NULL DEFAULT '',
  time_end TEXT NOT NULL DEFAULT '',
  time_label TEXT NOT NULL DEFAULT '',
  every_n INT NOT NULL DEFAULT 1,
  first_day INT NOT NULL DEFAULT 1,
  guide_id INT REFERENCES guides(id) ON DELETE SET NULL,
  optional BOOLEAN NOT NULL DEFAULT false,
  sort INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS completions (
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, day)
);
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  stay_id INT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  emergency BOOLEAN NOT NULL DEFAULT false,
  sort INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS updates (
  id SERIAL PRIMARY KEY,
  stay_id INT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  text TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  day DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_log (
  stay_id INT NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  day DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stay_id, user_id, kind, day)
);
`;

async function migrate() {
  await pool.query(SCHEMA);
}

module.exports = { pool, q, one, all, migrate };
