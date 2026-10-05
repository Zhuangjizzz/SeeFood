const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { recordPlatform } = require('./support/record-platform');
const { temporary } = require('./support/http-service');

async function setup(t, source = 'multiple') {
  const disk = recordPlatform(t); const traffic = [];
  const { createService } = await import('../server/service.ts');
  const { imageCardsHandler } = await import('../server/image-cards.ts');
  const generator = imageCardsHandler();
  const service = createService({ dataDir: temporary(t), enableDevSession: true, devIdentities: ['reader'], jobHandlers: {
    image_cards: { ...generator, async generate(context) {
      const output = await generator.generate(context);
      if (source === 'empty') return { cards: [] };
      output.cards[0].sourceImageIds = source === 'foreign' ? [context.request.target.imageId, 'foreign-image'] :
        source === 'no-target' ? context.snapshot.snapshot.images.filter((image) => image.imageId !== context.request.target.imageId).map((image) => image.imageId) :
          context.snapshot.snapshot.images.map((image) => image.imageId);
      return output;
    } }
  } });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const backend = { enabled: true, baseUrl: `http://127.0.0.1:${service.server.address().port}`, identity: 'reader' };
  disk.platform.request = (options) => {
    traffic.push({ method: options.method, url: options.url, data: structuredClone(options.data) });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  async function add(names, target = { kind: 'new' }) {
    const materials = names.map((name) => disk.material(name));
    disk.platform.chooseMedia = ({ success }) => success({ tempFiles: materials.map((image) => ({ tempFilePath: image.localPath, size: image.sizeBytes })) });
    await services.capture.chooseImages({ source: 'album', target });
    const batch = services.capture.confirm().batch;
    const saved = await services.records.confirmCapture(batch); assert.equal(saved.ok, true);
    return { id: saved.recordId, images: batch.images };
  }
  return { disk, services, backend, traffic, add };
}

function native(t, services, platform) {
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, old)); let stack = [{}, {}]; let rectangles = []; const navigation = [];
  global.getApp = () => ({ services }); global.getCurrentPages = () => stack;
  global.wx = { ...platform, getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }),
    setNavigationBarTitle() {}, nextTick(fn) { fn(); },
    navigateTo(value) { navigation.push(['push', value.url]); }, navigateBack() { navigation.push(['back']); },
    redirectTo(value) { navigation.push(['replace', value.url]); }, switchTab(value) { navigation.push(['tab', value.url]); },
    pageScrollTo(value) { navigation.push(['scroll', value]); },
    createSelectorQuery() { return { in() { return this; }, selectAll() { return this; }, fields() { return this; }, exec(callback) { callback([rectangles]); } }; }
  };
  return { navigation, setStack(value) { stack = value; }, setRectangles(value) { rectangles = value; }, load(name) {
    let definition; global.Page = (value) => { definition = value; };
    const filename = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[filename]; require(filename);
    return { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  } };
}
function tap(value, name = 'id') { return { currentTarget: { dataset: { [name]: value } } }; }

test('one delivered card can refer to two real frozen record images while later and foreign images remain rejected', async (t) => {
  const { services, disk, backend, add } = await setup(t);
  const { id, images } = await add(['menu-photo.png', 'menu-long.png']);
  for (const image of images) assert.equal((await services.uploads.uploadRecord(id, image.id)).ok, true);
  assert.equal((await services.jobs.startImageCards(id, images[0].id)).ok, true);
  const saved = services.records.getRecord(id).record;
  assert.equal(saved.images[0].stageJobs.image_cards.state, 'succeeded');
  assert.deepEqual(saved.cards[0].sourceImageIds, images.map((image) => image.id));
  const { images: appended } = await add(['menu-screenshot.png'], { kind: 'append', recordId: id });
  assert.equal((await services.uploads.uploadRecord(id, appended[0].id)).ok, true);
  const reopened = createWechatServices(disk.platform, { backend });
  for (const sourceIds of [[images[1].id], [images[0].id, 'foreign-image'], [images[0].id, appended[0].id]]) {
    const delivery = structuredClone(saved.images[0].stageJobs.image_cards); delivery.revision += 1;
    delivery.output.cards[0].sourceImageIds = sourceIds;
    assert.equal(reopened.jobs.applyJob(id, delivery).ok, false);
    assert.deepEqual(reopened.records.getRecord(id).record.cards, saved.cards);
  }
});

