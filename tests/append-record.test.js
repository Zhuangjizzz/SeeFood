const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
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
  disk.platform.downloadFile = (options) => {
    const tempFilePath = path.join(disk.root, `translation-${Date.now()}-${Math.random()}.png`);
    fetch(options.url, { headers: options.header }).then(async (response) => {
      fs.writeFileSync(tempFilePath, Buffer.from(await response.arrayBuffer()));
      options.success({ statusCode: response.status, tempFilePath });
    }).catch(options.fail);
  };
  disk.platform.getImageInfo = ({ src, success, fail }) => sharp(src).metadata().then((metadata) => success({ width: metadata.width, height: metadata.height, type: metadata.format })).catch(fail);
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const id = (await services.records.confirmCapture(await captureBatch([disk.material('menu-photo.png')]))).recordId;
  assert.equal((await services.uploads.uploadRecord(id)).ok, true);
  assert.equal((await services.jobs.startImageProcessing(id)).ok, true);
  assert.equal(services.imageView.selectVariant(id, services.records.getRecord(id).record.images[0].id, 'original').ok, true);
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
  for (const key of ['id', 'createdAt', 'title', 'kind', 'sourceBatchId', 'captureSignature', 'requestId', 'contextId', 'contextSnapshotVersion', 'contextSnapshot', 'cardIds', 'cards', 'messages', 'messageIds', 'chatJobs', 'chatRequests', 'browseState']) {
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
  assert.equal((await services.jobs.startImageProcessing(id, batch.images[0].id)).ok, true);
  const after = services.records.getRecord(id).record;
  assert.deepEqual(after.images[0], before.images[0]);
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.cards.filter((card) => before.cardIds.includes(card.id)), before.cards);
  assert.equal(after.images[1].uploadState, 'uploaded');
  assert.equal(after.images[1].stageJobs.image_cards.state, 'succeeded');
  assert.equal(after.images[1].stageJobs.image_translation.output.state, 'not_required');
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
  const independent = (await services.records.confirmCapture(await captureBatch([disk.material('menu-photo.png')]))).recordId;
  assert.notEqual(independent, id);
  assert.equal((await services.uploads.uploadRecord(independent)).ok, true);
  assert.equal((await services.jobs.startImageProcessing(independent)).ok, true);
  assert.equal((await services.chat.sendQuickQuestion(independent, 'explain')).ok, true);
  const separate = services.records.getRecord(independent).record;
  const newChat = separate.chatRequests[separate.messages.at(-1).id];
  assert.notEqual(separate.contextId, after.contextId);
  assert.deepEqual(newChat.snapshot.snapshot.images.map((image) => image.imageId), separate.imageIds);
  assert.deepEqual(newChat.snapshot.snapshot.cards.map((card) => card.id), separate.cardIds);
  assert.deepEqual(newChat.snapshot.snapshot.messages, []);
  assert.equal(separate.images.some((image) => after.imageIds.includes(image.id)), false);
  assert.equal(separate.images[0].stageJobs.image_cards.contextId, separate.contextId);
  assert.deepEqual(services.records.getRecord(id).record, after);
  await server.stop();
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.records.getRecord(id).record, after);
  assert.deepEqual(reopened.chat.getState(id).messages, before.messages);
});

