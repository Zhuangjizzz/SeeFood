const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');
async function setup(t, env = {}, language = 'ja', kind = 'menu') {
  const disk = recordPlatform(t); const server = await start(t, temporary(t), env); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => { traffic.push({ method: options.method, url: options.url });
    fetch(options.url, { method: options.method, headers: options.header, body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const data = await response.text(); options.success({ statusCode: response.status, data: data ? JSON.parse(data) : null }); }).catch(options.fail);
  };
  disk.platform.downloadFile = (options) => { traffic.push({ method: 'DOWNLOAD', url: options.url });
    fetch(options.url, { headers: options.header }).then(async (response) => {
      const tempFilePath = path.join(disk.root, `download-${traffic.length}.png`);
      fs.writeFileSync(tempFilePath, Buffer.from(await response.arrayBuffer()));
      options.success({ statusCode: response.status, tempFilePath });
    }).catch(options.fail);
  };
  disk.platform.getImageInfo = ({ src, success, fail }) => sharp(src).metadata().then((metadata) => success({ width: metadata.width, height: metadata.height, type: metadata.format })).catch(fail);
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => language });
  capture.chooseMode(kind); await capture.chooseImages({ source: 'album' });
  const saved = await services.records.confirmCapture(capture.confirm().batch); assert.equal(saved.ok, true);
  assert.equal((await services.uploads.uploadRecord(saved.recordId)).ok, true);
  return { disk, services, id: saved.recordId, traffic, backend, server };
}

test('translation has independent real download and durable file state while cards and originals remain intact offline', async (t) => {
  const { services, disk, id, backend, traffic, server } = await setup(t);
  assert.equal((await services.jobs.startImageCards(id)).ok, true);
  const before = services.records.getRecord(id).record;
  assert.equal((await services.jobs.startImageTranslation(id)).ok, true);
  const translated = services.records.getRecord(id).record;
  assert.deepEqual(translated.cards, before.cards); assert.deepEqual(translated.images[0].original, before.images[0].original);
  const image = translated.images[0]; assert.equal(image.stageJobs.image_translation.state, 'succeeded');
  assert.equal(image.translation.saveState, 'saved'); assert.equal(image.translation.contentLanguage, 'ja');
  assert.ok(fs.statSync(image.translation.localPath).size > 0); assert.notEqual(image.translation.localPath, image.original.localPath);
  assert.equal(traffic.filter((entry) => entry.method === 'DOWNLOAD').length, 1);
  await server.stop();
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.records.getRecord(id).record.images[0].translation.saveState, 'saved');
  const requests = traffic.length; assert.equal((await reopened.jobs.startImageTranslation(id)).ok, true); assert.equal(traffic.length, requests);
  fs.unlinkSync(image.translation.localPath);
  const missing = reopened.records.getRecord(id).record.images[0];
  assert.equal(missing.translation.saveState, 'failed'); assert.equal(missing.original.saveState, 'saved');
});
module.exports = { setup };

test('first view prefers an existing translation but completion never steals an original; choices survive a fresh client', async (t) => {
  const { services, disk, id, backend } = await setup(t);
  const imageId = services.records.getRecord(id).record.images[0].id;
  assert.equal(services.imageView.open(id, imageId).variant, 'original');
  assert.equal((await services.jobs.startImageTranslation(id)).ok, true);
  assert.equal(services.imageView.open(id, imageId).variant, 'original');
  assert.equal(services.imageView.open(id, imageId).translationAvailable, true);
  assert.equal(services.imageView.selectVariant(id, imageId, 'translation').ok, true);
  let reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.imageView.open(id).variant, 'translation');
  assert.equal(reopened.imageView.selectVariant(id, imageId, 'original').ok, true);
  reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.imageView.open(id).variant, 'original');
  const fresh = await setup(t);
  await fresh.services.jobs.startImageTranslation(fresh.id);
  assert.equal(fresh.services.imageView.open(fresh.id).variant, 'translation');
});

test('lost translation acceptance binds the original job through recovery without resubmitting generation', async (t) => {
  const { services, disk, id, backend, traffic } = await setup(t);
  const send = disk.platform.request; let accepted;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) options.success = (result) => { accepted = result.data; options.fail(new Error('lost reply')); };
    send(options);
  };
  assert.equal((await services.jobs.startImageTranslation(id)).ok, false);
  disk.platform.request = send; const reopened = createWechatServices(disk.platform, { backend });
  const before = traffic.filter((entry) => entry.method === 'POST').length;
  assert.equal(reopened.jobs.acceptRecoveredJob(id, accepted).ok, true);
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
  assert.equal(reopened.records.getRecord(id).record.images[0].stageJobs.image_translation.jobId, accepted.jobId);
  assert.equal(reopened.records.getRecord(id).record.images[0].translation.saveState, 'saved');
  assert.equal(traffic.filter((entry) => entry.method === 'POST').length, before);
});

function resultPage(t, services) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  t.after(() => Object.assign(global, previous));
  global.getApp = () => ({ services }); global.wx = { setNavigationBarTitle() {}, previewImage() {} };
  let definition; global.Page = (value) => { definition = value; };
  const file = require.resolve('../miniprogram/pages/result/result'); delete require.cache[file]; require(file);
  return { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
}

