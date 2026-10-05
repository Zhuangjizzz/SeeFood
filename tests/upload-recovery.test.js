const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');

async function recoveryEnvironment(t) {
  const disk = recordPlatform(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seefood-upload-recovery-'));
  const { createService } = await import('../server/service.ts');
  let time = Date.now();
  const service = createService({ dataDir: directory, enableDevSession: true, devIdentities: ['demo-owner-a'], now: () => time });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await service.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const backend = { enabled: true, baseUrl: `http://127.0.0.1:${service.server.address().port}`, identity: 'demo-owner-a' };
  const exchanges = [];
  const networkListeners = [];
  const environment = { disk, backend, exchanges, advance: (milliseconds) => { time += milliseconds; },
    deliver: () => true, reconnect: () => networkListeners.forEach((listener) => listener({ isConnected: true, networkType: 'wifi' })),
    client: () => createWechatServices(disk.platform, { backend }) };
  service.server.on('request', (request) => { if (environment.observeRequest) environment.observeRequest(request); });
  disk.platform.onNetworkStatusChange = (listener) => networkListeners.push(listener);
  disk.platform.request = (options) => {
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => {
        const text = await response.text();
        const result = { statusCode: response.status, data: text ? JSON.parse(text) : null };
        const exchange = { request: options, response: result }; exchanges.push(exchange);
        if (environment.deliver(exchange)) options.success(result);
      }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) =>
    error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  return environment;
}

async function pendingRecord(services, disk, material = disk.material('menu-photo.png')) {
  const capture = createCapture({ media: { chooseImages: async () => [material] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' });
  const saved = await services.records.confirmCapture(capture.confirm().batch);
  assert.equal(saved.ok, true);
  return services.records.getRecord(saved.recordId).record;
}

function suspendResponse(environment, predicate) {
  let paused;
  const reached = new Promise((resolve) => { paused = resolve; });
  environment.deliver = (exchange) => {
    if (!predicate(exchange)) return true;
    environment.deliver = () => true;
    paused(exchange);
    return false;
  };
  return reached;
}

function nativePages(t, services) {
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, old));
  global.getApp = () => ({ services });
  global.wx = { setNavigationBarTitle() {}, setTabBarItem() {} };
  global.getCurrentPages = () => [];
  return (name) => {
    let definition;
    global.Page = (page) => { definition = page; };
    const filename = require.resolve(`../miniprogram/pages/${name}/${name}`);
    delete require.cache[filename]; require(filename);
    return { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  };
}

test('an interrupted credential response reopens as a manual resume with the original material and request identity', async (t) => {
  const environment = await recoveryEnvironment(t);
  const first = environment.client();
  const initial = await pendingRecord(first, environment.disk);
  const stopped = suspendResponse(environment, ({ request }) => request.url.endsWith('/v1/uploads'));
  void first.uploads.uploadRecord(initial.id);
  await stopped;

  const reopened = environment.client();
  const state = reopened.uploads.getState(initial.id);
  assert.equal(state.running, false);
  assert.equal(state.interrupted, true);
  assert.equal(state.canRetry, true);
  const saved = reopened.records.getRecord(initial.id).record;
  assert.equal(saved.id, initial.id);
  assert.equal(saved.contextId, initial.contextId);
  assert.deepEqual(saved.images[0].requests, initial.images[0].requests);
  assert.deepEqual(fs.readFileSync(saved.images[0].localOriginalPath), fs.readFileSync(initial.images[0].localOriginalPath));
  const before = environment.exchanges.length;
  reopened.records.listRecent();
  environment.reconnect();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(environment.exchanges.length, before, 'reopen and reconnect do not submit work');
  assert.equal((await reopened.uploads.uploadRecord(initial.id)).ok, true);
  assert.equal(reopened.records.getRecord(initial.id).record.images[0].uploadState, 'uploaded');
  assert.equal(reopened.records.listRecent().records.length, 1);
  assert.equal(environment.exchanges.some(({ request }) => request.url.endsWith('/v1/jobs')), false);
});

test('manual resume recovers an already completed asset after its completion response is lost and the upload ticket expires', async (t) => {
  const environment = await recoveryEnvironment(t);
  const first = environment.client();
  const initial = await pendingRecord(first, environment.disk);
  const stopped = suspendResponse(environment, ({ request, response }) => request.url.endsWith('/complete') && response.statusCode === 200);
  void first.uploads.uploadRecord(initial.id);
  const accepted = (await stopped).response.data;
  environment.advance(16 * 60 * 1000);
  const reopened = environment.client();
  assert.equal(reopened.uploads.getState(initial.id).interrupted, true);
  assert.equal((await reopened.uploads.uploadRecord(initial.id)).ok, true);
  const saved = reopened.records.getRecord(initial.id).record;
  assert.equal(saved.images[0].assetId, accepted.assetId);
  assert.equal(saved.images[0].uploadTicket.uploadId, accepted.uploadId);
  assert.deepEqual(saved.images[0].requests, initial.images[0].requests);
  assert.equal(saved.contextSnapshotVersion, 2);
  assert.equal(saved.images[0].uploadState, 'uploaded');
  const completedAssets = environment.exchanges.filter(({ request, response }) => request.url.endsWith('/complete') && response.statusCode === 200);
  assert.deepEqual([...new Set(completedAssets.map(({ response }) => response.data.assetId))], [accepted.assetId]);
  assert.equal(environment.exchanges.some(({ response }) => response.data && response.data.code === 'UPLOAD_EXPIRED'), false,
    'a confirmed asset remains retrievable without trying its expired byte capability');
});

test('an expired unfinished upload renews for the same image and a lost renewal response reuses that persisted request', async (t) => {
  const environment = await recoveryEnvironment(t);
  const initialClient = environment.client();
  const initial = await pendingRecord(initialClient, environment.disk);
  const oldResponse = suspendResponse(environment, ({ request }) => request.url.endsWith('/v1/uploads'));
  void initialClient.uploads.uploadRecord(initial.id);
  const originalTicket = (await oldResponse).response.data;
  environment.advance(16 * 60 * 1000);
  const reopened = environment.client();
  let renewal;
  environment.deliver = (exchange) => {
    if (exchange.request.url.endsWith('/v1/uploads') && exchange.response.data.uploadId !== originalTicket.uploadId) {
      renewal = exchange;
      exchange.request.fail(new Error('response lost'));
      return false;
    }
    return true;
  };
  assert.deepEqual(await reopened.uploads.uploadRecord(initial.id), { ok: false, error: 'network-unavailable' });
  assert.ok(renewal, 'the server issued one fresh ticket after confirming the old ticket was expired');
  const waiting = environment.client().records.getRecord(initial.id).record;
  assert.deepEqual(waiting.images[0].requests, initial.images[0].requests);
  assert.equal(waiting.images[0].localOriginalPath, initial.images[0].localOriginalPath);
  assert.equal(waiting.images[0].assetId, null);
  const renewalKey = renewal.request.header['Idempotency-Key'];
  assert.notEqual(renewalKey, initial.images[0].requests.upload);
  environment.deliver = () => true;
  const retry = environment.client();
  assert.equal((await retry.uploads.uploadRecord(initial.id)).ok, true);
  const saved = retry.records.getRecord(initial.id).record;
  assert.equal(saved.images[0].uploadTicket.uploadId, renewal.response.data.uploadId);
  assert.equal(saved.contextId, initial.contextId);
  assert.equal(saved.images[0].id, initial.images[0].id);
  assert.equal(saved.images[0].uploadState, 'uploaded');
  assert.equal(saved.images[0].original.saveState, 'saved');
  const claims = environment.exchanges.filter(({ request }) => request.url.endsWith('/v1/uploads'));
  assert.deepEqual([...new Set(claims.map(({ response }) => response.data.uploadId))], [originalTicket.uploadId, renewal.response.data.uploadId]);
  assert.equal(claims.at(-1).request.header['Idempotency-Key'], renewalKey);
  assert.equal(environment.exchanges.some(({ request }) => request.url.endsWith('/v1/jobs')), false);
});

test('native recent and result pages identify interrupted uploads in five languages and only the retry action resumes the same image', async (t) => {
  const environment = await recoveryEnvironment(t);
  const first = environment.client();
  const initial = await pendingRecord(first, environment.disk);
  const stopped = suspendResponse(environment, ({ request }) => request.url.includes('/_uploads/'));
  void first.uploads.uploadRecord(initial.id);
  await stopped;
  const reopened = environment.client();
  const load = nativePages(t, reopened);
  const result = load('result'); result.onLoad({ recordId: initial.id });
  const index = load('index');
  const before = environment.exchanges.length;
  for (const [language, paused, retry] of [
    ['en', 'Upload interrupted', 'Continue upload'], ['ja', 'アップロード中断', 'アップロードを再開'],
    ['ko', '업로드 중단', '업로드 계속'], ['es', 'Subida interrumpida', 'Continuar subida'], ['zh-CN', '上传中断', '继续上传']
  ]) {
    reopened.application.chooseLanguage(language);
    result.onShow(); index.onShow();
    assert.equal(result.data.processingLabel, paused);
    assert.equal(index.data.recentRecords[0].processingLabel, paused);
    assert.equal(result.data.uploadInterrupted, true);
    assert.equal(result.data.canRetryUpload, true);
    assert.equal(result.data.uploadCopy.retryUpload, retry);
    assert.ok(result.data.uploadCopy.interruptedBody);
    assert.equal(result.data.originalsSaved, true);
    result.onHide();
  }
  environment.reconnect();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(environment.exchanges.length, before);
  result.onShow();
  const resumed = suspendResponse(environment, ({ request, response }) => request.url.endsWith('/complete') && response.statusCode === 200);
  const action = result.retryUpload();
  const held = await resumed;
  assert.equal(result.data.uploadResuming, true);
  assert.equal(result.data.processingLabel, '恢复上传中');
  assert.equal(result.data.canRetryUpload, false);
  held.request.success(held.response);
  assert.equal((await action).ok, true);
  assert.equal(result.data.record.id, initial.id);
  assert.equal(result.data.currentImage.id, initial.images[0].id);
  assert.equal(result.data.uploadState, 'uploaded');
  assert.equal(result.data.canRetryUpload, false);
  result.onUnload();
});

test('saving a renewal failure is visible independently and blocks new upload requests until the state can be saved', async (t) => {
  const environment = await recoveryEnvironment(t);
  const initialClient = environment.client();
  const initial = await pendingRecord(initialClient, environment.disk);
  const stopped = suspendResponse(environment, ({ request }) => request.url.includes('/_uploads/'));
  void initialClient.uploads.uploadRecord(initial.id);
  await stopped;
  environment.advance(16 * 60 * 1000);
  const write = environment.disk.storage.set;
  environment.deliver = ({ response }) => {
    if (response.data && response.data.code === 'UPLOAD_EXPIRED') environment.disk.storage.set = () => { throw new Error('disk full'); };
    return true;
  };
  const reopened = environment.client();
  assert.deepEqual(await reopened.uploads.uploadRecord(initial.id), { ok: false, error: 'storage-write' });
  const load = nativePages(t, reopened);
  const result = load('result'); result.onLoad({ recordId: initial.id }); result.onShow();
  assert.equal(result.data.uploadLocalFailure, true);
  assert.equal(result.data.saveLabel, 'Not saved');
  assert.equal(result.data.originalsSaved, true);
  assert.equal(result.data.canRetryUpload, true);
  assert.equal(environment.exchanges.filter(({ request }) => request.url.endsWith('/v1/uploads')).length, 1,
    'a new claim requires a saved renewal association');
  environment.disk.storage.set = write;
  environment.deliver = () => true;
  assert.equal((await result.retryUpload()).ok, true);
  assert.equal(result.data.uploadLocalFailure, false);
  assert.equal(result.data.saveLabel, 'Saved on this device');
  result.onUnload();
});

test('a missing saved original shows a replacement prompt in every language and cannot silently restart an upload', async (t) => {
  const environment = await recoveryEnvironment(t);
  const first = environment.client();
  const initial = await pendingRecord(first, environment.disk);
  const stopped = suspendResponse(environment, ({ request }) => request.url.endsWith('/v1/uploads'));
  void first.uploads.uploadRecord(initial.id);
  await stopped;
  fs.unlinkSync(initial.images[0].localOriginalPath);
  const reopened = environment.client();
  const load = nativePages(t, reopened);
  const result = load('result'); result.onLoad({ recordId: initial.id });
  const before = environment.exchanges.length;
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    reopened.application.chooseLanguage(language);
    result.onShow();
    assert.equal(result.data.uploadState, 'failed');
    assert.equal(result.data.uploadOriginalMissing, true);
    assert.equal(result.data.canRetryUpload, false);
    assert.equal(result.data.currentImage.original.error, 'original-missing');
    assert.ok(result.data.recordCopy.missingOriginal);
    assert.equal((await result.retryUpload()).ok, false);
    result.onHide();
  }
  assert.deepEqual(await reopened.uploads.uploadRecord(initial.id), { ok: false, error: 'original-missing' });
  assert.equal(environment.exchanges.length, before);
  assert.equal(reopened.records.getRecord(initial.id).record.id, initial.id);
});

test('a byte transfer crossing the ticket expiry cannot be committed after renewal becomes possible', async (t) => {
  const environment = await recoveryEnvironment(t);
  const client = environment.client();
  const initial = await pendingRecord(client, environment.disk);
  const stopped = suspendResponse(environment, ({ request }) => request.url.endsWith('/v1/uploads'));
  void client.uploads.uploadRecord(initial.id);
  const ticket = (await stopped).response.data;
  const bytes = fs.readFileSync(initial.images[0].localOriginalPath);
  const half = Math.floor(bytes.length / 2);
  let transfer;
  environment.observeRequest = (request) => {
    if (!request.url.startsWith('/_uploads/')) return;
    request.once('data', () => {
      environment.advance(16 * 60 * 1000);
      transfer.end(bytes.subarray(half));
    });
  };
  const response = await new Promise((resolve, reject) => {
    transfer = http.request(ticket.uploadUrl, { method: ticket.uploadMethod, headers: ticket.uploadHeaders }, (result) => {
      let body = '';
      result.on('data', (chunk) => { body += chunk; });
      result.on('end', () => resolve({ status: result.statusCode, body: body ? JSON.parse(body) : null }));
    });
    transfer.on('error', reject);
    transfer.write(bytes.subarray(0, half));
  });
  assert.equal(response.status, 410);
  assert.equal(response.body.code, 'UPLOAD_EXPIRED');
});

test('completion rechecks ticket expiry after decoding before it can create an asset', async (t) => {
  const environment = await recoveryEnvironment(t);
  const sharp = require('sharp');
  const filename = path.join(environment.disk.root, 'large-original.png');
  await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#f0eadf' } }).png().toFile(filename);
  const client = environment.client();
  const initial = await pendingRecord(client, environment.disk, { localPath: filename, sizeBytes: fs.statSync(filename).size,
    mimeType: 'image/png', width: 6000, height: 6000, orientation: 'up' });
  const stopped = suspendResponse(environment, ({ request }) => request.url.includes('/_uploads/'));
  void client.uploads.uploadRecord(initial.id);
  await stopped;
  const image = environment.client().records.getRecord(initial.id).record.images[0];
  environment.observeRequest = (request) => {
    if (!request.url.endsWith('/complete')) return;
    // The HTTP body is complete before advancing the external clock; decoding is asynchronous.
    request.once('end', () => setImmediate(() => environment.advance(16 * 60 * 1000)));
  };
  await assert.rejects(client.backend.completeUpload(image.uploadTicket.uploadId,
    { contextId: initial.contextId, imageId: image.id }, image.requests.complete), (error) => error.code === 'UPLOAD_EXPIRED');
  environment.observeRequest = null;
  const reopened = environment.client();
  assert.equal((await reopened.uploads.uploadRecord(initial.id)).ok, true);
  const saved = reopened.records.getRecord(initial.id).record;
  assert.notEqual(saved.images[0].uploadTicket.uploadId, image.uploadTicket.uploadId);
  assert.equal(saved.images[0].uploadState, 'uploaded');
  const assets = environment.exchanges.filter(({ request, response }) => request.url.endsWith('/complete') && response.statusCode === 200);
  assert.equal(new Set(assets.map(({ response }) => response.data.assetId)).size, 1);
});

test('a failed final local status save resumes the already bound snapshot without publishing a duplicate version', async (t) => {
  const environment = await recoveryEnvironment(t);
  const client = environment.client();
  const initial = await pendingRecord(client, environment.disk);
  const write = environment.disk.storage.set;
  environment.disk.storage.set = (key, entry) => {
    if (Array.isArray(entry.value) && entry.value.some((record) => record.id === initial.id && record.images[0].uploadState === 'uploaded')) {
      throw new Error('device storage is full');
    }
    write(key, entry);
  };
  assert.deepEqual(await client.uploads.uploadRecord(initial.id), { ok: false, error: 'storage-write' });
  const before = environment.client().records.getRecord(initial.id).record;
  assert.equal(before.contextSnapshotVersion, 2);
  assert.ok(before.images[0].assetId);
  environment.disk.storage.set = write;
  const reopened = environment.client();
  assert.equal((await reopened.uploads.uploadRecord(initial.id)).ok, true);
  const saved = reopened.records.getRecord(initial.id).record;
  assert.equal(saved.contextSnapshotVersion, 2);
  assert.equal(saved.images[0].assetId, before.images[0].assetId);
  assert.equal(saved.images[0].uploadState, 'uploaded');
});

test('an original read failure retains a truthful missing-material prompt when the upload error is reopened', async (t) => {
  const environment = await recoveryEnvironment(t);
  const client = environment.client();
  const initial = await pendingRecord(client, environment.disk);
  environment.disk.fileSystem.readFile = ({ fail }) => fail(new Error('original is inaccessible'));
  assert.deepEqual(await client.uploads.uploadRecord(initial.id), { ok: false, error: 'original-missing' });
  const reopened = environment.client();
  const load = nativePages(t, reopened);
  const result = load('result'); result.onLoad({ recordId: initial.id }); result.onShow();
  assert.equal(result.data.uploadOriginalMissing, true);
  assert.equal(result.data.canRetryUpload, false);
  assert.equal(result.data.uploadState, 'failed');
  assert.ok(result.data.recordCopy.missingOriginal);
  result.onUnload();
});
