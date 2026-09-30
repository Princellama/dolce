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

const UPGRADES = `
ALTER TABLE stays ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stays ADD COLUMN IF NOT EXISTS pin_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE pets ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]';
ALTER TABLE pets ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]';
ALTER TABLE updates ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}';
ALTER TABLE stays ALTER COLUMN report_time SET DEFAULT '21:00';
CREATE TABLE IF NOT EXISTS cal_tokens (token TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, stay_id INT NOT NULL REFERENCES stays(id) ON DELETE CASCADE, UNIQUE (user_id, stay_id));
CREATE TABLE IF NOT EXISTS patches (key TEXT PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;

// One-off data changes for the live site. Each runs once, in order.
const PATCHES = [
  {
    key: '2026-09-29-milli-public-pin',
    sql: `UPDATE stays SET is_public = true,
            pin_hash = 'scrypt$d2a27cc66717cea97cc6268aad03d0e0$1aab09c7fd0aaa084cac8dc837d12147d8f4eedfbba9394f53d9290264bcc2a3'
          WHERE name = 'Milli & Reggie''s' AND pin_hash = ''`,
  },
  {
    key: '2026-09-29-kharis-sitter',
    sql: `DO $$
      DECLARE sid INT; uid INT;
      BEGIN
        SELECT id INTO sid FROM stays WHERE name = 'Milli & Reggie''s' ORDER BY id LIMIT 1;
        IF sid IS NULL THEN RETURN; END IF;
        SELECT id INTO uid FROM users WHERE email = 'kharis1092@icloud.com';
        IF uid IS NULL THEN
          -- If she already signed in with the PIN as "Kharis", give that account her email.
          SELECT u.id INTO uid FROM users u JOIN members m ON m.user_id = u.id
            WHERE m.stay_id = sid AND m.role = 'sitter' AND u.email LIKE '%@pin.invalid' AND lower(split_part(u.name, ' ', 1)) = 'kharis' LIMIT 1;
          IF uid IS NOT NULL THEN
            UPDATE users SET email = 'kharis1092@icloud.com', name = 'Kharis' WHERE id = uid;
          ELSE
            INSERT INTO users (email, name) VALUES ('kharis1092@icloud.com', 'Kharis') RETURNING id INTO uid;
          END IF;
        END IF;
        INSERT INTO members (stay_id, user_id, role, morning_email, evening_report, phone)
          VALUES (sid, uid, 'sitter', true, false, '808-382-3856')
          ON CONFLICT (stay_id, user_id) DO UPDATE SET role = 'sitter', morning_email = true, phone = '808-382-3856';
      END $$`,
  },
  {
    // The evening report is now the safety net for a missed check-out, so it goes out at 9 PM.
    key: '2026-09-29-report-9pm',
    sql: `UPDATE stays SET report_time = '21:00' WHERE report_time = '20:00'`,
  },
  {
    // Items in Care are no longer only pets: move single photos into the photo list.
    key: '2026-09-29-items-photos',
    sql: `UPDATE pets SET photos = jsonb_build_array(photo) WHERE photo <> '' AND photos = '[]'::jsonb`,
  },
  {
    key: '2026-09-29-milli-plant-areas',
    sql: `INSERT INTO pets (stay_id, section_id, name, location, description, sort)
      SELECT s.id, sec.id, v.name, v.location, v.description, v.sort
        FROM stays s JOIN sections sec ON sec.stay_id = s.id AND sec.kind = 'plants'
        CROSS JOIN (VALUES
          ('Hedge plants', 'Along our side', 'Water these first, with the spigot just over a half turn.', 1),
          ('Plants by the door', 'By the front door', 'Water with the hedge plants.', 2),
          ('Flower bed', 'To the left', 'Pull out 7 rings of hose to reach it. About 15 seconds per plant. Bring the hose back so the car tires don''t catch it.', 3),
          ('Plants on our side', 'Our side of the yard', 'Finish here after the flower bed, then turn off the spigots and roll the hose up completely.', 4)
        ) AS v(name, location, description, sort)
       WHERE s.name = 'Milli & Reggie''s'
         AND NOT EXISTS (SELECT 1 FROM pets p WHERE p.section_id = sec.id)`,
  },
  {
    key: '2026-09-29-milli-owner',
    sql: `DO $$
      DECLARE sid INT; uid INT;
      BEGIN
        SELECT id INTO sid FROM stays WHERE name = 'Milli & Reggie''s' ORDER BY id LIMIT 1;
        IF sid IS NULL THEN RETURN; END IF;
        INSERT INTO users (email, name) VALUES ('sosillymilli@gmail.com', 'Milli Lumanta')
          ON CONFLICT (email) DO UPDATE SET name = COALESCE(NULLIF(users.name, ''), 'Milli Lumanta') RETURNING id INTO uid;
        INSERT INTO members (stay_id, user_id, role, morning_email, evening_report, phone)
          VALUES (sid, uid, 'owner', true, true, '808-722-4369')
          ON CONFLICT (stay_id, user_id) DO UPDATE SET role = 'owner', morning_email = true, evening_report = true, phone = '808-722-4369';
      END $$`,
  },
];

async function migrate() {
  await pool.query(SCHEMA);
  await pool.query(UPGRADES);
}

async function runPatches() {
  for (const p of PATCHES) {
    const done = await pool.query('SELECT 1 FROM patches WHERE key=$1', [p.key]);
    if (done.rowCount) continue;
    await pool.query(p.sql);
    await pool.query('INSERT INTO patches (key) VALUES ($1)', [p.key]);
    console.log('patch', p.key);
  }
}

module.exports = { pool, q, one, all, migrate, runPatches };
