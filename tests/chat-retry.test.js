const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { temporary, start, request, session, uploaded, finished } = require('./support/http-service');
async function until(operation, predicate) {
  for (let i = 0; i < 300; i += 1) { const value = await operation(); if (predicate(value)) return value; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail('expected public state was not reached');
}
async function chatMenu(url, token) {
  const menu = await uploaded(url, token); const accepted = await request(url, 'POST', '/v1/jobs', menu.body, token, 'cards');
  const cards = (await finished(url, token, accepted.body.jobId)).output.cards;
  const snapshot = structuredClone(menu.bound); snapshot.snapshotVersion = 3; snapshot.snapshot.cards = cards;
  await request(url, 'PUT', `/v1/contexts/${menu.contextId}`, snapshot, token);
  return { contextId: menu.contextId, kind: 'chat', target: { userMessageId: 'partial-question', assistantMessageId: 'partial-answer' }, input: { contextSnapshotVersion: 3, text: 'Explain the dishes on this menu.', targetLanguage: 'en' } };
}

test('partial chat is durable while running, survives process death, and same-job retry replaces the incomplete output', async (t) => {
  const directory = temporary(t); const env = { SEEFOOD_MOCK_SCENARIO: 'chat-partial-failure', SEEFOOD_CHAT_PARTIAL_DELAY_MS: '350' };
  let server = await start(t, directory, env); const token = await session(server.url); const body = await chatMenu(server.url, token);
  const accepted = (await request(server.url, 'POST', '/v1/jobs', body, token, 'partial-request')).body;
  const partial = await until(async () => (await request(server.url, 'GET', `/v1/jobs/${accepted.jobId}`, undefined, token)).body, (job) => job.output?.complete === false);
  assert.equal(partial.state, 'running'); assert.ok(partial.output.text.length > 0);
  await server.stop('SIGKILL'); server = await start(t, directory, env);
  const failed = await finished(server.url, token, accepted.jobId);
  assert.equal(failed.state, 'failed'); assert.equal(failed.output.complete, false); assert.equal(failed.output.text, partial.output.text);
  assert.ok(failed.revision > partial.revision);
  const retry = await request(server.url, 'POST', `/v1/jobs/${accepted.jobId}/retry`, { expectedAttempt: 1 }, token, 'retry-partial');
  assert.equal(retry.status, 202); assert.equal(retry.body.jobId, accepted.jobId); assert.deepEqual(retry.body.target, body.target);
  assert.equal(retry.body.output, null); assert.equal(retry.body.attempt, 2);
  const done = await finished(server.url, token, accepted.jobId);
  assert.equal(done.state, 'succeeded'); assert.equal(done.output.complete, true); assert.ok(done.output.text.startsWith(partial.output.text));
  assert.notEqual(done.output.text, partial.output.text); assert.ok(done.revision > retry.body.revision);
  await server.stop(); server = await start(t, directory, env);
  assert.deepEqual((await request(server.url, 'GET', `/v1/jobs/${done.jobId}`, undefined, token)).body, done);
});

const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
async function setup(t, env = { SEEFOOD_MOCK_SCENARIO: 'chat-partial-failure' }) {
  const disk = recordPlatform(t); const directory = temporary(t); const server = await start(t, directory, env); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => { traffic.push({ method: options.method, url: options.url, body: structuredClone(options.data), key: options.header['Idempotency-Key'] });
    fetch(options.url, { method: options.method, headers: options.header, body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const data = await response.text(); options.success({ statusCode: response.status, data: data ? JSON.parse(data) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend }); services.application.chooseLanguage('en');
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' }); const saved = await services.records.confirmCapture(capture.confirm().batch); const id = saved.recordId;
  await services.uploads.uploadRecord(id); await services.jobs.startImageCards(id);
  return { disk, directory, server, backend, services, traffic, id };
}

test('public chat retry keeps the same question/reply, preserves failed fragments while waiting, then saves one complete replacement', async (t) => {
  const { disk, backend, services, id, traffic } = await setup(t);
  const observed = []; const unsubscribe = services.chat.subscribe(() => observed.push(services.chat.getState(id)));
  assert.equal((await services.chat.sendQuickQuestion(id, 'explain')).ok, true);
  const before = services.records.getRecord(id).record; const key = before.messages[1].id; const failed = before.chatJobs[key];
  assert.ok(observed.some((state) => state.messages[1]?.state === 'partial' && state.messages[1].complete === false));
  assert.equal(before.messages[1].state, 'failed'); assert.equal(before.messages[1].complete, false);
  assert.equal((await services.chat.retryReply(id, key)).ok, true);
  const after = services.records.getRecord(id).record;
  assert.deepEqual(after.messageIds, before.messageIds); assert.equal(after.messages.length, 2); assert.equal(after.messages[0].text, before.messages[0].text);
  assert.ok(observed.some((state) => state.messages[1]?.state === 'retrying' && state.messages[1].text === before.messages[1].text));
  assert.equal(after.messages[1].state, 'complete'); assert.equal(after.messages[1].complete, true);
  assert.equal(after.chatJobs[key].jobId, failed.jobId); assert.equal(after.chatJobs[key].attempt, 2); assert.ok(after.chatJobs[key].revision > failed.revision);
  assert.notEqual(after.messages[1].text, before.messages[1].text);
  assert.equal(after.messages[1].text.split('示例炒饭').length - 1, 1);
  const stable = structuredClone(after);
  for (const change of [(job) => ({ ...failed, revision: job.revision + 200 }), (job) => ({ ...job, attempt: 3, revision: job.revision + 1 }), (job) => ({ ...job, revision: job.revision - 1 })]) {
    assert.equal(services.chat.applyJob(id, change(after.chatJobs[key])).error, 'stale-job');
    assert.deepEqual(services.records.getRecord(id).record.messages, stable.messages);
  }
  unsubscribe(); disk.platform.request = (options) => options.fail(new Error('offline'));
  const reopened = createWechatServices(disk.platform, { backend }); assert.deepEqual(reopened.chat.getState(id).messages, stable.messages);
  const mark = traffic.length; assert.equal((await reopened.chat.refreshRecord(id)).ok, true); assert.equal(traffic.length, mark);
});

test('undelivered question stays the same pending pair on GET-only reopen; explicit continuation proves absence then reuses the original request', async (t) => {
  const { disk, backend, services, id, traffic } = await setup(t, {}); const send = disk.platform.request; let dropped;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.data.kind === 'chat') { dropped = { body: structuredClone(options.data), key: options.header['Idempotency-Key'] }; options.fail(new Error('never sent')); return; }
    send(options);
  };
  assert.equal((await services.chat.send(id, 'Question retained once')).error, 'network-unavailable');
  const saved = services.records.getRecord(id).record; const key = saved.messages[1].id;
  disk.platform.request = send; const reopened = createWechatServices(disk.platform, { backend }); let mark = traffic.length;
  assert.equal((await reopened.chat.refreshRecord(id)).ok, true);
  assert.equal(traffic.slice(mark).some((event) => event.method === 'POST'), false);
  assert.deepEqual(reopened.records.getRecord(id).record.messageIds, saved.messageIds);
  const page = chatPage(t, reopened); page.onLoad({ recordId: id }); page.onShow(); await reopened.chat.refreshRecord(id);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    reopened.application.chooseLanguage(language); page.show();
    assert.equal(page.data.messages[1].canContinue, true); assert.equal(page.data.messages[1].statusLabel, page.data.chatCopy.sendUnconfirmed);
  }
  page.onInput({ detail: { value: 'Leave the next question alone' } });
  mark = traffic.length;
  assert.equal((await page.continueSend({ currentTarget: { dataset: { id: key } } })).ok, true);
  assert.equal(page.data.draft, 'Leave the next question alone'); page.onUnload();
  const events = traffic.slice(mark); const posted = events.filter((event) => event.method === 'POST'); assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].body, dropped.body); assert.equal(posted[0].key, dropped.key);
  assert.ok(events.findIndex((event) => event.method === 'GET' && event.url.includes('/contexts/')) < events.indexOf(posted[0]));
  assert.deepEqual(reopened.records.getRecord(id).record.messageIds, saved.messageIds);
  assert.equal(reopened.chat.getState(id).messages[1].state, 'complete');
});

