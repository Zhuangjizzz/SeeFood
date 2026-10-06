const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary } = require('./support/http-service');
async function batch(disk, name, target = { kind: 'new' }) {
  const capture = createCapture({ media: { chooseImages: async () => [disk.material(name)] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album', target }); return capture.confirm().batch;
}
async function setup(t, options = {}) {
  const { createService } = await import('../server/service.ts');
  let time = Date.now(); const directory = temporary(t);
  const server = createService({ dataDir: directory, enableDevSession: true, devIdentities: ['demo-owner-a'], now: () => time, contextRetentionMs: 10000, ...options });
  await new Promise(resolve => server.server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const disk = recordPlatform(t); const traffic = []; let online = true;
  disk.platform.getNetworkType = ({ success }) => success({ networkType: online ? 'wifi' : 'none' });
  disk.platform.request = options => {
    traffic.push({ method: options.method, url: options.url, data: structuredClone(options.data) });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async response => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const backend = { enabled: true, baseUrl: `http://127.0.0.1:${server.server.address().port}`, identity: 'demo-owner-a' };
  const services = createWechatServices(disk.platform, { backend });
  const capture = await batch(disk, 'menu-photo.png');
  const id = (await services.records.confirmCapture(capture)).recordId;
  assert.equal((await services.imageBatches.startBatch(id, capture.id)).ok, true);
  assert.equal((await services.chat.sendQuickQuestion(id, 'communicate')).ok, true);
  return { server, disk, backend, services, id, traffic, expire() { time += 10001; server.retention.sweep(); }, offline(value) { online = !value; } };
}

test('expired history stays readable offline; an explicit new question rebuilds from saved text without changing old record, cards, messages or images', async t => {
  const app = await setup(t); const { disk, backend, services, id, traffic } = app;
  const before = services.records.getRecord(id).record; const translated = fs.readFileSync(before.images[0].translation.localPath);
  app.expire(); app.offline(true); const start = traffic.length;
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.records.getRecord(id).record, before);
  assert.deepEqual(reopened.chat.getState(id).messages, before.messages);
  assert.equal((await reopened.chat.refreshRecord(id)).ok, true);
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
  assert.equal(traffic.length, start);
  app.offline(false); await reopened.network.refresh();
  const sent = await reopened.chat.sendQuickQuestion(id, 'explain'); assert.equal(sent.ok, true, JSON.stringify(sent));
  const after = reopened.records.getRecord(id).record;
  assert.notEqual(after.contextId, before.contextId); assert.equal(after.id, before.id);
  assert.ok(after.contextIds.includes(before.contextId));
  assert.deepEqual(after.cards, before.cards); assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
  assert.deepEqual(after.messageIds.slice(0, before.messageIds.length), before.messageIds);
  assert.deepEqual(fs.readFileSync(after.images[0].translation.localPath), translated);
  const newOperations = traffic.slice(start).filter(item => item.method === 'POST');
  assert.equal(newOperations.filter(item => item.data?.kind === 'chat').length, 1);
  assert.equal(newOperations.filter(item => item.url.endsWith('/v1/uploads') || ['image_cards', 'image_translation'].includes(item.data?.kind)).length, 0);
  assert.equal(reopened.chat.applyJob(id, { ...before.chatJobs[before.messages.at(-1).id], revision: 999 }).ok, false);
});

test('appending after temporary expiry rebuilds the same record and uploads only the new image; old saved content survives offline', async t => {
  const app = await setup(t); const { disk, backend, services, id, traffic } = app;
  const before = services.records.getRecord(id).record;
  const bytes = fs.readFileSync(before.images[0].translation.localPath);
  app.expire(); const start = traffic.length;
  const addition = await batch(disk, 'menu-screenshot.png', { kind: 'append', recordId: id });
  assert.equal((await services.records.confirmCapture(addition)).ok, true);
  const processed = await services.imageBatches.startBatch(id, addition.id);
  assert.equal(processed.ok, true, JSON.stringify(processed));
  const after = services.records.getRecord(id).record;
  assert.equal(after.id, before.id); assert.notEqual(after.contextId, before.contextId);
  assert.deepEqual(after.imageIds, [...before.imageIds, addition.images[0].id]);
  assert.deepEqual(after.cards.slice(0, before.cards.length), before.cards);
  assert.deepEqual(after.messages, before.messages); assert.deepEqual(after.images[0].translation, before.images[0].translation);
  assert.deepEqual(fs.readFileSync(after.images[0].translation.localPath), bytes);
  const operations = traffic.slice(start).filter(item => item.method === 'POST');
  assert.deepEqual(operations.filter(item => item.url.endsWith('/v1/uploads')).map(item => item.data.imageId), [addition.images[0].id]);
  assert.deepEqual(operations.filter(item => item.data?.kind?.startsWith('image_')).map(item => item.data.target.imageId), [addition.images[0].id, addition.images[0].id]);
  app.offline(true); const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.records.getRecord(id).record, after);
  assert.equal(reopened.records.listHistory().records.length, 1);
  assert.equal(reopened.jobs.applyJob(id, { ...before.images[0].stageJobs.image_cards, revision: 999 }).ok, false);
});

test('a record without saved dish text uploads its required original for a new question, and a missing original asks for replacement', async t => {
  const app = await setup(t, { mockScenario: 'no-cards' }); const { services, disk, id, traffic } = app;
  const before = services.records.getRecord(id).record; assert.deepEqual(before.cards, []);
  app.expire(); const start = traffic.length;
  const sent = await services.chat.sendQuickQuestion(id, 'explain'); assert.equal(sent.ok, true, JSON.stringify(sent));
  const uploads = traffic.slice(start).filter(item => item.method === 'POST' && item.url.endsWith('/v1/uploads'));
  assert.deepEqual(uploads.map(item => item.data.imageId), before.imageIds);
  assert.equal(traffic.slice(start).filter(item => item.method === 'POST' && item.data?.kind?.startsWith('image_')).length, 0);
  app.expire(); fs.unlinkSync(before.images[0].localOriginalPath);
  const latest = services.records.getRecord(id).record; const boundary = traffic.length;
  const missing = await services.chat.sendQuickQuestion(id, 'explain');
  assert.deepEqual(missing, { ok: false, error: 'rebuild-material-missing' });
  assert.equal(services.records.getRecord(id).record.contextId, latest.contextId);
  assert.deepEqual(services.records.getRecord(id).record.messageIds, latest.messageIds);
  assert.equal(traffic.slice(boundary).filter(item => item.method === 'POST' || item.method === 'PUT').length, 0);
});

test('an expired failed image retry creates only its selected stage in a new context and rejects old delivery', async t => {
  const app = await setup(t); const { services, id, traffic } = app;
  const before = services.records.getRecord(id).record; const image = before.images[0];
  // Material expiry is observed by a task lookup at the public HTTP boundary.
  app.expire(); const expired = await services.backend.getJob(image.stageJobs.image_translation.jobId);
  assert.equal(services.jobs.applyJob(id, expired).ok, true);
  assert.equal(services.jobs.getStageState(id, image.id, 'image_translation').canRetry, true);
  const start = traffic.length; const retried = await services.jobs.retryStage(id, image.id, 'image_translation');
  assert.equal(retried.ok, true, JSON.stringify(retried));
  const after = services.records.getRecord(id).record;
  assert.notEqual(after.contextId, before.contextId);
  assert.equal(after.images[0].stageJobs.image_translation.state, 'succeeded');
  assert.notEqual(after.images[0].stageJobs.image_translation.jobId, expired.jobId);
  assert.deepEqual(after.cards, before.cards); assert.deepEqual(after.messages, before.messages);
  assert.equal(traffic.slice(start).filter(item => item.method === 'POST' && item.data?.kind === 'image_cards').length, 0);
  assert.equal(services.jobs.applyJob(id, { ...image.stageJobs.image_translation, revision: 999 }).ok, false);
});

test('explicit retry after a partial reply expires preserves its question and reply IDs while rejecting the old task', async t => {
  const app = await setup(t, { mockScenario: 'chat-partial-failure', chatPartialDelayMs: 10 });
  const { services, id, traffic } = app; const before = services.records.getRecord(id).record;
  const reply = before.messages.at(-1); const oldJob = before.chatJobs[reply.id];
  assert.equal(reply.state, 'failed'); assert.ok(reply.text);
  app.expire(); const start = traffic.length;
  const retried = await services.chat.retryReply(id, reply.id); assert.equal(retried.ok, true, JSON.stringify(retried));
  const after = services.records.getRecord(id).record;
  assert.deepEqual(after.messageIds, before.messageIds); assert.equal(after.messages.length, before.messages.length);
  assert.notEqual(after.contextId, before.contextId); assert.notEqual(after.chatJobs[reply.id].jobId, oldJob.jobId);
  assert.equal(after.chatRequests[reply.id].request.input.text, before.chatRequests[reply.id].request.input.text);
  assert.equal(after.chatRequests[reply.id].snapshot.snapshot.preferences.version, before.chatRequests[reply.id].snapshot.snapshot.preferences.version);
  assert.equal(services.chat.applyJob(id, { ...oldJob, revision: 999 }).ok, false);
  assert.equal(traffic.slice(start).filter(item => item.method === 'POST' && item.data?.kind === 'chat').length, 1);
  assert.equal(traffic.slice(start).filter(item => item.url.endsWith('/v1/uploads')).length, 0);
});
