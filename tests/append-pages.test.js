const test = require('node:test');
const assert = require('node:assert/strict');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { recordPlatform } = require('./support/record-platform');

function nativePages(t, disk) {
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, old));
  const services = createWechatServices(disk.platform); const navigation = []; let events = {};
  global.getApp = () => ({ services });
  global.getCurrentPages = () => [{ route: 'pages/index/index' }, { route: 'pages/result/result' }, { route: 'pages/preview/preview' }];
  global.wx = { setTabBarItem() {}, setNavigationBarTitle() {}, nextTick() {},
    navigateTo(options) { navigation.push(['push', options.url]); events = options.events || {}; },
    redirectTo(options) { navigation.push(['replace', options.url]); },
    navigateBack() { navigation.push(['back']); }, switchTab(options) { navigation.push(['tab', options.url]); },
    pageScrollTo(options) { navigation.push(['scroll', options.scrollTop]); } };
  const material = disk.material('menu-photo.png');
  disk.platform.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: material.localPath, size: material.sizeBytes }] });
  disk.platform.getImageInfo = ({ success }) => success({ width: material.width, height: material.height, type: 'png', orientation: 'up' });
  function load(name) {
    let definition; global.Page = (value) => { definition = value; };
    const file = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[file]; require(file);
    return { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); },
      getOpenerEventChannel: () => ({ emit(name, ...args) { return events[name](...args); } }) };
  }
  return { services, navigation, load };
}

test('result append preview shows its actual target and chosen mode, and cancellation restores source position in five languages', async (t) => {
  const disk = recordPlatform(t); const ui = nativePages(t, disk);
  await ui.services.capture.chooseImages({ source: 'album' });
  const id = (await ui.services.records.confirmCapture(ui.services.capture.confirm().batch)).recordId;
  ui.services.records.updateRecord(id, (record) => { record.title = 'Lunch menu'; });
  const result = ui.load('result'); result.onLoad({ recordId: id }); result.onShow();
  const original = ui.services.records.getRecord(id).record;
  for (const [language, label] of [['en', 'Add photos'], ['ja', '写真を追加'], ['ko', '사진 추가'], ['es', 'Añadir fotos'], ['zh-CN', '添加照片']]) {
    ui.services.application.chooseLanguage(language); result.onShow();
    result.onPageScroll({ scrollTop: 740 });
    result.addPhotos();
    assert.equal(result.data.captureCopy.addPhotos, label);
    result.chooseMode({ currentTarget: { dataset: { mode: 'dish' } } });
    assert.equal((await result.importPhoto()).ok, true);
    assert.deepEqual(ui.navigation.pop(), ['push', '/pages/preview/preview']);
    const preview = ui.load('preview'); preview.onShow();
    assert.equal(preview.data.target.recordId, id);
    assert.equal(preview.data.target.title, 'Lunch menu');
    assert.equal(preview.data.images[0].kind, 'dish');
    preview.cancel();
    assert.deepEqual(ui.navigation.pop(), ['back']);
    preview.onUnload(); result.onShow();
    assert.deepEqual(ui.navigation.pop(), ['scroll', 740]);
    assert.equal(result.data.currentImageId, original.images[0].id);
    assert.deepEqual(ui.services.records.getRecord(id).record.images, original.images);
    assert.equal(ui.services.records.listRecent().records.length, 1);
  }
  result.onUnload();
});

test('native append confirmation returns to the existing result while a later home confirmation creates an independent record', async (t) => {
  const disk = recordPlatform(t); const ui = nativePages(t, disk);
  await ui.services.capture.chooseImages({ source: 'album' });
  const id = (await ui.services.records.confirmCapture(ui.services.capture.confirm().batch)).recordId;
  const result = ui.load('result'); result.onLoad({ recordId: id }); result.onShow();
  result.onPageScroll({ scrollTop: 420 }); result.addPhotos(); await result.takePhoto();
  global.getCurrentPages = () => [{ route: 'pages/index/index' }, { route: 'pages/result/result', recordId: id }, { route: 'pages/preview/preview' }];
  const preview = ui.load('preview'); preview.onShow();
  assert.deepEqual(await preview.confirm(), { ok: true, recordId: id });
  assert.deepEqual(ui.navigation.pop(), ['back']);
  preview.onUnload(); result.onShow();
  const appended = ui.services.records.getRecord(id).record;
  assert.equal(appended.images.length, 2);
  const index = ui.load('index'); index.onShow(); await index.importPhoto();
  const fresh = ui.load('preview'); fresh.onShow();
  assert.equal(fresh.data.target.kind, 'new');
  const other = await fresh.confirm();
  assert.equal(other.ok, true); assert.notEqual(other.recordId, id);
  const second = ui.services.records.getRecord(other.recordId).record;
  assert.notEqual(second.contextId, appended.contextId);
  assert.equal(second.images.length, 1);
  assert.deepEqual(ui.services.records.getRecord(id).record, appended);
  assert.deepEqual(ui.navigation.pop(), ['replace', `/pages/result/result?recordId=${encodeURIComponent(other.recordId)}`]);
  fresh.onUnload(); result.onUnload();
});

test('append preview reports an unavailable target in every language and retains the selection without creating a new record', async (t) => {
  const disk = recordPlatform(t); const ui = nativePages(t, disk);
  await ui.services.capture.chooseImages({ source: 'album' });
  const id = (await ui.services.records.confirmCapture(ui.services.capture.confirm().batch)).recordId;
  const result = ui.load('result'); result.onLoad({ recordId: id }); result.onShow();
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    ui.services.application.chooseLanguage(language); result.onShow(); result.addPhotos(); await result.importPhoto();
    const preview = ui.load('preview'); preview.onShow();
    const selected = structuredClone(preview.data.images);
    ui.services.records.updateRecord(id, (record) => { record.deletedAt = '2026-10-06T00:00:00.000Z'; });
    assert.equal((await preview.confirm()).error, 'append-target-unavailable');
    assert.equal(preview.data.saveState, 'failed');
    assert.equal(preview.data.saveError, preview.data.recordCopy.appendTargetUnavailable);
    assert.ok(preview.data.saveError.length > 0);
    assert.deepEqual(preview.data.images, selected);
    assert.equal((await preview.retrySave()).error, 'append-target-unavailable');
    assert.equal(ui.services.records.getRecord(id).record.images.length, 1);
    assert.equal(ui.services.records.listRecent().records.length, 1);
    preview.onUnload();
    ui.services.records.updateRecord(id, (record) => { delete record.deletedAt; });
  }
  result.onUnload();
});