test('fullscreen reads actual long images from the top and shares each image choice with results and reopened clients', async (t) => {
  const { services, disk, backend, add } = await setup(t);
  const { id, images } = await add(['menu-long.png', 'menu-photo.png']);
  for (const image of images) {
    await services.uploads.uploadRecord(id, image.id); await services.jobs.startImageProcessing(id, image.id);
  }
  const ui = native(t, services, disk.platform); const result = ui.load('result'); result.onLoad({ recordId: id }); result.onShow();
  result.selectVariant(tap('original', 'variant'));
  ui.setRectangles([{ id: 'result-image', dataset: { anchorId: `image:${images[0].id}` }, top: -20, bottom: 210 }]);
  result.onPageScroll({ scrollTop: 330 }); result.viewImage(); result.onHide();
  assert.match(ui.navigation.at(-1)[1], /\/pages\/image-reader\/image-reader\?/);
  const reader = ui.load('image-reader'); reader.onLoad({ recordId: encodeURIComponent(id), imageId: encodeURIComponent(images[0].id), source: 'result' }); reader.onShow();
  assert.equal(reader.data.index, 0); assert.equal(reader.data.count, 2); assert.equal(reader.data.scale, 1);
  assert.equal(reader.data.imageWidth, 375); assert.equal(reader.data.scrollTop, 0); assert.ok(reader.data.imageHeight > 1500);
  assert.equal(reader.data.imagePath, services.records.getRecord(id).record.images[0].localOriginalPath);
  reader.scrollImage({ detail: { scrollTop: 1200, scrollLeft: 0 } }); reader.zoomIn();
  assert.equal(reader.data.scale, 1.5); assert.equal(reader.data.scrollTop, 1800);
  reader.fitWidth(); assert.equal(reader.data.scale, 1); assert.equal(reader.data.scrollTop, 0);
  reader.selectVariant(tap('translation', 'variant')); assert.match(reader.data.imagePath, /seefood-translations/);
  reader.changeImage(tap(1, 'direction')); reader.selectVariant(tap('original', 'variant'));
  assert.equal(reader.data.index, 1); assert.equal(reader.data.variant, 'original');
  reader.changeImage(tap(-1, 'direction')); assert.equal(reader.data.variant, 'translation');
  const translated = fs.readFileSync(reader.data.imagePath);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); reader.onShow();
    assert.ok(reader.data.copy.close); assert.ok(reader.data.copy.fitWidth); assert.ok(reader.data.imageCopy.translation);
    assert.deepEqual(fs.readFileSync(reader.data.imagePath), translated);
  }
  reader.changeImage(tap(1, 'direction')); reader.close(); reader.onUnload();
  assert.deepEqual(ui.navigation.at(-1), ['back']);
  ui.setRectangles([{ id: 'result-image', dataset: { anchorId: `image:${images[1].id}` }, top: -20, bottom: 210 }]);
  result.onShow(); assert.equal(result.data.currentImageId, images[1].id); assert.equal(result.data.imageView.variant, 'original');
  assert.deepEqual(ui.navigation.at(-1), ['scroll', { selector: '#result-image', offsetTop: 20, duration: 0 }]);
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.imageView.open(id).imageId, images[1].id);
  assert.equal(reopened.imageView.open(id, images[0].id).variant, 'translation');
  assert.equal(reopened.imageView.open(id, images[1].id).variant, 'original'); result.onUnload();
});

