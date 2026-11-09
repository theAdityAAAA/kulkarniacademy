// Small in-memory rate limiter (per IP address).
// On Vercel each running copy of the backend keeps its own counts, so this is a first line of
// defence against floods and password-guessing, not a hard global limit.

const buckets = new Map(); // key → { count, resetAt }
const MAX_KEYS = 20_000;

/** Counts one hit for key. Returns 0 if allowed, otherwise the seconds to wait. */
export function hit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) prune(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > limit ? Math.ceil((bucket.resetAt - now) / 1000) : 0;
}

/** Seconds to wait if key is already over limit (without counting a new hit), else 0. */
export function blocked(key, limit) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= Date.now()) return 0;
  return bucket.count >= limit ? Math.ceil((bucket.resetAt - Date.now()) / 1000) : 0;
}

function prune(now) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  if (buckets.size >= MAX_KEYS) buckets.clear(); // under a huge spread-out flood, start fresh rather than grow forever
}

/** The caller's IP. Vercel puts the real client IP first in x-forwarded-for; locally use the socket. */
export function clientIp(request) {
  if (process.env.VERCEL) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
    if (typeof request.headers['x-real-ip'] === 'string') return request.headers['x-real-ip'];
  }
  return request.socket.remoteAddress ?? 'unknown';
}
