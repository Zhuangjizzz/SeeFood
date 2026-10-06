const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
async function save(services, disk) {
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'en' });
  capture.chooseMode('menu'); await capture.chooseImages({ source: 'album' });
  const batch = capture.confirm().batch; const outcome = await services.records.confirmCapture(batch); assert.equal(outcome.ok, true);
  return { id: outcome.recordId, batch };
}
test('deleting a record durably hides it, removes its content and files, preserves other records and personal cards, and rejects stale saves after recreation', async (t) => {
  const disk = recordPlatform(t); const services = createWechatServices(disk.platform);
  const first = await save(services, disk); const second = await save(services, disk);
  services.cardLibrary.getState(); const cards = services.store.get('personal-cards', null);
  services.records.updateRecord(first.id, (record) => { record.messages = [{ text: 'Private message' }]; record.chatDraft = { text: 'Unsent' }; record.browseState = { currentImageId: record.imageIds[0] }; });
  const old = services.records.getRecord(first.id).record;
  const result = await services.deletions.deleteRecord(first.id); assert.equal(result.ok, true);
  assert.equal(services.records.getRecord(first.id).error, 'record-missing');
  assert.deepEqual(services.records.listHistory().records.map((r) => r.id), [second.id]);
  assert.equal(fs.existsSync(old.images[0].localOriginalPath), false);
  assert.deepEqual(services.store.get('personal-cards', null), cards);
  assert.equal(JSON.stringify(services.store.get('records', [])).includes('Private message'), false);
  const reopened = createWechatServices(disk.platform);
  assert.equal(reopened.records.updateRecord(first.id, (r) => { r.messages = old.messages; }).ok, false);
  assert.equal((await services.records.confirmCapture(first.batch)).ok, false);
  assert.equal(services.records.getSubmission(first.batch.id), null);
  assert.equal(reopened.deletions.getState().entries[0].localState, 'succeeded');
  assert.equal(reopened.deletions.getState().entries[0].backendState, 'not-required');
  assert.equal(JSON.stringify(reopened.store.get('record-deletions', [])).includes('Private message'), false);
});

test('a failed deletion-marker write preserves visibility; later file failure stays hidden and retry removes real files after recreation', async (t) => {
  const disk = recordPlatform(t); const services = createWechatServices(disk.platform); const { id } = await save(services, disk);
  const original = services.records.getRecord(id).record.images[0].localOriginalPath;
  const write = disk.storage.set; disk.storage.set = (key, value) => { if (key.endsWith('record-deletions')) throw new Error('disk full'); write(key, value); };
  assert.equal((await services.deletions.deleteRecord(id)).ok, false);
  assert.equal(services.records.getRecord(id).ok, true); assert.equal(fs.existsSync(original), true);
  disk.storage.set = write;
  const remove = disk.fileSystem.rmdirSync; disk.fileSystem.rmdirSync = () => { throw new Error('busy filesystem'); };
  const deleted = await services.deletions.deleteRecord(id); assert.equal(deleted.ok, true); assert.equal(deleted.localComplete, false);
  assert.equal(services.records.listHistory().records.length, 0);
  assert.equal(services.deletions.getState().entries[0].localState, 'failed');
  disk.fileSystem.rmdirSync = remove;
  const fresh = createWechatServices(disk.platform); assert.equal((await fresh.deletions.retry(id)).ok, true);
  assert.equal(fresh.deletions.getState().entries[0].localState, 'succeeded'); assert.equal(fs.existsSync(original), false);
  const marker = fresh.deletions.getState().entries[0]; await fresh.deletions.deleteRecord(id);
  assert.equal(fresh.deletions.getState().entries.length, 1); assert.equal(fresh.deletions.getState().entries[0].deletedAt, marker.deletedAt);
});

