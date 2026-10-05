const test = require('node:test');
const assert = require('node:assert/strict');
const { temporary, start, request, session, uploaded, finished } = require('./support/http-service');
const { getChatCopy } = require('../miniprogram/core/chat-copy');

async function menu(url, token, id = 'chat-record') {
  const data = await uploaded(url, token, { id });
  const accepted = await request(url, 'POST', '/v1/jobs', data.body, token, `${id}-cards`);
  const cards = (await finished(url, token, accepted.body.jobId)).output.cards;
  const snapshot = structuredClone(data.bound); snapshot.snapshotVersion = 3; snapshot.snapshot.cards = cards;
  await request(url, 'PUT', `/v1/contexts/${data.contextId}`, snapshot, token);
  return { ...data, snapshot, cards };
}
function chat(contextId, text = 'Explain the dishes on this menu.', target = { userMessageId: 'question-one', assistantMessageId: 'reply-one' }) {
  return { contextId, kind: 'chat', target, input: { contextSnapshotVersion: 3, text, targetLanguage: 'en' } };
}

test('record chat accepts stable paired messages, freezes its menu and persists replies across a real server restart', async (t) => {
  const directory = temporary(t); let server = await start(t, directory);
  const token = await session(server.url); const data = await menu(server.url, token);
  const body = chat(data.contextId);
  const accepted = await request(server.url, 'POST', '/v1/jobs', body, token, 'chat-once');
  assert.equal(accepted.status, 202);
  assert.equal((await request(server.url, 'POST', '/v1/jobs', body, token, 'chat-again')).body.jobId, accepted.body.jobId);
  assert.equal((await request(server.url, 'POST', '/v1/jobs', { ...body, input: { ...body.input, text: 'Changed question' } }, token, 'chat-once')).body.code, 'IDEMPOTENCY_CONFLICT');
  const next = structuredClone(data.snapshot); next.snapshotVersion = 4; next.snapshot.cards = []; next.snapshot.images = [];
  await request(server.url, 'PUT', `/v1/contexts/${data.contextId}`, next, token);
  const result = await finished(server.url, token, accepted.body.jobId);
  assert.equal(result.state, 'succeeded'); assert.equal(result.output.complete, true);
  assert.match(result.output.text, /示例炒饭/);
  assert.deepEqual(result.output.attachments, [{ type: 'dish_reference', cardId: data.cards[0].id }]);
  await server.stop(); server = await start(t, directory);
  assert.deepEqual((await request(server.url, 'GET', `/v1/jobs/${result.jobId}`, undefined, token)).body, result);
});

module.exports = { menu, chat };

