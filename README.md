# The Dolce Life

A house-sitting companion: today's to-dos, pets, plants, house guides with photos, contacts, updates, morning emails for sitters and an evening report for owners.

Node + Express + Postgres. No build step.

## Environment

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `APP_URL` | e.g. `https://dolce.princellama.com` (used in email links) |
| `ADMIN_EMAILS` | comma-separated; admins see every stay |
| `SETUP_KEY` | long random string; `/setup/<key>` signs the first admin in before email works |
| `UPLOAD_DIR` | where photos are stored, e.g. `/data/uploads` on a Railway volume |
| `RESEND_API_KEY` | turns on email (Resend) |
| `MAIL_FROM` | e.g. `The Dolce Life <dolce@princellama.com>` |
| `NODE_ENV` | `production` for secure cookies |

On first start with an empty database, Milli & Reggie's stay is loaded (`src/seed.js`).