test('a delivered multi-image card stays readable under either filter when its local write fails', async (t) => {
  const { services, disk, add } = await setup(t);
  const { id, images } = await add(['menu-photo.png', 'menu-long.png']);
  for (const image of images) await services.uploads.uploadRecord(id, image.id);
  const send = disk.platform.request; const write = disk.storage.set;
  disk.platform.request = (options) => {
    const success = options.success;
    send({ ...options, success(response) {
      if (options.method === 'GET' && response.data.kind === 'image_cards' && response.data.state === 'succeeded') disk.storage.set = () => { throw new Error('disk full'); };
      success(response);
    } });
  };
  assert.equal((await services.jobs.startImageCards(id, images[0].id)).error, 'storage-write');
  const ui = native(t, services, disk.platform); const result = ui.load('result'); result.onLoad({ recordId: id });
  // Only the external connectivity/storage boundaries fail; no ready records are prefilled.
  disk.platform.request = (options) => options.fail(new Error('offline'));
  result.onShow(); result.selectImage(tap(images[1].id));
  assert.equal(result.data.dishCards.length, 1);
  assert.deepEqual(result.data.dishCards[0].sourceImageIds, images.map((image) => image.id));
  assert.equal(result.data.cardsSaveFailed, true);
  result.openDish(tap(result.data.dishCards[0].id));
  const detail = ui.load('dish-detail'); detail.onLoad({ recordId: id, cardId: result.data.dishCards[0].id }); detail.onShow();
  assert.equal(detail.data.sourceImages.length, 2); assert.equal(detail.data.card.id, result.data.dishCards[0].id);
  disk.storage.set = write; services.jobs.retrySave(id); result.onUnload();
});

test('filtering preserves the complete chat snapshot and dish source reading returns to the same detail', async (t) => {
  const { services, disk, traffic, add } = await setup(t);
  const { id, images } = await add(['menu-photo.png', 'menu-long.png']);
  for (const image of images) await services.uploads.uploadRecord(id, image.id);
  await services.jobs.startImageCards(id, images[0].id);
  const saved = services.records.getRecord(id).record; const cardId = saved.cards[0].id;
  const extra = await add(['menu-screenshot.png'], { kind: 'append', recordId: id });
  await services.uploads.uploadRecord(id, extra.images[0].id);
  const ui = native(t, services, disk.platform); const result = ui.load('result'); result.onLoad({ recordId: id }); result.onShow();
  for (const image of images) {
    result.selectImage(tap(image.id)); assert.deepEqual(result.data.dishCards.map((card) => card.id), [cardId]);
  }
  result.selectImage(tap(extra.images[0].id)); assert.deepEqual(result.data.dishCards, []);
  assert.equal(result.data.cardsStateLabel, result.data.dishCopy.unstarted);
  assert.deepEqual(services.records.getRecord(id).record.cards, saved.cards);
  assert.equal((await services.chat.send(id, 'Tell me about every menu photo')).ok, true);
  const snapshot = traffic.filter((request) => request.method === 'PUT' && request.data.purpose === 'record').at(-1).data.snapshot;
  assert.deepEqual(snapshot.images.map((image) => image.imageId), [...images, ...extra.images].map((image) => image.id));
  assert.deepEqual(snapshot.cards.map((card) => card.id), [cardId]);
  const detail = ui.load('dish-detail'); detail.onLoad({ recordId: id, cardId: encodeURIComponent(cardId) }); detail.onShow(); detail.viewOriginal();
  assert.match(ui.navigation.at(-1)[1], /\/pages\/image-reader\/image-reader\?/);
  const reader = ui.load('image-reader'); reader.onLoad({ recordId: id, imageId: images[0].id, source: 'detail', cardId: encodeURIComponent(cardId) }); reader.onShow();
  assert.equal(reader.data.variant, 'original'); assert.equal(reader.data.count, 3);
  ui.setStack([{}]); reader.close();
  assert.deepEqual(ui.navigation.at(-1), ['replace', `/pages/dish-detail/dish-detail?recordId=${id}&cardId=${encodeURIComponent(cardId)}`]);
  reader.onUnload(); result.onUnload();
});

