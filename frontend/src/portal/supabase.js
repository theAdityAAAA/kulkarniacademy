import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configured = Boolean(url && key && !key.startsWith('paste_'));
export const supabase = configured ? createClient(url, key) : null;

const BUCKET = 'homework';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_FILES = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';
const acceptedTypes = new Set(ACCEPTED_FILES.split(','));

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
    throw new Error('Could not reach the server. Is the backend running?');
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Something went wrong (${response.status}).`);
  return json;
}

export function checkFile(file) {
  if (file.size > MAX_FILE_BYTES) return `“${file.name}” is bigger than 10 MB.`;
  if (file.type && !acceptedTypes.has(file.type)) return `“${file.name}” must be a PDF or a photo (JPG, PNG, WEBP, HEIC).`;
  return null;
}

/** Uploads into the private homework bucket under folder (e.g. "<studentId>/submissions"). Returns the stored path. */
export async function uploadFile(folder, file) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
  const path = `${folder}/${crypto.randomUUID()}-${safeName}`;
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
  if (error) throw new Error(error.message);
  return data;
}

/** Supabase returns a one-to-one embed as an object, older versions as an array. */
export const firstOf = (value) => (Array.isArray(value) ? value[0] ?? null : value ?? null);
