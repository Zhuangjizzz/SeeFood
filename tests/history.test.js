const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');

async function saveRecord(services, disk, kind = 'menu', count = 1) {
  const capture = createCapture({ media: { chooseImages: async () => Array.from({ length: count }, () => disk.material('menu-photo.png')) }, getLanguage: () => 'en' });
  capture.chooseMode(kind); await capture.chooseImages({ source: 'album' });
  const saved = await services.records.confirmCapture(capture.confirm().batch); assert.equal(saved.ok, true);
  return saved.recordId;
}

test('all history survives client recreation and sorts by creation instant while home shows only three actual first images', async (t) => {
  const disk = recordPlatform(t); let date = '2026-10-06T00:00:00Z';
  const services = createWechatServices(disk.platform, { now: () => date });
  const oldest = await saveRecord(services, disk);
  date = '2026-10-06T03:00:00Z'; const newest = await saveRecord(services, disk, 'dish', 2);
  date = '2026-10-06T10:00:00+08:00'; const second = await saveRecord(services, disk);
  date = '2026-10-06T01:00:00Z'; const third = await saveRecord(services, disk);
  date = '2026-10-06T00:30:00Z'; const fourth = await saveRecord(services, disk);
  services.records.updateRecord(oldest, (record) => { record.title = 'Saved menu name'; });
  const reopened = createWechatServices(disk.platform);
  const history = reopened.history.list(); assert.equal(history.ok, true);
  assert.deepEqual(history.entries.map((entry) => entry.id), [newest, second, third, fourth, oldest]);
  assert.deepEqual(reopened.history.list({ recent: true }).entries.map((entry) => entry.id), [newest, second, third]);
  assert.equal(history.entries[0].imageCount, 2); assert.match(history.entries[0].title, /^Dish · 2026-10-06$/);
  assert.match(history.entries[0].createdAtLabel, /2026-10-06 \d\d:\d\d/);
  assert.equal(history.entries[4].title, 'Saved menu name');
  assert.equal(history.entries[0].thumbnail, reopened.records.getRecord(newest).record.images[0].localOriginalPath);
  assert.ok(fs.readFileSync(history.entries[0].thumbnail).length);
  assert.equal(history.entries[0].processingState, 'pending'); assert.equal(history.entries[0].saveState, 'saved');
  const read = disk.storage.get; disk.storage.get = () => { throw new Error('cannot read storage'); };
  assert.deepEqual(reopened.history.list(), { ok: false, entries: [], error: 'storage-read' });
  disk.storage.get = read; assert.equal(reopened.history.list().entries.length, 5);
});

async function connected(t, env) {
  const { temporary, start } = require('./support/http-service');
  const disk = recordPlatform(t); const server = await start(t, temporary(t), env);
  const traffic = []; const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => {
    traffic.push({ method: options.method, url: options.url, data: structuredClone(options.data) });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const id = await saveRecord(services, disk);
  assert.equal((await services.uploads.uploadRecord(id)).ok, true);
  return { disk, services, server, traffic, backend, id };
}

test('completed image and chat history reads actual saved files and unchanged generated language offline with no new work', async (t) => {
  const { disk, services, server, traffic, backend, id } = await connected(t);
  assert.equal((await services.jobs.startImageCards(id)).ok, true);
  assert.equal(services.history.list().entries[0].processingState, 'partial');
  assert.equal((await services.jobs.startImageTranslation(id)).ok, true);
  services.application.chooseLanguage('ja'); assert.equal((await services.chat.sendQuickQuestion(id, 'explain')).ok, true);
  const record = services.records.getRecord(id).record;
  assert.equal(services.history.list().entries[0].processingState, 'complete');
  assert.equal(services.history.list().entries[0].saveState, 'saved');
  assert.ok(fs.readFileSync(record.images[0].original.localPath).length);
  assert.ok(fs.readFileSync(record.images[0].translation.localPath).length);
  const originals = fs.readFileSync(record.images[0].original.localPath); const translated = fs.readFileSync(record.images[0].translation.localPath);
  await server.stop(); const before = traffic.length;
  const reopened = createWechatServices(disk.platform, { backend }); reopened.application.chooseLanguage('es');
  const saved = reopened.records.getRecord(id).record;
  assert.deepEqual(saved.cards, record.cards); assert.deepEqual(reopened.chat.getState(id).messages, record.messages);
  assert.equal(saved.messages[1].contentLanguage, 'ja'); assert.equal(saved.images[0].translation.contentLanguage, 'en');
  assert.deepEqual(fs.readFileSync(saved.images[0].original.localPath), originals); assert.deepEqual(fs.readFileSync(saved.images[0].translation.localPath), translated);
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true); assert.equal((await reopened.chat.refreshRecord(id)).ok, true);
  assert.equal(reopened.history.list().entries[0].processingState, 'complete'); assert.equal(traffic.length, before);
  fs.unlinkSync(saved.images[0].translation.localPath);
  const missingTranslation = reopened.history.list().entries[0];
  assert.equal(missingTranslation.processingState, 'complete'); assert.equal(missingTranslation.saveState, 'partial');
  assert.equal(missingTranslation.offlineAvailable, false); assert.equal(missingTranslation.missingImages, 1);
  assert.equal(reopened.imageView.open(id).translationAvailable, false);
  assert.ok(reopened.imageView.open(id).path); // The existing saved original remains usable.
  fs.unlinkSync(saved.images[0].original.localPath);
  assert.equal(reopened.history.list().entries[0].thumbnail, null);
  assert.equal(reopened.imageView.open(id).path, null);
  assert.deepEqual(reopened.chat.getState(id).messages, record.messages); assert.equal(traffic.length, before);
});

