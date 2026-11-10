import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configured = Boolean(url && key && !key.startsWith('paste_'));
export const supabase = configured ? createClient(url, key) : null;

const BUCKET = 'homework';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_FILES = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';
const acceptedTypes = new Set(ACCEPTED_FILES.split(','));

/** Random id for file names. crypto.randomUUID is missing on older iPhones/iPads (iOS before 15.4), so fall back. */
export function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Turns technical sign-in errors into something a student understands. */
export function friendlyError(message = '') {
  if (/jwt|expired|invalid claim|refresh token|not authenticated/i.test(message)) return 'Your sign-in has expired. Please refresh the page and sign in again.';
  if (/failed to fetch|network|load failed/i.test(message)) return 'No internet connection. Check your connection and try again.';
  return message;
}

/** Calls our own backend (teacher-only admin actions). */
export async function api(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server. Check your internet connection and try again.');
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(friendlyError(json.error || `Something went wrong (${response.status}).`));
  return json;
}

export function checkFile(file) {
  if (file.size > MAX_FILE_BYTES) return `“${file.name}” is bigger than 10 MB.`;
  if (file.type && !acceptedTypes.has(file.type)) return `“${file.name}” must be a PDF or a photo (JPG, PNG, WEBP, HEIC).`;
  return null;
}

/** Phone photos are often 3–10 MB. Shrink big JPEG/PNG/WEBP photos to ~2000px JPEG so uploads are quick on mobile data. */
export async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.2 * 1024 * 1024 || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // if the browser can't read it, upload the original
  }
}

/** Uploads into the private homework bucket under folder (e.g. "<studentId>/submissions"). Returns the stored path. */
export async function uploadFile(folder, original) {
  const file = await shrinkImage(original);
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
  const path = `${folder}/${newId()}-${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(`Upload failed for “${file.name}”: ${error.message}`);
  return path;
}

export async function signedUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export const fileLabel = (path) => path.split('/').pop().replace(/^[0-9a-f-]{36}-/, '');

/** Unwraps a Supabase query result, throwing its error so useAction can show it. */
export function must({ data, error }) {
  if (error) throw new Error(friendlyError(error.message));
  return data;
}

/** Supabase returns a one-to-one embed as an object, older versions as an array. */
export const firstOf = (value) => (Array.isArray(value) ? value[0] ?? null : value ?? null);
