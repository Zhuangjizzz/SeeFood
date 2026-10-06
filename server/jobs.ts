import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { ApiError, reject, canonical, validate, hash } from './contract.ts';
import type { Json } from './contract.ts';

export interface FrozenJob { request: Json; snapshot: Json; assets: Json[]; }
export interface GenerationContext extends FrozenJob { job: Json; images: Buffer[]; publishPartial: (output: Json) => void; }
export interface JobHandler {
  purpose: 'record' | 'communication';
  prepare(request: Json, snapshot: Json, asset: (id: string, imageId: string, kind?: string) => Json): Json[];
  generate(context: GenerationContext): Promise<Json>;
  validateOutput?(output: Json, frozen: FrozenJob, phase?: 'partial' | 'complete'): void;
}
interface JobServiceOptions {
  database: DatabaseSync; now: () => number;
  getContext: (id: string, owner: string) => any;
  getSnapshot: (id: string, owner: string, version?: number) => Json;
  idempotent: (owner: string, method: string, path: string, key: unknown, body: Json, operation: () => Json) => Json;
  handlers: Record<string, JobHandler>; workerDelayMs?: number; pageSize?: number;
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
  function row(id: string, owner: string, allowExpired = false) {
    const value = database.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!value) return reject(404, 'NOT_FOUND');
    if (value.owner !== owner) return reject(403, 'FORBIDDEN');
    try { getContext(String(value.context_id), owner); } catch (error) {
      if (!allowExpired || !(error instanceof ApiError) || error.code !== 'CONTEXT_EXPIRED') throw error;
    }
    return value;
  }
  function get(id: string, owner: string) { return JSON.parse(String(row(id, owner, true).response)); }
  function list(contextId: string, owner: string, cursor?: string) {
    getContext(contextId, owner);
    let after = '';
    if (cursor !== undefined) {
      try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!cursor || value.contextId !== contextId || typeof value.after !== 'string' || !value.after ||
            Buffer.from(JSON.stringify(value)).toString('base64url') !== cursor) return reject(400, 'INPUT_UNSUPPORTED');
        after = value.after;
      } catch { return reject(400, 'INPUT_UNSUPPORTED'); }
    }
    const size = Number.isInteger(options.pageSize) && options.pageSize! > 0 ? Math.min(options.pageSize!, 100) : 50;
    const rows = database.prepare('SELECT id FROM jobs WHERE context_id=? AND owner=? AND id>? ORDER BY id LIMIT ?').all(contextId, owner, after, size + 1);
    const items = rows.slice(0, size).map((value) => get(String(value.id), owner));
    const nextCursor = rows.length > size ? Buffer.from(JSON.stringify({ contextId, after: items[items.length - 1].jobId })).toString('base64url') : null;
    return { items, nextCursor };
  }
  function accept(owner: string, key: unknown, request: Json) {
    validate('CreateJobRequest', request);
    const context = getContext(request.contextId, owner);
    return idempotent(owner, 'POST', '/v1/jobs', key, request, () => {
      const previous = database.prepare('SELECT * FROM jobs WHERE context_id=? AND kind=? AND target=?').get(request.contextId, request.kind, canonical(request.kind === 'dietary_review' ? { ...request.target, cardIds: [...request.target.cardIds].sort() } : request.target));
      if (previous) {
        if (previous.request !== canonical(request)) reject(409, 'IDEMPOTENCY_CONFLICT');
        return JSON.parse(String(previous.response));
      }
      const handler = handlers[request.kind];
      if (!handler) reject(400, 'INPUT_UNSUPPORTED');
      if (request.kind === 'chat') {
        const existingChats = database.prepare("SELECT j.*,c.scope FROM jobs j JOIN contexts c ON c.id=j.context_id WHERE j.owner=? AND j.kind='chat'").all(owner);
        for (const previousChat of existingChats) {
          const target = JSON.parse(String(previousChat.target));
          const reused = [target.userMessageId, target.assistantMessageId].some((id) => [request.target.userMessageId, request.target.assistantMessageId].includes(id));
          if (reused) {
            const retired = JSON.parse(String(previousChat.response)).state === 'expired';
            if (!retired || previousChat.scope !== context.scope || target.userMessageId !== request.target.userMessageId || target.assistantMessageId !== request.target.assistantMessageId)
              reject(409, previousChat.scope === context.scope ? 'IDEMPOTENCY_CONFLICT' : 'DEPENDENCY_MISSING');
          }
          if (previousChat.scope === context.scope && ['queued', 'running'].includes(JSON.parse(String(previousChat.response)).state)) reject(409, 'JOB_STATE_CONFLICT');
        }
      }
      const snapshot = getSnapshot(request.contextId, owner, request.input.contextSnapshotVersion);
      if (snapshot.purpose !== handler.purpose) reject(409, 'DEPENDENCY_MISSING');
      if (request.kind === 'chat' || request.kind === 'dietary_review') {
        const cardIds = new Set(snapshot.snapshot.cards.map((card: Json) => card.id));
        const messageIds = new Set(snapshot.snapshot.messages.map((message: Json) => message.id));
        // Known identities retain their record/owner even if a client rewrites their fields.
        // Missing provenance is allowed for locally saved history after temporary expiry.
        const sourceJobs = database.prepare("SELECT j.*,c.scope FROM jobs j JOIN contexts c ON c.id=j.context_id WHERE j.kind IN ('image_cards','chat')").all();
        for (const source of sourceJobs) {
          const output = JSON.parse(String(source.response)).output;
          const target = JSON.parse(String(source.target));
          const referenced = source.kind === 'image_cards' ? output?.cards.some((card: Json) => cardIds.has(card.id)) :
            [target.userMessageId, target.assistantMessageId].some((id) => messageIds.has(id));
          if (!referenced) continue;
          if (source.owner !== owner) reject(403, 'FORBIDDEN');
          if (source.scope !== context.scope) reject(409, 'DEPENDENCY_MISSING');
        }
      }
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
        canonical(request.kind === 'dietary_review' ? { ...request.target, cardIds: [...request.target.cardIds].sort() } : request.target), canonical(request), JSON.stringify({ request, snapshot, assets }), JSON.stringify(job));
      return job;
    });
  }
  function retry(id: string, owner: string, key: unknown, request: Json) {
    validate('RetryRequest', request);
    row(id, owner);
    return idempotent(owner, 'POST', `/v1/jobs/${id}/retry`, key, request, () => {
      const job = get(id, owner);
      if (job.state !== 'failed' || job.error?.retryable !== true || job.attempt !== request.expectedAttempt) {
        return reject(409, 'JOB_STATE_CONFLICT', { currentAttempt: job.attempt, state: job.state });
      }
      if (job.kind === 'chat') {
        const context = getContext(job.contextId, owner);
        const siblings = database.prepare("SELECT j.response FROM jobs j JOIN contexts c ON c.id=j.context_id WHERE j.owner=? AND c.scope=? AND j.kind='chat' AND j.id<>?").all(owner, context.scope, id);
        if (siblings.some((sibling) => ['queued', 'running'].includes(JSON.parse(String(sibling.response)).state))) reject(409, 'JOB_STATE_CONFLICT');
      }
      const next = { ...job, state: 'queued', attempt: job.attempt + 1, revision: job.revision + 1, output: null, error: null };
      validate('Job', next);
      database.prepare('UPDATE jobs SET response=? WHERE id=?').run(JSON.stringify(next), id);
      return next;
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
        const output = await handler.generate({ ...frozen, job, publishPartial(output) {
          if (job.kind !== 'chat' || output.complete !== false) reject(409, 'DEPENDENCY_MISSING');
          handler.validateOutput?.(output, frozen, 'partial');
          const next = { ...job, revision: job.revision + 1, output };
          if (publish(next, saved)) job = next;
        }, images: frozen.assets.map((asset) => {
          let bytes: Buffer;
          try { bytes = readFileSync(asset.path); } catch { return reject(409, 'DEPENDENCY_MISSING'); }
          if (hash(bytes) !== asset.contentHash) reject(409, 'DEPENDENCY_MISSING');
          return bytes;
        }) });
        handler.validateOutput?.(output, frozen, 'complete');
        publish({ ...job, state: 'succeeded', revision: job.revision + 1, output, error: null }, saved);
      } catch (error) {
        const failure = error instanceof ApiError ? error : new ApiError(503, 'TEMPORARY_FAILURE', true);
        publish({ ...job, state: 'failed', revision: job.revision + 1, output: job.output,
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
    const currentRow = database.prepare('SELECT response FROM jobs WHERE id=?').get(job.jobId);
    if (!currentRow) return;
    const current = JSON.parse(String(currentRow.response));
    if (current.attempt !== job.attempt || current.revision >= job.revision || current.state !== 'running') return;
    // Never allow completion after deletion/expiration or a newer attempt.
    try { getContext(String(saved.context_id), String(saved.owner)); } catch { return; }
    validate('Job', job);
    database.prepare('UPDATE jobs SET response=? WHERE id=?').run(JSON.stringify(job), job.jobId);
    return true;
  }
  const timer = setInterval(() => {
    if (!stopped) work();
  }, interval);
  timer.unref();
  return { accept, retry, get, list, async close() { stopped = true; clearInterval(timer); await Promise.all(active.values()); } };

}