function chatPage(t, services) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp }; t.after(() => Object.assign(global, previous));
  global.getApp = () => ({ services }); global.wx = { setNavigationBarTitle() {} };
  let definition; global.Page = (value) => { definition = value; };
  const file = require.resolve('../miniprogram/pages/chat/chat'); delete require.cache[file]; require(file);
  return { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
}

test('chat page exposes incomplete and explicit recovery actions in five locales while retry never sends or clears the editable next question', async (t) => {
  const { services, id, traffic } = await setup(t); await services.chat.sendQuickQuestion(id, 'explain');
  const page = chatPage(t, services); page.onLoad({ recordId: id }); page.onShow();
  const failed = services.records.getRecord(id).record.messages[1];
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); page.show();
    const message = page.data.messages[1]; assert.equal(message.canRetry, true); assert.ok(page.data.chatCopy.retryReply);
    assert.ok(page.data.chatCopy.retrying); assert.ok(page.data.chatCopy.continueSend); assert.ok(message.statusLabel);
    assert.equal(message.text, failed.text); assert.equal(message.contentLanguage, 'en');
  }
  page.onInput({ detail: { value: 'Keep this unsubmitted question' } });
  const event = { currentTarget: { dataset: { id: failed.id } } }; const mark = traffic.length;
  const retry = page.retryReply(event); page.onInput({ detail: { value: 'Still typing during retry' } });
  await Promise.all([retry, page.retryReply(event)]);
  assert.equal(page.data.draft, 'Still typing during retry'); assert.equal(page.data.messages.length, 2);
  assert.equal(page.data.messages[1].state, 'complete'); assert.equal(page.data.messages[1].canRetry, false);
  const posts = traffic.slice(mark).filter((entry) => entry.method === 'POST'); assert.equal(posts.length, 1); assert.ok(posts[0].url.endsWith('/retry'));
  page.onUnload();
});

