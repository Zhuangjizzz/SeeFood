const test = require('node:test');
const assert = require('node:assert/strict');
const { temporary, start, request, session, finished } = require('./support/http-service');

function translation(contextId = 'conversation', overrides = {}) {
  const snapshot = { text: 'Please do not add peanuts. Thank you.', sourceLanguage: 'en', targetLanguage: 'zh-CN', inputVersion: 1, ...overrides };
  return {
    context: { purpose: 'communication', localScopeId: 'current-exchange', snapshotVersion: 1, snapshot },
    request: { contextId, kind: 'text_translation', target: { requestId: 'first-turn' }, input: { contextSnapshotVersion: 1, ...snapshot } }
  };
}

test('independent translation freezes text and language, survives an HTTP process kill, and stays private to its owner', async (t) => {
  const directory = temporary(t); const service = await start(t, directory, { SEEFOOD_WORKER_DELAY_MS: '10000' });
  const token = await session(service.url); const other = await session(service.url, 'demo-owner-b');
  const source = translation();
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/conversation', source.context, token)).status, 200);
  const accepted = await request(service.url, 'POST', '/v1/jobs', source.request, token, 'first-turn');
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.state, 'queued');
  assert.equal((await request(service.url, 'POST', '/v1/jobs', source.request, token, 'different-key')).body.jobId, accepted.body.jobId);
  const newer = structuredClone(source.context); newer.snapshotVersion = 2; newer.snapshot.text = 'A new unsent thought'; newer.snapshot.targetLanguage = 'ja'; newer.snapshot.inputVersion = 2;
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/conversation', newer, token)).status, 200);
  for (const [method, route, body] of [
    ['GET', `/v1/jobs/${accepted.body.jobId}`], ['GET', '/v1/contexts/conversation/jobs'],
    ['PUT', '/v1/contexts/conversation', source.context], ['POST', '/v1/jobs', source.request]
  ]) assert.equal((await request(service.url, method, route, body, other, 'other-turn')).status, 403);
  await service.stop('SIGKILL');
  const restarted = await start(t, directory);
  const result = await finished(restarted.url, token, accepted.body.jobId);
  assert.equal(result.state, 'succeeded'); assert.equal(result.attempt, 1);
  assert.deepEqual(result.output, { text: '请不要放花生，谢谢。', contentLanguage: 'zh-CN', inputVersion: 1 });
  assert.deepEqual((await request(restarted.url, 'GET', '/v1/contexts/conversation/jobs', undefined, token)).body.items.map((job) => job.jobId), [accepted.body.jobId]);
});

module.exports = { translation };

test('translation acceptance rejects text, language and version mismatches and other-purpose contexts', async (t) => {
  const service = await start(t, temporary(t)); const token = await session(service.url); const source = translation();
  await request(service.url, 'PUT', '/v1/contexts/conversation', source.context, token);
  for (const [key, value] of [['text', 'Changed'], ['sourceLanguage', 'ja'], ['targetLanguage', 'ko'], ['inputVersion', 2]]) {
    const altered = structuredClone(source.request); altered.input[key] = value; altered.target.requestId = key;
    assert.equal((await request(service.url, 'POST', '/v1/jobs', altered, token, key)).status, 409);
  }
  const record = { purpose: 'record', recordId: 'record', localScopeId: 'record', snapshotVersion: 1,
    snapshot: { images: [], cards: [], messages: [], preferences: { version: 1, allergies: [], restrictions: [], tastes: [], notes: '' } } };
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/record', record, token)).status, 200);
  assert.equal((await request(service.url, 'POST', '/v1/jobs', { ...source.request, contextId: 'record' }, token, 'record-text')).status, 409);
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/extra-record', { ...source.context, recordId: 'record' }, token)).status, 400);
  assert.deepEqual((await request(service.url, 'GET', '/v1/contexts/conversation/jobs', undefined, token)).body.items, []);
});
