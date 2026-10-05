const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');

async function setup(t, env = {}) {
  const disk = recordPlatform(t); const server = await start(t, temporary(t), env); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  const send = (options) => {
    traffic.push({ url: options.url, method: options.method, data: structuredClone(options.data), header: options.header });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.platform.request = send;
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  return { disk, server, backend, traffic, send, services };
}
async function capture(disk, names, target = { kind: 'new' }) {
  const draft = createCapture({ media: { chooseImages: async () => names.map((name) => disk.material(name)) }, getLanguage: () => 'en' });
  await draft.chooseImages({ source: 'album', target }); return draft;
}
async function until(read, predicate) {
  for (let count = 0; count < 300; count += 1) {
    const value = read(); if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('batch did not reach the expected observable state');
}
function nativePages(t, services) {
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, old));
  let events = {}; const navigation = [];
  global.getApp = () => ({ services });
  global.getCurrentPages = () => [{ route: 'pages/index/index' }, { route: 'pages/preview/preview' }];
  global.wx = { setTabBarItem() {}, setNavigationBarTitle() {}, nextTick() {},
    navigateTo(options) { events = options.events || {}; navigation.push(['push', options.url]); },
    redirectTo(options) { navigation.push(['replace', options.url]); }, navigateBack() { navigation.push(['back']); },
    pageScrollTo(options) { navigation.push(['scroll', options.scrollTop]); } };
  return { navigation, load(name) {
    let definition; global.Page = (value) => { definition = value; };
    const filename = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[filename]; require(filename);
    return { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); },
      getOpenerEventChannel: () => ({ emit(name, ...args) { return events[name](...args); } }) };
  } };
}

test('a reordered confirmed batch uploads in parallel and exposes a completed image before its slow neighbour', async (t) => {
  const { disk, services, traffic, send } = await setup(t);
  const draft = await capture(disk, ['menu-photo.png', 'menu-screenshot.png', 'menu-long.png']);
  const chosen = draft.getState().images;
  draft.removeImage(chosen[1].id); draft.moveImage(chosen[2].id, 0);
  const batch = draft.confirm().batch;
  const id = (await services.records.confirmCapture(batch)).recordId;
  let held; const uploadImages = new Map();
  disk.platform.request = (options) => {
    if (options.url.endsWith('/v1/uploads')) {
      const success = options.success;
      send({ ...options, success(response) { uploadImages.set(response.data.uploadUrl, options.data.imageId); success(response); } }); return;
    }
    if (uploadImages.get(options.url) === chosen[2].id && !held) { held = options; return; }
    send(options);
  };
  const pending = services.imageBatches.startBatch(id, batch.id);
  const early = await until(() => services.records.getRecord(id).record,
    (record) => record.images[1].translation?.saveState === 'saved');
  assert.deepEqual(early.imageIds, [chosen[2].id, chosen[0].id]);
  assert.equal(early.images[0].uploadState, 'uploading');
  assert.equal(early.images[1].stageJobs.image_cards.state, 'succeeded');
  assert.equal(early.cards.every((card) => card.sourceImageIds[0] === chosen[0].id), true);
  assert.equal(services.imageBatches.getState(id).canLeave, false);
  send(held);
  assert.equal((await pending).ok, true);
  const saved = services.records.getRecord(id).record;
  assert.equal(services.imageBatches.getState(id).canLeave, true);
  assert.equal(services.records.listRecent().records.length, 1);
  for (const image of saved.images) {
    assert.equal(image.uploadState, 'uploaded');
    assert.equal(image.stageJobs.image_cards.state, 'succeeded');
    assert.equal(image.translation.saveState, 'saved');
    assert.equal(saved.cards.some((card) => card.sourceImageIds[0] === image.id), true);
    assert.equal(fs.existsSync(image.localOriginalPath), true);
    assert.equal(fs.existsSync(image.translation.localPath), true);
  }
  const snapshots = traffic.filter((request) => request.method === 'PUT' && request.data.purpose === 'record').map((request) => request.data);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.snapshotVersion), [1, 2, 3]);
  assert.deepEqual(snapshots[1].snapshot.images.map((image) => !!image.assetId), [false, true]);
  assert.deepEqual(snapshots[2].snapshot.images.map((image) => image.assetId), saved.images.map((image) => image.assetId));
  assert.deepEqual(traffic.filter((request) => request.url.includes('/_uploads/')).map((request) => request.header.Authorization), [undefined, undefined]);
});

