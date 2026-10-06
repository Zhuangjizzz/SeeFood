import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Json } from './contract.ts';
interface Options {
  database: DatabaseSync; now: () => number; imageDirectory: string;
  transaction: <T>(operation: () => T) => T;
  contextEligibility: (id: string, owner: string) => { eligible: boolean };
  savedContextRetentionMs?: number;
}
/** Expiration retains an owner-bound identity fence, never a remote history copy. */
export function createRetentionService({ database, now, imageDirectory, transaction, contextEligibility, savedContextRetentionMs }: Options) {
  database.exec('CREATE TABLE IF NOT EXISTS retention_candidates (context_id TEXT PRIMARY KEY, eligible_since INTEGER NOT NULL)');
  function sweep() {
    const results: { contextId: string; cleaned: boolean; reason: string }[] = [];
    for (const context of database.prepare('SELECT * FROM contexts WHERE deleted=0').all()) {
      const id = String(context.id);
      const prior = database.prepare('SELECT * FROM context_expirations WHERE context_id=?').get(id);
      let reason = prior ? String(prior.reason) : Date.parse(String(context.expires_at)) <= now() ? 'hard-expiry' : null;
      if (!reason && savedContextRetentionMs !== undefined) {
        const versions = database.prepare('SELECT response FROM jobs WHERE context_id=?').all(id).map(row => Number(JSON.parse(String(row.response)).contextSnapshotVersion));
        const pendingUpload = database.prepare('SELECT 1 FROM uploads WHERE context_id=? AND asset_id IS NULL LIMIT 1').get(id);
        const eligible = !pendingUpload && Number(context.latest_version) <= Math.max(0, ...versions) && contextEligibility(id, String(context.owner)).eligible;
        if (!eligible) database.prepare('DELETE FROM retention_candidates WHERE context_id=?').run(id);
        else {
          database.prepare('INSERT OR IGNORE INTO retention_candidates VALUES (?,?)').run(id, now());
          const candidate = database.prepare('SELECT eligible_since FROM retention_candidates WHERE context_id=?').get(id)!;
          if (now() - Number(candidate.eligible_since) >= savedContextRetentionMs) reason = 'saved-results';
        }
      }
      if (!reason || prior?.cleaned) continue;
      // This entire decision/fence is synchronous: acceptance cannot race the final
      // eligibility check and start depending on resources selected for removal.
      transaction(() => {
        database.prepare('INSERT OR IGNORE INTO context_expirations VALUES (?,?,0)').run(id, reason);
        for (const row of database.prepare('SELECT id,response FROM jobs WHERE context_id=?').all(id)) {
          const job: Json = JSON.parse(String(row.response));
          if (job.state !== 'expired') {
            job.state = 'expired'; job.revision += 1; job.output = null;
            job.error = { code: 'CONTEXT_EXPIRED', messageKey: 'errors.context_expired', retryable: false, details: {} };
            database.prepare('UPDATE jobs SET response=? WHERE id=?').run(JSON.stringify(job), row.id);
          }
        }
      });
      try {
        const paths = new Set(database.prepare('SELECT path FROM assets WHERE context_id=?').all(id).map(row => String(row.path)));
        for (const row of database.prepare('SELECT id FROM uploads WHERE context_id=?').all(id)) paths.add(resolve(imageDirectory, `${row.id}.image`));
        for (const row of database.prepare('SELECT path FROM image_artifacts WHERE context_id=?').all(id)) paths.add(String(row.path));
        for (const path of paths) { try { unlinkSync(path); } catch (error: any) { if (error.code !== 'ENOENT') throw error; } }
        transaction(() => {
          for (const table of ['job_deliveries', 'job_receipts', 'image_artifacts', 'assets', 'uploads', 'snapshots']) database.prepare(`DELETE FROM ${table} WHERE context_id=?`).run(id);
          database.prepare("UPDATE jobs SET request='{}', frozen='{}' WHERE context_id=?").run(id);
          for (const row of database.prepare('SELECT * FROM idempotency WHERE owner=?').all(context.owner)) {
            const body = JSON.parse(String(row.body)); const response = JSON.parse(String(row.response));
            if (body.contextId === id || response.contextId === id) database.prepare('DELETE FROM idempotency WHERE owner=? AND method=? AND path=? AND key=?').run(row.owner, row.method, row.path, row.key);
          }
          database.prepare('UPDATE context_expirations SET cleaned=1 WHERE context_id=?').run(id);
          database.prepare('DELETE FROM retention_candidates WHERE context_id=?').run(id);
        });
        results.push({ contextId: id, cleaned: true, reason });
      } catch { results.push({ contextId: id, cleaned: false, reason }); }
    }
    return results;
  }
  const timer = setInterval(() => { try { sweep(); } catch { /* Retry from durable lifecycle state. */ } }, 25); timer.unref();
  return { sweep, close() { clearInterval(timer); } };
}