test('a record allows one active chat and rejects reused message identities or foreign menu/history references', async (t) => {
  const server = await start(t, temporary(t), { SEEFOOD_WORKER_DELAY_MS: '300' });
  const token = await session(server.url); const other = await session(server.url, 'demo-owner-b');
  const data = await menu(server.url, token);
  assert.equal((await request(server.url, 'POST', '/v1/jobs', chat(data.contextId), other, 'foreign')).body.code, 'FORBIDDEN');
  const accepted = await request(server.url, 'POST', '/v1/jobs', chat(data.contextId), token, 'first-chat');
  assert.equal(accepted.status, 202);
  const second = chat(data.contextId, 'Another question', { userMessageId: 'question-two', assistantMessageId: 'reply-two' });
  assert.equal((await request(server.url, 'POST', '/v1/jobs', second, token, 'concurrent-chat')).body.code, 'JOB_STATE_CONFLICT');
  await finished(server.url, token, accepted.body.jobId);
  assert.equal((await request(server.url, 'GET', `/v1/jobs/${accepted.body.jobId}`, undefined, other)).body.code, 'FORBIDDEN');
  assert.equal((await request(server.url, 'POST', '/v1/jobs', { ...second, target: { ...second.target, userMessageId: 'question-one' } }, token, 'reuse-one-id')).body.code, 'IDEMPOTENCY_CONFLICT');
  const otherRecord = await menu(server.url, token, 'another-record');
  assert.equal((await request(server.url, 'POST', '/v1/jobs', chat(otherRecord.contextId), token, 'reuse-foreign-record-pair')).body.code, 'DEPENDENCY_MISSING');
  for (const [label, change] of [
    ['foreign-card', (s) => { s.snapshot.cards[0].recordId = 'another-record'; }],
    ['foreign-source', (s) => { s.snapshot.cards[0].sourceImageIds = ['unknown-image']; }],
    ['included-current', (s) => { s.snapshot.messages = [{ id: 'question-two', role: 'user', text: 'Current question', contentLanguage: 'en', inReplyTo: null, preferencesVersion: 1, attachments: [] }]; }],
    ['foreign-history', (s) => { s.snapshot.messages = [{ id: 'old-user', role: 'user', text: 'Old', contentLanguage: 'en', inReplyTo: null, preferencesVersion: 1, attachments: [] }, { id: 'old-reply', role: 'assistant', text: 'Old reply', contentLanguage: 'en', inReplyTo: 'old-user', preferencesVersion: 1, attachments: [{ type: 'dish_reference', cardId: 'unknown-card' }] }]; }]
  ]) {
    const snapshot = structuredClone(data.snapshot); snapshot.snapshotVersion = 4 + ['foreign-card', 'foreign-source', 'included-current', 'foreign-history'].indexOf(label); change(snapshot);
    const published = await request(server.url, 'PUT', `/v1/contexts/${data.contextId}`, snapshot, token);
    if (published.status < 400) assert.equal((await request(server.url, 'POST', '/v1/jobs', { ...second, input: { ...second.input, contextSnapshotVersion: snapshot.snapshotVersion } }, token, label)).body.code, 'DEPENDENCY_MISSING');
    else assert.equal(published.body.code, 'DEPENDENCY_MISSING');
  }
});

test('fixed localized replies cover explanation, recommendation, decimal reference prices and complete communication attachments', async (t) => {
  const server = await start(t, temporary(t)); const token = await session(server.url); const data = await menu(server.url, token);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    for (const question of getChatCopy(language).questions) {
      const body = chat(data.contextId, question.text, { userMessageId: `${language}-${question.id}-user`, assistantMessageId: `${language}-${question.id}-assistant` });
      body.input.targetLanguage = language;
      const accepted = await request(server.url, 'POST', '/v1/jobs', body, token, `${language}-${question.id}`);
      assert.equal(accepted.status, 202);
      const result = await finished(server.url, token, accepted.body.jobId);
      assert.equal(result.state, 'succeeded'); assert.equal(result.output.contentLanguage, language);
      assert.match(result.output.text, /示例炒饭/);
      if (question.id === 'price') assert.match(result.output.text, /2 × CNY 28 = CNY 56/);
      if (question.id === 'communicate') {
        const attachment = result.output.attachments.find((item) => item.type === 'communication_card');
        assert.ok(attachment); assert.equal(attachment.card.pairedLanguage, language);
        assert.match(attachment.card.textZh, /示例炒饭/);
        assert.equal(language === 'zh-CN' ? attachment.card.pairedText : !!attachment.card.pairedText, language === 'zh-CN' ? null : true);
      } else assert.ok(result.output.attachments.some((item) => item.type === 'dish_reference' && item.cardId === data.cards[0].id));
    }
  }
});

