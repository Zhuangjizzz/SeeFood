const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { fileStorage } = require('./support/storage');

function nativePage(t) {
  const storage = fileStorage(t); const navigations = [];
  const platform = { getStorageSync: storage.get, setStorageSync: storage.set, removeStorageSync: storage.remove,
    getAppBaseInfo: () => ({ language: 'en' }), env: { USER_DATA_PATH: '/tmp' }, getFileSystemManager: () => ({}) };
  const services = createWechatServices(platform, { backend: { enabled: false } });
  const globals = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, globals));
  global.getApp = () => ({ services }); global.getCurrentPages = () => [{}];
  global.wx = { setNavigationBarTitle() {}, switchTab(value) { navigations.push(value.url); }, navigateBack() { navigations.push('back'); }, showModal(value) { value.success({ confirm: true }); } };
  let definition; global.Page = (value) => { definition = value; };
  const filename = require.resolve('../miniprogram/pages/text-exchange/text-exchange'); delete require.cache[filename]; require(filename);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  page.onLoad(); page.onShow(); t.after(() => page.onUnload());
  return { page, services, navigations };
}

test('the shared native input switches speakers and renders saved drafts with five localized interfaces', async (t) => {
  const { page, services, navigations } = nativePage(t);
  page.onInput({ detail: { value: 'My next words' } });
  page.selectSpeaker({ currentTarget: { dataset: { speaker: 'staff' } } });
  assert.equal(page.data.inputValue, '');
  page.onInput({ detail: { value: '店员的话' } });
  page.selectSpeaker({ currentTarget: { dataset: { speaker: 'visitor' } } });
  assert.equal(page.data.inputValue, 'My next words');
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); page.onShow();
    assert.equal(page.data.inputValue, 'My next words'); assert.equal(page.data.rows.length, 2);
    assert.ok(page.data.exchangeCopy.title); assert.ok(page.data.exchangeCopy.offline); assert.ok(page.data.direction.includes('English'));
  }
  page.clearExchange(); assert.equal(page.data.inputValue, ''); assert.equal(page.data.rows.every((row) => !row.result), true);
  page.returnCards(); assert.deepEqual(navigations, ['/pages/cards/cards']);
  global.getCurrentPages = () => [{}, {}]; page.returnCards(); assert.equal(navigations.at(-1), 'back');
  assert.deepEqual(services.records.listRecent().records, []);
  const wxml = fs.readFileSync(require('node:path').join(__dirname, '../miniprogram/pages/text-exchange/text-exchange.wxml'), 'utf8');
  assert.equal((wxml.match(/<textarea\b/g) || []).length, 1);
});
