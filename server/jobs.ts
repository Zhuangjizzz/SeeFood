import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { ApiError, reject, canonical, validate, hash } from './contract.ts';
import type { Json } from './contract.ts';

export interface FrozenJob { request: Json; snapshot: Json; assets: Json[]; }
export interface GenerationContext extends FrozenJob { job: Json; images: Buffer[]; }
export interface JobHandler {
  purpose: 'record' | 'communication';
  prepare(request: Json, snapshot: Json, asset: (id: string, imageId: string, kind?: string) => Json): Json[];
  generate(context: GenerationContext): Promise<Json>;
  validateOutput?(output: Json, frozen: FrozenJob): void;
}
interface JobServiceOptions {
  database: DatabaseSync; now: () => number;
  getContext: (id: string, owner: string) => any;
  getSnapshot: (id: string, owner: string, version?: number) => Json;
  idempotent: (owner: string, method: string, path: string, key: unknown, body: Json, operation: () => Json) => Json;
  handlers: Record<string, JobHandler>; workerDelayMs?: number;
}
/** Durable acceptance, identity and execution are shared by all job kinds. */
export function createJobService(options: JobServiceOptions) {
  const { database, now, getContext, getSnapshot, idempotent, handlers } = options;
  database.exec(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, context_id TEXT NOT NULL REFERENCES contexts(id),
    kind TEXT NOT NULL, target TEXT NOT NULL, request TEXT NOT NULL, frozen TEXT NOT NULL, response TEXT NOT NULL,
    UNIQUE(context_id, kind, target));`);
  let stopped = false; const active = new Map<string, Promise<void>>();
  const interval = Math.max(10, options.workerDelayMs || 20);
  function row(id: string, owner: string) {
    const value = database.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!value) return reject(404, 'NOT_FOUND');
    if (value.owner !== owner) return reject(403, 'FORBIDDEN');
    getContext(String(value.context_id), owner);
    return value;
  }
  function get(id: string, owner: string) { return JSON.parse(String(row(id, owner).response)); }
  function accept(owner: string, key: unknown, request: Json) {
    validate('CreateJobRequest', request);
    const context = getContext(request.contextId, owner);
    return idempotent(owner, 'POST', '/v1/jobs', key, request, () => {
      const previous = database.prepare('SELECT * FROM jobs WHERE context_id=? AND kind=? AND target=?').get(request.contextId, request.kind, canonical(request.target));
      if (previous) {
        if (previous.request !== canonical(request)) reject(409, 'IDEMPOTENCY_CONFLICT');
        return JSON.parse(String(previous.response));
      }
      const handler = handlers[request.kind];
      if (!handler) reject(400, 'INPUT_UNSUPPORTED');
      const snapshot = getSnapshot(request.contextId, owner, request.input.contextSnapshotVersion);
      if (snapshot.purpose !== handler.purpose) reject(409, 'DEPENDENCY_MISSING');
      const assets = handler.prepare(request, snapshot, (id, imageId, kind) => {
        const asset = database.prepare('SELECT a.*,u.kind FROM assets a JOIN uploads u ON u.id=a.upload_id WHERE a.id=?').get(id);
        if (!asset) return reject(409, 'DEPENDENCY_MISSING');
        if (asset.owner !== owner) return reject(403, 'FORBIDDEN');
        if (asset.context_id !== request.contextId || asset.image_id !== imageId || (kind && asset.kind !== kind)) reject(409, 'DEPENDENCY_MISSING');
        try { if (statSync(String(asset.path)).size !== asset.size) reject(409, 'DEPENDENCY_MISSING'); }
        catch { reject(409, 'DEPENDENCY_MISSING'); }
        return { id, path: asset.path, contentHash: asset.content_hash };
      });
      const job = { jobId: randomUUID(), contextId: request.contextId, contextSnapshotVersion: request.input.contextSnapshotVersion,
        kind: request.kind, target: request.target, state: 'queued', attempt: 1, revision: 1, output: null, error: null, expiresAt: context.expires_at };
      validate('Job', job);
      database.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)').run(job.jobId, owner, request.contextId, request.kind,
        canonical(request.target), canonical(request), JSON.stringify({ request, snapshot, assets }), JSON.stringify(job));
      return job;
    });
  }
  async function execute(saved: any) {
      if (stopped) return;
      let job = JSON.parse(String(saved.response));
      if (!['queued', 'running'].includes(job.state)) return;
      // On restart an interrupted running task keeps its frozen input and attempt.
      const frozen: FrozenJob = JSON.parse(String(saved.frozen));
      try {
        getContext(String(saved.context_id), String(saved.owner));
        const handler = handlers[job.kind];
        if (!handler) return;
        job = { ...job, state: 'running', revision: job.revision + 1 };
        database.prepare('UPDATE jobs SET response=? WHERE id=?').run(JSON.stringify(job), job.jobId);
        const output = await handler.generate({ ...frozen, job, images: frozen.assets.map((asset) => {
          let bytes: Buffer;
          try { bytes = readFileSync(asset.path); } catch { return reject(409, 'DEPENDENCY_MISSING'); }
          if (hash(bytes) !== asset.contentHash) reject(409, 'DEPENDENCY_MISSING');
          return bytes;
        }) });
        handler.validateOutput?.(output, frozen);
        publish({ ...job, state: 'succeeded', revision: job.revision + 1, output, error: null }, saved);
      } catch (error) {
        const failure = error instanceof ApiError ? error : new ApiError(503, 'TEMPORARY_FAILURE', true);
        publish({ ...job, state: 'failed', revision: job.revision + 1, output: null,
          error: { code: failure.code, messageKey: `errors.${failure.code.toLowerCase()}`, retryable: failure.retryable, details: failure.details } }, saved);
      }
  }
  function work() {
    for (const saved of database.prepare('SELECT * FROM jobs ORDER BY id').all()) {
      const id = String(saved.id);
      if (active.has(id) || !['queued', 'running'].includes(JSON.parse(String(saved.response)).state)) continue;
      const running = execute(saved).catch(() => { /* Next tick recovers durable running work. */ }).finally(() => active.delete(id));
      active.set(id, running);
    }
  }
  function publish(job: Json, saved: any) {
    if (stopped) return;
    const current = JSON.parse(String(database.prepare('SELECT response FROM jobs WHERE id=?').get(job.jobId)!.response));
    if (current.attempt !== job.attempt || current.revision >= job.revision || current.state !== 'running') return;
    // Never allow completion after deletion/expiration or a newer attempt.
    try { getContext(String(saved.context_id), String(saved.owner)); } catch { return; }
    validate('Job', job);
    database.prepare('UPDATE jobs SET response=? WHERE id=?').run(JSON.stringify(job), job.jobId);
  }
  const timer = setInterval(() => {
    if (!stopped) work();
  }, interval);
  timer.unref();
  return { accept, get, async close() { stopped = true; clearInterval(timer); await Promise.all(active.values()); } };
}