test('native confirmation processes every new and appended image while preserving existing cards, chat, choices and append order', async (t) => {
  const { disk, services, backend, server, traffic, send } = await setup(t);
  const ui = nativePages(t, services);
  const choose = (names) => {
    const materials = names.map((name) => disk.material(name));
    disk.platform.chooseMedia = ({ success }) => success({ tempFiles: materials.map((material) => ({ tempFilePath: material.localPath, size: material.sizeBytes })) });
  };
  choose(['menu-photo.png', 'menu-screenshot.png']);
  const index = ui.load('index'); index.onShow(); await index.importPhoto();
  const preview = ui.load('preview'); preview.onShow(); const initialIds = preview.data.images.map((image) => image.id);
  const confirmed = await preview.confirm(); assert.equal(confirmed.ok, true); preview.onUnload();
  const id = confirmed.recordId;
  assert.deepEqual(ui.navigation.at(-1), ['replace', `/pages/result/result?recordId=${encodeURIComponent(id)}`]);
  await until(() => services.records.getRecord(id).record, (record) => record.images.every((image) => image.translation?.saveState === 'saved'));
  assert.equal((await services.chat.sendQuickQuestion(id, 'communicate')).ok, true);
  services.imageView.selectVariant(id, initialIds[0], 'original');
  const result = ui.load('result'); result.onLoad({ recordId: id }); result.onShow();
  result.onPageScroll({ scrollTop: 420 });
  const before = services.records.getRecord(id).record;
  choose(['menu-photo.png', 'menu-screenshot.png', 'menu-long.png']);
  result.addPhotos(); await result.importPhoto();
  const append = ui.load('preview'); append.onShow(); const selected = append.data.images;
  append.removeImage({ currentTarget: { dataset: { id: selected[1].id } } });
  append.moveOne({ currentTarget: { dataset: { id: selected[2].id, direction: -1 } } });
  let held; const uploadImages = new Map();
  disk.platform.request = (options) => {
    if (options.url.endsWith('/v1/uploads')) {
      const success = options.success;
      send({ ...options, success(response) { uploadImages.set(response.data.uploadUrl, options.data.imageId); success(response); } }); return;
    }
    if (uploadImages.get(options.url) === selected[2].id && !held) { held = options; return; }
    send(options);
  };
  global.getCurrentPages = () => [{ route: 'pages/index/index' }, { route: 'pages/result/result', recordId: id }, { route: 'pages/preview/preview' }];
  assert.deepEqual(await append.confirm(), { ok: true, recordId: id });
  assert.deepEqual(ui.navigation.at(-1), ['back']); append.onUnload(); result.onShow();
  assert.deepEqual(ui.navigation.at(-1), ['scroll', 420]);
  const early = await until(() => services.records.getRecord(id).record, (record) => record.images[3].translation?.saveState === 'saved');
  assert.deepEqual(early.imageIds, [...initialIds, selected[2].id, selected[0].id]);
  assert.deepEqual(early.images.slice(0, 2), before.images);
  assert.deepEqual(early.messages, before.messages);
  assert.equal(result.data.currentImageId, initialIds[0]); assert.equal(result.data.imageView.variant, 'original');
  assert.equal(result.data.canLeave, false);
  result.selectImage({ currentTarget: { dataset: { id: selected[0].id } } });
  assert.ok(result.data.dishCards.length > 0);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); result.retryRead();
    assert.equal(result.data.imageStates[2].cardsStateLabel, result.data.dishCopy.unstarted);
    assert.equal(result.data.imageStates[3].cardsStateLabel, result.data.dishCopy.succeeded);
    assert.equal(result.data.imageStates[3].translationStateLabel, result.data.imageCopy.ready);
    assert.equal(result.data.imageStates[3].translationSaveLabel, result.data.imageCopy.saved);
  }
  send(held);
  const done = await until(() => services.records.getRecord(id).record, (record) => record.images.every((image) => image.translation?.saveState === 'saved'));
  assert.equal(result.data.canLeave, true);
  assert.deepEqual(done.messages, before.messages);
  assert.deepEqual(done.cards.filter((card) => before.cardIds.includes(card.id)), before.cards);
  assert.equal(services.records.listRecent().records.length, 1);
  assert.equal(traffic.filter((request) => request.method === 'POST' && request.data.kind === 'image_cards').length, 4);
  for (const image of done.images) { assert.equal(fs.existsSync(image.localOriginalPath), true); assert.equal(fs.existsSync(image.translation.localPath), true); }
  result.onUnload(); await server.stop();
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.records.getRecord(id).record, done);
  assert.deepEqual(reopened.chat.getState(id).messages, before.messages);
});

