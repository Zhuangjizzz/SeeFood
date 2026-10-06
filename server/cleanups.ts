import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { reject, validate } from './contract.ts';
import type { Json } from './contract.ts';
interface Options { database: DatabaseSync; imageDirectory: string; transaction: <T>(operation: () => T) => T; }
/** User deletion fences the context before any asynchronous resource removal. */
export function createCleanupService({ database, imageDirectory, transaction }: Options) {
  database.exec(`CREATE TABLE IF NOT EXISTS cleanups (id TEXT PRIMARY KEY, owner TEXT NOT NULL, context_id TEXT NOT NULL UNIQUE REFERENCES contexts(id), response TEXT NOT NULL);`);
  function getCleanup(id: string, owner: string) {
    const row = database.prepare('SELECT * FROM cleanups WHERE id=?').get(id);
    if (!row) return reject(404, 'NOT_FOUND');
    if (row.owner !== owner) return reject(403, 'FORBIDDEN');
    return JSON.parse(String(row.response));
  }
  function deleteContext(id: string, owner: string) {
    return transaction(() => {
      const context = database.prepare('SELECT * FROM contexts WHERE id=?').get(id);
      if (!context) return reject(404, 'NOT_FOUND');
      if (context.owner !== owner) return reject(403, 'FORBIDDEN');
      const old = database.prepare('SELECT * FROM cleanups WHERE context_id=?').get(id);
      if (old) {
        const result = JSON.parse(String(old.response));
        if (result.state === 'failed') { result.state = 'queued'; result.error = null; database.prepare('UPDATE cleanups SET response=? WHERE id=?').run(JSON.stringify(result), old.id); }
        return result;
      }
      database.prepare('UPDATE contexts SET deleted=1 WHERE id=?').run(id);
      const result = { cleanupId: randomUUID(), contextId: id, state: 'queued', error: null };
      validate('Cleanup', result);
      database.prepare('INSERT INTO cleanups VALUES (?,?,?,?)').run(result.cleanupId, owner, id, JSON.stringify(result));
      for (const row of database.prepare('SELECT id,response FROM jobs WHERE context_id=?').all(id)) {
        const job = JSON.parse(String(row.response));
        if (['queued', 'running'].includes(job.state)) {
          job.state = 'cancelled'; job.revision += 1; job.output = null; job.error = null;
          database.prepare('UPDATE jobs SET response=? WHERE id=?').run(JSON.stringify(job), row.id);
        }
      }
      return result;
    });
  }
  function work() {
    for (const row of database.prepare('SELECT * FROM cleanups').all()) {
      const result: Json = JSON.parse(String(row.response));
      if (!['queued', 'running'].includes(result.state)) continue;
      result.state = 'running'; database.prepare('UPDATE cleanups SET response=? WHERE id=?').run(JSON.stringify(result), row.id);
      try {
        const paths = new Set(database.prepare('SELECT path FROM assets WHERE context_id=?').all(row.context_id).map((item) => String(item.path)));
        for (const upload of database.prepare('SELECT id FROM uploads WHERE context_id=?').all(row.context_id)) paths.add(resolve(imageDirectory, `${upload.id}.image`));
        for (const artifact of database.prepare('SELECT path FROM image_artifacts WHERE context_id=?').all(row.context_id)) paths.add(String(artifact.path));
        for (const path of paths) { try { unlinkSync(path); } catch (error: any) { if (error.code !== 'ENOENT') throw error; } }
        transaction(() => {
          for (const table of ['image_artifacts', 'jobs', 'assets', 'uploads', 'snapshots']) database.prepare(`DELETE FROM ${table} WHERE context_id=?`).run(row.context_id);
          // Idempotency responses can contain full generated content. Keep only the
          // owner-bound context tombstone and cleanup identity after explicit deletion.
          for (const saved of database.prepare('SELECT * FROM idempotency WHERE owner=?').all(row.owner)) {
            const request = JSON.parse(String(saved.body)); const response = JSON.parse(String(saved.response));
            if (request.contextId === row.context_id || response.contextId === row.context_id || saved.path === `/v1/contexts/${row.context_id}`) {
              database.prepare('DELETE FROM idempotency WHERE owner=? AND method=? AND path=? AND key=?').run(saved.owner, saved.method, saved.path, saved.key);
            }
          }
          result.state = 'succeeded'; result.error = null;
          database.prepare('UPDATE cleanups SET response=? WHERE id=?').run(JSON.stringify(result), row.id);
        });
      } catch (_) {
        result.state = 'failed'; result.error = { code: 'TEMPORARY_FAILURE', messageKey: 'errors.temporary_failure', retryable: true, details: {} };
        database.prepare('UPDATE cleanups SET response=? WHERE id=?').run(JSON.stringify(result), row.id);
      }
    }
  }
  const timer = setInterval(work, 25); timer.unref();
  return { deleteContext, getCleanup, work, close() { clearInterval(timer); } };
}
