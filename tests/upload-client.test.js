const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');

async function localBackend(t, disk) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seefood-upload-client-'));
  const { createService } = await import('../server/service.ts');
  const service = createService({ dataDir: directory, enableDevSession: true, devIdentities: ['demo-owner-a'] });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await service.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const backend = { enabled: true, baseUrl: `http://127.0.0.1:${service.server.address().port}`, identity: 'demo-owner-a' };
  const traffic = [];
  disk.platform.request = (options) => {
    traffic.push({ url: options.url, method: options.method, headers: options.header, data: options.data });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.data instanceof ArrayBuffer || Buffer.isBuffer(options.data) ? options.data : JSON.stringify(options.data) })
      .then(async (response) => {
        const text = await response.text();
        options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null });
      }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) =>
    error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  return { backend, traffic, directory };
}
async function saveRecord(services, disk) {
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'ja' });
  await capture.chooseImages({ source: 'album' });
  const result = await services.records.confirmCapture(capture.confirm().batch);
  assert.equal(result.ok, true);
  return services.records.getRecord(result.recordId).record;
}

test('public native upload sends actual saved bytes, binds a new snapshot and reopens stable IDs without claiming jobs', async (t) => {
  const disk = recordPlatform(t); const setup = await localBackend(t, disk);
  const services = createWechatServices(disk.platform, { backend: setup.backend });
  const initial = await saveRecord(services, disk);
  const observed = [];
  services.uploads.subscribe((id) => observed.push(services.records.getRecord(id).record.images[0].uploadState));
  const result = await services.uploads.uploadRecord(initial.id);
  assert.equal(result.ok, true);
  const reopened = createWechatServices(disk.platform, { backend: setup.backend });
  const saved = reopened.records.getRecord(initial.id).record;
  assert.equal(saved.contextSnapshotVersion, 2);
  assert.equal(saved.images[0].uploadState, 'uploaded');
  assert.equal(typeof saved.images[0].assetId, 'string');
  assert.equal(saved.images[0].original.assetId, saved.images[0].assetId);
  assert.equal(saved.id, initial.id); assert.equal(saved.requestId, initial.requestId);
  assert.deepEqual(saved.images[0].requests, initial.images[0].requests);
  assert.deepEqual(saved.images[0].stageJobs, { image_cards: null, image_translation: null });
  assert.equal(saved.images[0].localOriginalPath, initial.images[0].localOriginalPath);
  assert.equal(saved.images[0].original.saveState, 'saved');
  assert.equal(observed.includes('uploading'), true); assert.equal(observed.at(-1), 'uploaded');
  const bytes = fs.readFileSync(initial.images[0].localOriginalPath);
  const remoteFile = fs.readdirSync(path.join(setup.directory, 'images'))[0];
  assert.deepEqual(fs.readFileSync(path.join(setup.directory, 'images', remoteFile)), bytes);
  const byteRequest = setup.traffic.find((item) => item.url.includes('/_uploads/'));
  assert.equal(byteRequest.method, 'PUT');
  assert.deepEqual(Object.keys(byteRequest.headers), ['Content-Type']);
  assert.equal(Buffer.from(byteRequest.data).equals(bytes), true);
  assert.equal(setup.traffic.some((item) => item.url.endsWith('/v1/jobs')), false);
  const before = setup.traffic.length;
  assert.equal((await reopened.uploads.uploadRecord(initial.id)).ok, true);
  assert.equal(setup.traffic.length, before);
});

