const test = require('node:test');
const assert = require('node:assert/strict');
const { temporary, start, request, session, uploaded, finished } = require('./support/http-service');

test('explicit stage retry preserves frozen input and monotonic revisions across crash/replay while success siblings stay intact', async (t) => {
  const directory = temporary(t); let service = await start(t, directory, { SEEFOOD_MOCK_SCENARIO: 'translation-failure' });
  const token = await session(service.url); const stranger = await session(service.url, 'demo-owner-b');
  const source = await uploaded(service.url, token);
  const cards = (await request(service.url, 'POST', '/v1/jobs', source.body, token, 'cards')).body;
  const delivered = await finished(service.url, token, cards.jobId);
  const translation = { ...source.body, kind: 'image_translation', input: { ...source.body.input } }; delete translation.input.inputKind;
  const accepted = (await request(service.url, 'POST', '/v1/jobs', translation, token, 'translation')).body;
  const failed = await finished(service.url, token, accepted.jobId); assert.equal(failed.error.retryable, true);
  const route = `/v1/jobs/${failed.jobId}/retry`;
  assert.equal((await request(service.url, 'POST', route, { expectedAttempt: 1 }, stranger, 'foreign')).status, 403);
  assert.equal((await request(service.url, 'POST', `/v1/jobs/${cards.jobId}/retry`, { expectedAttempt: 1 }, token, 'success')).body.code, 'JOB_STATE_CONFLICT');
  assert.equal((await request(service.url, 'POST', route, { expectedAttempt: 2 }, token, 'stale')).body.code, 'JOB_STATE_CONFLICT');
  const later = structuredClone(source.bound); later.snapshotVersion = 3; later.snapshot.images = [];
  await request(service.url, 'PUT', `/v1/contexts/${source.contextId}`, later, token);
  await service.stop(); service = await start(t, directory, { SEEFOOD_WORKER_DELAY_MS: '1000' });
  const retry = await request(service.url, 'POST', route, { expectedAttempt: 1 }, token, 'retry-one');
  assert.equal(retry.status, 202); assert.equal(retry.body.jobId, failed.jobId); assert.equal(retry.body.attempt, 2);
  assert.ok(retry.body.revision > failed.revision); assert.equal(retry.body.contextSnapshotVersion, 2);
  assert.deepEqual(await request(service.url, 'POST', route, { expectedAttempt: 1 }, token, 'retry-one'), retry);
  assert.equal((await request(service.url, 'POST', route, { expectedAttempt: 2 }, token, 'retry-one')).body.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await request(service.url, 'POST', route, { expectedAttempt: 1 }, token, 'another-key')).body.code, 'JOB_STATE_CONFLICT');
  await service.stop('SIGKILL'); service = await start(t, directory);
  const result = await finished(service.url, token, failed.jobId);
  assert.equal(result.state, 'succeeded'); assert.equal(result.attempt, 2); assert.ok(result.revision > retry.body.revision);
  assert.equal(result.output.artifact.contentLanguage, 'en'); assert.equal(result.output.artifact.imageId, 'real-image');
  assert.equal((await fetch(result.output.artifact.remoteUrl, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  assert.deepEqual((await request(service.url, 'GET', `/v1/jobs/${cards.jobId}`, undefined, token)).body, delivered);
  assert.deepEqual(await request(service.url, 'POST', route, { expectedAttempt: 1 }, token, 'retry-one'), retry);
  assert.equal((await request(service.url, 'POST', route, { expectedAttempt: 2 }, token, 'new-after-success')).body.code, 'JOB_STATE_CONFLICT');
});

test('non-retryable input damage cannot be retried and stale worker completion cannot overwrite a newer attempt', async (t) => {
  const { createService } = await import('../server/service.ts');
  const { imageCardsHandler } = await import('../server/image-cards.ts');
  const { ApiError } = await import('../server/contract.ts');
  const { once } = require('node:events');
  const directory = temporary(t); let releaseOld; let markOldStarted;
  const oldStarted = new Promise((resolve) => { markOldStarted = resolve; });
  const delayed = new Promise((resolve) => { releaseOld = resolve; });
  async function serve(handler) {
    const service = createService({ dataDir: directory, enableDevSession: true, devIdentities: ['demo-owner-a'], jobHandlers: { image_cards: handler } });
    service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
    t.after(() => service.close()); return `http://127.0.0.1:${service.server.address().port}`;
  }
  const normal = imageCardsHandler();
  const firstUrl = await serve({ ...normal, async generate(input) { markOldStarted(); await delayed; return normal.generate(input); } });
  t.after(() => releaseOld());
  const token = await session(firstUrl); const source = await uploaded(firstUrl, token);
  const accepted = (await request(firstUrl, 'POST', '/v1/jobs', source.body, token, 'original')).body;
  await oldStarted;
  const nextUrl = await serve({ ...normal, async generate(input) {
    if (input.job.attempt === 1) throw new ApiError(503, 'TEMPORARY_FAILURE', true);
    const output = await normal.generate(input); output.cards[0].summary = 'Current attempt'; return output;
  } });
  const failed = await finished(nextUrl, token, accepted.jobId);
  assert.equal(failed.state, 'failed');
  const retry = await request(nextUrl, 'POST', `/v1/jobs/${failed.jobId}/retry`, { expectedAttempt: 1 }, token, 'retry');
  assert.equal(retry.status, 202);
  const ready = await finished(nextUrl, token, failed.jobId);
  assert.equal(ready.output.cards[0].summary, 'Current attempt');
  releaseOld(); await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual((await request(nextUrl, 'GET', `/v1/jobs/${failed.jobId}`, undefined, token)).body, ready);
  const bad = await uploaded(nextUrl, token, { id: 'bad-bytes' });
  const fs = require('node:fs'); const path = require('node:path');
  for (const name of fs.readdirSync(path.join(directory, 'images'))) {
    const file = path.join(directory, 'images', name); const bytes = fs.readFileSync(file); bytes[100] ^= 1; fs.writeFileSync(file, bytes);
  }
  const badJob = (await request(nextUrl, 'POST', '/v1/jobs', bad.body, token, 'bad')).body;
  const damage = await finished(nextUrl, token, badJob.jobId);
  assert.equal(damage.error.retryable, false);
  assert.equal((await request(nextUrl, 'POST', `/v1/jobs/${badJob.jobId}/retry`, { expectedAttempt: 1 }, token, 'bad-retry')).body.code, 'JOB_STATE_CONFLICT');
});

test('retry shares the one-active-chat-per-record rule and keeps frozen question/message identities', async (t) => {
  const directory = temporary(t); let service = await start(t, directory, { SEEFOOD_MOCK_SCENARIO: 'chat-failure' });
  const token = await session(service.url); const source = await uploaded(service.url, token);
  const body = { contextId: source.contextId, kind: 'chat', target: { userMessageId: 'first-question', assistantMessageId: 'first-reply' },
    input: { contextSnapshotVersion: 2, text: 'My original question', targetLanguage: 'ja' } };
  const accepted = (await request(service.url, 'POST', '/v1/jobs', body, token, 'chat-one')).body;
  const failed = await finished(service.url, token, accepted.jobId); assert.equal(failed.state, 'failed');
  await service.stop(); service = await start(t, directory, { SEEFOOD_WORKER_DELAY_MS: '1000' });
  const secondBody = { ...body, target: { userMessageId: 'second-question', assistantMessageId: 'second-reply' } };
  const second = (await request(service.url, 'POST', '/v1/jobs', secondBody, token, 'chat-two')).body;
  const route = `/v1/jobs/${failed.jobId}/retry`;
  assert.equal((await request(service.url, 'POST', route, { expectedAttempt: 1 }, token, 'chat-retry')).body.code, 'JOB_STATE_CONFLICT');
  await finished(service.url, token, second.jobId);
  const retry = await request(service.url, 'POST', route, { expectedAttempt: 1 }, token, 'chat-retry'); assert.equal(retry.status, 202);
  const done = await finished(service.url, token, failed.jobId);
  assert.equal(done.attempt, 2); assert.equal(done.output.contentLanguage, 'ja'); assert.deepEqual(done.target, body.target);
  assert.equal(done.contextSnapshotVersion, 2);
});
