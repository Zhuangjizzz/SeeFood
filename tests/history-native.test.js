const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { recordPlatform } = require('./support/record-platform');

function native(t, offline = false) {
  const disk = recordPlatform(t); let networkChange;
  disk.platform.getNetworkType = ({ success }) => success({ networkType: offline ? 'none' : 'wifi' });
  disk.platform.onNetworkStatusChange = (listener) => { networkChange = listener; };
  const services = createWechatServices(disk.platform);
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages }; t.after(() => Object.assign(global, previous));
  const navigation = []; let stack = [{}]; let rectangles = [];
  global.getApp = () => ({ services }); global.getCurrentPages = () => stack;
  global.wx = { ...disk.platform, setTabBarItem() {}, setNavigationBarTitle() {}, nextTick(fn) { fn(); },
    navigateTo({url}) { navigation.push(['push', url]); }, redirectTo({url}) { navigation.push(['replace', url]); },
    switchTab({url}) { navigation.push(['tab', url]); }, navigateBack() { navigation.push(['back']); },
    pageScrollTo(options) { navigation.push(['scroll', options]); }, showToast() {},
    createSelectorQuery() { return { in() { return this; }, selectAll() { return this; }, fields() { return this; }, exec(callback) { callback([rectangles]); } }; }
  };
  function load(name) {
    let definition; global.Page = (value) => { definition = value; };
    const filename = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[filename]; require(filename);
    return { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  }
  return { disk, services, load, navigation, networkChange(event) { networkChange(event); }, setStack(value) { stack = value; }, setRectangles(value) { rectangles = value; } };
}
async function add(ui) {
  const photo = ui.disk.material('menu-photo.png');
  ui.disk.platform.chooseMedia = ({success}) => success({ tempFiles: [{ tempFilePath: photo.localPath, size: photo.sizeBytes }] });
  await ui.services.capture.chooseImages({ source: 'album' });
  const saved = await ui.services.records.confirmCapture(ui.services.capture.confirm().batch); assert.equal(saved.ok, true); return saved.recordId;
}

test('native home and mine open all history with five-language empty/readable/error states and preserve list/result return anchors', async (t) => {
  const ui = native(t); const history = ui.load('history'); history.onLoad({ source: 'mine' }); history.onShow();
  assert.equal(history.data.entries.length, 0); assert.equal(history.data.historyReadable, true);
  history.takePhoto(); assert.deepEqual(ui.navigation.pop(), ['tab', '/pages/index/index']);
  const index = ui.load('index'); index.onShow(); index.openHistory(); assert.deepEqual(ui.navigation.pop(), ['push', '/pages/history/history?source=home']);
  const mine = ui.load('mine'); mine.onShow(); mine.openHistory(); assert.deepEqual(ui.navigation.pop(), ['push', '/pages/history/history?source=mine']);
  const ids = []; for (let i = 0; i < 5; i++) ids.push(await add(ui));
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    ui.services.application.chooseLanguage(language); history.onShow(); index.onShow(); mine.onShow();
    assert.equal(history.data.entries.length, 5); assert.equal(index.data.recentRecords.length, 3);
    assert.ok(history.data.historyCopy.empty); assert.ok(history.data.historyCopy.offline); assert.ok(history.data.historyCopy.missingImages);
    assert.ok(history.data.entries[0].processingLabel); assert.ok(history.data.entries[0].saveLabel); assert.ok(mine.data.copy.localDataBody);
  }
  history.onShow(); const targetId = history.data.entries[2].id;
  ui.setRectangles([{ id: 'history-row-2', dataset: { anchorId: targetId }, top: -18, bottom: 180 }]);
  history.onPageScroll({ scrollTop: 700 }); history.openRecord({ currentTarget: { dataset: { id: targetId } } });
  assert.deepEqual(ui.navigation.pop(), ['push', `/pages/result/result?recordId=${encodeURIComponent(targetId)}`]);
  const result = ui.load('result'); result.onLoad({ recordId: encodeURIComponent(targetId) }); result.onShow();
  ui.setStack([{}]); result.back(); assert.deepEqual(ui.navigation.pop(), ['replace', '/pages/history/history?source=mine']);
  history.onShow(); assert.deepEqual(ui.navigation.pop(), ['scroll', { selector: '#history-row-2', offsetTop: 18, duration: 0 }]);
  ui.setStack([{},{}]); result.back(); assert.deepEqual(ui.navigation.pop(), ['back']);
  fs.unlinkSync(ui.services.records.getRecord(targetId).record.images[0].localOriginalPath); history.onShow();
  const missing = history.data.entries.find((entry) => entry.id === targetId); assert.equal(missing.thumbnail, null); assert.equal(missing.offlineAvailable, false);
  const read = ui.disk.storage.get; ui.disk.storage.get = (key) => { if (key.endsWith(':records')) throw new Error('read blocked'); return read(key); };
  history.retryHistory(); assert.equal(history.data.historyReadable, false); assert.ok(history.data.historyError);
  ui.disk.storage.get = read; history.retryHistory(); assert.equal(history.data.entries.length, 5);
  history.onUnload(); result.onUnload(); index.onUnload();
});

test('five-language offline pages retain readable content and typed input while generation controls wait for reconnection', async (t) => {
  const ui = native(t, true); const id = await add(ui);
  const history = ui.load('history'); history.onLoad({ source: 'home' });
  const result = ui.load('result'); result.onLoad({ recordId: id });
  const chat = ui.load('chat'); chat.onLoad({ recordId: encodeURIComponent(id) }); chat.onInput({ detail: { value: 'Keep this question' } });
  const index = ui.load('index');
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    ui.services.application.chooseLanguage(language); history.onShow(); result.onShow(); chat.onShow(); index.onShow();
    assert.equal(history.data.offline, true); assert.equal(result.data.offline, true); assert.equal(index.data.offline, true);
    assert.equal(chat.data.canSend, false); assert.equal(chat.data.errorText, chat.data.chatCopy.offline);
    assert.equal(history.data.entries[0].imageCount, 1); assert.ok(result.data.imageView.path);
    assert.equal(chat.data.draft, 'Keep this question');
  }
  assert.equal((await chat.send()).error, 'network-unavailable'); assert.equal(chat.data.draft, 'Keep this question'); assert.equal(chat.data.messages.length, 0);
  ui.networkChange({ isConnected: true, networkType: 'wifi' });
  assert.equal(history.data.offline, false); assert.equal(result.data.offline, false); assert.equal(chat.data.canSend, true);
  assert.equal(chat.data.messages.length, 0); assert.equal(chat.data.draft, 'Keep this question');
  history.onUnload(); result.onUnload(); chat.onUnload(); index.onUnload();
});
