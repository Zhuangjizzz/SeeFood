const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalStore } = require('../miniprogram/core/local-store');
const { fileStorage } = require('./support/storage');
const { createCardLibrary } = require('../miniprogram/core/card-library');
const { createWechatServices } = require('../miniprogram/platform/wechat');

test('the native application service exposes an offline card library tied to the saved interface language', (t) => {
  const driver = fileStorage(t);
  const platform = { getStorageSync: driver.get, setStorageSync: driver.set, removeStorageSync: driver.remove, getAppBaseInfo: () => ({ language: 'en' }) };
  const services = createWechatServices(platform);
  services.application.chooseLanguage('es');
  assert.equal(services.cardLibrary.getState().topCard.title, 'Poco picante, por favor');
  services.cardLibrary.expand();
  const restarted = createWechatServices(platform);
  assert.equal(restarted.cardLibrary.getState().expanded, true);
  assert.equal(restarted.cardLibrary.getState().topCard.pairedLanguage, 'es');
});

test('an offline visitor gets personal preset copies and one persistent global order without a menu record', (t) => {
  const driver = fileStorage(t);
  const library = createCardLibrary({ store: createLocalStore(driver), getLanguage: () => 'en' });
  const first = library.getState();
  assert.equal(first.error, null);
  assert.equal(first.expanded, false);
  assert.deepEqual(first.counts, { all: 6, dietary: 3, service: 3 });
  assert.equal(first.cards[0].title, 'Less spicy, please');
  assert.equal(first.cards[0].pairedText, 'Please make it less spicy. Thank you.');
  assert.equal(first.cards[0].textZh, '请少放辣椒，谢谢。');
  assert.equal(first.cards[0].saveState, 'saved');
  const identity = first.allCards.map(({ id, order }) => ({ id, order }));
  assert.equal(new Set(identity.map(({ id }) => id)).size, 6);
  assert.deepEqual(identity.map(({ order }) => order), [0, 1, 2, 3, 4, 5]);
  const reopened = createCardLibrary({ store: createLocalStore(driver), getLanguage: () => 'en' });
  assert.deepEqual(reopened.getState().allCards.map(({ id, order }) => ({ id, order })), identity);
  assert.deepEqual(createLocalStore(driver).get('records', []), []);
});

test('unreadable personal cards are preserved and cannot be replaced by presets or view writes', () => {
  const store = createLocalStore({
    get: (key) => key.endsWith('personal-cards') ? { schema: 1, value: { initialized: true, cards: null } } : undefined,
    set: () => assert.fail('unreadable saved content must not be overwritten')
  });
  const library = createCardLibrary({ store });
  assert.equal(library.getState().error, 'storage-read');
  assert.deepEqual(library.getState().cards, []);
  assert.deepEqual(library.expand(), { ok: false, error: 'storage-read' });
});

test('empty and single-card categories and long libraries restore valid anchors and fall back from stale positions', (t) => {
  const store = createLocalStore(fileStorage(t));
  const personal = Array.from({ length: 100 }, (_, order) => ({
    id: 'saved-' + order, order, title: 'Saved message ' + order, category: order === 99 ? 'service' : 'dietary',
    color: 'green', edited: true, saveState: 'saved', textZh: '请帮我确认。', pairedText: 'Please help me check.', pairedLanguage: 'en'
  }));
  store.set('personal-cards', { initialized: true, cards: personal });
  store.set('card-library-view', { category: 'removed-category', expanded: true, position: { cardId: 'gone', offset: -20 } });
  const library = createCardLibrary({ store });
  assert.equal(library.getState().category, 'all');
  assert.equal(library.getState().cards.length, 100);
  assert.deepEqual(library.getState().position, { cardId: 'saved-0', offset: 0 });
  library.rememberPosition({ cardId: 'saved-98', offset: 32 });
  assert.deepEqual(createCardLibrary({ store }).getState().position, { cardId: 'saved-98', offset: 32 });
  library.selectCategory('service');
  assert.equal(library.getState().cards.length, 1);
  assert.equal(library.getState().topCard.id, 'saved-99');
  store.set('personal-cards', { initialized: true, cards: personal.slice(0, 99) });
  const reopened = createCardLibrary({ store });
  assert.equal(reopened.getState().cards.length, 0);
  assert.equal(reopened.getState().topCard, null);
  assert.deepEqual(reopened.getState().position, { cardId: null, offset: 0 });
  reopened.selectCategory('all');
  assert.equal(reopened.getState().cards.length, 99);
  store.set('personal-cards', { initialized: true, cards: [] });
  assert.equal(createCardLibrary({ store }).getState().allCards.length, 0);
});

