const test = require('node:test');
const assert = require('node:assert/strict');
const { temporary, start, request, session, uploaded, finished } = require('./support/http-service');

test('accepted image cards survive a killed process and deliver the bound version and actual record/image IDs', async (t) => {
  const directory = temporary(t); const service = await start(t, directory, { SEEFOOD_WORKER_DELAY_MS: '1000' });
  const token = await session(service.url); const source = await uploaded(service.url, token);
  const accepted = await request(service.url, 'POST', '/v1/jobs', source.body, token, 'one-job');
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.state, 'queued'); assert.equal(accepted.body.contextSnapshotVersion, 2);
  const later = structuredClone(source.bound); later.snapshotVersion = 3; later.snapshot.images = [];
  await request(service.url, 'PUT', `/v1/contexts/${source.contextId}`, later, token);
  await service.stop('SIGKILL');
  const restarted = await start(t, directory);
  const result = await finished(restarted.url, token, accepted.body.jobId);
  assert.equal(result.state, 'succeeded'); assert.equal(result.contextSnapshotVersion, 2);
  assert.equal(result.jobId, accepted.body.jobId); assert.equal(result.attempt, 1); assert.ok(result.revision > accepted.body.revision);
  assert.equal(result.output.cards[0].recordId, 'real-record');
  assert.deepEqual(result.output.cards[0].sourceImageIds, ['real-image']);
  assert.equal(result.output.cards[0].price.amount, '28'); assert.ok(result.output.cards[0].details.length >= 6);
  await restarted.stop(); const again = await start(t, directory);
  assert.deepEqual((await request(again.url, 'GET', `/v1/jobs/${result.jobId}`, undefined, token)).body, result);
});

test('menu, unknown-price, empty and uncertain dish generation preserve uncertainty and all requested content languages', async (t) => {
  for (const scenario of ['menu', 'unknown-price', 'no-cards', 'dish']) {
    const service = await start(t, temporary(t), { SEEFOOD_MOCK_SCENARIO: scenario }); const token = await session(service.url);
    for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
      const source = await uploaded(service.url, token, { id: `record-${scenario}-${language}`, kind: scenario === 'dish' ? 'dish' : 'menu' });
      source.body.input.targetLanguage = language;
      const accepted = await request(service.url, 'POST', '/v1/jobs', source.body, token, `${scenario}-${language}`);
      const result = await finished(service.url, token, accepted.body.jobId);
      assert.equal(result.state, 'succeeded');
      if (scenario === 'no-cards') { assert.deepEqual(result.output.cards, []); continue; }
      const card = result.output.cards[0]; assert.equal(card.contentLanguage, language);
      if (scenario === 'unknown-price' || scenario === 'dish') assert.equal(card.price.amount, null);
      if (scenario === 'dish') { assert.equal(card.nameZh, null); assert.equal(card.localizedName, null); }
      assert.ok(card.uncertainty.length > 0); assert.ok(card.details.length >= 6);
      if (language === 'ja') assert.match(card.summary, /模擬/);
      if (language === 'ko') assert.match(card.summary, /예시/);
      if (language === 'es') assert.match(card.summary, /ejemplo/);
      if (language === 'zh-CN') assert.match(card.summary, /模拟/);
    }
  }
});

test('job acceptance enforces owner, purpose, frozen image/asset/mode and both durable idempotency levels', async (t) => {
  const service = await start(t, temporary(t)); const a = await session(service.url); const b = await session(service.url, 'demo-owner-b');
  const source = await uploaded(service.url, a);
  const accepted = await request(service.url, 'POST', '/v1/jobs', source.body, a, 'submit'); assert.equal(accepted.status, 202);
  assert.equal((await request(service.url, 'GET', `/v1/jobs/${accepted.body.jobId}`, undefined, b)).status, 403);
  assert.equal((await request(service.url, 'POST', '/v1/jobs', source.body, b, 'submit')).status, 403);
  assert.deepEqual(await request(service.url, 'POST', '/v1/jobs', source.body, a, 'submit'), accepted);
  assert.equal((await request(service.url, 'POST', '/v1/jobs', source.body, a, 'new-key')).body.jobId, accepted.body.jobId);
  const changed = structuredClone(source.body); changed.input.targetLanguage = 'ja';
  for (const key of ['submit', 'changed-key']) assert.equal((await request(service.url, 'POST', '/v1/jobs', changed, a, key)).body.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await request(service.url, 'POST', '/v1/jobs', { ...source.body, owner: 'demo-owner-a' }, a, 'owner-in-body')).status, 400);
  for (const [suffix, edit] of [['pending', (body) => { body.input.contextSnapshotVersion = 1; }], ['wrong-mode', (body) => { body.input.inputKind = 'dish'; }], ['wrong-image', (body) => { body.target.imageId = 'another-image'; }], ['wrong-asset', (body) => { body.input.assetId = 'missing'; }]]) {
    const next = await uploaded(service.url, a, { id: suffix }); edit(next.body);
    assert.equal((await request(service.url, 'POST', '/v1/jobs', next.body, a, suffix)).body.code, 'DEPENDENCY_MISSING');
  }
  const communication = { purpose: 'communication', localScopeId: 'draft-one', snapshotVersion: 1,
    snapshot: { text: 'hello', sourceLanguage: 'en', targetLanguage: 'zh-CN', inputVersion: 1 } };
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/communication', communication, a)).status, 200);
  const wrongPurpose = { ...source.body, contextId: 'communication', input: { ...source.body.input, contextSnapshotVersion: 1 } };
  assert.equal((await request(service.url, 'POST', '/v1/jobs', wrongPurpose, a, 'purpose')).body.code, 'DEPENDENCY_MISSING');
});

test('generation cannot succeed from bytes changed after their frozen asset was accepted', async (t) => {
  const fs = require('node:fs'); const path = require('node:path'); const directory = temporary(t);
  const service = await start(t, directory, { SEEFOOD_WORKER_DELAY_MS: '400' }); const token = await session(service.url); const source = await uploaded(service.url, token);
  const accepted = await request(service.url, 'POST', '/v1/jobs', source.body, token, 'tampered');
  const file = path.join(directory, 'images', fs.readdirSync(path.join(directory, 'images'))[0]); const bytes = fs.readFileSync(file); bytes[100] ^= 1; fs.writeFileSync(file, bytes);
  const result = await finished(service.url, token, accepted.body.jobId);
  assert.equal(result.state, 'failed'); assert.equal(result.output, null); assert.equal(result.error.code, 'DEPENDENCY_MISSING');
});

test('a generation failure is a persisted failed job with no fabricated cards', async (t) => {
  const directory = temporary(t); const service = await start(t, directory, { SEEFOOD_MOCK_SCENARIO: 'failure' }); const token = await session(service.url);
  const source = await uploaded(service.url, token); const accepted = await request(service.url, 'POST', '/v1/jobs', source.body, token, 'failure');
  const result = await finished(service.url, token, accepted.body.jobId);
  assert.equal(result.state, 'failed'); assert.equal(result.error.retryable, true); assert.equal(result.output, null);
  await service.stop(); const restarted = await start(t, directory);
  assert.deepEqual((await request(restarted.url, 'GET', `/v1/jobs/${result.jobId}`, undefined, token)).body, result);
});