test('native append confirmation starts its own stages and manual upload retry continues the appended photo', async (t) => {
  const { disk, services, id, traffic } = await setup(t);
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, old));
  let events; const navigation = [];
  global.getApp = () => ({ services });
  global.getCurrentPages = () => [{ route: 'pages/index/index' }, { route: 'pages/result/result', recordId: id }, { route: 'pages/preview/preview' }];
  global.wx = { setNavigationBarTitle() {}, nextTick() {},
    navigateTo(options) { events = options.events; }, navigateBack() { navigation.push('back'); },
    pageScrollTo() {} };
  function load(name) {
    let definition; global.Page = (value) => { definition = value; };
    const file = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[file]; require(file);
    return { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); },
      getOpenerEventChannel: () => ({ emit(name, ...args) { return events[name](...args); } }) };
  }
  const result = load('result'); result.onLoad({ recordId: id }); result.onShow();
  const before = services.records.getRecord(id).record;
  const screenshot = disk.material('menu-screenshot.png');
  disk.platform.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: screenshot.localPath, size: screenshot.sizeBytes }] });
  result.addPhotos(); await result.importPhoto();
  const send = disk.platform.request;
  disk.platform.request = (options) => options.url.includes('/_uploads/') ? options.fail(new Error('offline')) : send(options);
  const preview = load('preview'); preview.onShow();
  assert.deepEqual(await preview.confirm(), { ok: true, recordId: id });
  assert.deepEqual(navigation, ['back']);
  const appendedId = services.records.getRecord(id).record.images[1].id;
  assert.equal((await services.uploads.uploadRecord(id, appendedId)).error, 'network-unavailable');
  assert.deepEqual(services.records.getRecord(id).record.images[0], before.images[0]);
  disk.platform.request = send;
  assert.equal((await result.retryUpload()).ok, true);
  const after = services.records.getRecord(id).record;
  assert.equal(after.images[1].stageJobs.image_cards?.state, 'succeeded');
  assert.equal(after.images[1].stageJobs.image_translation?.state, 'succeeded');
  assert.equal(after.images[1].translation.saveState, 'saved');
  assert.deepEqual(after.images[0], before.images[0]);
  assert.deepEqual(after.messages, before.messages);
  assert.equal(traffic.filter((item) => item.method === 'POST' && item.data.kind === 'image_cards' && item.data.target.imageId === appendedId).length, 1);
  preview.onUnload(); result.onShow();
  const long = disk.material('menu-long.png');
  disk.platform.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: long.localPath, size: long.sizeBytes }] });
  result.addPhotos(); await result.importPhoto();
  const another = load('preview'); another.onShow();
  assert.deepEqual(await another.confirm(), { ok: true, recordId: id });
  let completed;
  for (let count = 0; count < 200; count += 1) {
    completed = services.records.getRecord(id).record;
    if (completed.images[2].translation?.saveState === 'saved' && completed.images[2].stageJobs.image_cards?.state === 'succeeded') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(completed.images[2].stageJobs.image_cards?.state, 'succeeded');
  assert.equal(completed.images[2].translation?.saveState, 'saved');
  assert.deepEqual(completed.images.slice(0, 2), after.images);
  assert.deepEqual(completed.messages, before.messages);
  assert.equal(services.records.listRecent().records.length, 1);
  result.onUnload(); another.onUnload();
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

test('append retries preserve stable new image identities and merge updates made while copying originals', async (t) => {
  const disk = recordPlatform(t); const services = createWechatServices(disk.platform);
  const id = (await services.records.confirmCapture(await captureBatch([disk.material('menu-photo.png')]))).recordId;
  const batch = await captureBatch([disk.material('menu-screenshot.png')], { kind: 'append', recordId: id });
  const copy = disk.fileSystem.copyFile; let release;
  disk.fileSystem.copyFile = (options) => { release = () => copy(options); };
  const first = services.records.confirmCapture(batch);
  const stable = services.records.getSubmission(batch.id).record.images[0];
  const alongside = services.records.confirmCapture(batch);
  assert.equal(services.records.updateRecord(id, (record) => { record.title = 'Updated during save'; record.browseState = { currentImageId: record.images[0].id }; }).ok, true);
  const write = disk.storage.set; disk.storage.set = () => { throw new Error('full'); };
  release();
  assert.equal((await first).error, 'storage-write'); assert.equal((await alongside).error, 'storage-write');
  assert.equal(services.records.getRecord(id).record.images.length, 1);
  disk.storage.set = write; disk.fileSystem.copyFile = copy;
  fs.unlinkSync(batch.images[0].localPath);
  assert.deepEqual(await services.records.retrySave(batch.id), { ok: true, recordId: id });
  const saved = services.records.getRecord(id).record;
  assert.equal(saved.title, 'Updated during save');
  assert.equal(saved.browseState.currentImageId, saved.images[0].id);
  assert.equal(saved.images[1].id, stable.id);
  assert.deepEqual(saved.images[1].requests, stable.requests);
  assert.equal(saved.images[1].order, 1);
});

test('a missing or ineligible target fails before copying, and deletion during copying cannot recreate a record', async (t) => {
  const disk = recordPlatform(t); const services = createWechatServices(disk.platform);
  const id = (await services.records.confirmCapture(await captureBatch([disk.material('menu-photo.png')]))).recordId;
  const before = services.records.getRecord(id).record;
  const bad = await captureBatch([disk.material('menu-screenshot.png')], { kind: 'append', recordId: 'missing' });
  assert.deepEqual(await services.records.confirmCapture(bad), { ok: false, error: 'append-target-unavailable', batchId: bad.id });
  services.records.updateRecord(id, (record) => { record.deletedAt = '2026-10-06T00:00:00.000Z'; });
  const ineligible = await captureBatch([disk.material('menu-screenshot.png')], { kind: 'append', recordId: id });
  assert.equal((await services.records.confirmCapture(ineligible)).error, 'append-target-unavailable');
  services.records.updateRecord(id, (record) => { delete record.deletedAt; });
  const batch = await captureBatch([disk.material('menu-screenshot.png')], { kind: 'append', recordId: id });
  const copy = disk.fileSystem.copyFile; let release;
  disk.fileSystem.copyFile = (options) => { release = () => copy(options); };
  const confirmation = services.records.confirmCapture(batch);
  // Remove the persisted scope at the storage boundary while the real copy is pending.
  disk.storage.set('seefood:v1:records', { schema: 1, value: [] });
  release();
  assert.equal((await confirmation).error, 'append-target-unavailable');
  assert.equal((await services.records.retrySave(batch.id)).error, 'append-target-unavailable');
  assert.deepEqual(services.records.listRecent().records, []);
  assert.deepEqual(await services.records.discardSubmission(batch.id), { ok: true });
  assert.equal(fs.existsSync(before.images[0].localOriginalPath), true);
});

test('a lost append snapshot response is replayed exactly before a later appended photo can receive a newer version', async (t) => {
  const { disk, services, id, traffic } = await setup(t);
  const before = services.records.getRecord(id).record;
  const first = await captureBatch([disk.material('menu-screenshot.png')], { kind: 'append', recordId: id });
  await services.records.confirmCapture(first);
  const send = disk.platform.request; let lost = false;
  disk.platform.request = (options) => {
    if (!lost && options.method === 'PUT' && options.data?.purpose === 'record') {
      lost = true; options.success = () => options.fail(new Error('accepted response lost'));
    }
    send(options);
  };
  assert.equal((await services.uploads.uploadRecord(id, first.images[0].id)).error, 'network-unavailable');
  const pending = services.records.getRecord(id).record.pendingContextSnapshot;
  assert.equal(pending.snapshotVersion, before.contextSnapshotVersion + 1);
  const second = await captureBatch([disk.material('menu-long.png')], { kind: 'append', recordId: id });
  await services.records.confirmCapture(second);
  disk.platform.request = send; const begin = traffic.length;
  assert.equal((await services.uploads.uploadRecord(id, first.images[0].id)).ok, true);
  const puts = traffic.slice(begin).filter((item) => item.method === 'PUT' && item.data?.purpose === 'record');
  assert.deepEqual(puts[0].data, pending);
  assert.deepEqual(puts.map((item) => item.data.snapshotVersion), [pending.snapshotVersion, pending.snapshotVersion + 1, pending.snapshotVersion + 2]);
  assert.deepEqual(puts.at(-1).data.snapshot.images.map((image) => image.imageId), services.records.getRecord(id).record.imageIds);
  assert.equal(puts.at(-1).data.snapshot.images[2].assetId, null);
  assert.deepEqual(services.records.getRecord(id).record.messages, before.messages);
});

test('an accepted chat retains its frozen input through append and the following chat sees the full expanded record', async (t) => {
  const { disk, services, id, traffic } = await setup(t, { SEEFOOD_WORKER_DELAY_MS: '300' });
  const old = services.records.getRecord(id).record;
  const activeChat = services.chat.sendQuickQuestion(id, 'recommend');
  let pending;
  for (let count = 0; count < 100; count += 1) {
    pending = services.records.getRecord(id).record;
    if (pending.messages.length > old.messages.length && pending.chatJobs[pending.messages.at(-1).id]) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const replyId = pending.messages.at(-1).id;
  const frozen = structuredClone(pending.chatRequests[replyId]);
  assert.equal(pending.chatJobs[replyId].state === 'queued' || pending.chatJobs[replyId].state === 'running', true);
  const batch = await captureBatch([disk.material('menu-screenshot.png')], { kind: 'append', recordId: id });
  assert.equal((await services.records.confirmCapture(batch)).ok, true);
  assert.equal((await services.uploads.uploadRecord(id, batch.images[0].id)).ok, true);
  assert.equal((await services.jobs.startImageProcessing(id, batch.images[0].id)).ok, true);
  assert.equal((await activeChat).ok, true);
  const expanded = services.records.getRecord(id).record;
  assert.deepEqual(expanded.chatRequests[replyId], frozen);
  assert.equal(expanded.chatJobs[replyId].contextSnapshotVersion, frozen.snapshot.snapshotVersion);
  assert.deepEqual(frozen.snapshot.snapshot.images.map((image) => image.imageId), old.imageIds);
  assert.equal((await services.chat.sendQuickQuestion(id, 'explain')).ok, true);
  const complete = services.records.getRecord(id).record;
  const newest = complete.chatRequests[complete.messages.at(-1).id];
  assert.ok(newest.snapshot.snapshotVersion > frozen.snapshot.snapshotVersion);
  assert.deepEqual(newest.snapshot.snapshot.images.map((image) => image.imageId), expanded.imageIds);
  assert.deepEqual(newest.snapshot.snapshot.cards.map((card) => card.id), expanded.cardIds);
  assert.deepEqual(newest.snapshot.snapshot.messages.map((message) => message.id), expanded.messageIds);
  assert.equal(traffic.filter((item) => item.method === 'POST' && item.data.kind === 'chat').length, 3);
});
