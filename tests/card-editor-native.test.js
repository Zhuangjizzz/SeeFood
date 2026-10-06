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

test('native edit routing retains official text until saving and localizes edit and discard states in all five interfaces', (t) => {
  const services = servicesFor(t); const target = services.cardLibrary.getState().allCards[2];
  const { page, navigations } = editor(t, services, { id: encodeURIComponent(target.id) });
  assert.equal(page.data.draft.mode, 'edit'); assert.equal(page.data.draft.cardId, target.id);
  page.onSourceInput({ detail: { value: 'Does this dish contain nuts?' } });
  page.onChineseInput({ detail: { value: '这道菜有坚果吗？' } });
  page.onTitleInput({ detail: { value: 'Ask about nuts' } });
  page.selectCategory({ currentTarget: { dataset: { value: 'service' } } });
  services.cardLibrary.showCard(target.id);
  assert.equal(services.cardLibrary.getState().displayCard.primaryText, target.textZh);
  const titles = ['Edit card', 'カードを編集', '카드 편집', 'Editar tarjeta', '编辑沟通卡'];
  for (const [index, language] of ['en', 'ja', 'ko', 'es', 'zh-CN'].entries()) {
    services.application.chooseLanguage(language); page.onShow();
    assert.equal(page.data.editorCopy.title, titles[index]);
    assert.equal(page.data.sourceLanguageName, 'English');
    assert.equal(page.data.draft.text, 'Does this dish contain nuts?');
    assert.ok(page.data.editorCopy.discardBody); assert.ok(page.data.editorCopy.cardMissing);
  }
  page.onUnload();
  const resumed = editor(t, services, { id: target.id });
  assert.equal(resumed.page.data.needsResume, true); resumed.page.continueDraft();
  assert.equal(resumed.page.data.canSave, true); resumed.page.saveCard();
  assert.equal(resumed.navigations.at(-1), '/pages/cards/cards');
  assert.equal(services.cardLibrary.getState().position.cardId, target.id);
  assert.equal(services.cardLibrary.getState().category, 'service');
  assert.equal(services.cardLibrary.getState().expanded, true);
  const discarded = editor(t, services, { id: target.id });
  discarded.page.onTitleInput({ detail: { value: 'Do not save this title' } }); discarded.page.discardDraft();
  services.cardLibrary.showCard(target.id);
  assert.equal(services.cardLibrary.getState().displayCard.title, 'Ask about nuts');
  assert.equal(discarded.navigations.at(-1), '/pages/cards/cards');
  assert.equal(navigations.includes('/pages/card-display/card-display'), false);
});

test('native edit exits once if its target disappears while it is away', (t) => {
  const services = servicesFor(t); const target = services.cardLibrary.getState().allCards[0];
  const { page, navigations } = editor(t, services, { id: target.id });
  page.onHide(); services.cardLibrary.deleteCard(target.id); page.onShow(); page.renderDraft();
  assert.equal(page.data.draft, null);
  assert.equal(navigations.filter((value) => value === '/pages/cards/cards').length, 1);
  assert.equal(services.cardLibrary.getState().allCards.length, 5);
});

test('staff display rereads the last successful formal save when another editor instance changes the card', (t) => {
  const storage = fileStorage(t);
  const platform = { getStorageSync: storage.get, setStorageSync: storage.set, removeStorageSync: storage.remove,
    getAppBaseInfo: () => ({ language: 'en' }), env: { USER_DATA_PATH: '/tmp' }, getFileSystemManager: () => ({}) };
  const services = createWechatServices(platform, { backend: { enabled: false } });
  const other = createWechatServices(platform, { backend: { enabled: false } });
  const target = services.cardLibrary.getState().allCards[0];
  const globals = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  t.after(() => Object.assign(global, globals));
  global.getApp = () => ({ services }); global.wx = { setNavigationBarTitle() {} };
  let definition; global.Page = (value) => { definition = value; };
  const filename = require.resolve('../miniprogram/pages/card-display/card-display'); delete require.cache[filename]; require(filename);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  page.onLoad({ id: target.id }); page.onShow();
  assert.equal(page.data.card.primaryText, target.textZh);
  other.cardDrafts.beginEdit(target.id); other.cardDrafts.edit({ textZh: '请稍微少放辣椒。' });
  page.onShow(); assert.equal(page.data.card.primaryText, target.textZh);
  other.cardDrafts.save(); page.onShow();
  assert.equal(page.data.card.primaryText, '请稍微少放辣椒。');
});

test('an unsaved previous draft blocks opening a different editor until retry saves it, without showing the wrong card content', (t) => {
  const storage = fileStorage(t);
  const platform = { getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: storage.remove,
    getAppBaseInfo: () => ({ language: 'en' }), env: { USER_DATA_PATH: '/tmp' }, getFileSystemManager: () => ({}) };
  const services = createWechatServices(platform, { backend: { enabled: false } });
  services.cardDrafts.beginNew(); const write = storage.set;
  storage.set = () => { throw new Error('full'); };
  services.cardDrafts.edit({ text: 'Please keep these words' });
  const target = services.cardLibrary.getState().allCards[1];
  const { page } = editor(t, services, { id: target.id });
  assert.equal(page.data.draft, null); assert.equal(page.data.canSave, false);
  assert.equal(page.data.entryBlocked, true);
  assert.equal(services.cardDrafts.getState().draft.text, 'Please keep these words');
  storage.set = write; page.retrySave();
  assert.equal(page.data.entryBlocked, false);
  assert.equal(page.data.draft.cardId, target.id); assert.equal(page.data.draft.text, target.pairedText);
  services.cardDrafts.beginNew(); services.cardDrafts.resumeNew();
  assert.equal(services.cardDrafts.getState().draft.text, 'Please keep these words');
});
