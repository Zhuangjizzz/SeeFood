const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { temporary, request, session, uploaded, finished } = require('./support/http-service');

async function controlled(t, options = {}) {
  const { createService } = await import('../server/service.ts');
  let time = Date.now(); const directory = temporary(t);
  const service = createService({ dataDir: directory, enableDevSession: true, devIdentities: ['demo-owner-a', 'demo-owner-b'], now: () => time,
    contextRetentionMs: 10000, ...options });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  let stopped = false; const stop = async () => { if (!stopped) { stopped = true; await service.close(); } }; t.after(stop);
  const url = `http://127.0.0.1:${service.server.address().port}`;
  return { service, directory, stop, url, token: await session(url), advance(ms) { time += ms; }, now: () => time };
}

test('configured hard expiry persists expired task identity and rejects a late worker, new writes and old-context reuse', async t => {
  const app = await controlled(t, { translationDelayMs: 150 });
  const { url, token, service } = app; const source = await uploaded(url, token);
  const input = { ...source.body.input }; delete input.inputKind;
  const accepted = (await request(url, 'POST', '/v1/jobs', { ...source.body, kind: 'image_translation', input }, token, 'translate')).body;
  assert.equal(Date.parse(accepted.expiresAt), app.now() + 10000);
  await new Promise(resolve => setTimeout(resolve, 50));
  app.advance(10001);
  service.retention.sweep();
  const expired = (await request(url, 'GET', `/v1/jobs/${accepted.jobId}`, undefined, token)).body;
  assert.equal(expired.state, 'expired'); assert.equal(expired.output, null); assert.equal(expired.jobId, accepted.jobId);
  assert.equal(expired.error.code, 'CONTEXT_EXPIRED'); assert.equal(expired.error.retryable, false);
  assert.equal((await request(url, 'PUT', `/v1/contexts/${source.contextId}`, source.bound, token)).body.code, 'CONTEXT_EXPIRED');
  assert.equal((await request(url, 'POST', '/v1/jobs', source.body, token, 'late-cards')).body.code, 'CONTEXT_EXPIRED');
  assert.equal((await request(url, 'POST', `/v1/jobs/${accepted.jobId}/retry`, { expectedAttempt: 1 }, token, 'late-retry')).body.code, 'CONTEXT_EXPIRED');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual((await request(url, 'GET', `/v1/jobs/${accepted.jobId}`, undefined, token)).body, expired);
  assert.deepEqual(fs.readdirSync(path.join(app.directory, 'images')), []);
  assert.deepEqual(fs.readdirSync(path.join(app.directory, 'translations')), []);
});

