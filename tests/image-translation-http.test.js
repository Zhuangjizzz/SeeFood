const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { temporary, start, request, session, uploaded, finished } = require('./support/http-service');

test('independent translation job delivers an owned real image from its frozen input and survives process restart', async (t) => {
  const directory = temporary(t); let service = await start(t, directory);
  const token = await session(service.url); const stranger = await session(service.url, 'demo-owner-b');
  const source = await uploaded(service.url, token);
  const cards = (await request(service.url, 'POST', '/v1/jobs', source.body, token, 'cards')).body;
  assert.equal((await finished(service.url, token, cards.jobId)).state, 'succeeded');
  const body = { ...source.body, kind: 'image_translation', input: { ...source.body.input } }; delete body.input.inputKind;
  const accepted = await request(service.url, 'POST', '/v1/jobs', body, token, 'translation');
  assert.equal(accepted.status, 202);
  const later = structuredClone(source.bound); later.snapshotVersion = 3; later.snapshot.images = [];
  await request(service.url, 'PUT', `/v1/contexts/${source.contextId}`, later, token);
  const job = await finished(service.url, token, accepted.body.jobId);
  assert.equal(job.state, 'succeeded'); assert.equal(job.output.state, 'ready');
  const image = job.output.artifact;
  assert.equal(image.imageId, 'real-image'); assert.equal(image.contentLanguage, 'en'); assert.equal(image.kind, 'translation');
  assert.equal(job.contextSnapshotVersion, 2); assert.notEqual(job.jobId, cards.jobId);
  assert.equal((await fetch(image.remoteUrl)).status, 401);
  assert.equal((await fetch(image.remoteUrl, { headers: { Authorization: `Bearer ${stranger}` } })).status, 403);
  const download = await fetch(image.remoteUrl, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(download.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await download.arrayBuffer()); const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, image.width); assert.equal(metadata.height, image.height);
  await service.stop(); service = await start(t, directory);
  const recovered = (await request(service.url, 'GET', `/v1/jobs/${job.jobId}`, undefined, token)).body;
  assert.equal(recovered.revision, job.revision); assert.equal(recovered.output.artifact.id, image.id);
  assert.deepEqual(Buffer.from(await (await fetch(recovered.output.artifact.remoteUrl, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer()), bytes);
});

test('Chinese menus and dish photos complete with not_required while translation failure leaves delivered cards readable', async (t) => {
  for (const [kind, language] of [['menu', 'zh-CN'], ['dish', 'en']]) {
    const service = await start(t, temporary(t)); const token = await session(service.url);
    const source = await uploaded(service.url, token, { kind });
    const body = { ...source.body, kind: 'image_translation', input: { contextSnapshotVersion: 2, assetId: source.asset.assetId, targetLanguage: language } };
    const accepted = await request(service.url, 'POST', '/v1/jobs', body, token, 'translation');
    const job = await finished(service.url, token, accepted.body.jobId);
    assert.equal(job.state, 'succeeded'); assert.equal(job.output.state, 'not_required'); assert.equal(job.output.artifact, undefined);
    assert.ok(job.output.reasonKey);
  }
  const service = await start(t, temporary(t), { SEEFOOD_MOCK_SCENARIO: 'translation-failure' }); const token = await session(service.url);
  const source = await uploaded(service.url, token);
  const card = (await request(service.url, 'POST', '/v1/jobs', source.body, token, 'cards')).body;
  const ready = await finished(service.url, token, card.jobId);
  const body = { ...source.body, kind: 'image_translation', input: { contextSnapshotVersion: 2, assetId: source.asset.assetId, targetLanguage: 'en' } };
  const accepted = (await request(service.url, 'POST', '/v1/jobs', body, token, 'translation')).body;
  assert.equal((await finished(service.url, token, accepted.jobId)).state, 'failed');
  assert.deepEqual((await request(service.url, 'GET', `/v1/jobs/${card.jobId}`, undefined, token)).body, ready);
});
