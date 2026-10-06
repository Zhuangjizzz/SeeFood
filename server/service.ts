import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';

import { ApiError, reject, hash, canonical, validate } from './contract.ts';
import type { Json } from './contract.ts';
import { createJobService } from './jobs.ts';
import type { JobHandler } from './jobs.ts';
import { dietaryReviewHandler } from './dietary-review.ts';
import { imageCardsHandler } from './image-cards.ts';
import { textTranslationHandler } from './text-translation.ts';
import { createImageTranslation } from './image-translation.ts';
import { chatHandler } from './chat.ts';
import { createReceiptService } from './receipts.ts';
import { createCleanupService } from './cleanups.ts';
import { createRetentionService } from './retention.ts';

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) reject(413, 'INPUT_LIMIT_EXCEEDED');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return reject(400, 'INPUT_UNSUPPORTED'); }
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
export interface ServiceOptions {
  dataDir: string;
  enableDevSession?: boolean;
  devIdentities?: string[];
  now?: () => number;
  jobHandlers?: Record<string, JobHandler>;
  workerDelayMs?: number;
  jobPageSize?: number;
  mockScenario?: string;
  translationDelayMs?: number;
  chatPartialDelayMs?: number;
  contextRetentionMs?: number;
  savedContextRetentionMs?: number;
  artifactUrlTtlMs?: number;
}
export function createService(options: ServiceOptions) {
  const dataDir = resolve(options.dataDir);
  const repository = fileURLToPath(new URL('../', import.meta.url));
  if (dataDir === repository.slice(0, -1) || dataDir.startsWith(repository.endsWith(sep) ? repository : repository + sep)) {
    throw new Error('SEEFOOD_DATA_DIR must be outside the project');
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const imageDir = resolve(dataDir, 'images');
  mkdirSync(imageDir, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(resolve(dataDir, 'metadata.sqlite'));
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contexts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, purpose TEXT NOT NULL, scope TEXT NOT NULL, latest_version INTEGER NOT NULL, expires_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS snapshots (context_id TEXT NOT NULL REFERENCES contexts(id), version INTEGER NOT NULL, body TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(context_id, version));
    CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, owner TEXT NOT NULL, context_id TEXT NOT NULL REFERENCES contexts(id), image_id TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, secret_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, received_hash TEXT, asset_id TEXT);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, owner TEXT NOT NULL, context_id TEXT NOT NULL REFERENCES contexts(id), image_id TEXT NOT NULL, upload_id TEXT NOT NULL UNIQUE REFERENCES uploads(id), path TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, content_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS idempotency (owner TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(owner,method,path,key));`);
  database.exec('CREATE TABLE IF NOT EXISTS context_expirations (context_id TEXT PRIMARY KEY REFERENCES contexts(id), reason TEXT NOT NULL, cleaned INTEGER NOT NULL DEFAULT 0)');
  const contextRetentionMs = options.contextRetentionMs ?? 24 * 60 * 60 * 1000;
  for (const value of [contextRetentionMs, options.artifactUrlTtlMs ?? 15 * 60 * 1000]) if (!Number.isFinite(value) || value <= 0) throw new Error('Retention durations must be positive milliseconds');
  if (options.savedContextRetentionMs !== undefined && (!Number.isFinite(options.savedContextRetentionMs) || options.savedContextRetentionMs < 0)) throw new Error('Saved retention must be nonnegative milliseconds');
  const now = options.now || Date.now;
  const expiry = (duration: number) => new Date(now() + duration).toISOString();
  function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE');
    try { const result = operation(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function getContext(id: string, ownerId: string) {
    const row = database.prepare('SELECT * FROM contexts WHERE id=?').get(id);
    if (!row) return reject(404, 'NOT_FOUND');
    if (row.owner !== ownerId) return reject(403, 'FORBIDDEN');
    if (row.deleted) return reject(410, 'CONTEXT_DELETED');
    if (Date.parse(String(row.expires_at)) <= now() || database.prepare('SELECT 1 FROM context_expirations WHERE context_id=?').get(id)) return reject(410, 'CONTEXT_EXPIRED');
    return row;
  }
  function getSnapshot(id: string, ownerId: string, version?: number): Json {
    const context = getContext(id, ownerId);
    const row = database.prepare('SELECT body FROM snapshots WHERE context_id=? AND version=?').get(id, version || context.latest_version);
    if (!row) return reject(409, 'DEPENDENCY_MISSING');
    return JSON.parse(String(row.body));
  }
  function replay(ownerId: string, method: string, path: string, key: unknown, body: Json): Json | undefined {
    if (typeof key !== 'string' || !key.trim()) return reject(400, 'INPUT_UNSUPPORTED');
    const saved = database.prepare('SELECT * FROM idempotency WHERE owner=? AND method=? AND path=? AND key=?').get(ownerId, method, path, key);
    if (saved) {
      if (saved.body !== canonical(body)) reject(409, 'IDEMPOTENCY_CONFLICT');
      return JSON.parse(String(saved.response));
    }
  }
  function idempotent(ownerId: string, method: string, path: string, key: unknown, body: Json, operation: () => Json): Json {
    return transaction(() => {
      const saved = replay(ownerId, method, path, key, body);
      if (saved) return saved;
      const response = operation();
      database.prepare('INSERT INTO idempotency VALUES (?,?,?,?,?,?)').run(ownerId, method, path, String(key), canonical(body), JSON.stringify(response));
      return response;
    });
  }
  function baseUrl() {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No HTTP address');
    return `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`;
  }
  const translations = createImageTranslation({ database, directory: resolve(dataDir, 'translations'), now, getContext, baseUrl,
    scenario: options.mockScenario, delayMs: options.translationDelayMs, urlTtlMs: options.artifactUrlTtlMs });
  const jobs = createJobService({ database, now, getContext, getSnapshot, idempotent,
    handlers: { dietary_review: dietaryReviewHandler(options.mockScenario), image_cards: imageCardsHandler(options.mockScenario), image_translation: translations.handler, text_translation: textTranslationHandler(options.mockScenario), chat: chatHandler(options.mockScenario, options.chatPartialDelayMs), ...options.jobHandlers }, workerDelayMs: options.workerDelayMs, pageSize: options.jobPageSize });
  const receipts = createReceiptService({ database, getContext, transaction });
  const deliver = (job: Json) => receipts.delivered(translations.decorate(job));
  const cleanups = createCleanupService({ database, imageDirectory: imageDir, transaction });
  const retention = createRetentionService({ database, now, imageDirectory: imageDir, transaction, contextEligibility: receipts.contextEligibility, savedContextRetentionMs: options.savedContextRetentionMs });

  function checkImage(contextId: string, ownerId: string, imageId: string, kind?: string) {
    const snapshot = getSnapshot(contextId, ownerId);
    if (snapshot.purpose !== 'record') reject(400, 'INPUT_UNSUPPORTED');
    const image = snapshot.snapshot.images.find((item: Json) => item.imageId === imageId);
    if (!image) return reject(409, 'DEPENDENCY_MISSING');
    if (kind && image.kind !== kind) reject(409, 'DEPENDENCY_MISSING');
    return image;
  }
  function getUpload(id: string, ownerId: string) {
    const upload = database.prepare('SELECT * FROM uploads WHERE id=?').get(id);
    if (!upload) return reject(404, 'NOT_FOUND');
    if (upload.owner !== ownerId) return reject(403, 'FORBIDDEN');
    getContext(String(upload.context_id), ownerId);
    return upload;
  }
  function createUpload(ownerId: string, key: unknown, body: Json, origin: string) {
    validate('UploadRequest', body);
    const saved = replay(ownerId, 'POST', '/v1/uploads', key, body);
    if (saved) { getUpload(saved.uploadId, ownerId); return saved; }
    checkImage(body.contextId, ownerId, body.imageId, body.kind);
    if (body.sizeBytes > 20 * 1024 * 1024) reject(413, 'INPUT_LIMIT_EXCEEDED');
    return idempotent(ownerId, 'POST', '/v1/uploads', key, body, () => {
      const uploadId = randomUUID(); const secret = randomUUID() + randomUUID(); const expiresAt = expiry(15 * 60 * 1000);
      database.prepare('INSERT INTO uploads (id,owner,context_id,image_id,kind,mime,size,secret_hash,expires_at) VALUES (?,?,?,?,?,?,?,?,?)').run(uploadId, ownerId, body.contextId, body.imageId, body.kind, body.mimeType, body.sizeBytes, hash(secret), expiresAt);
      return { uploadId, uploadUrl: `${origin}/_uploads/${secret}`, uploadMethod: 'PUT', uploadHeaders: { 'Content-Type': body.mimeType }, expiresAt };
    });
  }
  async function receiveUpload(req: IncomingMessage, secret: string) {
    const upload = database.prepare('SELECT * FROM uploads WHERE secret_hash=?').get(hash(secret));
    if (!upload) return reject(404, 'NOT_FOUND');
    if (req.headers.authorization) return reject(403, 'FORBIDDEN');
    getContext(String(upload.context_id), String(upload.owner));
    if (Date.parse(String(upload.expires_at)) <= now()) reject(410, 'UPLOAD_EXPIRED');
    if (req.headers['content-type'] !== upload.mime) reject(400, 'INPUT_UNSUPPORTED');
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > Number(upload.size)) reject(413, 'INPUT_LIMIT_EXCEEDED');
      chunks.push(chunk);
    }
    if (size !== Number(upload.size)) reject(409, 'UPLOAD_INCOMPLETE');
    const bytes = Buffer.concat(chunks); const contentHash = hash(bytes);
    // The capability identifies one immutable upload; a network replay cannot replace its bytes.
    transaction(() => {
      const current = getUpload(String(upload.id), String(upload.owner));
      if (Date.parse(String(current.expires_at)) <= now()) reject(410, 'UPLOAD_EXPIRED');
      if (current.received_hash && current.received_hash !== contentHash) reject(409, 'IDEMPOTENCY_CONFLICT');
      if (current.received_hash) return;
      const filename = resolve(imageDir, `${upload.id}.image`);
      const temporary = `${filename}.${randomUUID()}.partial`;
      try { writeFileSync(temporary, bytes, { mode: 0o600 }); renameSync(temporary, filename); }
      finally { try { unlinkSync(temporary); } catch { /* Rename already removed the temporary name. */ } }
      database.prepare('UPDATE uploads SET received_hash=? WHERE id=?').run(contentHash, upload.id);
    });
  }
  async function completeUpload(ownerId: string, id: string, key: unknown, body: Json) {
    validate('UploadCompleteRequest', body);
    const upload = getUpload(id, ownerId);
    const saved = replay(ownerId, 'POST', `/v1/uploads/${id}/complete`, key, body);
    if (saved) return saved;
    if (upload.context_id !== body.contextId || upload.image_id !== body.imageId) reject(409, 'DEPENDENCY_MISSING');
    checkImage(body.contextId, ownerId, body.imageId, String(upload.kind));
    if (!upload.asset_id && Date.parse(String(upload.expires_at)) <= now()) reject(410, 'UPLOAD_EXPIRED');
    const filename = resolve(imageDir, `${id}.image`);
    if (!upload.asset_id) {
      if (!upload.received_hash) reject(409, 'UPLOAD_INCOMPLETE');
      let bytes: Buffer;
      try { bytes = readFileSync(filename); }
      catch { return reject(409, 'UPLOAD_INCOMPLETE'); }
      if (bytes.length !== Number(upload.size) || hash(bytes) !== upload.received_hash) reject(409, 'UPLOAD_INCOMPLETE');
      try {
        const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 100_000_000 });
        const info = await image.metadata();
        const formats: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
        if (formats[info.format || ''] !== upload.mime) reject(400, 'INPUT_UNSUPPORTED');
        await image.stats(); // Decode pixels as well as the container header.
      } catch (error) { if (error instanceof ApiError) throw error; return reject(400, 'INPUT_UNSUPPORTED'); }
    }
    return idempotent(ownerId, 'POST', `/v1/uploads/${id}/complete`, key, body, () => {
      const current = getUpload(id, ownerId);
      const assetId = current.asset_id ? String(current.asset_id) : randomUUID();
      if (!current.asset_id) {
        if (Date.parse(String(current.expires_at)) <= now()) reject(410, 'UPLOAD_EXPIRED');
        database.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?)').run(assetId, ownerId, body.contextId, body.imageId, id, filename, current.mime, current.size, current.received_hash);
        database.prepare('UPDATE uploads SET asset_id=? WHERE id=?').run(assetId, id);
      }
      return { uploadId: id, contextId: body.contextId, imageId: body.imageId, assetId };
    });
  }
  function putContext(id: string, ownerId: string, body: Json) {
    validate('ContextRequest', body);
    if (body.purpose === 'record' && body.localScopeId !== body.recordId) reject(400, 'INPUT_UNSUPPORTED');
    if (body.purpose === 'record') {
      const images = body.snapshot.images;
      if (new Set(images.map((image: Json) => image.imageId)).size !== images.length ||
          new Set(images.map((image: Json) => image.order)).size !== images.length) reject(400, 'INPUT_UNSUPPORTED');
    }
    return transaction(() => {
      let existing = database.prepare('SELECT * FROM contexts WHERE id=?').get(id);
      if (existing) {
        existing = getContext(id, ownerId);
        if (existing.purpose !== body.purpose || existing.scope !== body.localScopeId) reject(409, 'SNAPSHOT_CONFLICT');
        const saved = database.prepare('SELECT * FROM snapshots WHERE context_id=? AND version=?').get(id, body.snapshotVersion);
        if (saved) {
          if (saved.body !== canonical(body)) reject(409, 'SNAPSHOT_CONFLICT');
          return JSON.parse(String(saved.response));
        }
        if (body.snapshotVersion <= Number(existing.latest_version)) reject(409, 'SNAPSHOT_CONFLICT');
      }
      if (body.purpose === 'record') {
        for (const image of body.snapshot.images) {
          if (image.assetId === null) continue;
          const asset = database.prepare('SELECT a.*,u.kind FROM assets a JOIN uploads u ON u.id=a.upload_id WHERE a.id=?').get(image.assetId);
          if (!asset) reject(409, 'DEPENDENCY_MISSING');
          if (asset.owner !== ownerId) reject(403, 'FORBIDDEN');
          if (asset.context_id !== id || asset.image_id !== image.imageId || asset.kind !== image.kind) reject(409, 'DEPENDENCY_MISSING');
          try { if (statSync(String(asset.path)).size !== Number(asset.size)) reject(409, 'DEPENDENCY_MISSING'); }
          catch { reject(409, 'DEPENDENCY_MISSING'); }
        }
      }
      const expiresAt = existing ? String(existing.expires_at) : expiry(contextRetentionMs);
      const response: Json = { contextId: id, purpose: body.purpose, localScopeId: body.localScopeId, snapshotVersion: body.snapshotVersion, expiresAt };
      if (body.purpose === 'record') response.recordId = body.recordId;
      if (!existing) database.prepare('INSERT INTO contexts (id,owner,purpose,scope,latest_version,expires_at) VALUES (?,?,?,?,?,?)').run(id, ownerId, body.purpose, body.localScopeId, body.snapshotVersion, expiresAt);
      else database.prepare('UPDATE contexts SET latest_version=? WHERE id=?').run(body.snapshotVersion, id);
      database.prepare('INSERT INTO snapshots VALUES (?,?,?,?)').run(id, body.snapshotVersion, canonical(body), JSON.stringify(response));
      return response;
    });
  }
  function owner(req: IncomingMessage) {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return reject(401, 'AUTH_REQUIRED');
    const session = database.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash(authorization.slice(7)));
    if (!session || Date.parse(String(session.expires_at)) <= now()) return reject(401, 'AUTH_REQUIRED');
    return String(session.owner);
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    retention.sweep();
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname;
    const byteRoute = route.match(/^\/_uploads\/([^/]+)$/);
    if (byteRoute && req.method === 'PUT') {
      await receiveUpload(req, byteRoute[1]); res.writeHead(204); res.end(); return;
    }
    if (route === '/v1/dev/session' && req.method === 'POST') {
      if (!options.enableDevSession) return reject(404, 'NOT_FOUND');
      const body = await readJson(req); validate('DevSessionRequest', body);
      if (!options.devIdentities?.includes(body.identity)) return reject(403, 'FORBIDDEN');
      const accessToken = randomUUID() + randomUUID(); const expiresAt = expiry(60 * 60 * 1000);
      database.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(accessToken), body.identity, expiresAt);
      return send(res, 200, { accessToken, expiresAt });
    }
    if (route.startsWith('/v1/')) {
      const ownerId = owner(req);
      if (route === '/v1/jobs' && req.method === 'POST') return send(res, 202, deliver(jobs.accept(ownerId, req.headers['idempotency-key'], await readJson(req))));
      const ackRoute = route.match(/^\/v1\/jobs\/([^/]+)\/ack$/);
      if (ackRoute && req.method === 'POST') return send(res, 200, receipts.ack(decodeURIComponent(ackRoute[1]), ownerId, await readJson(req)));
      const retryRoute = route.match(/^\/v1\/jobs\/([^/]+)\/retry$/);
      if (retryRoute && req.method === 'POST') return send(res, 202, deliver(jobs.retry(decodeURIComponent(retryRoute[1]), ownerId, req.headers['idempotency-key'], await readJson(req))));
      const jobRoute = route.match(/^\/v1\/jobs\/([^/]+)$/);
      if (jobRoute && req.method === 'GET') return send(res, 200, deliver(jobs.get(decodeURIComponent(jobRoute[1]), ownerId)));
      const artifactRoute = route.match(/^\/v1\/image-artifacts\/([^/]+)$/);
      if (artifactRoute && req.method === 'GET') {
        const bytes = translations.download(decodeURIComponent(artifactRoute[1]), ownerId, url.searchParams);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store' });
        return res.end(bytes);
      }
      const contextJobs = route.match(/^\/v1\/contexts\/([^/]+)\/jobs$/);
      if (contextJobs && req.method === 'GET') {
        if (url.searchParams.getAll('cursor').length > 1) return reject(400, 'INPUT_UNSUPPORTED');
        const list = jobs.list(decodeURIComponent(contextJobs[1]), ownerId, url.searchParams.get('cursor') ?? undefined);
        return send(res, 200, { ...list, items: list.items.map(deliver) });

      }
      const contextRoute = route.match(/^\/v1\/contexts\/([^/]+)$/);
      if (contextRoute && req.method === 'DELETE') return send(res, 202, cleanups.deleteContext(decodeURIComponent(contextRoute[1]), ownerId));
      const cleanupRoute = route.match(/^\/v1\/cleanups\/([^/]+)$/);
      if (cleanupRoute && req.method === 'GET') return send(res, 200, cleanups.getCleanup(decodeURIComponent(cleanupRoute[1]), ownerId));
      if (contextRoute && req.method === 'PUT') return send(res, 200, putContext(decodeURIComponent(contextRoute[1]), ownerId, await readJson(req)));
      if (route === '/v1/uploads' && req.method === 'POST') {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No HTTP address');
        return send(res, 201, createUpload(ownerId, req.headers['idempotency-key'], await readJson(req), `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`));
      }
      const completion = route.match(/^\/v1\/uploads\/([^/]+)\/complete$/);
      if (completion && req.method === 'POST') return send(res, 200, await completeUpload(ownerId, completion[1], req.headers['idempotency-key'], await readJson(req)));
    }
    reject(404, 'NOT_FOUND');
  }
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const failure = error instanceof ApiError ? error : new ApiError(503, 'TEMPORARY_FAILURE', true);
      if (!res.headersSent) send(res, failure.status, { code: failure.code, messageKey: `errors.${failure.code.toLowerCase()}`, retryable: failure.retryable, details: failure.details });
      else res.destroy();
    });
  });
  return { server, retention: { ...receipts, sweep: retention.sweep }, close: async () => { retention.close(); cleanups.close(); await jobs.close(); await new Promise<void>((done) => server.close(() => { database.close(); done(); })); } };
}
