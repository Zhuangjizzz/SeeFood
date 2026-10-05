const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');
async function setup(t, env) {
  const disk = recordPlatform(t); const directory = temporary(t); const server = await start(t, directory, env); server.directory = directory;
  const traffic = []; const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => {
    traffic.push({ url: options.url, method: options.method, data: structuredClone(options.data) });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' }); const saved = await services.records.confirmCapture(capture.confirm().batch);
  assert.equal((await services.uploads.uploadRecord(saved.recordId)).ok, true);
  assert.equal((await services.jobs.startImageCards(saved.recordId)).ok, true);
  return { disk, services, backend, id: saved.recordId, traffic, server };
}

test('public chat sends localized questions with a frozen whole-record snapshot and saved preferences/history, then reopens offline', async (t) => {
  const { disk, services, backend, id, traffic, server } = await setup(t);
  services.application.chooseLanguage('ja');
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'peanuts'); services.preferences.save();
  services.preferences.beginEdit(); services.preferences.updateNotes('allergies', 'Unsaved change');
  const result = await services.chat.sendQuickQuestion(id, 'explain');
  assert.equal(result.ok, true);
  const first = services.records.getRecord(id).record;
  assert.equal(first.messages.length, 2); assert.equal(first.messages[0].text, 'このメニューの料理を説明してください。');
  assert.equal(first.messages[1].inReplyTo, first.messages[0].id);
  assert.equal(first.messages[1].state, 'complete'); assert.equal(first.messages[1].contentLanguage, 'ja');
  const sent = traffic.filter((item) => item.method === 'POST' && item.data.kind === 'chat')[0].data;
  const snapshot = traffic.find((item) => item.method === 'PUT' && item.data.snapshotVersion === sent.input.contextSnapshotVersion).data;
  assert.deepEqual(snapshot.snapshot.images.map((image) => image.imageId), first.imageIds);
  assert.deepEqual(snapshot.snapshot.cards.map((card) => card.id), first.cardIds);
  assert.deepEqual(snapshot.snapshot.messages, []); assert.deepEqual(snapshot.snapshot.preferences.allergies, ['peanuts']);
  assert.equal(snapshot.snapshot.preferences.notes, '');
  assert.equal(first.chatJobs[first.messages[1].id].locallySavedRevision, first.chatJobs[first.messages[1].id].revision);
  assert.equal((await services.chat.send(id, 'Tell me more.')).ok, true);
  const second = services.records.getRecord(id).record;
  assert.equal(second.messages.length, 4); assert.deepEqual(second.messageIds, second.messages.map((message) => message.id));
  const latest = second.chatRequests[second.messages[3].id].snapshot;
  assert.deepEqual(latest.snapshot.messages.map((message) => message.id), first.messageIds);
  assert.equal(latest.snapshot.messages.some((message) => second.messages.slice(2).some((current) => current.id === message.id)), false);
  await server.stop(); const count = traffic.length;
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.chat.getState(id).messages, second.messages);
  assert.equal((await reopened.chat.refreshRecord(id)).ok, true); assert.equal(traffic.length, count);
});

test('native fixed entry opens record chat, one request runs at a time, and typing during send is never erased or auto-sent', async (t) => {
  const { services, id, traffic } = await setup(t, { SEEFOOD_WORKER_DELAY_MS: '350' });
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages }; t.after(() => Object.assign(global, old));
  let navigation; let backed = false;
  global.getApp = () => ({ services }); global.getCurrentPages = () => [{}, {}];
  global.wx = { setNavigationBarTitle() {}, navigateTo(value) { navigation = value.url; }, navigateBack() { backed = true; } };
  function load(name) {
    let definition; global.Page = (value) => { definition = value; }; const file = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[file]; require(file);
    return { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  }
  const result = load('result'); result.onLoad({ recordId: id }); result.onShow();
  result.openChat(); assert.equal(navigation, `/pages/chat/chat?recordId=${encodeURIComponent(id)}`);
  const page = load('chat'); page.onLoad({ recordId: id }); page.onShow();
  page.onInput({ detail: { value: 'Please explain this dish.' } });
  const first = page.send();
  assert.equal((await services.chat.send(id, 'Do not send this')).error, 'JOB_STATE_CONFLICT');
  page.onInput({ detail: { value: 'A different next question' } });
  assert.equal((await first).ok, true);
  assert.equal(page.data.draft, 'A different next question');
  assert.equal(services.records.getRecord(id).record.messages.length, 2);
  const assistant = page.data.messages.find((message) => message.role === 'assistant');
  page.openDish({ currentTarget: { dataset: { messageId: assistant.id, cardId: assistant.dishReferences[0].id } } });
  assert.match(navigation, /dish-detail/); assert.ok(navigation.includes(encodeURIComponent(id)));
  page.openDish({ currentTarget: { dataset: { messageId: assistant.id, cardId: 'foreign-card' } } });
  assert.match(navigation, /dish-detail/);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); page.onShow(); result.onShow();
    assert.ok(page.data.chatCopy.title); assert.equal(page.data.chatCopy.questions.length, 4); assert.equal(page.data.draft, 'A different next question');
    assert.equal(services.records.getRecord(id).record.messages[0].contentLanguage, 'en');
  }
  assert.equal(traffic.filter((item) => item.method === 'POST' && item.data.kind === 'chat').length, 1);
  page.back(); assert.equal(backed, true); page.onUnload(); result.onUnload();
});

