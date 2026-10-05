const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');

async function captureBatch(materials, target = { kind: 'new' }, mode = 'menu', language = 'en') {
  const capture = createCapture({ media: { chooseImages: async () => materials }, getLanguage: () => language });
  capture.chooseMode(mode);
  await capture.chooseImages({ source: 'album', target });
  return capture.confirm().batch;
}

async function setup(t, env = {}) {
  const disk = recordPlatform(t); const server = await start(t, temporary(t), env); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => {
    traffic.push({ url: options.url, method: options.method, data: structuredClone(options.data) });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const id = (await services.records.confirmCapture(await captureBatch([disk.material('menu-photo.png')]))).recordId;
  assert.equal((await services.uploads.uploadRecord(id)).ok, true);
  assert.equal((await services.jobs.startImageCards(id)).ok, true);
  assert.equal((await services.chat.sendQuickQuestion(id, 'communicate')).ok, true);
  return { disk, server, traffic, backend, services, id };
}

test('appending a confirmed original preserves the full saved record and replays the same batch once after reopening', async (t) => {
  const { disk, services, id, backend } = await setup(t);
  const before = services.records.getRecord(id).record;
  const material = disk.material('menu-screenshot.png');
  const bytes = fs.readFileSync(material.localPath);
  const batch = await captureBatch([material], { kind: 'append', recordId: id, title: 'Lunch menu' }, 'dish', 'ja');
  assert.deepEqual(await services.records.confirmCapture(batch), { ok: true, recordId: id });
  const after = services.records.getRecord(id).record;
  for (const key of ['id', 'createdAt', 'sourceBatchId', 'captureSignature', 'requestId', 'contextId', 'contextSnapshotVersion', 'contextSnapshot', 'cardIds', 'cards', 'messages', 'messageIds', 'chatJobs', 'chatRequests']) {
    assert.deepEqual(after[key], before[key], key);
  }
  assert.deepEqual(after.images[0], before.images[0]);
  assert.deepEqual(after.imageIds, [before.images[0].id, batch.images[0].id]);
  assert.equal(after.images[1].order, 1);
  assert.equal(after.images[1].recordId, id);
  assert.equal(after.images[1].kind, 'dish');
  assert.equal(after.images[1].targetLanguage, 'ja');
  fs.unlinkSync(material.localPath);
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(await reopened.records.confirmCapture(batch), { ok: true, recordId: id });
  assert.deepEqual(reopened.records.getRecord(id).record, after);
  assert.deepEqual(fs.readFileSync(after.images[1].localOriginalPath), bytes);
  assert.equal(reopened.records.listRecent().records.length, 1);
});

test('one appended photo uploads and generates in its original record with a new snapshot and complete saved history', async (t) => {
  const { disk, services, id, traffic, server, backend } = await setup(t);
  const before = services.records.getRecord(id).record;
  const batch = await captureBatch([disk.material('menu-screenshot.png')], { kind: 'append', recordId: id }, 'dish', 'ko');
  assert.equal((await services.records.confirmCapture(batch)).ok, true);
  const begin = traffic.length;
  assert.deepEqual(await services.uploads.uploadRecord(id, batch.images[0].id), { ok: true, recordId: id });
  assert.equal((await services.jobs.startImageCards(id, batch.images[0].id)).ok, true);
  const after = services.records.getRecord(id).record;
  assert.deepEqual(after.images[0], before.images[0]);
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.cards.filter((card) => before.cardIds.includes(card.id)), before.cards);
  assert.equal(after.images[1].uploadState, 'uploaded');
  assert.equal(after.images[1].stageJobs.image_cards.state, 'succeeded');
  assert.equal(after.images[1].stageJobs.image_cards.contextSnapshotVersion, before.contextSnapshotVersion + 2);
  assert.equal(after.cards.some((card) => card.sourceImageIds.includes(batch.images[0].id)), true);
  const puts = traffic.slice(begin).filter((item) => item.method === 'PUT' && item.data && item.data.purpose === 'record');
  assert.equal(puts.length, 2);
  assert.deepEqual(puts.map((item) => item.data.snapshotVersion), [before.contextSnapshotVersion + 1, before.contextSnapshotVersion + 2]);
  assert.deepEqual(puts[0].data.snapshot.images.map((image) => image.assetId), [before.images[0].assetId, null]);
  assert.deepEqual(puts[1].data.snapshot.images.map((image) => image.assetId), after.images.map((image) => image.assetId));
  for (const put of puts) {
    assert.deepEqual(put.data.snapshot.cards, before.cards);
    assert.deepEqual(put.data.snapshot.messages.map((message) => message.id), before.messageIds);
    assert.equal(put.data.snapshot.messages.some((message) => 'state' in message || 'jobId' in message), false);
  }
  const jobs = traffic.slice(begin).filter((item) => item.method === 'POST' && item.data.kind === 'image_cards');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].data.target.imageId, batch.images[0].id);
  await server.stop();
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.records.getRecord(id).record, after);
  assert.deepEqual(reopened.chat.getState(id).messages, before.messages);
});

test('abandoning an append after metadata failure removes only its uncommitted copies and never changes the saved record', async (t) => {
  const disk = recordPlatform(t); const services = createWechatServices(disk.platform);
  const id = (await services.records.confirmCapture(await captureBatch([disk.material('menu-photo.png')]))).recordId;
  const original = services.records.getRecord(id).record;
  const batch = await captureBatch([disk.material('menu-screenshot.png')], { kind: 'append', recordId: id });
  const write = disk.storage.set; disk.storage.set = () => { throw new Error('quota exceeded'); };
  assert.deepEqual(await services.records.confirmCapture(batch), { ok: false, error: 'storage-write', batchId: batch.id });
  const copied = services.records.getSubmission(batch.id).record.images[0].localOriginalPath;
  assert.equal(fs.existsSync(copied), true);
  assert.deepEqual(services.records.getRecord(id).record, original);
  disk.storage.set = write;
  assert.deepEqual(await services.records.discardSubmission(batch.id), { ok: true });
  assert.equal(fs.existsSync(copied), false);
  assert.equal(fs.existsSync(original.images[0].localOriginalPath), true);
  assert.deepEqual(createWechatServices(disk.platform).records.getRecord(id).record, original);
});