test('one failed upload can be retried while another still transfers without rerunning its successful neighbour', async (t) => {
  const { disk, services, send, traffic } = await setup(t);
  const batch = (await capture(disk, ['menu-photo.png', 'menu-screenshot.png', 'menu-long.png'])).confirm().batch;
  const id = (await services.records.confirmCapture(batch)).recordId;
  const [failedId, heldId, goodId] = batch.images.map((image) => image.id);
  const uploadImages = new Map(); let held; let failed = false;
  disk.platform.request = (options) => {
    if (options.url.endsWith('/v1/uploads')) {
      const success = options.success;
      send({ ...options, success(response) { uploadImages.set(response.data.uploadUrl, options.data.imageId); success(response); } }); return;
    }
    const imageId = uploadImages.get(options.url);
    if (imageId === failedId && !failed) { failed = true; options.fail(new Error('disconnected')); return; }
    if (imageId === heldId && !held) { held = options; return; }
    send(options);
  };
  const ui = nativePages(t, services); const result = ui.load('result'); result.onLoad({ recordId: id }); result.onShow();
  const processing = services.imageBatches.startBatch(id, batch.id);
  const partial = await until(() => services.records.getRecord(id).record, (record) => record.images[2].translation?.saveState === 'saved');
  assert.equal(partial.images[0].uploadState, 'failed');
  assert.equal(services.uploads.getState(id, failedId).running, false);
  assert.equal(services.uploads.getState(id, failedId).canRetry, true);
  assert.equal(services.uploads.getState(id, heldId).running, true);
  assert.equal(services.uploads.getState(id, goodId).error, null);
  assert.equal(result.data.imageStates[0].canRetryUpload, true);
  assert.equal(result.data.imageStates[1].canRetryUpload, false);
  assert.equal(result.data.imageStates[2].processingLabel, result.data.recordCopy.uploaded);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); result.retryRead();
    assert.equal(result.data.imageStates[0].processingLabel, result.data.recordCopy.uploadFailed);
    assert.equal(result.data.imageStates[1].processingLabel, result.data.recordCopy.uploading);
    assert.equal(result.data.imageStates[2].processingLabel, result.data.recordCopy.uploaded);
    assert.equal(result.data.imageStates[2].cardsStateLabel, result.data.dishCopy.succeeded);
  }
  result.selectImage({ currentTarget: { dataset: { id: goodId } } });
  assert.ok(result.data.dishCards.length > 0); assert.equal(result.data.canLeave, false);
  assert.equal((await result.retryUpload({ currentTarget: { dataset: { id: failedId } } })).ok, true);
  assert.equal(services.records.getRecord(id).record.images[0].translation.saveState, 'saved');
  assert.deepEqual(services.records.getRecord(id).record.images[2], partial.images[2]);
  assert.equal(traffic.filter((request) => request.method === 'POST' && request.data.kind === 'image_cards' && request.data.target.imageId === goodId).length, 1);
  send(held); await processing;
  assert.equal(services.imageBatches.getState(id).canLeave, true);
  result.onUnload();
});