test('native result keeps cards readable while translation saves separately and five-language controls preserve generated content', async (t) => {
  const { services, id, traffic } = await setup(t);
  await services.jobs.startImageCards(id);
  const page = resultPage(t, services); page.onLoad({ recordId: id }); page.onShow();
  assert.equal(page.data.canLeave, false);
  assert.equal(page.data.imageView.variant, 'original');
  const copy = services.records.getRecord(id).record.cards;
  assert.equal((await services.jobs.startImageTranslation(id)).ok, true);
  assert.equal(page.data.canLeave, true); assert.equal(page.data.imageView.variant, 'original');
  assert.equal(page.data.imageView.translationAvailable, true); assert.equal(page.data.translationSaveLabel, 'Saved on this device');
  page.selectVariant({ currentTarget: { dataset: { variant: 'translation' } } });
  assert.equal(page.data.imageView.variant, 'translation'); assert.match(page.data.imageView.path, /seefood-translations/);
  const before = traffic.length;
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); page.onShow();
    assert.ok(page.data.imageCopy.translation); assert.ok(page.data.imageCopy.notRequired); assert.ok(page.data.imageCopy.missingTranslation);
    assert.equal(page.data.imageView.variant, 'translation');
    assert.deepEqual(services.records.getRecord(id).record.cards, copy);
    assert.equal(services.records.getRecord(id).record.images[0].translation.contentLanguage, 'ja');
  }
  assert.equal(traffic.length, before); page.onUnload();
});

test('native encoded dish routes open saved details and malformed route parameters show the missing state', async (t) => {
  const { services, id } = await setup(t); await services.jobs.startImageCards(id);
  const page = resultPage(t, services); page.onLoad({ recordId: encodeURIComponent(id) }); page.onShow();
  let url; global.wx.navigateTo = (options) => { url = options.url; };
  const cardId = page.data.dishCards[0].id; page.openDish({ currentTarget: { dataset: { id: cardId } } });
  const raw = Object.fromEntries(url.split('?')[1].split('&').map((pair) => pair.split('=')));
  assert.match(raw.cardId, /%3A/);
  let definition; global.Page = (value) => { definition = value; };
  const file = require.resolve('../miniprogram/pages/dish-detail/dish-detail'); delete require.cache[file]; require(file);
  const detail = { ...definition, data: {}, setData(value) { Object.assign(this.data, value); } };
  detail.onLoad(raw); detail.onShow(); assert.equal(detail.data.card.id, cardId);
  detail.onLoad({ recordId: id, cardId: '%malformed' }); detail.onShow();
  assert.equal(detail.data.card, null); assert.ok(detail.data.error);
  page.onUnload();
});

test('a reopened client exposes an interrupted translated-file save for manual retry without new generation', async (t) => {
  const { services, disk, id, backend, traffic } = await setup(t);
  const download = disk.platform.downloadFile; let interrupted = false;
  disk.platform.downloadFile = () => { interrupted = true; };
  void services.jobs.startImageTranslation(id);
  for (let count = 0; count < 200 && !interrupted; count += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(interrupted, true);
  assert.equal(services.records.getRecord(id).record.images[0].translation.saveState, 'saving');
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.imageView.open(id).translationSaveState, 'pending');
  disk.platform.downloadFile = download; const before = traffic.filter((entry) => entry.method === 'POST').length;
  const page = resultPage(t, reopened); page.onLoad({ recordId: id }); page.onShow();
  await page.retryTranslationSave();
  assert.equal(reopened.records.getRecord(id).record.images[0].translation.saveState, 'saved');
  assert.equal(traffic.filter((entry) => entry.method === 'POST').length, before); page.onUnload();
});

test('failed translated-file writes retain cards, original and viewing choice; manual save retry uses no generation', async (t) => {
  const { services, disk, id, traffic } = await setup(t); await services.jobs.startImageCards(id);
  const original = services.records.getRecord(id).record.images[0].original;
  const cards = services.records.getRecord(id).record.cards;
  const write = disk.storage.set; disk.storage.set = () => { throw new Error('metadata full'); };
  assert.equal(services.imageView.open(id).variant, 'original');
  disk.storage.set = write;
  const copy = disk.fileSystem.copyFile;
  disk.fileSystem.copyFile = (options) => options.destPath.includes('/seefood-translations/') ? options.fail(new Error('image storage full')) : copy(options);
  assert.equal((await services.jobs.startImageTranslation(id)).error, 'translation-write');
  const saved = services.records.getRecord(id).record;
  assert.equal(saved.images[0].translation.saveState, 'failed'); assert.deepEqual(saved.images[0].original, original); assert.deepEqual(saved.cards, cards);
  const page = resultPage(t, services); page.onLoad({ recordId: id }); page.onShow();
  assert.equal(page.data.imageView.variant, 'original'); assert.equal(page.data.dishCards.length, 1);
  assert.notEqual(page.data.saveLabel, page.data.recordCopy.saved); assert.equal(page.data.originalSaveLabel, page.data.imageCopy.saved);
  assert.equal(page.data.translationSaveLabel, page.data.imageCopy.saveFailed);
  assert.equal(page.data.imageView.translationAvailable, true);
  const before = traffic.filter((entry) => entry.method === 'POST').length;
  disk.fileSystem.copyFile = copy; await page.retryTranslationSave();
  assert.equal(page.data.imageView.variant, 'original'); assert.equal(page.data.translationSaveLabel, page.data.imageCopy.saved);
  assert.equal(traffic.filter((entry) => entry.method === 'POST').length, before);
  page.retryImageChoice(); assert.equal(page.data.imageView.saveError, null); page.onUnload();
});