test('lost and undelivered retry requests retain one intent across client and server restart; reopening only reads and explicit retry reuses its key', async (t) => {
  for (const mode of ['lost', 'undelivered']) {
    const { disk, services, backend, directory, server, id, traffic } = await setup(t);
    await services.chat.send(id, 'Question needing retry'); const before = services.records.getRecord(id).record; const key = before.messages[1].id;
    const send = disk.platform.request; let original;
    disk.platform.request = (options) => {
      if (options.url.endsWith('/retry')) {
        original = { body: structuredClone(options.data), key: options.header['Idempotency-Key'] };
        if (mode === 'undelivered') { options.fail(new Error('not delivered')); return; }
        options.success = () => options.fail(new Error('accepted reply lost'));
      }
      send(options);
    };
    assert.equal((await services.chat.retryReply(id, key)).error, 'network-unavailable');
    assert.ok(services.records.getRecord(id).record.chatRetries[key]);
    assert.equal((await services.chat.send(id, 'Do not implicitly send this')).error, 'JOB_STATE_CONFLICT');
    await server.stop('SIGKILL'); const restarted = await start(t, directory, { SEEFOOD_MOCK_SCENARIO: 'chat-partial-failure' }); backend.baseUrl = restarted.url;
    disk.platform.request = send; const reopened = createWechatServices(disk.platform, { backend }); let mark = traffic.length;
    assert.equal((await reopened.chat.refreshRecord(id)).ok, true);
    assert.equal(traffic.slice(mark).some((entry) => entry.method === 'POST' && entry.url.includes('/v1/jobs')), false);
    if (mode === 'undelivered') {
      assert.equal(reopened.chat.getState(id).messages[1].state, 'failed');
      assert.equal(reopened.chat.getState(id).messages[1].text, before.messages[1].text);
      mark = traffic.length; assert.equal((await reopened.chat.retryReply(id, key)).ok, true);
      const posts = traffic.slice(mark).filter((entry) => entry.method === 'POST'); assert.equal(posts.length, 1);
      assert.equal(posts[0].key, original.key); assert.deepEqual(posts[0].body, original.body);
    }
    assert.deepEqual(reopened.records.getRecord(id).record.messageIds, before.messageIds);
    assert.equal(reopened.chat.getState(id).messages[1].complete, true);
    assert.equal(reopened.records.getRecord(id).record.chatJobs[key].attempt, 2);
    assert.equal(reopened.records.getRecord(id).record.chatRetries[key], undefined);
  }
});