test('a lost accepted asset snapshot is replayed exactly before another image binds, and retry does not upload accepted bytes again', async (t) => {
  const { disk, services, send, traffic } = await setup(t);
  const batch = (await capture(disk, ['menu-photo.png', 'menu-long.png'])).confirm().batch;
  const id = (await services.records.confirmCapture(batch)).recordId;
  const [firstId, secondId] = batch.images.map((image) => image.id);
  const uploadImages = new Map(); let held; let lost = false;
  disk.platform.request = (options) => {
    if (options.url.endsWith('/v1/uploads')) {
      const success = options.success;
      send({ ...options, success(response) { uploadImages.set(response.data.uploadUrl, options.data.imageId); success(response); } }); return;
    }
    if (uploadImages.get(options.url) === secondId && !held) { held = options; return; }
    if (!lost && options.method === 'PUT' && options.data.purpose === 'record' && options.data.snapshotVersion === 2) {
      lost = true; send({ ...options, success() { options.fail(new Error('accepted response lost')); } }); return;
    }
    send(options);
  };
  const batchResult = services.imageBatches.startBatch(id, batch.id);
  const uncertain = await until(() => services.records.getRecord(id).record, (record) => record.images[0].uploadState === 'failed' && !!held);
  assert.equal(uncertain.images[0].uploadError, 'network-unavailable');
  assert.ok(uncertain.images[0].assetId); assert.equal(uncertain.pendingContextSnapshot.snapshotVersion, 2);
  send(held); assert.equal((await batchResult).ok, false);
  const partial = services.records.getRecord(id).record;
  assert.equal(partial.images[1].translation.saveState, 'saved');
  const snapshots = traffic.filter((request) => request.method === 'PUT' && request.data.purpose === 'record').map((request) => request.data);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.snapshotVersion), [1, 2, 2, 3]);
  assert.deepEqual(snapshots[1], snapshots[2]);
  assert.deepEqual(snapshots[3].snapshot.images.map((image) => image.assetId), partial.images.map((image) => image.assetId));
  const transfers = traffic.filter((request) => request.url.includes('/_uploads/')).length;
  assert.equal((await services.imageBatches.retryUploads(id, firstId)).ok, true);
  assert.equal(traffic.filter((request) => request.url.includes('/_uploads/')).length, transfers);
  assert.deepEqual(services.records.getRecord(id).record.images[1], partial.images[1]);
  assert.equal(services.imageBatches.getState(id).canLeave, true);
});

test('all uploads alone do not allow leaving until both requested stages on every image have been accepted', async (t) => {
  const { disk, services, send } = await setup(t, { SEEFOOD_TRANSLATION_DELAY_MS: '180' });
  const batch = (await capture(disk, ['menu-photo.png', 'menu-long.png'])).confirm().batch;
  const id = (await services.records.confirmCapture(batch)).recordId;
  const secondId = batch.images[1].id; let held;
  disk.platform.request = (options) => {
    if (!held && options.method === 'POST' && options.data?.kind === 'image_translation' && options.data.target.imageId === secondId) { held = options; return; }
    send(options);
  };
  const ui = nativePages(t, services); const page = ui.load('result'); page.onLoad({ recordId: id }); page.onShow();
  const pending = services.imageBatches.startBatch(id, batch.id);
  const cards = await until(() => services.records.getRecord(id).record, (record) => record.images.every((image) => image.stageJobs.image_cards?.state === 'succeeded'));
  assert.equal(cards.images.every((image) => image.uploadState === 'uploaded'), true);
  assert.equal(page.data.canLeave, false); assert.ok(page.data.dishCards.length > 0);
  assert.equal(page.data.imageStates[1].translationStateLabel, page.data.recoveryCopy.checking);
  send(held);
  await until(() => page.data, (value) => value.canLeave);
  assert.ok(['queued', 'running'].includes(services.records.getRecord(id).record.images[1].stageJobs.image_translation.state));
  await pending; page.onUnload();
});

test('client reentry only recovers accepted batch jobs and leaves unuploaded materials for an explicit retry', async (t) => {
  const { disk, services, backend, send, traffic } = await setup(t, { SEEFOOD_WORKER_DELAY_MS: '400', SEEFOOD_JOB_PAGE_SIZE: '1' });
  const batch = (await capture(disk, ['menu-photo.png', 'menu-long.png'])).confirm().batch;
  const id = (await services.records.confirmCapture(batch)).recordId;
  const firstId = batch.images[0].id;
  const uploadImages = new Map();
  disk.platform.request = (options) => {
    if (options.url.endsWith('/v1/uploads')) {
      const success = options.success;
      send({ ...options, success(response) { uploadImages.set(response.data.uploadUrl, options.data.imageId); success(response); } }); return;
    }
    if (uploadImages.get(options.url) === firstId) { options.fail(new Error('connection lost')); return; }
    // The service persists both stages; this client loses their acceptance responses.
    if (options.method === 'POST' && ['image_cards', 'image_translation'].includes(options.data?.kind)) {
      send({ ...options, success() { options.fail(new Error('acceptance response lost')); } }); return;
    }
    send(options);
  };
  assert.equal((await services.imageBatches.startBatch(id, batch.id)).ok, false);
  disk.platform.request = send;
  const begin = traffic.length;
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
  const recovered = reopened.records.getRecord(id).record;
  assert.equal(recovered.images[0].uploadState, 'failed');
  assert.equal(recovered.images[1].stageJobs.image_cards.state, 'succeeded');
  assert.equal(recovered.images[1].translation.saveState, 'saved');
  assert.equal(traffic.slice(begin).every((request) => request.method === 'GET'), true);
  assert.equal(reopened.imageBatches.getState(id).canLeave, false);
  assert.equal((await reopened.imageBatches.retryUploads(id, firstId)).ok, true);
  assert.equal(reopened.imageBatches.getState(id).canLeave, true);
  assert.deepEqual(reopened.records.getRecord(id).record.images[1], recovered.images[1]);
});

