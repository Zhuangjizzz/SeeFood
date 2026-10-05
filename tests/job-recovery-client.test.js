const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start, request, session, finished } = require('./support/http-service');

async function setup(t, env = {}) {
  const disk = recordPlatform(t); const directory = temporary(t); const service = await start(t, directory, env);
  const traffic = []; const backend = { enabled: true, baseUrl: service.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => {
    traffic.push({ method: options.method, url: options.url, data: structuredClone(options.data) });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'ja' });
  await capture.chooseImages({ source: 'album' }); const saved = await services.records.confirmCapture(capture.confirm().batch);
  assert.equal((await services.uploads.uploadRecord(saved.recordId)).ok, true);
  return { disk, directory, service, services, backend, traffic, id: saved.recordId };
}

function pageFor(services, id, t) {
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp }; t.after(() => Object.assign(global, old));
  global.getApp = () => ({ services }); global.wx = { setNavigationBarTitle() {} };
  let definition; global.Page = (value) => { definition = value; };
  const filename = require.resolve('../miniprogram/pages/result/result'); delete require.cache[filename]; require(filename);
  const page = { ...definition, data: { ...definition.data }, setData(data) { Object.assign(this.data, data); } };
  page.onLoad({ recordId: id }); t.after(() => page.onUnload()); return page;
}

test('page reentry recovers a lost acceptance response across a killed HTTP process and recreated client', async (t) => {
  const { disk, directory, service, services, backend, id, traffic } = await setup(t, { SEEFOOD_WORKER_DELAY_MS: '10000' });
  const send = disk.platform.request; let accepted;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) options.success = (result) => { accepted = result.data; options.fail(new Error('acceptance response lost')); };
    send(options);
  };
  assert.equal((await services.jobs.startImageCards(id)).ok, false);
  const pending = services.records.getRecord(id).record;
  assert.equal(pending.images[0].stageJobs.image_cards, null);
  assert.equal(pending.images[0].jobRequests.image_cards.input.contextSnapshotVersion, 2);
  await service.stop('SIGKILL');
  const restarted = await start(t, directory); backend.baseUrl = restarted.url; disk.platform.request = send;
  const reopened = createWechatServices(disk.platform, { backend }); const page = pageFor(reopened, id, t);
  page.onShow(); assert.equal(page.data.canLeave, false);
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
  const recovered = reopened.records.getRecord(id).record;
  assert.equal(recovered.images[0].stageJobs.image_cards.jobId, accepted.jobId);
  assert.equal(recovered.images[0].stageJobs.image_cards.state, 'succeeded');
  assert.equal(recovered.images[0].stageJobs.image_cards.attempt, 1);
  assert.equal(recovered.cards[0].price.amount, '28'); assert.equal(recovered.cards[0].contentLanguage, 'ja');
  assert.equal(recovered.id, pending.id); assert.deepEqual(recovered.imageIds, pending.imageIds);
  assert.deepEqual(recovered.images[0].original, pending.images[0].original);
  assert.equal(fs.existsSync(recovered.images[0].localOriginalPath), true);
  assert.equal(page.data.canLeave, true); assert.equal(page.data.dishCards.length, 1);
  assert.equal(traffic.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/v1/jobs')).length, 1);
  const token = await session(restarted.url);
  const listed = await request(restarted.url, 'GET', `/v1/contexts/${recovered.contextId}/jobs`, undefined, token);
  assert.deepEqual(listed.body.items.map((job) => job.jobId), [accepted.jobId]);
  const again = createWechatServices(disk.platform, { backend });
  assert.deepEqual(again.records.getRecord(id).record.cards, recovered.cards);
  assert.equal(again.records.listRecent().records.length, 1);
});