test('a short download credential expires independently; job lookup renews it without changing content, attempt or revision', async t => {
  const app = await controlled(t, { artifactUrlTtlMs: 1000 }); const { url, token } = app;
  const source = await uploaded(url, token); const input = { ...source.body.input }; delete input.inputKind;
  const accepted = (await request(url, 'POST', '/v1/jobs', { ...source.body, kind: 'image_translation', input }, token, 'translation')).body;
  const ready = await finished(url, token, accepted.jobId);
  const first = await fetch(ready.output.artifact.remoteUrl, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(first.status, 200); const bytes = Buffer.from(await first.arrayBuffer());
  app.advance(1001);
  assert.equal((await fetch(ready.output.artifact.remoteUrl, { headers: { Authorization: `Bearer ${token}` } })).status, 410);
  const renewed = (await request(url, 'GET', `/v1/jobs/${ready.jobId}`, undefined, token)).body;
  assert.notEqual(renewed.output.artifact.remoteUrl, ready.output.artifact.remoteUrl);
  assert.equal(renewed.jobId, ready.jobId); assert.equal(renewed.attempt, ready.attempt); assert.equal(renewed.revision, ready.revision);
  assert.equal(renewed.output.artifact.id, ready.output.artifact.id);
  assert.deepEqual(Buffer.from(await (await fetch(renewed.output.artifact.remoteUrl, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer()), bytes);
  const unsigned = renewed.output.artifact.remoteUrl.split('?')[0];
  assert.equal((await fetch(unsigned, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
  const tampered = new URL(renewed.output.artifact.remoteUrl); tampered.searchParams.set('expires', String(app.now() + 9000));
  assert.equal((await fetch(tampered, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
});

test('early collection requires saved current files and no active job or newly prepared input, then expires the complete context', async t => {
  const app = await controlled(t, { savedContextRetentionMs: 100, translationDelayMs: 150 });
  const { url, token, service } = app; const source = await uploaded(url, token);
  const cards = await finished(url, token, (await request(url, 'POST', '/v1/jobs', source.body, token, 'cards')).body.jobId);
  await request(url, 'POST', `/v1/jobs/${cards.jobId}/ack`, { appliedRevision: cards.revision, locallySavedRevision: cards.revision, locallySavedArtifactIds: [] }, token);
  const input = { ...source.body.input }; delete input.inputKind;
  const accepted = (await request(url, 'POST', '/v1/jobs', { ...source.body, kind: 'image_translation', input }, token, 'translation')).body;
  app.advance(101); service.retention.sweep();
  assert.equal((await request(url, 'GET', `/v1/jobs/${cards.jobId}`, undefined, token)).body.state, 'succeeded');
  assert.ok(fs.readdirSync(path.join(app.directory, 'images')).length > 0);
  const translation = await finished(url, token, accepted.jobId);
  await request(url, 'POST', `/v1/jobs/${translation.jobId}/ack`, { appliedRevision: translation.revision, locallySavedRevision: translation.revision, locallySavedArtifactIds: [] }, token);
  app.advance(101); service.retention.sweep();
  assert.equal((await fetch(translation.output.artifact.remoteUrl, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  await request(url, 'POST', `/v1/jobs/${translation.jobId}/ack`, { appliedRevision: translation.revision, locallySavedRevision: translation.revision, locallySavedArtifactIds: [translation.output.artifact.id] }, token);
  // A fresh pending image is a material dependency even before its task exists.
  const append = structuredClone(source.bound); append.snapshotVersion += 1;
  append.snapshot.images.push({ imageId: 'pending-append', kind: 'menu', order: 1, assetId: null });
  await request(url, 'PUT', `/v1/contexts/${source.contextId}`, append, token);
  service.retention.sweep(); app.advance(101); service.retention.sweep();
  assert.equal((await request(url, 'GET', `/v1/jobs/${cards.jobId}`, undefined, token)).body.state, 'succeeded');
  // Explicitly replacing the unused pending snapshot does not automatically prove
  // its newer version was consumed; only hard expiry can now collect this scope.
  app.advance(10000); service.retention.sweep();
  assert.equal((await request(url, 'GET', `/v1/jobs/${cards.jobId}`, undefined, token)).body.state, 'expired');
  assert.deepEqual(fs.readdirSync(path.join(app.directory, 'images')), []);
});

test('fully saved outputs are collected after the configured grace, with a durable expiry fence across a real restart', async t => {
  const app = await controlled(t, { savedContextRetentionMs: 100 }); const { url, token, service } = app;
  const source = await uploaded(url, token); const cards = await finished(url, token, (await request(url, 'POST', '/v1/jobs', source.body, token, 'cards')).body.jobId);
  await request(url, 'POST', `/v1/jobs/${cards.jobId}/ack`, { appliedRevision: cards.revision, locallySavedRevision: cards.revision, locallySavedArtifactIds: [] }, token);
  service.retention.sweep(); app.advance(101);
  assert.equal(service.retention.sweep().find(item => item.contextId === source.contextId).cleaned, true);
  assert.equal((await request(url, 'GET', `/v1/jobs/${cards.jobId}`, undefined, token)).body.state, 'expired');
  const { start } = require('./support/http-service');
  // A second process reads the actual retained SQLite directory. Its clock is
  // before the original hard deadline, so only the persisted fence can reject.
  await app.stop();
  const restarted = await start(t, app.directory);
  assert.equal((await request(restarted.url, 'PUT', `/v1/contexts/${source.contextId}`, source.bound, token)).body.code, 'CONTEXT_EXPIRED');
  assert.equal((await request(restarted.url, 'GET', `/v1/jobs/${cards.jobId}`, undefined, token)).body.state, 'expired');
});

test('hard expiry after process death is enforced before interrupted work can restart, using the retained SQLite directory', async t => {
  const { start } = require('./support/http-service'); const directory = temporary(t);
  let process = await start(t, directory, { SEEFOOD_CONTEXT_RETENTION_MS: '1000', SEEFOOD_TRANSLATION_DELAY_MS: '5000' });
  const token = await session(process.url); const source = await uploaded(process.url, token);
  const input = { ...source.body.input }; delete input.inputKind;
  const job = (await request(process.url, 'POST', '/v1/jobs', { ...source.body, kind: 'image_translation', input }, token, 'translation')).body;
  await new Promise(resolve => setTimeout(resolve, 60)); await process.stop('SIGKILL');
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(job.expiresAt) - Date.now() + 25)));
  process = await start(t, directory);
  const expired = (await request(process.url, 'GET', `/v1/jobs/${job.jobId}`, undefined, token)).body;
  assert.equal(expired.state, 'expired'); assert.equal(expired.attempt, 1); assert.equal(expired.output, null);
  assert.equal((await request(process.url, 'POST', '/v1/jobs', source.body, token, 'late')).body.code, 'CONTEXT_EXPIRED');
  assert.deepEqual(fs.readdirSync(path.join(directory, 'images')), []);
  assert.deepEqual(fs.readdirSync(path.join(directory, 'translations')), []);
});