test('failed preset initialization can be retried and failed view saves keep the last durable state', (t) => {
  const driver = fileStorage(t);
  const write = driver.set;
  driver.set = () => { throw new Error('full'); };
  const library = createCardLibrary({ store: createLocalStore(driver) });
  assert.equal(library.getState().error, 'storage-write');
  assert.equal(library.getState().cards.length, 0);
  driver.set = write;
  assert.equal(library.reload().ok, true);
  assert.equal(library.getState().cards.length, 6);
  driver.set = () => { throw new Error('full'); };
  assert.deepEqual(library.expand(), { ok: false, error: 'storage-write' });
  assert.equal(library.getState().expanded, false);
  assert.equal(library.getState().showExpandHint, true);
  assert.equal(createCardLibrary({ store: createLocalStore(driver) }).getState().expanded, false);
  driver.set = write;
  assert.equal(library.expand().ok, true);
  assert.equal(createCardLibrary({ store: createLocalStore(driver) }).getState().expanded, true);
});

test('one long press only spreads cards; release, scrolling, cancellation and collapse never open staff display', (t) => {
  const library = createCardLibrary({ store: createLocalStore(fileStorage(t)) });
  const id = library.getState().topCard.id;
  library.beginTouch({ cardId: id, x: 20, y: 30 });
  assert.deepEqual(library.longPress(), { ok: true, action: 'expand' });
  library.endTouch();
  library.tapCard(id);
  assert.equal(library.getState().expanded, true);
  assert.equal(library.getState().displayCard, null);
  library.beginTouch({ cardId: id, x: 20, y: 30 });
  library.moveTouch({ x: 20, y: 90 });
  assert.equal(library.longPress().action, 'none');
  library.endTouch();
  library.tapCard(id);
  assert.equal(library.getState().displayCard, null);
  library.beginTouch({ cardId: id, x: 20, y: 30 });
  library.cancelTouch();
  library.tapCard(id);
  assert.equal(library.getState().displayCard, null);
  library.collapse();
  library.tapCard(id);
  assert.equal(library.getState().displayCard, null);
  library.beginTouch({ cardId: id, x: 20, y: 30 });
  library.endTouch();
  assert.equal(library.tapCard(id).ok, true);
  assert.equal(library.getState().displayCard.id, id);
});

