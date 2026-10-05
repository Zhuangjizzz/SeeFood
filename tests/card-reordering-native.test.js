const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { fileStorage } = require('./support/storage');
const { createWechatServices } = require('../miniprogram/platform/wechat');

function openNativePage(t, driver) {
  const navigations = [];
  const platform = {
    getStorageSync: driver.get, setStorageSync: (key, value) => driver.set(key, value), removeStorageSync: driver.remove,
    getAppBaseInfo: () => ({ language: 'en' }), getWindowInfo: () => ({ windowWidth: 375, windowHeight: 700 }),
    setTabBarItem() {}, setNavigationBarTitle() {}, navigateTo: (target) => navigations.push(target.url)
  };
  const services = createWechatServices(platform);
  services.application.chooseLanguage('en');
  global.getApp = () => ({ services });
  global.wx = platform;
  t.after(() => { delete global.getApp; delete global.wx; });
  let target;
  let nextTimer = 1;
  const timers = new Map();
  const filename = path.join(__dirname, '../miniprogram/pages/cards/cards.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: createRequire(filename), wx: platform, Page: (value) => { target = value; },
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id)
  }, { filename });
  target.setData = (patch, callback) => { Object.assign(target.data, patch); if (callback) callback(); };
  target.createSelectorQuery = () => {
    const query = { select: () => query, boundingClientRect: (callback) => { callback({ top: 200, bottom: 700, height: 500 }); return query; }, exec() {} };
    return query;
  };
  target.onLoad();
  target.onShow();
  return { target, services, navigations, tick(delay) {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); }
  } };
}

test('native touch events show a lifted card and drop slot, edge-scroll, save on release, and suppress card navigation', (t) => {
  const driver = fileStorage(t);
  const { target, services, navigations, tick } = openNativePage(t, driver);
  const first = target.data.cards[0].id;
  const start = { currentTarget: { dataset: { id: first } }, touches: [{ clientX: 50, clientY: 250 }] };
  target.onCardTouchStart(start);
  tick(420);
  target.onCardTouchEnd();
  target.showCard(start);
  assert.equal(target.data.expanded, true);
  assert.equal(navigations.length, 0);
  target.onCardTouchStart(start);
  tick(420);
  assert.equal(target.data.dragging, true);
  assert.equal(target.data.cards.find((card) => card.id === first).lifted, true);
  target.onCardTouchMove({ touches: [{ clientX: 50, clientY: 690 }] });
  assert.equal(target.data.dropPosition, 3);
  tick(32);
  assert.equal(target.data.scrollTop, 18);
  target.onCardTouchEnd();
  target.showCard(start);
  assert.equal(target.data.dragging, false);
  assert.equal(target.data.showSortHint, false);
  assert.equal(navigations.length, 0);
  assert.deepEqual(services.cardLibrary.getState().allCards.map((card) => card.presetId), ['water', 'ingredients', 'less-spicy', 'tableware', 'no-meat', 'bill']);
});

test('a fresh native card activation opens staff display without requiring a preceding touch sequence', (t) => {
  const { target, navigations } = openNativePage(t, fileStorage(t));
  const id = target.data.cards[0].id;
  target.showCard({ currentTarget: { dataset: { id } } });
  assert.deepEqual(navigations, ['/pages/card-display/card-display?id=' + id]);
});

test('native retry finishes a failed deletion first, then retries the pending order without resurrecting that card', (t) => {
  const driver = fileStorage(t);
  const { target, services, tick } = openNativePage(t, driver);
  services.cardLibrary.expand();
  target.onShow();
  const write = driver.set;
  driver.set = (key, value) => { if (key.endsWith('personal-cards')) throw new Error('full'); write(key, value); };
  target.onCardTouchStart({ currentTarget: { dataset: { id: 'personal-preset-ingredients' } }, touches: [{ clientX: 50, clientY: 650 }] });
  tick(420);
  target.onCardTouchMove({ touches: [{ clientX: 50, clientY: 250 }] });
  target.onCardTouchEnd();
  assert.match(target.data.cardError, /Order was not saved/);
  target.openCardMenu({ currentTarget: { dataset: { id: 'personal-preset-less-spicy' } } });
  target.deleteMenuCard();
  assert.match(target.data.cardError, /not deleted/);
  driver.set = write;
  target.retryCards();
  assert.equal(services.cardLibrary.getState().pendingDeletionId, null);
  assert.equal(services.cardLibrary.getState().pendingReorder, true);
  assert.match(target.data.cardError, /Order was not saved/);
  target.retryCards();
  assert.equal(target.data.cardError, '');
  assert.equal(services.cardLibrary.getState().pendingReorder, false);
  assert.deepEqual(services.cardLibrary.getState().allCards.map((card) => card.presetId), ['ingredients', 'water', 'tableware', 'no-meat', 'bill']);
});

test('expanded card management opens the edit route without also opening staff display or changing its reading anchor', (t) => {
  const { target, services, navigations } = openNativePage(t, fileStorage(t));
  services.cardLibrary.expand(); target.onShow();
  const id = 'personal-preset-ingredients';
  target.onLibraryScroll({ detail: { scrollTop: 421 } }); target.flushPosition();
  const before = services.cardLibrary.getState();
  target.openCardMenu({ currentTarget: { dataset: { id } } });
  const labels = ['Edit card', 'カードを編集', '카드 편집', 'Editar tarjeta', '编辑卡片'];
  for (const [index, language] of ['en', 'ja', 'ko', 'es', 'zh-CN'].entries()) {
    services.application.chooseLanguage(language); target.renderLibrary(false, false);
    assert.equal(target.data.cardCopy.editCard, labels[index]);
  }
  target.editMenuCard(); target.showCard({ currentTarget: { dataset: { id } } });
  assert.deepEqual(navigations, ['/pages/card-editor/card-editor?id=' + id]);
  assert.equal(services.cardLibrary.getState().menuCard, null);
  assert.deepEqual(services.cardLibrary.getState().position, before.position);
  assert.deepEqual(services.cardLibrary.getState().allCards.map((card) => [card.id, card.order]), before.allCards.map((card) => [card.id, card.order]));
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/cards/cards.wxml'), 'utf8');
  assert.match(template, /class="card-menu-edit" catchtap="editMenuCard"/);
});
