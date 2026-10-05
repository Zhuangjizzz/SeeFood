const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { fileStorage } = require('./support/storage');

function editor(t, services, options = {}) {
  const navigations = [];
  const globals = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, globals));
  global.getApp = () => ({ services }); global.getCurrentPages = () => [{}];
  global.wx = { setNavigationBarTitle() {}, switchTab(value) { navigations.push(value.url); }, navigateBack() { navigations.push('back'); },
    showModal(value) { value.success({ confirm: true }); }, showToast(value) { navigations.push(value.title); } };
  let definition; global.Page = (value) => { definition = value; };
  const filename = require.resolve('../miniprogram/pages/card-editor/card-editor'); delete require.cache[filename]; require(filename);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  page.onLoad(options); page.onShow(); t.after(() => page.onUnload());
  return { page, navigations };
}
function servicesFor(t) {
  const storage = fileStorage(t);
  const platform = { getStorageSync: storage.get, setStorageSync: storage.set, removeStorageSync: storage.remove,
    getAppBaseInfo: () => ({ language: 'en' }), env: { USER_DATA_PATH: '/tmp' }, getFileSystemManager: () => ({}) };
  return createWechatServices(platform, { backend: { enabled: false } });
}

test('native create editor offers recovery, five interface languages, editable Chinese and returns to the saved category', (t) => {
  const services = servicesFor(t); const { page, navigations } = editor(t, services, { category: 'dietary' });
  page.onSourceInput({ detail: { value: 'Please check the ingredients' } });
  page.onChineseInput({ detail: { value: '请核对配料。' } });
  page.onTitleInput({ detail: { value: 'Check ingredients' } });
  page.selectCategory({ currentTarget: { dataset: { value: 'service' } } });
  page.selectColor({ currentTarget: { dataset: { value: 'orange' } } });
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); page.onShow();
    assert.equal(page.data.draft.text, 'Please check the ingredients');
    assert.equal(page.data.sourceLanguageName, 'English'); assert.equal(page.data.isChinese, false);
    assert.ok(page.data.editorCopy.draftSaved); assert.ok(page.data.editorCopy.generate); assert.ok(page.data.editorCopy.translationFailed);
    assert.equal(page.data.categories.length, 2); assert.equal(page.data.colors.length, 3);
  }
  page.onUnload();
  const resumed = editor(t, services, { category: 'all' });
  assert.equal(resumed.page.data.needsResume, true); resumed.page.continueDraft();
  assert.equal(resumed.page.data.needsResume, false); assert.equal(resumed.page.data.canSave, true);
  resumed.page.saveCard(); assert.equal(resumed.navigations.at(-1), '/pages/cards/cards');
  assert.equal(services.cardLibrary.getState().topCard.title, 'Check ingredients');
  assert.equal(services.cardLibrary.getState().category, 'service');
  assert.equal(services.cardDrafts.getState().draft, null);
  global.getCurrentPages = () => [{}, {}]; page.returnCards(); assert.equal(resumed.navigations.at(-1), 'back');
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/card-editor/card-editor.wxml'), 'utf8');
  const positions = ['source-input', 'chinese-input', 'title-input', 'category-options', 'color-options', 'save-card'].map((name) => template.indexOf(name));
  assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
});
