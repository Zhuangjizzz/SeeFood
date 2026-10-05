const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../miniprogram/core/application');
const { createLocalStore } = require('../miniprogram/core/local-store');
const { fileStorage } = require('./support/storage');

test('a supported system language opens capture without a login or language gate', () => {
  const application = createApplication({ systemLanguage: 'en-US' });
  assert.equal(application.getState().language, 'en');
  assert.equal(application.getState().page, 'capture');
  assert.equal(application.getState().needsLanguage, false);
});

test('supported regional language codes match the five interface languages', () => {
  const examples = [
    ['en_GB', 'en'], ['ja-JP', 'ja'], ['ko_KR', 'ko'],
    ['es-MX', 'es'], ['zh-Hans-CN', 'zh-CN'], ['zh_CN', 'zh-CN'], ['zh', 'zh-CN']
  ];
  for (const [systemLanguage, expected] of examples) {
    const state = createApplication({ systemLanguage }).getState();
    assert.equal(state.language, expected);
    assert.equal(state.page, 'capture');
  }
});

test('an unsupported or traditional Chinese system language first asks the user to choose', () => {
  for (const systemLanguage of ['fr-FR', 'zh-TW', 'zh-Hant', 'zh-HK', '']) {
    const state = createApplication({ systemLanguage }).getState();
    assert.equal(state.page, 'language');
    assert.equal(state.needsLanguage, true);
  }
});

test('a chosen language is saved and restored after the application and repository are rebuilt', (t) => {
  const driver = fileStorage(t);
  const application = createApplication({ store: createLocalStore(driver), systemLanguage: 'fr' });
  assert.equal(application.chooseLanguage('ja').ok, true);
  assert.equal(application.getState().page, 'capture');
  const restored = createApplication({ store: createLocalStore(driver), systemLanguage: 'es' });
  assert.equal(restored.getState().language, 'ja');
  assert.equal(restored.getState().needsLanguage, false);
});

test('language settings return to whichever main entrance opened them', (t) => {
  const application = createApplication({ store: createLocalStore(fileStorage(t)), systemLanguage: 'en' });
  for (const origin of ['capture', 'cards', 'mine']) {
    application.visit(origin);
    application.openLanguage();
    assert.equal(application.getState().page, 'language');
    application.chooseLanguage('es');
    assert.equal(application.getState().page, origin);
    application.openLanguage();
    application.closeLanguage();
    assert.equal(application.getState().page, origin);
  }
});

test('a failed write is visible and does not claim a new language was saved', (t) => {
  const driver = fileStorage(t);
  const application = createApplication({ store: createLocalStore(driver), systemLanguage: 'en' });
  application.chooseLanguage('ja');
  application.visit('mine');
  application.openLanguage();
  driver.set = () => { throw new Error('storage full'); };
  assert.deepEqual(application.chooseLanguage('ko'), { ok: false, error: 'storage-write' });
  assert.equal(application.getState().language, 'ja');
  assert.equal(application.getState().page, 'language');
  assert.equal(application.getState().error, 'storage-write');
  const restored = createApplication({ store: createLocalStore(driver), systemLanguage: 'en' });
  assert.equal(restored.getState().language, 'ja');
});

test('an unreadable settings store reports a recovery error instead of crashing or overwriting it', () => {
  const store = createLocalStore({
    get() { throw new Error('read failed'); },
    set() { throw new Error('must not overwrite unread settings'); }
  });
  const application = createApplication({ store, systemLanguage: 'en' });
  assert.equal(application.getState().page, 'capture');
  assert.equal(application.getState().error, 'storage-read');
  assert.deepEqual(application.chooseLanguage('es'), { ok: false, error: 'storage-read' });
});

test('skipping the optional preference invitation leaves capture available and stays skipped after restart', (t) => {
  const driver = fileStorage(t);
  const application = createApplication({ store: createLocalStore(driver), systemLanguage: 'en' });
  assert.equal(application.getState().showPreferenceInvite, true);
  assert.equal(application.skipPreferenceInvite().ok, true);
  assert.equal(application.getState().page, 'capture');
  const restored = createApplication({ store: createLocalStore(driver), systemLanguage: 'en' });
  assert.equal(restored.getState().showPreferenceInvite, false);
});

test('switching every interface language changes static labels and preserves saved foreign content', (t) => {
  const store = createLocalStore(fileStorage(t));
  const original = {
    record: { id: 'menu-1', contextId: 'ctx-1', title: 'Evening menu' },
    translation: { contentLanguage: 'en', localPath: 'saved/translated.png' },
    dish: { nameZh: '宫保鸡丁', contentLanguage: 'en', explanation: 'Chicken with peanuts.' },
    message: { contentLanguage: 'ja', text: '水をください。' },
    personalCard: { contentLanguage: 'ko', text: '덜 맵게 해 주세요.', textZh: '请少放辣。' }
  };
  store.set('saved-content', original);
  const application = createApplication({ store, systemLanguage: 'en' });
  const examples = [
    ['en', 'Capture', 'Cards', 'Me'], ['ja', '撮影', '会話カード', 'マイページ'],
    ['ko', '촬영', '소통 카드', '내 정보'], ['es', 'Cámara', 'Tarjetas', 'Mi perfil'],
    ['zh-CN', '拍照', '沟通卡', '我的']
  ];
  for (const [language, capture, cards, mine] of examples) {
    application.chooseLanguage(language);
    const copy = application.getState().copy;
    assert.deepEqual([copy.capture, copy.cards, copy.mine], [capture, cards, mine]);
    assert.deepEqual(store.get('saved-content'), original);
  }
});

test('the initial language gate cannot be skipped with a tab or an unsupported selection', (t) => {
  const application = createApplication({ store: createLocalStore(fileStorage(t)), systemLanguage: 'fr' });
  application.visit('mine');
  application.closeLanguage();
  assert.equal(application.getState().page, 'language');
  assert.deepEqual(application.chooseLanguage('fr'), { ok: false, error: 'unsupported-language' });
  assert.equal(application.getState().needsLanguage, true);
  assert.equal(application.chooseLanguage('zh-CN').ok, true);
  assert.equal(application.getState().page, 'capture');
});

test('unreadable saved data does not become an apparently empty settings object', () => {
  for (const value of [null, 'broken', { schema: 2, value: {} }, { schema: 1, value: null }]) {
    const driver = { get: () => value, set: () => assert.fail('must preserve unread data') };
    const application = createApplication({ store: createLocalStore(driver), systemLanguage: 'en' });
    assert.equal(application.getState().error, 'storage-read');
    assert.deepEqual(application.chooseLanguage('es'), { ok: false, error: 'storage-read' });
  }
});
