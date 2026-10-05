const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { recordPlatform } = require('./support/record-platform');

function nativePages(t, disk) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, previous));
  const services = createWechatServices(disk.platform);
  const navigation = [];
  const handlers = {};
  const channel = {
    on(name, handler) { handlers[name] = handler; },
    emit(name, ...args) { if (handlers[name]) return handlers[name](...args); }
  };
  global.getApp = () => ({ services });
  global.getCurrentPages = () => [{ route: 'pages/index/index' }, { route: 'pages/preview/preview' }];
  global.wx = Object.assign(disk.platform, {
    setTabBarItem() {}, setNavigationBarTitle() {}, nextTick() {},
    navigateTo(options) { navigation.push(['push', options.url]); Object.assign(handlers, options.events); },
    redirectTo(options) { navigation.push(['replace', options.url]); if (options.success) options.success(); },
    navigateBack() { navigation.push(['back']); },
    switchTab(options) { navigation.push(['tab', options.url]); },
    previewImage(options) { navigation.push(['original', options]); }
  });
  function load(name) {
    let definition;
    global.Page = (page) => { definition = page; };
    const filename = require.resolve(`../miniprogram/pages/${name}/${name}.js`);
    delete require.cache[filename];
    require(filename);
    return Object.assign({}, definition, {
      data: JSON.parse(JSON.stringify(definition.data)),
      getOpenerEventChannel: () => channel,
      setData(values) { Object.assign(this.data, values); }
    });
  }
  return { services, navigation, load };
}

test('the native confirmation handoff stays on failed input, retries saving, and opens the same pending record from recent history in all languages', async (t) => {
  const disk = recordPlatform(t);
  const photo = disk.material('menu-photo.png');
  disk.platform.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: photo.localPath, size: photo.sizeBytes }] });
  disk.platform.getImageInfo = ({ success }) => success({ width: 640, height: 960, type: 'png', orientation: 'up' });
  const ui = nativePages(t, disk);
  const index = ui.load('index');
  assert.equal(typeof index.handleCaptureConfirmed, 'function');
  index.onShow();
  await index.importPhoto();
  assert.deepEqual(ui.navigation.pop(), ['push', '/pages/preview/preview']);
  const preview = ui.load('preview');
  preview.onShow();
  const copy = disk.fileSystem.copyFile;
  disk.fileSystem.copyFile = (options) => options.fail(new Error('device storage is full'));
  assert.equal((await preview.confirm()).ok, false);
  assert.equal(preview.data.saveState, 'failed');
  assert.equal(preview.data.images[0].localPath, photo.localPath);
  assert.equal(preview.data.saveError.length > 0, true);
  assert.equal(ui.navigation.length, 0);
  assert.equal(ui.services.records.listRecent().records.length, 0);
  disk.fileSystem.copyFile = copy;
  const saved = await preview.retrySave();
  assert.equal(saved.ok, true);
  assert.deepEqual(ui.navigation.pop(), ['replace', `/pages/result/result?recordId=${encodeURIComponent(saved.recordId)}`]);
  index.onShow();
  assert.equal(index.data.recentRecords[0].id, saved.recordId);
  assert.notEqual(index.data.recentRecords[0].thumbnail, photo.localPath);
  index.openRecord({ currentTarget: { dataset: { id: saved.recordId } } });
  assert.deepEqual(ui.navigation.pop(), ['push', `/pages/result/result?recordId=${encodeURIComponent(saved.recordId)}`]);
  const result = ui.load('result');
  result.onLoad({ recordId: saved.recordId });
  for (const [language, waiting, savedLabel] of [
    ['en', 'Waiting to upload', 'Saved on this device'], ['ja', 'アップロード待ち', '端末に保存済み'],
    ['ko', '업로드 대기 중', '기기에 저장됨'], ['es', 'Pendiente de subir', 'Guardado en este dispositivo'],
    ['zh-CN', '待上传', '已保存到本机']
  ]) {
    ui.services.application.chooseLanguage(language);
    result.onShow();
    index.onShow();
    assert.equal(result.data.record.id, saved.recordId);
    assert.equal(result.data.processingLabel, waiting);
    assert.equal(result.data.saveLabel, savedLabel);
    assert.equal(index.data.recentRecords[0].processingLabel, waiting);
    assert.equal(result.data.currentImage.targetLanguage, 'en');
    assert.equal(fs.existsSync(result.data.currentImage.localOriginalPath), true);
  }
  result.viewOriginal();
  assert.equal(ui.navigation.pop()[0], 'original');
});