test('native confirmation starts upload and result pages show live and saved outcomes in all five languages without restarting on revisit', async (t) => {
  const disk = recordPlatform(t); const setup = await localBackend(t, disk);
  const photo = disk.material('menu-photo.png');
  disk.platform.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: photo.localPath, size: photo.sizeBytes }] });
  disk.platform.getImageInfo = ({ success }) => success({ width: photo.width, height: photo.height, type: 'png', orientation: 'up' });
  const services = createWechatServices(disk.platform, { backend: setup.backend });
  await services.capture.chooseImages({ source: 'album' });
  const definitions = {};
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, old));
  global.getApp = () => ({ services }); global.getCurrentPages = () => [];
  global.wx = { redirectTo() {}, setNavigationBarTitle() {}, nextTick() {} };
  function load(name) {
    global.Page = (definition) => { definitions[name] = definition; };
    const file = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[file]; require(file);
    const page = { ...definitions[name], data: { ...definitions[name].data }, setData(patch) { this.data = { ...this.data, ...patch }; } };
    return page;
  }
  const preview = load('preview'); preview.onShow();
  preview.getOpenerEventChannel = () => ({ async emit(name, batch, complete) { complete(await services.records.confirmCapture(batch)); } });
  let release;
  const request = disk.platform.request;
  disk.platform.request = (options) => options.url.includes('/_uploads/') ? (release = () => request(options)) : request(options);
  const confirmation = await preview.confirm();
  const initial = services.records.getRecord(confirmation.recordId).record;
  const result = load('result'); result.onLoad({ recordId: initial.id }); result.onShow();
  for (let count = 0; count < 50 && !release; count += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(typeof release, 'function');
  assert.equal(result.data.uploadState, 'uploading');
  release();
  assert.equal((await services.uploads.uploadRecord(initial.id)).ok, true);
  assert.equal((await services.jobs.startImageProcessing(initial.id)).ok, true);
  assert.equal(result.data.canLeave, true);
  for (const [language, label] of [['en', 'Uploaded'], ['ja', 'アップロード済み'], ['ko', '업로드됨'], ['es', 'Subida completada'], ['zh-CN', '已上传']]) {
    services.application.chooseLanguage(language);
    result.onHide(); result.onShow();
    assert.equal(result.data.processingLabel, label);
    assert.equal(result.data.uploadCopy.uploadedBody.length > 0, true);
    assert.equal(result.data.currentImage.stageJobs.image_cards.state, 'succeeded');
    assert.equal(result.data.dishCards.length, 1);
  }
  const sent = setup.traffic.length;
  result.onHide(); result.onShow(); result.onUnload();
  assert.equal(setup.traffic.length, sent);
});

test('network refusal and local metadata failures remain visible while originals and stable upload associations survive', async (t) => {
  const disk = recordPlatform(t); const setup = await localBackend(t, disk);
  const services = createWechatServices(disk.platform, { backend: setup.backend });
  const initial = await saveRecord(services, disk);
  const send = disk.platform.request;
  disk.platform.request = (options) => options.url.includes('/_uploads/') ? options.fail(new Error('offline')) : send(options);
  assert.deepEqual(await services.uploads.uploadRecord(initial.id), { ok: false, error: 'network-unavailable' });
  let saved = createWechatServices(disk.platform, { backend: setup.backend }).records.getRecord(initial.id).record;
  assert.equal(saved.images[0].uploadState, 'failed');
  assert.equal(saved.images[0].assetId, null);
  assert.equal(saved.images[0].original.saveState, 'saved');
  assert.equal(fs.existsSync(saved.images[0].localOriginalPath), true);
  assert.deepEqual(saved.images[0].requests, initial.images[0].requests);
  disk.platform.request = (options) => {
    if (options.url.endsWith('/complete')) {
      const success = options.success;
      options.success = (value) => { disk.storage.set = () => { throw new Error('storage full'); }; success(value); };
    }
    send(options);
  };
  assert.deepEqual(await services.uploads.uploadRecord(initial.id), { ok: false, error: 'storage-write' });
  assert.equal(services.uploads.getState(initial.id).error, 'storage-write');
  saved = createWechatServices(disk.platform, { backend: setup.backend }).records.getRecord(initial.id).record;
  assert.notEqual(saved.images[0].uploadState, 'uploaded');
  assert.equal(saved.images[0].original.saveState, 'saved');
  assert.deepEqual(saved.images[0].requests, initial.images[0].requests);
});

test('native release and trial configurations cannot enable the development identity or issue network requests', async (t) => {
  const disk = recordPlatform(t);
  disk.platform.request = () => assert.fail('development identity must not run here');
  for (const envVersion of ['release', 'trial']) {
    disk.platform.getAccountInfoSync = () => ({ miniProgram: { envVersion } });
    const services = createWechatServices(disk.platform);
    const record = await saveRecord(services, disk);
    assert.equal(services.uploads.enabled, false);
    assert.deepEqual(await services.uploads.uploadRecord(record.id), { ok: false, error: 'backend-unavailable' });
    assert.equal(services.records.getRecord(record.id).record.images[0].uploadState, 'pending');
  }
});