test('storage faults before intent and after accepted retry cannot create another attempt or replace a higher unsaved reply', async (t) => {
  const { disk, services, id, traffic } = await setup(t); await services.chat.send(id, 'Retry after save failure');
  const before = services.records.getRecord(id).record; const key = before.messages[1].id; const write = disk.storage.set; const send = disk.platform.request;
  disk.storage.set = () => { throw new Error('full before retry'); }; let mark = traffic.length;
  assert.equal((await services.chat.retryReply(id, key)).error, 'storage-write'); assert.equal(traffic.slice(mark).some((entry) => entry.method === 'POST'), false);
  disk.storage.set = write;
  disk.platform.request = (options) => {
    if (options.url.endsWith('/retry')) { const success = options.success; options.success = (response) => { disk.storage.set = () => { throw new Error('accepted but not stored'); }; success(response); }; }
    send(options);
  };
  assert.equal((await services.chat.retryReply(id, key)).error, 'storage-write');
  const retained = services.chat.getState(id).unsavedJob; assert.equal(retained.attempt, 2);
  assert.equal(services.chat.applyJob(id, { ...before.chatJobs[key], revision: retained.revision + 100 }).error, 'stale-job');
  assert.deepEqual(services.chat.getState(id).unsavedJob, retained);
  disk.storage.set = write; disk.platform.request = send; mark = traffic.length;
  assert.equal((await services.chat.retryReply(id, key)).ok, true);
  assert.equal(traffic.slice(mark).some((entry) => entry.url.endsWith('/retry')), false);
  assert.equal(services.chat.getState(id).messages[1].complete, true); assert.equal(services.records.getRecord(id).record.chatJobs[key].attempt, 2);
});

test('an older failed reply cannot be retried while another question is active, even from a fresh client or direct HTTP', async (t) => {
  const { disk, services, id, backend, traffic } = await setup(t, { SEEFOOD_MOCK_SCENARIO: 'chat-partial-failure', SEEFOOD_CHAT_PARTIAL_DELAY_MS: '600' });
  await services.chat.send(id, 'Older failed question'); const first = services.records.getRecord(id).record; const key = first.messages[1].id;
  const second = services.chat.send(id, 'A newer question is running');
  await until(() => services.chat.getState(id), (state) => state.messages[3]?.state === 'partial');
  let mark = traffic.length; assert.equal((await services.chat.retryReply(id, key)).error, 'JOB_STATE_CONFLICT');
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal((await reopened.chat.retryReply(id, key)).error, 'JOB_STATE_CONFLICT');
  assert.equal(traffic.slice(mark).some((entry) => entry.url.endsWith('/retry')), false);
  assert.equal(reopened.records.getRecord(id).record.chatRetries?.[key], undefined);
  await assert.rejects(services.backend.retryJob(first.chatJobs[key].jobId, { expectedAttempt: 1 }, 'bypass-client'), (error) => error.code === 'JOB_STATE_CONFLICT');
  await second; assert.equal(services.records.getRecord(id).record.messages.length, 4);
});

test('a newer unsaved failed partial remains incomplete and cannot be erased by an older delivered fragment', async (t) => {
  const { disk, services, id } = await setup(t); const send = disk.platform.request; const write = disk.storage.set;
  disk.platform.request = (options) => {
    if (options.method === 'GET' && options.url.includes('/v1/jobs/')) {
      const success = options.success; options.success = (response) => {
        if (response.data.kind === 'chat' && response.data.output?.complete === false) disk.storage.set = () => { throw new Error('no space for partial'); };
        success(response);
      };
    }
    send(options);
  };
  assert.equal((await services.chat.send(id, 'Show partial content')).error, 'storage-write');
  const partial = services.chat.getState(id).unsavedJob; assert.equal(partial.state, 'running');
  assert.equal(services.chat.getState(id).messages[1].state, 'partial'); assert.equal(services.chat.getState(id).messages[1].complete, false);
  const failed = await until(() => services.backend.getJob(partial.jobId), (job) => job.state === 'failed');
  assert.equal(services.chat.applyJob(id, failed).error, 'storage-write');
  const state = services.chat.getState(id); assert.equal(state.messages[1].state, 'failed'); assert.equal(state.messages[1].text, partial.output.text); assert.equal(state.messages[1].unsaved, true);
  assert.equal(services.chat.applyJob(id, partial).error, 'stale-job'); assert.deepEqual(services.chat.getState(id).unsavedJob, failed);
  disk.storage.set = write; disk.platform.request = send;
  assert.equal(services.chat.retrySave(id).ok, true); assert.equal(services.chat.getState(id).unsavedJob, null);
  assert.equal(services.records.getRecord(id).record.messages[1].complete, false); assert.equal(services.records.getRecord(id).record.messages[1].state, 'failed');
});

