const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { fileStorage } = require('./support/storage');
const { createWechatServices } = require('../miniprogram/platform/wechat');

async function openPreview(t) {
  const driver = fileStorage(t);
  const inputPaths = ['menu-photo.png', 'menu-screenshot.png', 'menu-long.png'].map((name) => path.join(__dirname, 'fixtures', name));
  const platform = {
    getStorageSync: driver.get, setStorageSync: (key, value) => driver.set(key, value), removeStorageSync: driver.remove,
    getAppBaseInfo: () => ({ language: 'en' }), setNavigationBarTitle() {}, nextTick: (callback) => callback(),
    chooseMedia: ({ success }) => success({ tempFiles: inputPaths.map((tempFilePath) => ({ tempFilePath, size: fs.statSync(tempFilePath).size })) }),
    getImageInfo({ src, success }) {
      const bytes = fs.readFileSync(src);
      success({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), type: 'png', orientation: 'up' });
    }
  };
  const services = createWechatServices(platform);
  await services.capture.chooseImages({ source: 'album' });
  global.getApp = () => ({ services });
  global.wx = platform;
  let target;
  let nextTimer = 1;
  const intervals = new Map();
  const filename = path.join(__dirname, '../miniprogram/pages/preview/preview.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: createRequire(filename), wx: platform, Page: (value) => { target = value; },
    setInterval: (callback) => { const id = nextTimer++; intervals.set(id, callback); return id; },
    clearInterval: (id) => intervals.delete(id)
  }, { filename });
  target.setData = (patch) => { Object.assign(target.data, patch); };
  target.createSelectorQuery = () => {
    let selector;
    const query = {
      selectAll(value) { selector = value; return query; }, select(value) { selector = value; return query; },
      boundingClientRect(callback) {
        callback(selector === '.preview-row' ? [100, 232, 364].map((top) => ({ top, height: 120 })) : { top: 80, bottom: 650, height: 570 });
        return query;
      }, exec() {}
    };
    return query;
  };
  target.onShow();
  t.after(() => { target.onUnload(); delete global.getApp; delete global.wx; });
  // Dispatch the touch events registered by the native handle, not private drag helpers.
  const template = fs.readFileSync(filename.replace('.js', '.wxml'), 'utf8');
  const handle = template.match(/<button\s+class="drag-handle"[^>]*>/)[0];
  return {
    services,
    touch(event, id, y) {
      const handler = handle.match(new RegExp(`catch${event}="([^"]+)"`))[1];
      target[handler]({ currentTarget: { dataset: { id } }, touches: y === undefined ? [] : [{ clientX: 340.5, clientY: y }] });
    },
    elapse() { for (const callback of [...intervals.values()]) callback(); }
  };
}

test('pressing the lower edge of a preview handle without moving does not reorder photos', async (t) => {
  const preview = await openPreview(t);
  const before = preview.services.capture.getState().images.map((image) => image.id);
  preview.touch('touchstart', before[0], 164.6875);
  preview.elapse();
  preview.elapse();
  preview.touch('touchend', before[0]);
  assert.deepEqual(preview.services.capture.getState().images.map((image) => image.id), before);
});

test('moving inside the original row preserves order whether the handle was grabbed high or low', async (t) => {
  const preview = await openPreview(t);
  const before = preview.services.capture.getState().images.map((image) => image.id);
  for (const startY of [123.6875, 164.6875]) {
    preview.touch('touchstart', before[0], startY);
    preview.touch('touchmove', before[0], startY + 20);
    preview.elapse();
    preview.elapse();
    preview.touch('touchend', before[0]);
    assert.deepEqual(preview.services.capture.getState().images.map((image) => image.id), before);
  }
});

test('small touch jitter and cancelling an intentional preview drag both preserve the original order', async (t) => {
  const preview = await openPreview(t);
  const before = preview.services.capture.getState().images.map((image) => image.id);
  preview.touch('touchstart', before[0], 164.6875);
  preview.touch('touchmove', before[0], 169.6875);
  preview.elapse();
  preview.touch('touchend', before[0]);
  assert.deepEqual(preview.services.capture.getState().images.map((image) => image.id), before);
  preview.touch('touchstart', before[0], 164.6875);
  preview.touch('touchmove', before[0], 296.6875);
  preview.elapse();
  preview.touch('touchcancel', before[0]);
  preview.elapse();
  preview.touch('touchend', before[0]);
  assert.deepEqual(preview.services.capture.getState().images.map((image) => image.id), before);
});

for (const [edge, startY] of [['upper', 123.6875], ['lower', 164.6875]]) {
  test(`dragging from the ${edge} handle edge across one row moves exactly one place`, async (t) => {
    const preview = await openPreview(t);
    const before = preview.services.capture.getState().images.map((image) => image.id);
    preview.touch('touchstart', before[0], startY);
    preview.touch('touchmove', before[0], startY + 132);
    preview.elapse();
    preview.elapse();
    preview.touch('touchend', before[0]);
    assert.deepEqual(preview.services.capture.getState().images.map((image) => image.id), [before[1], before[0], before[2]]);
  });
}
