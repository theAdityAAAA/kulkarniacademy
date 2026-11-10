// Finds and removes files in Supabase Storage that no database row points to any more
// (e.g. after homework, a test or a student is deleted). Database rows and storage files are
// separate systems in Supabase, so deleting a row never deletes its file by itself.
//
// Safety rules:
//   • A file is only removed if NO table references it.
//   • Files younger than `minAgeHours` (default 24) are never touched, so uploads in progress
//     (a student photographing an answer, a form not saved yet) are safe.
//   • `dryRun` reports what would be removed without removing anything.

const BUCKETS = ['homework', 'question-images', 'question-imports'];
const PAGE = 1000;

async function listAll(admin, bucket, prefix = '', out = []) {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Could not list ${bucket}: ${error.message}`);
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) await listAll(admin, bucket, path, out); // a folder
      else out.push({ bucket, path, size: item.metadata?.size ?? 0, created: item.created_at ?? item.updated_at });
    }
    if (data.length < PAGE) return out;
  }
}

async function referencedPaths(admin) {
  const refs = { homework: new Set(), 'question-images': new Set(), 'question-imports': new Set() };
  const pageThrough = async (table, columns, each) => {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from(table).select(columns).range(from, from + PAGE - 1);
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return; // feature not set up yet
        throw new Error(`Could not read ${table}: ${error.message}`);
      }
      data.forEach(each);
      if (data.length < PAGE) return;
    }
  };
  await pageThrough('homework', 'attachment_path', (r) => r.attachment_path && refs.homework.add(r.attachment_path));
  await pageThrough('submissions', 'file_paths', (r) => (r.file_paths ?? []).forEach((p) => refs.homework.add(p)));
  await pageThrough('attempt_answers', 'given_files', (r) => (r.given_files ?? []).forEach((p) => refs.homework.add(p)));
  await pageThrough('questions', 'image_path', (r) => r.image_path && refs['question-images'].add(r.image_path));
  return refs;
}

// `onlyMatching` (tests only, not reachable from the website) limits removal to file paths containing that text.
export async function cleanupStorage(admin, { dryRun = true, minAgeHours = 24, onlyMatching = null } = {}) {
  const [files, refs] = await Promise.all([
    Promise.all(BUCKETS.map((b) => listAll(admin, b).catch((e) => (/not found/i.test(e.message) ? [] : Promise.reject(e))))).then((l) => l.flat()),
    referencedPaths(admin),
  ]);
  const cutoff = Date.now() - minAgeHours * 3600000;
  // Uploaded PDFs are normally deleted right after import; anything left there over an hour is stale.
  const importCutoff = Date.now() - Math.min(minAgeHours, 1) * 3600000;
  const orphans = files.filter((f) => !refs[f.bucket].has(f.path)
    && new Date(f.created ?? 0).getTime() < (f.bucket === 'question-imports' ? importCutoff : cutoff)
    && (!onlyMatching || f.path.includes(onlyMatching)));

  let removed = 0;
  if (!dryRun) {
    for (const bucket of BUCKETS) {
      const paths = orphans.filter((f) => f.bucket === bucket).map((f) => f.path);
      for (let i = 0; i < paths.length; i += 100) {
        const { data, error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) throw new Error(`Could not delete from ${bucket}: ${error.message}`);
        removed += data?.length ?? 0;
      }
    }
  }
  const bytes = orphans.reduce((s, f) => s + Number(f.size || 0), 0);
  return {
    dryRun,
    totalFiles: files.length,
    totalBytes: files.reduce((s, f) => s + Number(f.size || 0), 0),
    unusedFiles: orphans.length,
    unusedBytes: bytes,
    removed,
    byBucket: Object.fromEntries(BUCKETS.map((b) => [b, orphans.filter((f) => f.bucket === b).length])),
  };
}
