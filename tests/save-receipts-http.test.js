const test = require('node:test');
const assert = require('node:assert/strict');
const { temporary, start, request, session, uploaded, finished } = require('./support/http-service');

test('receipt acknowledges displayed and persisted revisions independently and survives process restart', async (t) => {
  const directory = temporary(t); let service = await start(t, directory);
  const token = await session(service.url); const stranger = await session(service.url, 'demo-owner-b');
  const source = await uploaded(service.url, token);
  const accepted = (await request(service.url, 'POST', '/v1/jobs', source.body, token, 'cards')).body;
  const job = await finished(service.url, token, accepted.jobId);
  const path = `/v1/jobs/${job.jobId}/ack`;
  const shown = { appliedRevision: job.revision, locallySavedRevision: null, locallySavedArtifactIds: [] };
  assert.deepEqual(await request(service.url, 'POST', path, shown, token), { status: 200, body: { jobId: job.jobId, ...shown } });
  const stored = { ...shown, locallySavedRevision: job.revision };
  assert.deepEqual((await request(service.url, 'POST', path, stored, token)).body, { jobId: job.jobId, ...stored });
  assert.equal((await request(service.url, 'POST', path, { ...stored, appliedRevision: job.revision + 1 }, token)).status, 409);
  assert.equal((await request(service.url, 'POST', path, { ...stored, appliedRevision: accepted.revision }, token)).status, 409);
  assert.equal((await request(service.url, 'POST', path, stored, stranger)).status, 403);
  await service.stop('SIGKILL'); service = await start(t, directory);
  const old = { appliedRevision: accepted.revision, locallySavedRevision: null, locallySavedArtifactIds: [] };
  assert.deepEqual((await request(service.url, 'POST', path, old, token)).body, { jobId: job.jobId, ...stored });
});

