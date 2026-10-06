import type { DatabaseSync } from 'node:sqlite';
import { reject, validate } from './contract.ts';
import type { Json } from './contract.ts';

interface Options { database: DatabaseSync; getContext: (id: string, owner: string) => any; transaction: <T>(operation: () => T) => T; }
export function createReceiptService({ database, getContext, transaction }: Options) {
  database.exec(`CREATE TABLE IF NOT EXISTS job_deliveries (job_id TEXT NOT NULL, context_id TEXT NOT NULL, revision INTEGER NOT NULL, artifact_ids TEXT NOT NULL, PRIMARY KEY(job_id,revision));
    CREATE TABLE IF NOT EXISTS job_receipts (job_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, owner TEXT NOT NULL, response TEXT NOT NULL);`);
  function owned(id: string, owner: string) {
    const row = database.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!row) return reject(404, 'NOT_FOUND');
    if (row.owner !== owner) return reject(403, 'FORBIDDEN');
    getContext(String(row.context_id), owner);
    return row;
  }
  function delivered(job: Json) {
    const ids = job.kind === 'image_translation' && job.output?.state === 'ready' ? [job.output.artifact.id] : [];
    database.prepare('INSERT OR IGNORE INTO job_deliveries VALUES (?,?,?,?)').run(job.jobId, job.contextId, job.revision, JSON.stringify(ids));
    return job;
  }
  function ack(id: string, owner: string, body: Json) {
    validate('AckRequest', body);
    return transaction(() => {
      const job = JSON.parse(String(owned(id, owner).response));
      const deliveries = database.prepare('SELECT revision,artifact_ids FROM job_deliveries WHERE job_id=?').all(id);
      const revisions = new Set(deliveries.map((item) => Number(item.revision)));
      if (!revisions.has(body.appliedRevision) || body.appliedRevision > job.revision ||
          body.locallySavedRevision !== null && (!revisions.has(body.locallySavedRevision) || body.locallySavedRevision > body.appliedRevision)) reject(409, 'JOB_STATE_CONFLICT');
      const artifacts = new Set(deliveries.filter((item) => Number(item.revision) <= body.appliedRevision).flatMap((item) => JSON.parse(String(item.artifact_ids))));
      if (body.locallySavedArtifactIds.some((artifact: string) => !artifacts.has(artifact))) reject(409, 'DEPENDENCY_MISSING');
      const row = database.prepare('SELECT response FROM job_receipts WHERE job_id=?').get(id);
      const old = row ? JSON.parse(String(row.response)) : null;
      const response = { jobId: id, appliedRevision: Math.max(old?.appliedRevision || 0, body.appliedRevision),
        locallySavedRevision: Math.max(old?.locallySavedRevision || 0, body.locallySavedRevision || 0) || null,
        locallySavedArtifactIds: [...new Set<string>([...(old?.locallySavedArtifactIds || []), ...body.locallySavedArtifactIds])] };
      validate('AckReceipt', response);
      database.prepare('INSERT INTO job_receipts VALUES (?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET response=excluded.response').run(id, job.contextId, owner, JSON.stringify(response));
      return response;
    });
  }
  function eligibility(id: string, owner: string) {
    const row = owned(id, owner); const job = JSON.parse(String(row.response));
    const no = (reason: string) => ({ jobId: id, revision: job.revision, eligible: false, reason });
    if (['queued', 'running'].includes(job.state)) return no('active-job');
    if (job.state !== 'succeeded') return no(job.error?.retryable ? 'retry-available' : 'no-successful-result');
    const stored = database.prepare('SELECT response FROM job_receipts WHERE job_id=?').get(id);
    const receipt = stored && JSON.parse(String(stored.response));
    if (!receipt || receipt.locallySavedRevision !== job.revision) return no('newer-unsaved-result');
    const ids = job.kind === 'image_translation' && job.output?.state === 'ready' ? [job.output.artifact.id] : [];
    if (ids.some((artifact) => !receipt.locallySavedArtifactIds.includes(artifact))) return no('artifact-unsaved');
    // Conservatively retain this context's frozen inputs while any sibling works.
    // A later lifecycle policy may narrow this to individual shared resources.
    const siblings = database.prepare('SELECT response FROM jobs WHERE context_id=? AND id<>?').all(row.context_id, id);
    if (siblings.some((item) => ['queued', 'running'].includes(JSON.parse(String(item.response)).state))) return no('active-dependency');
    return { jobId: id, revision: job.revision, eligible: true, reason: null };
  }
  function contextEligibility(contextId: string, owner: string) {
    getContext(contextId, owner);
    const results = database.prepare('SELECT id FROM jobs WHERE context_id=?').all(contextId).map((item) => eligibility(String(item.id), owner));
    return { contextId, eligible: results.length > 0 && results.every((item) => item.eligible), jobs: results };
  }
  return { delivered, ack, eligibility, contextEligibility };
}