test('a delivered reply remains visible during local write failure and a later older result cannot erase it', async (t) => {
  const { disk, services, id, traffic } = await setup(t); const send = disk.platform.request; const write = disk.storage.set;
  disk.platform.request = (options) => {
    if (options.method === 'GET' && options.url.includes('/v1/jobs/')) {
      const success = options.success; options.success = (response) => {
        if (response.data.kind === 'chat' && response.data.state === 'succeeded') disk.storage.set = () => { throw new Error('disk full'); };
        success(response);
      };
    }
    send(options);
  };
  assert.equal((await services.chat.sendQuickQuestion(id, 'communicate')).error, 'storage-write');
  const state = services.chat.getState(id); const job = state.unsavedJob;
  assert.equal(state.messages[1].unsaved, true); assert.equal(state.messages[1].attachments[1].card.category, 'service');
  assert.equal(services.records.getRecord(id).record.messages[1].text, '');
  assert.equal(services.chat.applyJob(id, { ...job, state: 'running', revision: job.revision - 1, output: null }).error, 'stale-job');
  const before = traffic.length; disk.storage.set = write;
  assert.equal(services.chat.retrySave(id).ok, true); assert.equal(traffic.length, before);
  const saved = services.records.getRecord(id).record;
  assert.equal(saved.messages[1].text, job.output.text); assert.equal(saved.messages[1].state, 'complete');
  for (const change of [
    (value) => { value.contextId = 'foreign-context'; },
    (value) => { value.target.userMessageId = 'foreign-message'; },
    (value) => { value.jobId = 'foreign-job'; },
    (value) => { value.attempt += 1; },
    (value) => { value.output.attachments[0].cardId = 'foreign-card'; }
  ]) {
    const invalid = structuredClone(job); invalid.revision += 1; change(invalid);
    assert.equal(services.chat.applyJob(id, invalid).ok, false);
    assert.deepEqual(services.records.getRecord(id).record.messages, saved.messages);
  }
});

test('pending context acceptance is replayed exactly before chat allocates its next snapshot version', async (t) => {
  const { services, id, traffic } = await setup(t);
  const saved = services.records.getRecord(id).record;
  const pending = structuredClone(saved.contextSnapshot); pending.snapshotVersion += 1;
  assert.equal(services.records.updateRecord(id, (record) => { record.pendingContextSnapshot = pending; }).ok, true);
  await services.backend.putContext(saved.contextId, pending);
  const before = traffic.length;
  assert.equal((await services.chat.send(id, 'A new question.')).ok, true);
  const puts = traffic.slice(before).filter((item) => item.method === 'PUT');
  assert.deepEqual(puts[0].data, pending); assert.equal(puts[1].data.snapshotVersion, pending.snapshotVersion + 1);
  assert.equal(services.records.getRecord(id).record.contextSnapshotVersion, pending.snapshotVersion + 1);
});

test('a lost chat acceptance is found read-only after client/server restart with the original paired message IDs', async (t) => {
  const { disk, services, id, backend, traffic, server } = await setup(t); const send = disk.platform.request; let accepted;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.data.kind === 'chat') options.success = (response) => { accepted = response.data; options.fail(new Error('response lost')); };
    send(options);
  };
  assert.equal((await services.chat.sendQuickQuestion(id, 'recommend')).error, 'network-unavailable');
  const saved = services.records.getRecord(id).record; assert.equal(saved.messages.length, 2);
  await server.stop('SIGKILL');
  disk.platform.request = send;
  // The durable service directory is recovered through the HTTP helper's process configuration.
  const restarted = await start(t, server.directory);
  const reopened = createWechatServices(disk.platform, { backend: { ...backend, baseUrl: restarted.url } });
  const before = traffic.length;
  assert.equal((await reopened.chat.refreshRecord(id)).ok, true);
  const result = reopened.records.getRecord(id).record;
  assert.deepEqual(result.messageIds, saved.messageIds); assert.equal(result.messages[1].state, 'complete');
  assert.equal(result.chatJobs[saved.messages[1].id].jobId, accepted.jobId);
  assert.equal(traffic.slice(before).some((item) => item.method === 'POST' && item.url.endsWith('/v1/jobs')), false);
});