test('server rejects generated associations outside its frozen record images or without the processing target', async (t) => {
  for (const source of ['foreign', 'no-target']) {
    const { services, add } = await setup(t, source); const { id, images } = await add(['menu-photo.png', 'menu-long.png']);
    for (const image of images) await services.uploads.uploadRecord(id, image.id);
    await services.jobs.startImageCards(id, images[0].id);
    const record = services.records.getRecord(id).record;
    assert.equal(record.images[0].stageJobs.image_cards.state, 'failed');
    assert.equal(record.images[0].stageJobs.image_cards.error.code, 'DEPENDENCY_MISSING');
    assert.deepEqual(record.cards || [], []);
  }
});

test('fullscreen missing files, stale image locations and missing records have safe five-language fallbacks without new work', async (t) => {
  const { services: initial, disk, traffic, add, backend } = await setup(t, 'empty'); const { id, images } = await add(['menu-photo.png']);
  await initial.uploads.uploadRecord(id, images[0].id); await initial.jobs.startImageProcessing(id, images[0].id);
  const record = initial.records.getRecord(id).record;
  assert.equal(initial.imageView.open(id).variant, 'translation');
  const services = createWechatServices(disk.platform, { backend }); const ui = native(t, services, disk.platform);
  const result = ui.load('result'); result.onLoad({ recordId: id });
  const reader = ui.load('image-reader'); reader.onLoad({ recordId: id, imageId: 'no-longer-present', source: 'result' }); reader.onShow();
  assert.equal(reader.data.currentImageId, images[0].id); assert.equal(reader.data.variant, 'translation');
  fs.unlinkSync(record.images[0].translation.localPath);
  const before = traffic.length;
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); reader.onShow(); result.onShow();
    assert.equal(reader.data.imagePath, null); assert.equal(reader.data.translationAvailable, false);
    assert.ok(reader.data.missingImage); assert.deepEqual(result.data.dishCards, []); assert.ok(result.data.dishCopy.noCards);
    assert.equal(result.data.cardsJob.state, 'succeeded');
  }
  reader.selectVariant(tap('original', 'variant')); assert.equal(reader.data.imagePath, record.images[0].localOriginalPath);
  fs.unlinkSync(record.images[0].localOriginalPath); reader.onShow(); assert.equal(reader.data.imagePath, null);
  assert.equal(reader.data.missingImage, result.data.recordCopy.missingOriginal);
  reader.onUnload();
  const missing = ui.load('image-reader'); missing.onLoad({ recordId: 'deleted-record', imageId: '%broken' });
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); missing.onShow(); assert.equal(missing.data.count, 0); assert.ok(missing.data.error); assert.equal(missing.data.imagePath, null);
  }
  ui.setStack([{}]); missing.close(); assert.deepEqual(ui.navigation.at(-1), ['tab', '/pages/index/index']);
  assert.equal(traffic.length, before); missing.onUnload(); result.onUnload();
});

test('preview fullscreen still reads only selected originals and preserves the unsubmitted batch position', async (t) => {
  const { services, disk, traffic } = await setup(t);
  const image = disk.material('menu-long.png');
  disk.platform.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: image.localPath, size: image.sizeBytes }] });
  await services.capture.chooseImages({ source: 'album' }); const selected = services.capture.getState().images[0];
  services.capture.setPreviewPosition(460); services.capture.openOriginal(selected.id);
  const ui = native(t, services, disk.platform); const reader = ui.load('preview-image'); reader.onShow();
  assert.equal(reader.data.image.localPath, image.localPath); assert.equal(reader.data.imageWidth, 375);
  assert.equal(reader.data.scrollTop, 0); assert.ok(reader.data.imageHeight > 1500);
  reader.startTouch({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });
  reader.moveTouch({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 250, clientY: 0 }] }); reader.finishTouch();
  assert.equal(reader.data.scale, 2.5); reader.fitWidth(); reader.close(); reader.onUnload();
  assert.deepEqual(ui.navigation.at(-1), ['back']); assert.equal(services.capture.getState().previewPosition, 460);
  assert.equal(services.capture.getState().canConfirm, true); assert.equal(traffic.length, 0);
});