test('list and result anchors restore their actual source through recreation and reject vanished images or cards', async (t) => {
  const disk = recordPlatform(t); const services = createWechatServices(disk.platform);
  const first = await saveRecord(services, disk); const second = await saveRecord(services, disk, 'menu', 2);
  const images = services.records.getRecord(second).record.images;
  services.history.saveListPosition('history', { anchorId: first, offset: -22, scrollTop: 810 });
  services.history.saveListPosition('home', { anchorId: second, offset: 17, scrollTop: 430 });
  assert.equal(services.history.enterRecord(second, { view: 'history', historySource: 'mine' }).ok, true);
  services.imageView.open(second, images[1].id);
  services.history.saveResultPosition(second, { anchorId: `image:${images[1].id}`, offset: -93, scrollTop: 530 });
  const fresh = createWechatServices(disk.platform);
  assert.deepEqual(fresh.history.getListPosition('history'), { anchorId: first, offset: -22, scrollTop: 810 });
  assert.deepEqual(fresh.history.getListPosition('home'), { anchorId: second, offset: 17, scrollTop: 430 });
  assert.deepEqual(fresh.history.getResultSource(second), { view: 'history', historySource: 'mine' });
  assert.deepEqual(fresh.history.getResultPosition(second), { anchorId: `image:${images[1].id}`, offset: -93, scrollTop: 530 });
  fresh.records.updateRecord(second, (record) => { record.images = record.images.slice(0, 1); record.imageIds = record.imageIds.slice(0, 1); });
  assert.equal(fresh.imageView.open(second).imageId, images[0].id);
  assert.deepEqual(fresh.history.getResultPosition(second), { anchorId: null, offset: 0, scrollTop: 0 });
  assert.equal(fresh.history.enterRecord('absent', { view: 'history' }).error, 'record-missing');
  assert.equal(fresh.history.saveListPosition('history', { anchorId: 'absent', offset: 3, scrollTop: 999 }).ok, true);
  assert.deepEqual(fresh.history.getListPosition('history'), { anchorId: null, offset: 0, scrollTop: 0 });
  const write = disk.storage.set; disk.storage.set = () => { throw new Error('full'); };
  assert.equal(fresh.history.saveListPosition('home', { anchorId: first, offset: -10, scrollTop: 800 }).error, 'storage-write');
  disk.storage.set = write;
  assert.deepEqual(createWechatServices(disk.platform).history.getListPosition('home'), { anchorId: second, offset: 17, scrollTop: 430 });
});

test('known offline reopening reads saved history and new generation waits for reconnection without creating a message or upload request', async (t) => {
  const { disk, services, server, traffic, backend, id } = await connected(t);
  await services.jobs.startImageCards(id); await services.jobs.startImageTranslation(id); await services.chat.send(id, 'Existing reply');
  let change; disk.platform.getNetworkType = ({ success }) => success({ networkType: 'none' });
  disk.platform.onNetworkStatusChange = (listener) => { change = listener; };
  const reopened = createWechatServices(disk.platform, { backend });
  const before = traffic.length; const messages = reopened.chat.getState(id).messages;
  assert.equal((await reopened.chat.send(id, 'Please wait for Wi-Fi')).error, 'network-unavailable');
  assert.deepEqual(reopened.chat.getState(id).messages, messages);
  const pending = await saveRecord(reopened, disk);
  assert.equal((await reopened.uploads.uploadRecord(pending)).error, 'network-unavailable');
  assert.equal(reopened.records.getRecord(pending).record.images[0].uploadState, 'pending');
  assert.equal(reopened.history.list().entries.length, 2); assert.equal(traffic.length, before);
  change({ isConnected: true, networkType: 'wifi' }); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(traffic.length, before); // Reconnection updates availability; it does not send anything.
  assert.equal((await reopened.chat.send(id, 'Please wait for Wi-Fi')).ok, true);
  assert.equal(reopened.chat.getState(id).messages.length, messages.length + 2);
  await server.stop();
});
