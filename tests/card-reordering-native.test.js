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
