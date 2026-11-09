# Backend

A small Node 22+ server for the student portal. Run `npm install` once, then `npm run dev`
(or `npm.cmd run dev` in Windows PowerShell). It listens on port 3001.

Most portal data goes straight from the browser to Supabase and is protected by the row level
security rules in `../supabase/setup.sql`. This server only handles actions that need the
Supabase **secret key**, and each one checks that the caller is signed in as the teacher:

| Route | What it does |
| --- | --- |
| `GET /api/health` | Health check (also reports whether Supabase is configured) |
| `GET /api/admin/logins` | Student login emails and last sign-in times |
| `POST /api/admin/students` | Create a student login and profile |
| `POST /api/admin/students/:id/password` | Set a new password for a student |

Settings come from `backend/.env` locally (copy `.env.example`) and from Vercel's environment
variables in production: `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Never put the secret key in
the frontend or commit it.