test('staff display keeps complete Chinese text first, avoids duplicate Chinese, and returns to the same library position', (t) => {
  const store = createLocalStore(fileStorage(t));
  const paragraph = '请帮我确认这道菜的食材。\n' + '我想先了解配料，然后再决定。'.repeat(120);
  store.set('personal-cards', { initialized: true, cards: [
    { id: 'long-card', order: 0, title: 'A detailed request', category: 'dietary', color: 'green', edited: true, saveState: 'saved', textZh: paragraph, pairedText: 'Please help me check all of the ingredients.\n' + 'Thank you. '.repeat(120), pairedLanguage: 'en' },
    { id: 'chinese-card', order: 1, title: '请给我水', category: 'service', color: 'blue', edited: true, saveState: 'saved', textZh: '请给我一杯水。', pairedText: null, pairedLanguage: 'zh-CN' }
  ] });
  const library = createCardLibrary({ store });
  library.expand();
  library.rememberPosition({ cardId: 'long-card', offset: 143 });
  const before = library.getState();
  assert.equal(library.showCard('long-card').ok, true);
  assert.equal(library.getState().displayCard.primaryText, paragraph);
  assert.equal(library.getState().displayCard.secondaryText, before.cards[0].pairedText);
  library.closeCard();
  assert.equal(library.getState().displayCard, null);
  assert.deepEqual(library.getState().position, before.position);
  assert.equal(library.getState().expanded, true);
  library.showCard('chinese-card');
  assert.equal(library.getState().displayCard.primaryText, '请给我一杯水。');
  assert.equal(library.getState().displayCard.secondaryText, null);
  assert.deepEqual(library.getState().allCards, before.allCards);
  assert.deepEqual(library.showCard('missing-card'), { ok: false, error: 'card-not-found' });
  assert.equal(library.getState().displayCard, null);
});

test('category changes keep the spread shape, begin at the first matching card, and restore position after exit', (t) => {
  const driver = fileStorage(t);
  const library = createCardLibrary({ store: createLocalStore(driver) });
  const globalIds = library.getState().allCards.map((card) => card.id);
  assert.equal(library.getState().showExpandHint, true);
  assert.equal(library.expand().ok, true);
  assert.equal(library.getState().showExpandHint, false);
  assert.equal(library.selectCategory('dietary').ok, true);
  assert.deepEqual(library.getState().cards.map((card) => card.id), [globalIds[0], globalIds[2], globalIds[4]]);
  assert.deepEqual(library.getState().position, { cardId: globalIds[0], offset: 0 });
  library.rememberPosition({ cardId: globalIds[2], offset: 78 });
  const reopened = createCardLibrary({ store: createLocalStore(driver) });
  assert.equal(reopened.getState().category, 'dietary');
  assert.equal(reopened.getState().expanded, true);
  assert.deepEqual(reopened.getState().position, { cardId: globalIds[2], offset: 78 });
  reopened.selectCategory('service');
  assert.equal(reopened.getState().expanded, true);
  assert.deepEqual(reopened.getState().position, { cardId: globalIds[1], offset: 0 });
  reopened.collapse();
  assert.equal(reopened.getState().expanded, false);
  assert.equal(reopened.getState().topCard.id, globalIds[1]);
  assert.deepEqual(reopened.getState().allCards.map((card) => card.id), globalIds);
  assert.equal(createCardLibrary({ store: createLocalStore(driver) }).getState().showExpandHint, false);
});

test('five interface languages change untouched presets while edited and personal text keep their saved language', (t) => {
  const store = createLocalStore(fileStorage(t));
  let language = 'en';
  createCardLibrary({ store, getLanguage: () => language });
  const saved = store.get('personal-cards');
  Object.assign(saved.cards[1], { edited: true, title: 'My water', pairedText: 'Warm water for me.', pairedLanguage: 'en', textZh: '请给我温水。' });
  store.set('personal-cards', saved);
  const library = createCardLibrary({ store, getLanguage: () => language });
  for (const [code, title] of [['en', 'Less spicy, please'], ['ja', '辛さ控えめで'], ['ko', '덜 맵게 해 주세요'], ['es', 'Poco picante, por favor'], ['zh-CN', '请少放辣']]) {
    language = code;
    const cards = library.getState().cards;
    assert.equal(cards[0].title, title);
    assert.equal(cards[0].pairedLanguage, code);
    assert.equal(cards[0].pairedText === null, code === 'zh-CN');
    assert.equal(cards[1].title, 'My water');
    assert.equal(cards[1].pairedText, 'Warm water for me.');
    assert.equal(cards[1].pairedLanguage, 'en');
  }
  assert.equal(store.get('personal-cards').cards[0].pairedLanguage, 'en');
});
