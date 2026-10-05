const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { temporary, start, request, session, finished } = require('./support/http-service');
const { createJobRecovery } = require('../miniprogram/core/recovery');

async function acceptedImages(url, token, count = 3, id = 'recovery-record') {
  const contextId = `${id}-context`;
  const snapshot = { purpose: 'record', recordId: id, localScopeId: id, snapshotVersion: 1, snapshot: {
    images: Array.from({ length: count }, (_, index) => ({ imageId: `${id}-image-${index}`, kind: 'menu', order: index, assetId: null })),
    cards: [], messages: [], preferences: { version: 1, allergies: [], restrictions: [], tastes: [], notes: '' } } };
  assert.equal((await request(url, 'PUT', `/v1/contexts/${contextId}`, snapshot, token)).status, 200);
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/menu-photo.png'));
  for (const image of snapshot.snapshot.images) {
    const upload = await request(url, 'POST', '/v1/uploads', { contextId, imageId: image.imageId, kind: image.kind,
      sizeBytes: bytes.length, mimeType: 'image/png' }, token, image.imageId);
    assert.equal((await fetch(upload.body.uploadUrl, { method: upload.body.uploadMethod, headers: upload.body.uploadHeaders, body: bytes })).status, 204);
    const asset = await request(url, 'POST', `/v1/uploads/${upload.body.uploadId}/complete`, { contextId, imageId: image.imageId }, token, image.imageId);
    image.assetId = asset.body.assetId;
  }
  snapshot.snapshotVersion = 2;
  assert.equal((await request(url, 'PUT', `/v1/contexts/${contextId}`, snapshot, token)).status, 200);
  const jobs = [];
  for (const image of snapshot.snapshot.images) {
    const body = { contextId, kind: 'image_cards', target: { imageId: image.imageId }, input: {
      contextSnapshotVersion: 2, assetId: image.assetId, inputKind: 'menu', targetLanguage: 'en' } };
    const accepted = await request(url, 'POST', '/v1/jobs', body, token, image.imageId);
    assert.equal(accepted.status, 202); jobs.push(accepted.body);
  }
  return { contextId, snapshot, jobs };
}

test('context recovery pages include every original task in stable order after an actual process kill', async (t) => {
  const directory = temporary(t);
  const service = await start(t, directory, { SEEFOOD_WORKER_DELAY_MS: '10000', SEEFOOD_JOB_PAGE_SIZE: '2' });
  const token = await session(service.url); const source = await acceptedImages(service.url, token);
  const first = await request(service.url, 'GET', `/v1/contexts/${source.contextId}/jobs`, undefined, token);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 2); assert.ok(first.body.nextCursor);
  assert.ok(first.body.items.every((job) => job.state === 'queued'));
  await service.stop('SIGKILL');
  const restarted = await start(t, directory, { SEEFOOD_JOB_PAGE_SIZE: '2' });
  const last = await request(restarted.url, 'GET', `/v1/contexts/${source.contextId}/jobs?cursor=${encodeURIComponent(first.body.nextCursor)}`, undefined, token);
  assert.equal(last.status, 200); assert.equal(last.body.items.length, 1); assert.equal(last.body.nextCursor, null);
  assert.deepEqual(first.body.items.concat(last.body.items).map((job) => job.jobId), source.jobs.map((job) => job.jobId).sort());
  assert.equal((await request(restarted.url, 'GET', `/v1/contexts/${source.contextId}/jobs`, undefined, await session(restarted.url, 'demo-owner-b'))).status, 403);
  assert.equal((await request(restarted.url, 'GET', `/v1/contexts/${source.contextId}/jobs?cursor=invalid`, undefined, token)).status, 400);
  assert.equal((await request(restarted.url, 'GET', `/v1/contexts/${source.contextId}/jobs?cursor=`, undefined, token)).status, 400);
});

module.exports = { acceptedImages };

test('the reusable recovery operation drains pages to find a requested last-page task and merges repeat delivery by its stable ID', async (t) => {
  const service = await start(t, temporary(t), { SEEFOOD_JOB_PAGE_SIZE: '1' });
  const token = await session(service.url); const source = await acceptedImages(service.url, token);
  const wanted = source.jobs.sort((a, b) => a.jobId.localeCompare(b.jobId)).at(-1);
  const ready = await finished(service.url, token, wanted.jobId);
  const image = source.snapshot.snapshot.images.find((entry) => entry.imageId === wanted.target.imageId);
  const requests = [{ contextId: source.contextId, kind: 'image_cards', target: wanted.target,
    input: { contextSnapshotVersion: 2, assetId: image.assetId, inputKind: 'menu', targetLanguage: 'en' } }];
  const delivered = new Map();
  const recovery = createJobRecovery({ backend: { async listContextJobs(contextId, cursor) {
    return (await request(service.url, 'GET', `/v1/contexts/${contextId}/jobs${cursor === undefined ? '' : '?cursor=' + encodeURIComponent(cursor)}`, undefined, token)).body;
  } } });
  const recover = () => recovery.recover({ contextId: source.contextId, requests, apply: async (job) => { delivered.set(job.jobId, job); return { ok: true }; } });
  assert.deepEqual(await recover(), { ok: true, jobIds: [wanted.jobId] });
  assert.deepEqual(await recover(), { ok: true, jobIds: [wanted.jobId] });
  assert.deepEqual([...delivered.values()], [ready]);
  const other = await acceptedImages(service.url, token, 1, 'another-record');
  const first = await request(service.url, 'GET', `/v1/contexts/${source.contextId}/jobs`, undefined, token);
  assert.equal((await request(service.url, 'GET', `/v1/contexts/${other.contextId}/jobs?cursor=${encodeURIComponent(first.body.nextCursor)}`, undefined, token)).status, 400);
});