test('a saved partial question recovers by lookup after connection loss, fresh client and actual backend restart', async (t) => {
  const { disk, services, backend, directory, server, id, traffic } = await setup(t, { SEEFOOD_MOCK_SCENARIO: 'chat-partial-failure', SEEFOOD_CHAT_PARTIAL_DELAY_MS: '1200' });
  const send = disk.platform.request; let partialSeen = false;
  disk.platform.request = (options) => {
    if (options.method === 'GET' && options.url.includes('/v1/jobs/')) {
      if (partialSeen) { options.fail(new Error('left while partial')); return; }
      const success = options.success; options.success = (response) => { if (response.data.kind === 'chat' && response.data.output?.complete === false) partialSeen = true; success(response); };
    }
    send(options);
  };
  assert.equal((await services.chat.send(id, 'Recover this partial question')).error, 'network-unavailable');
  const saved = services.records.getRecord(id).record; assert.equal(saved.messages[1].state, 'partial');
  await server.stop('SIGKILL'); const restarted = await start(t, directory, { SEEFOOD_MOCK_SCENARIO: 'chat-partial-failure' }); backend.baseUrl = restarted.url;
  disk.platform.request = send; const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.chat.getState(id).messages[1].text, saved.messages[1].text);
  const mark = traffic.length; assert.equal((await reopened.chat.refreshRecord(id)).ok, true);
  assert.equal(traffic.slice(mark).some((entry) => entry.method === 'POST' && entry.url.includes('/v1/jobs')), false);
  const recovered = reopened.records.getRecord(id).record; assert.deepEqual(recovered.messageIds, saved.messageIds);
  assert.equal(recovered.messages[1].state, 'failed'); assert.equal(recovered.messages[1].complete, false); assert.equal(recovered.messages[1].text, saved.messages[1].text);
});

test('partial publication can finish in the same attempt and invalid partial attachments never become visible', async (t) => {
  const { createService } = await import('../server/service.ts'); const { chatHandler } = await import('../server/chat.ts');
  for (const invalid of [false, true]) {
    const handler = chatHandler(); let release; const wait = new Promise((resolve) => { release = resolve; });
    const service = createService({ dataDir: temporary(t), enableDevSession: true, devIdentities: ['demo-owner-a'], jobHandlers: { chat: { ...handler,
      async generate(context) {
        const output = await handler.generate(context);
        context.publishPartial({ ...output, text: 'A partial answer', complete: false, attachments: invalid ? [{ type: 'dish_reference', cardId: 'foreign-card' }] : [] });
        await wait; return output;
      }
    } } });
    await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => { release(); return service.close(); });
    const url = `http://127.0.0.1:${service.server.address().port}`; const token = await session(url); const body = await chatMenu(url, token);
    const accepted = (await request(url, 'POST', '/v1/jobs', body, token, 'same-attempt-partial')).body;
    if (invalid) {
      const failed = await finished(url, token, accepted.jobId); assert.equal(failed.state, 'failed'); assert.equal(failed.output, null); assert.equal(failed.error.code, 'DEPENDENCY_MISSING'); release();
    } else {
      const partial = await until(async () => (await request(url, 'GET', `/v1/jobs/${accepted.jobId}`, undefined, token)).body, (job) => job.output?.complete === false);
      assert.equal(partial.output.text, 'A partial answer'); release(); const done = await finished(url, token, accepted.jobId);
      assert.equal(done.attempt, partial.attempt); assert.equal(done.state, 'succeeded'); assert.ok(done.revision > partial.revision); assert.match(done.output.text, /示例炒饭/);
    }
  }
});