test('known cards and completed message IDs cannot be rebound to another record by rewriting the snapshot fields', async (t) => {
  const server = await start(t, temporary(t)); const token = await session(server.url);
  const own = await menu(server.url, token, 'own-menu'); const other = await menu(server.url, token, 'other-menu');
  const previousBody = chat(other.contextId, 'Hello', { userMessageId: 'other-question', assistantMessageId: 'other-reply' });
  const previous = await request(server.url, 'POST', '/v1/jobs', previousBody, token, 'other-chat'); await finished(server.url, token, previous.body.jobId);
  const forged = structuredClone(own.snapshot); forged.snapshotVersion = 4;
  forged.snapshot.cards[0].id = other.cards[0].id;
  await request(server.url, 'PUT', `/v1/contexts/${own.contextId}`, forged, token);
  const body = chat(own.contextId); body.input.contextSnapshotVersion = 4;
  assert.equal((await request(server.url, 'POST', '/v1/jobs', body, token, 'forged-card')).body.code, 'DEPENDENCY_MISSING');
  const history = structuredClone(own.snapshot); history.snapshotVersion = 5;
  history.snapshot.messages = [{ id: 'other-question', role: 'user', text: 'Hello', contentLanguage: 'en', inReplyTo: null, preferencesVersion: 1, attachments: [] },
    { id: 'other-reply', role: 'assistant', text: 'A reply', contentLanguage: 'en', inReplyTo: 'other-question', preferencesVersion: 1, attachments: [] }];
  await request(server.url, 'PUT', `/v1/contexts/${own.contextId}`, history, token);
  body.input.contextSnapshotVersion = 5;
  assert.equal((await request(server.url, 'POST', '/v1/jobs', body, token, 'forged-history')).body.code, 'DEPENDENCY_MISSING');
  const stranger = await session(server.url, 'demo-owner-b'); const strangerMenu = await menu(server.url, stranger, 'stranger-menu');
  const foreign = structuredClone(strangerMenu.snapshot); foreign.snapshotVersion = 4; foreign.snapshot.cards[0].id = own.cards[0].id;
  await request(server.url, 'PUT', `/v1/contexts/${strangerMenu.contextId}`, foreign, stranger);
  const foreignBody = chat(strangerMenu.contextId); foreignBody.input.contextSnapshotVersion = 4;
  assert.equal((await request(server.url, 'POST', '/v1/jobs', foreignBody, stranger, 'forged-owner')).body.code, 'FORBIDDEN');
});

test('unknown prices stay unknown and generated chat failure persists without becoming an empty completed reply', async (t) => {
  for (const scenario of ['unknown-price', 'chat-failure']) {
    const server = await start(t, temporary(t), { SEEFOOD_MOCK_SCENARIO: scenario });
    const token = await session(server.url); const data = await menu(server.url, token);
    const body = chat(data.contextId, 'Show a reference price for two portions of a dish.');
    const accepted = await request(server.url, 'POST', '/v1/jobs', body, token, scenario);
    const result = await finished(server.url, token, accepted.body.jobId);
    if (scenario === 'unknown-price') {
      assert.equal(result.state, 'succeeded'); assert.match(result.output.text, /price or currency is unknown/); assert.doesNotMatch(result.output.text, / = |NaN/);
    } else {
      assert.equal(result.state, 'failed'); assert.equal(result.output, null); assert.equal(result.error.code, 'TEMPORARY_FAILURE');
      assert.deepEqual((await request(server.url, 'GET', `/v1/jobs/${result.jobId}`, undefined, token)).body, result);
    }
  }
});

test('the shared service rejects generated dish references outside the frozen record', async (t) => {
  const { createService } = await import('../server/service.ts'); const { chatHandler } = await import('../server/chat.ts');
  const service = createService({ dataDir: temporary(t), enableDevSession: true, devIdentities: ['demo-owner-a'], jobHandlers: { chat: {
    ...chatHandler(), generate: async () => ({ text: 'Invalid generated attachment', contentLanguage: 'en', complete: true, attachments: [{ type: 'dish_reference', cardId: 'not-in-this-menu' }] })
  } } });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const url = `http://127.0.0.1:${service.server.address().port}`; const token = await session(url); const data = await menu(url, token);
  const accepted = await request(url, 'POST', '/v1/jobs', chat(data.contextId), token, 'invalid-generation');
  const result = await finished(url, token, accepted.body.jobId);
  assert.equal(result.state, 'failed'); assert.equal(result.output, null); assert.equal(result.error.code, 'DEPENDENCY_MISSING');
});