test('a completed recovery result interrupted by local saving remains recoverable after client recreation', async (t) => {
  const { disk, service, services, backend, id } = await setup(t);
  const send = disk.platform.request; let accepted;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) options.success = (result) => { accepted = result.data; options.fail(new Error('acceptance response lost')); };
    send(options);
  };
  assert.equal((await services.jobs.startImageCards(id)).ok, false); disk.platform.request = send;
  await finished(service.url, await session(service.url), accepted.jobId);
  const write = disk.storage.set;
  disk.storage.set = (key, value) => {
    if (Array.isArray(value.value) && value.value.some((record) => record.cards && record.cards.length)) throw new Error('disk full');
    write(key, value);
  };
  const first = createWechatServices(disk.platform, { backend });
  assert.equal((await first.jobs.refreshRecord(id)).error, 'storage-write');
  assert.equal(first.jobs.getState(id).unsavedJob.state, 'succeeded');
  disk.storage.set = write;
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
  const record = reopened.records.getRecord(id).record;
  assert.equal(record.cards.length, 1);
  assert.equal(record.images[0].stageJobs.image_cards.jobId, accepted.jobId);
  assert.equal(record.images[0].stageJobs.image_cards.locallySavedRevision, record.images[0].stageJobs.image_cards.revision);
});

test('reopening a failed task retains the original and failure without starting a retry or a new generation', async (t) => {
  const { disk, services, backend, id, traffic } = await setup(t, { SEEFOOD_MOCK_SCENARIO: 'failure' });
  assert.equal((await services.jobs.startImageCards(id)).ok, true);
  const before = services.records.getRecord(id).record;
  assert.equal(before.images[0].stageJobs.image_cards.state, 'failed');
  const requestCount = traffic.length;
  const reopened = createWechatServices(disk.platform, { backend }); const page = pageFor(reopened, id, t);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    reopened.application.chooseLanguage(language); page.onShow();
    assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
    assert.equal(page.data.cardsStateLabel, page.data.dishCopy.failed);
    assert.equal(page.data.currentImage.original.saveState, 'saved');
  }
  assert.equal(traffic.length, requestCount);
  assert.deepEqual(reopened.records.getRecord(id).record.images[0].stageJobs, before.images[0].stageJobs);
  assert.equal(reopened.records.getRecord(id).record.cards, undefined);
});

test('unknown acceptance is explained in five languages and progress can be checked again without resubmission', async (t) => {
  const { disk, services, backend, id, traffic } = await setup(t);
  const send = disk.platform.request;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) options.success = () => options.fail(new Error('acceptance response lost'));
    send(options);
  };
  assert.equal((await services.jobs.startImageCards(id)).ok, false);
  disk.platform.request = (options) => options.fail(new Error('offline'));
  const reopened = createWechatServices(disk.platform, { backend }); const page = pageFor(reopened, id, t);
  const labels = { en: 'Checking processing status', ja: '処理の受付状況を確認中', ko: '처리 접수 상태 확인 중', es: 'Comprobando el estado del procesamiento', 'zh-CN': '正在确认处理状态' };
  for (const [language, label] of Object.entries(labels)) {
    reopened.application.chooseLanguage(language); page.onShow(); await reopened.jobs.refreshRecord(id);
    assert.equal(page.data.cardsAcceptancePending, true);
    assert.equal(page.data.cardsStateLabel, label); assert.equal(page.data.canLeave, false);
    assert.equal(page.data.cardsReadFailed, true);
    assert.equal(page.data.currentImage.original.saveState, 'saved');
  }
  disk.platform.request = send;
  assert.equal((await page.retryProgress()).ok, true);
  assert.equal(page.data.cardsAcceptancePending, false); assert.equal(page.data.dishCards.length, 1);
  assert.equal(traffic.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/v1/jobs')).length, 1);
});

test('a late initial acceptance response cannot replace the newer result already recovered under the same task ID', async (t) => {
  const { disk, services, id } = await setup(t);
  const send = disk.platform.request; let release; let received;
  const responseReady = new Promise((resolve) => { received = resolve; });
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) {
      const success = options.success; options.success = (result) => { release = () => success(result); received(); };
    }
    send(options);
  };
  const original = services.jobs.startImageCards(id); await responseReady;
  assert.equal((await services.jobs.refreshRecord(id)).ok, true);
  const saved = services.records.getRecord(id).record.images[0].stageJobs.image_cards;
  assert.equal(saved.state, 'succeeded');
  const observed = [];
  const unsubscribe = services.jobs.subscribe(() => observed.push(services.records.getRecord(id).record.images[0].stageJobs.image_cards.revision));
  release(); assert.equal((await original).ok, true); unsubscribe();
  assert.ok(observed.every((revision) => revision >= saved.revision), JSON.stringify(observed));
  assert.deepEqual(services.records.getRecord(id).record.images[0].stageJobs.image_cards, saved);
});
