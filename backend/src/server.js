import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';

// Kulkarni Academy API.
// Everything students and the teacher read or write goes straight to Supabase from the
// browser, protected by row level security. This server only does the few things that
// need the SECRET key: creating student logins, resetting passwords and listing logins.
// Every /api/admin route checks that the caller is signed in as the teacher.

const port = Number(process.env.PORT) || 3001;
const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const admin = supabaseUrl && secretKey && !secretKey.startsWith('paste_')
  ? createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isValidZone = (zone) => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return Boolean(zone); } catch { return false; } };

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new HttpError(400, 'The password must be 8 to 72 characters.');
  return password;
}

function readJson(request, limit = 10_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large.')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'Invalid request.')); }
    });
    request.on('error', reject);
  });
}

async function requireTeacher(request) {
  if (!admin) throw new HttpError(503, 'The server is missing SUPABASE_URL or SUPABASE_SECRET_KEY.');
  const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Please sign in again.');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  const { data: profile } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (profile?.role !== 'teacher') throw new HttpError(403, 'Only the teacher can do this.');
  return data.user;
}

async function requireStudent(id) {
  const { data: profile } = await admin.from('profiles').select('role').eq('id', id).maybeSingle();
  if (profile?.role !== 'student') throw new HttpError(404, 'Student not found.');
}

async function createStudent(body) {
  const fullName = text(body.fullName, 80);
  const email = text(body.email, 254).toLowerCase();
  const password = checkPassword(body.password);
  const timezone = text(body.timezone, 64);
  if (!fullName) throw new HttpError(400, 'Enter the student’s name.');
  if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!isValidZone(timezone)) throw new HttpError(400, 'Choose a valid time zone.');

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) {
    const exists = /already|registered|exists/i.test(error.message);
    throw new HttpError(exists ? 409 : 400, exists ? 'A login with this email already exists.' : error.message);
  }
  const { error: profileError } = await admin.from('profiles').insert({
    id: data.user.id, full_name: fullName, role: 'student', timezone,
    grade: text(body.grade, 60) || null, board: text(body.board, 100) || null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id); // don't leave a login without a profile
    throw new HttpError(500, 'Couldn’t save the student. Please try again.');
  }
  return { id: data.user.id };
}

async function listLogins() {
  const { data: students, error } = await admin.from('profiles').select('id').eq('role', 'student');
  if (error) throw new HttpError(500, error.message);
  const ids = new Set(students.map((s) => s.id));
  const logins = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) throw new HttpError(500, listError.message);
    for (const user of data.users) if (ids.has(user.id)) logins.push({ id: user.id, email: user.email, last_sign_in_at: user.last_sign_in_at ?? null });
    if (data.users.length < 200) break;
  }
  return { logins };
}

const routes = [
  { method: 'GET', path: /^\/api\/health$/, handler: async () => ({ status: 'ok', service: 'kulkarni-academy-api', supabase: Boolean(admin) }) },
  { method: 'GET', path: /^\/api\/admin\/logins$/, handler: async (req) => { await requireTeacher(req); return listLogins(); } },
  { method: 'POST', path: /^\/api\/admin\/students$/, handler: async (req) => { await requireTeacher(req); return createStudent(await readJson(req)); }, status: 201 },
  {
    method: 'POST', path: new RegExp(`^/api/admin/students/(${UUID})/password$`),
    handler: async (req, [id]) => {
      await requireTeacher(req);
      const { password } = await readJson(req);
      checkPassword(password);
      await requireStudent(id);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) throw new HttpError(400, error.message);
      return { ok: true };
    },
  },
];

const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  const path = new URL(request.url, 'http://localhost').pathname;
  const pathMatches = routes.filter((r) => r.path.test(path));
  const route = pathMatches.find((r) => r.method === request.method);
  try {
    if (!route) throw new HttpError(pathMatches.length ? 405 : 404, pathMatches.length ? 'Method not allowed.' : 'Not found.');
    const body = await route.handler(request, path.match(route.path).slice(1));
    response.writeHead(route.status ?? 200);
    response.end(JSON.stringify(body));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    response.writeHead(status);
    response.end(JSON.stringify({ error: status === 500 && !(error instanceof HttpError) ? 'Something went wrong on the server.' : error.message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Kulkarni Academy API: http://127.0.0.1:${port}`);
  if (!admin) console.warn('Warning: SUPABASE_URL / SUPABASE_SECRET_KEY are not set. Student logins can’t be created.');
});