test('unsaved translated metadata stays distinct from successful cards and saves the retained result without changing the chosen original', async (t) => {
  const { services, disk, id } = await setup(t); await services.jobs.startImageCards(id);
  const page = resultPage(t, services); page.onLoad({ recordId: id }); page.onShow();
  const write = disk.storage.set; const send = disk.platform.request;
  disk.platform.request = (options) => {
    if (options.method === 'GET' && options.url.includes('/v1/jobs/')) {
      const success = options.success; options.success = (response) => {
        if (response.data.kind === 'image_translation' && response.data.state === 'succeeded') disk.storage.set = () => { throw new Error('metadata full'); };
        success(response);
      };
    }
    send(options);
  };
  assert.equal((await services.jobs.startImageTranslation(id)).error, 'storage-write');
  assert.equal(page.data.dishCards.length, 1); assert.equal(page.data.imageView.variant, 'original');
  assert.equal(page.data.translationJob.state, 'succeeded'); assert.equal(page.data.imageView.translationUnsaved, true);
  assert.equal(page.data.saveLabel, page.data.recordCopy.saveFailed); assert.equal(page.data.originalSaveLabel, page.data.imageCopy.saved);
  const ready = services.jobs.getState(id).unsavedJobs.find((job) => job.kind === 'image_translation');
  assert.equal(services.jobs.applyJob(id, { ...ready, state: 'running', output: null, revision: ready.revision - 1 }).error, 'stale-job');
  disk.storage.set = write; await page.retryTranslationSave();
  assert.equal(page.data.imageView.variant, 'original'); assert.equal(page.data.translationSaveLabel, page.data.imageCopy.saved); page.onUnload();
});

test('two real saved images keep separate original or translated choices when switching and reopening', async (t) => {
  const { services, disk, backend } = await setup(t);
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png'), disk.material('menu-screenshot.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' });
  const { recordId: id } = await services.records.confirmCapture(capture.confirm().batch); const record = services.records.getRecord(id).record;
  // Drive the existing public upload protocol for both materials; batch orchestration belongs to T15.
  const snapshot = { purpose: 'record', recordId: id, localScopeId: id, snapshotVersion: 1, snapshot: {
    images: record.images.map((image) => ({ imageId: image.id, kind: image.kind, order: image.order, assetId: null })), cards: [], messages: [],
    preferences: { version: 1, allergies: [], restrictions: [], tastes: [], notes: '' } } };
  await services.backend.putContext(record.contextId, snapshot);
  for (const image of record.images) {
    const ticket = await services.backend.createUpload({ contextId: record.contextId, imageId: image.id, kind: image.kind, mimeType: image.mimeType, sizeBytes: image.sizeBytes }, image.requests.upload);
    await services.backend.sendUpload(ticket, image.localOriginalPath);
    const asset = await services.backend.completeUpload(ticket.uploadId, { contextId: record.contextId, imageId: image.id }, image.requests.complete);
    snapshot.snapshot.images.find((item) => item.imageId === image.id).assetId = asset.assetId;
  }
  snapshot.snapshotVersion = 2; await services.backend.putContext(record.contextId, snapshot);
  services.records.updateRecord(id, (draft) => {
    draft.contextSnapshotVersion = 2;
    draft.images.forEach((image) => { image.assetId = snapshot.snapshot.images.find((item) => item.imageId === image.id).assetId; image.uploadState = 'uploaded'; });
  });
  const [first, second] = record.images.map((image) => image.id);
  assert.equal(services.imageView.open(id, first).variant, 'original');
  await Promise.all([services.jobs.startImageTranslation(id, first), services.jobs.startImageTranslation(id, second)]);
  assert.equal(services.imageView.open(id, first).variant, 'original');
  assert.equal(services.imageView.open(id, second).variant, 'translation');
  assert.equal(services.imageView.selectVariant(id, second, 'original').ok, true);
  assert.equal(services.imageView.selectVariant(id, first, 'translation').ok, true);
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.imageView.open(id).imageId, first); assert.equal(reopened.imageView.open(id).variant, 'translation');
  assert.equal(reopened.imageView.open(id, second).variant, 'original');
  const images = reopened.records.getRecord(id).record.images;
  assert.notEqual(images[0].translation.localPath, images[1].translation.localPath);
  assert.equal(images[0].translation.imageId, first); assert.equal(images[1].translation.imageId, second);
});
