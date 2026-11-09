import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { IMPORT_PATH, ImportError, importQuestions } from './importQuestions.js';
import { blocked, clientIp, hit } from './rateLimit.js';

// Load backend/.env no matter which folder the server is started from.
// (On Vercel there is no .env file; settings come from Environment Variables instead.)
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

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
  constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

// Request limits per IP address.
const LIMITS = {
  all: { limit: 120, windowMs: 60_000 },             // any API call: 120 a minute
  admin: { limit: 40, windowMs: 60_000 },            // teacher actions: 40 a minute
  badLogin: { limit: 10, windowMs: 10 * 60_000 },    // invalid/expired logins: 10 per 10 minutes
  import: { limit: 6, windowMs: 60 * 60_000 },       // AI PDF imports: 6 an hour
};
let importsRunning = 0;
const MAX_PARALLEL_IMPORTS = 1;

function limit(request, name) {
  const { limit: max, windowMs } = LIMITS[name];
  const wait = hit(`${name}:${clientIp(request)}`, max, windowMs);
  if (wait) throw new HttpError(429, 'Too many requests. Please wait a little and try again.', wait);
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isValidZone = (zone) => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return Boolean(zone); } catch { return false; } };

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new HttpError(400, 'The password must be 8 to 72 characters.');
  return password;
}

/** Reads a small JSON object body. Anything else (too big, not JSON, not an object) is a 400/413. */
function readJson(request, maxBytes = 10_000) {
  return new Promise((resolve, reject) => {
    if (Number(request.headers['content-length']) > maxBytes) { reject(new HttpError(413, 'Request too large.')); return; }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    request.on('data', (chunk) => {
      if (tooBig) return; // keep draining, stop storing
      size += chunk.length;
      if (size > maxBytes) { tooBig = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooBig) { reject(new HttpError(413, 'Request too large.')); return; }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { reject(new HttpError(400, 'Invalid request.')); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { reject(new HttpError(400, 'Invalid request.')); return; }
      resolve(body);
    });
    request.on('error', () => reject(new HttpError(400, 'Invalid request.')));
  });
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

async function requireTeacher(request) {
  if (!admin) throw new HttpError(503, 'The backend has no Supabase keys. Check backend/.env, then restart the backend.');
  const badKey = `badLogin:${clientIp(request)}`;
  const wait = blocked(badKey, LIMITS.badLogin.limit);
  if (wait) throw new HttpError(429, 'Too many failed sign-in attempts. Please wait a few minutes.', wait);
  const header = request.headers.authorization;
  const token = typeof header === 'string' ? header.match(/^Bearer (.+)$/)?.[1] : undefined;
  // Reject obviously fake tokens without asking Supabase (keeps floods cheap).
  if (!token || token.length > 4096 || !JWT_SHAPE.test(token)) {
    hit(badKey, LIMITS.badLogin.limit, LIMITS.badLogin.windowMs);
    throw new HttpError(401, 'Please sign in again.');
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    hit(badKey, LIMITS.badLogin.limit, LIMITS.badLogin.windowMs);
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
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
    if (/already|registered|exists/i.test(error.message)) throw new HttpError(409, 'A login with this email already exists.');
    if (/password/i.test(error.message) && error.message.length < 200 && !error.message.includes('<')) throw new HttpError(400, error.message);
    console.error('createUser failed:', error.message.slice(0, 300));
    throw new HttpError(400, 'Couldn’t create this login. Check the name and email (avoid unusual symbols) and try again.');
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

async function importFromFile(body) {
  const path = text(body.path, 80);
  const subject = text(body.subject, 60);
  if (!IMPORT_PATH.test(path)) throw new HttpError(400, 'Upload the file first.');
  if (!subject) throw new HttpError(400, 'Choose the subject of these questions.');
  if (importsRunning >= MAX_PARALLEL_IMPORTS) throw new HttpError(429, 'Another import is still running. Please wait for it to finish.', 30);
  importsRunning += 1;
  try {
    return await importQuestions({ admin, path, subject, grade: text(body.grade, 60), topicHint: text(body.topicHint, 200) });
  } catch (error) {
    if (error instanceof ImportError) throw new HttpError(error.status, error.message);
    throw error;
  } finally {
    importsRunning -= 1;
  }
}

const routes = [
  { method: 'GET', path: /^\/api\/health$/, handler: async () => ({ status: 'ok', service: 'kulkarni-academy-api', supabase: Boolean(admin), ai_import: Boolean(process.env.ANTHROPIC_API_KEY) }) },
  { method: 'POST', path: /^\/api\/admin\/import-questions$/, handler: async (req) => { await requireTeacher(req); limit(req, 'import'); return importFromFile(await readJson(req)); } },
  { method: 'GET', path: /^\/api\/admin\/logins$/, handler: async (req) => { await requireTeacher(req); return listLogins(); } },
  { method: 'POST', path: /^\/api\/admin\/students$/, handler: async (req) => { await requireTeacher(req); return createStudent(await readJson(req)); }, status: 201 },
  {
    method: 'POST', path: new RegExp(`^/api/admin/students/(${UUID})/password$`),
    handler: async (req, [id]) => {
      await requireTeacher(req);
      const { password } = await readJson(req);
      checkPassword(password);
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'Student not found.');
      await requireStudent(id);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) {
        console.error('updateUserById failed:', error.message.slice(0, 300));
        throw new HttpError(400, /password/i.test(error.message) && !error.message.includes('<') ? error.message.slice(0, 200) : 'Couldn’t change the password. Please try again.');
      }
      return { ok: true };
    },
  },
];

const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  try {
    limit(request, 'all');
    let path;
    try { path = new URL(request.url ?? '/', 'http://localhost').pathname; } catch { throw new HttpError(400, 'Invalid request.'); }
    const pathMatches = routes.filter((r) => r.path.test(path));
    const route = pathMatches.find((r) => r.method === request.method);
    if (!route) throw new HttpError(pathMatches.length ? 405 : 404, pathMatches.length ? 'Method not allowed.' : 'Not found.');
    if (path.startsWith('/api/admin/')) limit(request, 'admin');
    const body = await route.handler(request, path.match(route.path).slice(1));
    response.writeHead(route.status ?? 200);
    response.end(JSON.stringify(body));
  } catch (error) {
    const known = error instanceof HttpError;
    const status = known ? error.status : 500;
    if (!known) console.error(error);
    if (response.headersSent || response.destroyed) return;
    if (known && error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
    if (status === 413) response.setHeader('Connection', 'close');
    response.writeHead(status);
    response.end(JSON.stringify({ error: known ? error.message : 'Something went wrong on the server.' }));
  }
});

// Slow or stuck connections are cut off instead of piling up.
server.headersTimeout = 20_000;
server.requestTimeout = 330_000; // long enough for an AI PDF import
server.keepAliveTimeout = 5_000;
// If the server can't start at all (e.g. the port is already in use), stop with a clear error.
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use: is the backend already running in another terminal?` : error);
  process.exit(1);
});
// Last safety net while running: log unexpected errors instead of letting them stop the server.
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

server.listen(port, '127.0.0.1', () => {
  console.log(`Kulkarni Academy API: http://127.0.0.1:${port}`);
  if (admin) console.log('Connected to Supabase: student logins can be created.');
  else console.warn(`Warning: SUPABASE_URL / SUPABASE_SECRET_KEY are not set (looked in ${envFile}). Student logins can’t be created.`);
});
