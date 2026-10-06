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


test('history exposes scoped single-delete and clear confirmations in five languages, cancel is inert and marker failure preserves content', async (t) => {
  const ui = native(t); const history = ui.load('history'); history.onLoad({ source: 'mine' });
  let sheet; let modal;
  global.wx.showActionSheet = (options) => { sheet = options; };
  global.wx.showModal = (options) => { modal = options; };
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    ui.services.application.chooseLanguage(language); const id = await add(ui); history.onShow();
    assert.ok(history.data.deletionCopy.manage); assert.ok(history.data.deletionCopy.serverQueued);
    const operation = history.recordMenu({ currentTarget: { dataset: { id } } });
    assert.equal(sheet.itemList[0], history.data.deletionCopy.deleteRecord); sheet.success({ tapIndex: 0 });
    await Promise.resolve(); assert.ok(modal.content.includes(history.data.entries.find((entry) => entry.id === id).title));
    modal.success({ confirm: false }); await operation;
    assert.equal(ui.services.records.getRecord(id).ok, true);
    const removing = history.recordMenu({ currentTarget: { dataset: { id } } }); sheet.success({ tapIndex: 0 }); await Promise.resolve();
    assert.equal(modal.confirmText, history.data.deletionCopy.deleteRecord); modal.success({ confirm: true }); await removing;
    assert.equal(ui.services.records.getRecord(id).ok, false); assert.equal(history.data.entries.length, 0);
    assert.equal(history.data.cleanupEntries.at(-1).localLabel, history.data.deletionCopy.localSucceeded);
    assert.equal(history.data.cleanupEntries.at(-1).backendLabel, history.data.deletionCopy.serverNotRequired);
  }
  const first = await add(ui); const second = await add(ui); history.onShow();
  const clearing = history.manageHistory(); sheet.success({ tapIndex: 0 }); await Promise.resolve();
  assert.ok(modal.content.includes('2'));
  const third = await add(ui); modal.success({ confirm: true }); await clearing;
  assert.equal(ui.services.records.getRecord(first).ok, false); assert.equal(ui.services.records.getRecord(second).ok, false);
  assert.equal(ui.services.records.getRecord(third).ok, true);
  const write = ui.disk.storage.set; ui.disk.storage.set = (key, value) => { if (key.endsWith('record-deletions')) throw new Error('disk full'); write(key, value); };
  const failed = history.recordMenu({ currentTarget: { dataset: { id: third } } }); sheet.success({ tapIndex: 0 }); await Promise.resolve(); modal.success({ confirm: true }); await failed;
  assert.ok(history.data.deletionError); assert.equal(ui.services.records.getRecord(third).ok, true);
  ui.disk.storage.set = write;
  history.onUnload();
});