test('an original copy finishing after deletion cannot leave files or restore append content', async (t) => {
  const disk = recordPlatform(t); const services = createWechatServices(disk.platform); const { id } = await save(services, disk);
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'en' });
  capture.chooseMode('menu'); await capture.chooseImages({ source: 'album', target: { kind: 'append', recordId: id } });
  let release; let copied;
  const copy = disk.fileSystem.copyFile;
  disk.fileSystem.copyFile = (options) => { copied = options; release = () => { fs.mkdirSync(require('node:path').dirname(options.destPath), { recursive: true }); copy(options); }; };
  const pending = services.records.confirmCapture(capture.confirm().batch);
  assert.ok(release); await services.deletions.deleteRecord(id); release();
  assert.equal((await pending).ok, false); assert.equal(services.records.getRecord(id).ok, false);
  assert.equal(fs.existsSync(copied.destPath), false);
});

async function connected(t, env = {}) {
  const { temporary, start } = require('./support/http-service'); const disk = recordPlatform(t); const directory = temporary(t); const server = await start(t, directory, env);
  const traffic = []; const config = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  const networkListeners = []; let online = true;
  disk.platform.onNetworkStatusChange = (fn) => networkListeners.push(fn);
  disk.platform.getNetworkType = ({ success }) => success({ networkType: online ? 'wifi' : 'none' });
  disk.platform.request = (options) => {
    traffic.push({ method: options.method, url: options.url, data: options.data });
    fetch(options.url, { method: options.method, headers: options.header,
      body: ['GET', 'DELETE'].includes(options.method) ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, value) => error ? fail(error) : success({ data: value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) }));
  const services = createWechatServices(disk.platform, { backend: config });
  const saved = await save(services, disk);
  return { disk, directory, server, config, services, traffic, id: saved.id,
    online(value) { online = value; networkListeners.forEach((fn) => fn({ isConnected: value })); } };
}
async function waitFor(operation) {
  for (let i = 0; i < 400; i++) { if (operation()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail('expected public state did not arrive');
}

test('offline deletion of an uploaded record automatically continues owner-bound server cleanup on reconnection and never recreates history', async (t) => {
  const setup = await connected(t); const { services, id, disk, config, directory, traffic } = setup;
  assert.equal((await services.uploads.uploadRecord(id)).ok, true);
  assert.equal((await services.jobs.startImageProcessing(id)).ok, true);
  const old = services.records.getRecord(id).record;
  setup.online(false); const before = traffic.length;
  await services.deletions.deleteRecord(id); assert.equal(traffic.length, before);
  assert.equal(fs.existsSync(old.images[0].translation.localPath), false);
  const fresh = createWechatServices(disk.platform, { backend: config });
  assert.equal(fresh.records.listHistory().records.length, 0);
  setup.online(true);
  await waitFor(() => fresh.deletions.getState().entries[0].backendState === 'succeeded');
  const entry = fresh.deletions.getState().entries[0]; assert.equal(entry.localState, 'succeeded'); assert.ok(entry.cleanups[0].cleanupId);
  assert.deepEqual(fs.readdirSync(require('node:path').join(directory, 'images')), []);
  assert.deepEqual(fs.readdirSync(require('node:path').join(directory, 'translations')), []);
  const cleanupId = entry.cleanups[0].cleanupId; await fresh.deletions.deleteRecord(id);
  assert.equal(fresh.deletions.getState().entries[0].cleanups[0].cleanupId, cleanupId);
});

test('a translated image copy delivered after deletion is discarded, including saved bytes and temporary preview handles', async (t) => {
  const { services, id, disk } = await connected(t);
  assert.equal((await services.uploads.uploadRecord(id)).ok, true);
  const copy = disk.fileSystem.copyFile; let release; let destination;
  disk.fileSystem.copyFile = (options) => {
    if (!options.destPath.includes('seefood-translations')) return copy(options);
    destination = options.destPath; release = () => { fs.mkdirSync(require('node:path').dirname(destination), { recursive: true }); copy(options); };
  };
  const processing = services.jobs.startImageTranslation(id);
  await waitFor(() => release);
  await services.deletions.deleteRecord(id); release();
  assert.equal((await processing).ok, false);
  assert.equal(fs.existsSync(destination), false);
  assert.equal(services.records.getRecord(id).ok, false);
  assert.deepEqual(services.jobs.getState(id).previewPaths, {});
  assert.deepEqual(services.jobs.getState(id).unsavedJobs, []);
});

test('deleting a never-uploaded record needs no server cleanup and sends no missing-context request', async (t) => {
  const { services, id, traffic } = await connected(t);
  await services.deletions.deleteRecord(id);
  assert.equal(traffic.length, 0);
  assert.equal(services.deletions.getState().entries[0].backendState, 'not-required');
});

test('a context PUT already in transit is deleted when its late acceptance arrives, without starting an upload', async (t) => {
  const { services, id, disk, traffic } = await connected(t);
  const request = disk.platform.request; let release;
  disk.platform.request = (options) => { if (options.method === 'PUT' && options.url.includes('/v1/contexts/')) release = () => request(options); else request(options); };
  const uploading = services.uploads.uploadRecord(id); await waitFor(() => release);
  await services.deletions.deleteRecord(id);
  release(); assert.equal((await uploading).ok, false);
  await waitFor(() => services.deletions.getState().entries[0].backendState === 'succeeded');
  assert.equal(services.deletions.getState().entries[0].backendState, 'succeeded');
  assert.equal(traffic.some((item) => item.url.endsWith('/v1/uploads')), false);
  assert.equal(services.records.getRecord(id).ok, false);
});

test('deleting complete image and chat results removes their public retained delivery state as well as durable content', async (t) => {
  const { services, id, disk } = await connected(t);
  assert.equal((await services.uploads.uploadRecord(id)).ok, true); assert.equal((await services.jobs.startImageProcessing(id)).ok, true);
  assert.equal((await services.chat.sendQuickQuestion(id, 'communicate')).ok, true);
  const old = services.records.getRecord(id).record; const second = await save(services, disk);
  assert.ok(old.messages[1].attachments.some((attachment) => attachment.type === 'communication_card'));
  const translatedId = old.images[0].translation.id; assert.ok(services.jobs.getState(id).previewPaths[translatedId]);
  await services.deletions.deleteRecord(id);
  assert.equal(services.jobs.getState(second.id).previewPaths[translatedId], undefined);
  assert.equal(services.jobs.applyJob(id, old.images[0].stageJobs.image_cards).ok, false);
  assert.equal(services.chat.applyJob(id, Object.values(old.chatJobs)[0]).ok, false);
  assert.deepEqual(services.chat.getState(id).messages, []);
  const fresh = createWechatServices(disk.platform); assert.equal(fresh.records.getRecord(id).ok, false);
  assert.equal(JSON.stringify(fresh.store.get('records', [])).includes(old.messages[0].id), false);
});

test('failure to remove an original copied after deletion reopens local cleanup instead of reporting files removed', async (t) => {
  const disk = recordPlatform(t); const services = createWechatServices(disk.platform); const { id } = await save(services, disk);
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album', target: { kind: 'append', recordId: id } });
  const copy = disk.fileSystem.copyFile; const remove = disk.fileSystem.rmdirSync; let release; let destination;
  disk.fileSystem.copyFile = (options) => { destination = options.destPath; release = () => { fs.mkdirSync(require('node:path').dirname(destination), { recursive: true }); copy(options); }; };
  const saving = services.records.confirmCapture(capture.confirm().batch);
  await services.deletions.deleteRecord(id); disk.fileSystem.rmdirSync = () => { throw new Error('temporarily locked'); }; release(); await saving;
  assert.equal(services.deletions.getState().entries[0].localState, 'failed');
  assert.equal(fs.existsSync(destination), true);
  disk.fileSystem.rmdirSync = remove; await services.deletions.retry(id);
  assert.equal(fs.existsSync(destination), false); assert.equal(services.deletions.getState().entries[0].localState, 'succeeded');
});