test('unsaved card deliveries remain readable for each image and retry saving retains both without generation', async (t) => {
  const { disk, services, send, traffic } = await setup(t);
  const batch = (await capture(disk, ['menu-photo.png', 'menu-long.png'])).confirm().batch;
  const id = (await services.records.confirmCapture(batch)).recordId;
  await Promise.all(batch.images.map((image) => services.uploads.uploadRecord(id, image.id)));
  const write = disk.storage.set;
  disk.platform.request = (options) => {
    if (options.method === 'GET' && options.url.includes('/v1/jobs/')) {
      const success = options.success;
      setTimeout(() => send({ ...options, success(response) {
        if (response.data.state === 'succeeded') disk.storage.set = () => { throw new Error('full'); };
        success(response);
      } }), 200); return;
    }
    send(options);
  };
  const outcomes = await Promise.all(batch.images.map((image) => services.jobs.startImageCards(id, image.id)));
  assert.equal(outcomes.every((outcome) => outcome.error === 'storage-write'), true);
  assert.equal(services.jobs.getState(id).unsavedJobs.length, 2);
  const ui = nativePages(t, services); const page = ui.load('result'); page.onLoad({ recordId: id }); page.retryRead();
  for (const image of batch.images) {
    page.selectImage({ currentTarget: { dataset: { id: image.id } } });
    assert.equal(page.data.cardsSaveFailed, true);
    assert.equal(page.data.cardsStateLabel, page.data.dishCopy.succeeded);
    assert.ok(page.data.dishCards.length > 0);
    assert.equal(page.data.dishCards.every((card) => card.sourceImageIds[0] === image.id), true);
  }
  assert.equal(page.data.imageStates.every((image) => image.resultSaveFailed), true);
  disk.storage.set = write; disk.platform.request = send;
  const requests = traffic.length; page.retryResultSave();
  assert.equal(traffic.length, requests);
  assert.equal(services.jobs.getState(id).unsavedJobs.length, 0);
  for (const image of batch.images) assert.equal(services.records.getRecord(id).record.cards.some((card) => card.sourceImageIds[0] === image.id), true);
  page.onUnload();
});

test('failed image translations keep every completed card and original independently readable', async (t) => {
  const { disk, services } = await setup(t, { SEEFOOD_MOCK_SCENARIO: 'translation-failure' });
  const batch = (await capture(disk, ['menu-photo.png', 'menu-long.png'])).confirm().batch;
  const id = (await services.records.confirmCapture(batch)).recordId;
  await services.imageBatches.startBatch(id, batch.id);
  const ui = nativePages(t, services); const page = ui.load('result'); page.onLoad({ recordId: id }); page.retryRead();
  assert.equal(page.data.canLeave, true);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language);
    for (const image of batch.images) {
      page.selectImage({ currentTarget: { dataset: { id: image.id } } });
      assert.equal(page.data.translationStateLabel, page.data.imageCopy.failed);
      assert.equal(page.data.cardsStateLabel, page.data.dishCopy.succeeded);
      assert.ok(page.data.dishCards.length > 0); assert.equal(page.data.imageView.variant, 'original');
      assert.equal(fs.existsSync(page.data.imageView.path), true);
    }
  }
  assert.equal(page.data.imageStates.every((image) => image.translationStateLabel === page.data.imageCopy.failed && image.cardsStateLabel === page.data.dishCopy.succeeded), true);
  page.onUnload();
});