test('only artifacts delivered by the acknowledged job are accepted and saved files remain available', async (t) => {
  const service = await start(t, temporary(t)); const token = await session(service.url);
  const one = await uploaded(service.url, token); const two = await uploaded(service.url, token, { id: 'other-record' });
  const generate = async (source) => {
    const input = { ...source.body.input }; delete input.inputKind;
    const job = (await request(service.url, 'POST', '/v1/jobs', { ...source.body, kind: 'image_translation', input }, token, source.contextId + '-translation')).body;
    return finished(service.url, token, job.jobId);
  };
  const first = await generate(one); const second = await generate(two);
  const body = { appliedRevision: first.revision, locallySavedRevision: first.revision, locallySavedArtifactIds: [second.output.artifact.id] };
  assert.equal((await request(service.url, 'POST', `/v1/jobs/${first.jobId}/ack`, body, token)).status, 409);
  body.locallySavedArtifactIds = [first.output.artifact.id];
  assert.deepEqual((await request(service.url, 'POST', `/v1/jobs/${first.jobId}/ack`, body, token)).body, { jobId: first.jobId, ...body });
  const old = { ...body, locallySavedRevision: null, locallySavedArtifactIds: [] };
  assert.deepEqual((await request(service.url, 'POST', `/v1/jobs/${first.jobId}/ack`, old, token)).body, { jobId: first.jobId, ...body });
  assert.equal((await fetch(first.output.artifact.remoteUrl, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
});

test('old receipts cannot release newer results or frozen inputs used by active jobs', async (t) => {
  const { createService } = await import('../server/service.ts');
  const service = createService({ dataDir: temporary(t), enableDevSession: true, devIdentities: ['demo-owner-a'], translationDelayMs: 800 });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const url = `http://127.0.0.1:${service.server.address().port}`; const token = await session(url); const source = await uploaded(url, token);
  const cards = await finished(url, token, (await request(url, 'POST', '/v1/jobs', source.body, token, 'cards')).body.jobId);
  assert.equal(service.retention.eligibility(cards.jobId, 'demo-owner-a').eligible, false);
  await request(url, 'POST', `/v1/jobs/${cards.jobId}/ack`, { appliedRevision: cards.revision, locallySavedRevision: cards.revision, locallySavedArtifactIds: [] }, token);
  assert.equal(service.retention.eligibility(cards.jobId, 'demo-owner-a').eligible, true);
  const input = { ...source.body.input }; delete input.inputKind;
  const translation = (await request(url, 'POST', '/v1/jobs', { ...source.body, kind: 'image_translation', input }, token, 'translation')).body;
  assert.equal(service.retention.eligibility(cards.jobId, 'demo-owner-a').reason, 'active-dependency');
  await request(url, 'POST', `/v1/jobs/${translation.jobId}/ack`, { appliedRevision: translation.revision, locallySavedRevision: translation.revision, locallySavedArtifactIds: [] }, token);
  const ready = await finished(url, token, translation.jobId);
  assert.equal(service.retention.eligibility(ready.jobId, 'demo-owner-a').eligible, false);
  assert.equal(service.retention.contextEligibility(source.contextId, 'demo-owner-a').eligible, false);
  await request(url, 'POST', `/v1/jobs/${ready.jobId}/ack`, { appliedRevision: ready.revision, locallySavedRevision: ready.revision, locallySavedArtifactIds: [] }, token);
  assert.equal(service.retention.eligibility(ready.jobId, 'demo-owner-a').reason, 'artifact-unsaved');
  await request(url, 'POST', `/v1/jobs/${ready.jobId}/ack`, { appliedRevision: ready.revision, locallySavedRevision: ready.revision, locallySavedArtifactIds: [ready.output.artifact.id] }, token);
  assert.equal(service.retention.contextEligibility(source.contextId, 'demo-owner-a').eligible, true);
});

test('undelivered intermediate revisions and not-yet-delivered images cannot be acknowledged', async (t) => {
  const service = await start(t, temporary(t)); const token = await session(service.url); const source = await uploaded(service.url, token);
  const input = { ...source.body.input }; delete input.inputKind;
  const accepted = (await request(service.url, 'POST', '/v1/jobs', { ...source.body, kind: 'image_translation', input }, token, 'translation')).body;
  await new Promise((resolve) => setTimeout(resolve, 200));
  const job = await finished(service.url, token, accepted.jobId);
  assert.equal(job.revision, 3);
  const route = `/v1/jobs/${job.jobId}/ack`;
  assert.equal((await request(service.url, 'POST', route, { appliedRevision: 2, locallySavedRevision: null, locallySavedArtifactIds: [] }, token)).status, 409);
  assert.equal((await request(service.url, 'POST', route, { appliedRevision: accepted.revision, locallySavedRevision: accepted.revision, locallySavedArtifactIds: [job.output.artifact.id] }, token)).status, 409);
});

test('a saved failure cannot release frozen material while retry remains available', async (t) => {
  const { createService } = await import('../server/service.ts');
  const service = createService({ dataDir: temporary(t), enableDevSession: true, devIdentities: ['demo-owner-a'], mockScenario: 'failure' });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const url = `http://127.0.0.1:${service.server.address().port}`; const token = await session(url); const source = await uploaded(url, token);
  const job = await finished(url, token, (await request(url, 'POST', '/v1/jobs', source.body, token, 'cards')).body.jobId);
  assert.equal(job.state, 'failed'); assert.equal(job.error.retryable, true);
  await request(url, 'POST', `/v1/jobs/${job.jobId}/ack`, { appliedRevision: job.revision, locallySavedRevision: job.revision, locallySavedArtifactIds: [] }, token);
  assert.equal(service.retention.eligibility(job.jobId, 'demo-owner-a').eligible, false);
  assert.equal((await request(url, 'POST', `/v1/jobs/${job.jobId}/retry`, { expectedAttempt: 1 }, token, 'retry')).status, 202);
});
