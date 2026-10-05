const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');
async function setup(t, env, kind = 'menu') {
  const disk = recordPlatform(t); const server = await start(t, temporary(t), env);
  const traffic = []; const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => {
    traffic.push({ url: options.url, method: options.method, data: options.data });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'ja' });
  capture.chooseMode(kind);
  await capture.chooseImages({ source: 'album' }); const saved = await services.records.confirmCapture(capture.confirm().batch);
  assert.equal((await services.uploads.uploadRecord(saved.recordId)).ok, true);
  return { disk, services, backend, id: saved.recordId, traffic, server };
}

test('the public image job operation stores full cards and reopens the original record with no duplicate work', async (t) => {
  const { disk, services, backend, id, traffic } = await setup(t);
  const before = services.records.getRecord(id).record;
  const result = await services.jobs.startImageCards(id);
  assert.equal(result.ok, true);
  const reopened = createWechatServices(disk.platform, { backend }); const record = reopened.records.getRecord(id).record;
  assert.equal(record.id, id); assert.equal(record.images[0].id, before.images[0].id);
  const job = record.images[0].stageJobs.image_cards;
  assert.equal(job.contextSnapshotVersion, 2); assert.equal(job.state, 'succeeded');
  assert.equal(job.locallySavedRevision, job.revision);
  assert.deepEqual(record.cardIds, record.cards.map((card) => card.id));
  assert.equal(record.cards[0].recordId, id); assert.deepEqual(record.cards[0].sourceImageIds, [before.images[0].id]);
  assert.equal(record.cards[0].contentLanguage, 'ja'); assert.equal(record.cards[0].price.amount, '28');
  assert.ok(record.cards[0].details.length >= 6); assert.ok(record.cards[0].uncertainty.length > 0);
  const requests = traffic.length;
  assert.equal((await reopened.jobs.startImageCards(id)).ok, true);
  assert.equal(traffic.length, requests);
  assert.deepEqual(reopened.records.getRecord(id).record.images[0].original, before.images[0].original);
});
module.exports = { setup };

test('late or foreign image results cannot replace a saved card or advance an unrequested attempt', async (t) => {
  const { services, id } = await setup(t); await services.jobs.startImageCards(id);
  const saved = services.records.getRecord(id).record; const job = saved.images[0].stageJobs.image_cards;
  for (const change of [
    (value) => { value.attempt += 1; value.revision += 1; },
    (value) => { value.jobId = 'another-job'; value.revision += 1; },
    (value) => { value.output.cards[0].recordId = 'foreign-record'; value.revision += 1; },
    (value) => { value.output.cards[0].sourceImageIds = ['foreign-image']; value.revision += 1; },
    (value) => { value.revision -= 1; }
  ]) {
    const stale = structuredClone(job); change(stale);
    assert.equal(services.jobs.applyJob(id, stale).ok, false);
    assert.deepEqual(services.records.getRecord(id).record.cards, saved.cards);
  }
});

test('local result write failure preserves originals and previous cards and can save the delivered result without generation', async (t) => {
  const { disk, services, id, traffic } = await setup(t);
  const original = services.records.getRecord(id).record.images[0].original;
  const write = disk.storage.set; const send = disk.platform.request;
  disk.platform.request = (options) => {
    if (options.method === 'GET' && options.url.includes('/v1/jobs/')) {
      const success = options.success; options.success = (response) => {
        if (response.data.state === 'succeeded') disk.storage.set = () => { throw new Error('disk full'); };
        success(response);
      };
    }
    send(options);
  };
  assert.deepEqual(await services.jobs.startImageCards(id), { ok: false, error: 'storage-write' });
  assert.equal(services.jobs.getState(id).unsavedJob.state, 'succeeded');
  assert.deepEqual(services.records.getRecord(id).record.images[0].original, original);
  assert.equal(services.records.getRecord(id).record.cards, undefined);
  disk.storage.set = write; const before = traffic.length;
  assert.equal(services.jobs.retrySave(id).ok, true);
  assert.equal(traffic.length, before); assert.equal(services.records.getRecord(id).record.cards.length, 1);
});

test('native results show source cards, full details and original-image return while language changes preserve generated text', async (t) => {
  const { services, id, traffic } = await setup(t); await services.jobs.startImageCards(id);
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages }; t.after(() => Object.assign(global, old));
  let navigation; let returned = false;
  global.getApp = () => ({ services }); global.getCurrentPages = () => [{}, {}];
  global.wx = { setNavigationBarTitle() {}, navigateTo(value) { navigation = value.url; }, navigateBack() { returned = true; } };
  function load(name) {
    let definition; global.Page = (value) => { definition = value; }; const file = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[file]; require(file);
    return { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  }
  const result = load('result'); result.onLoad({ recordId: id }); result.onShow();
  assert.equal(result.data.dishCards.length, 1);
  const card = result.data.dishCards[0]; const text = card.summary;
  result.openDish({ currentTarget: { dataset: { id: card.id } } });
  assert.match(navigation, /dish-detail/);
  const detail = load('dish-detail'); detail.onLoad({ recordId: id, cardId: card.id }); detail.onShow();
  assert.equal(detail.data.card.details.length, 6); assert.ok(detail.data.card.uncertainty.length);
  detail.viewOriginal(); assert.match(navigation, /\/pages\/image-reader\/image-reader\?/);
  assert.equal(services.imageView.open(id).path, services.records.getRecord(id).record.images[0].localOriginalPath);
  const before = traffic.length;
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); result.onShow(); detail.onShow();
    assert.equal(result.data.dishCards[0].summary, text); assert.equal(detail.data.card.summary, text);
    assert.ok(result.data.dishCopy.unknownPrice); assert.ok(detail.data.dishCopy.details);
  }
  detail.back(); assert.equal(returned, true); result.onUnload(); assert.equal(traffic.length, before);
});

test('a lost creation response can be explicitly recovered with the saved request and original job identity', async (t) => {
  const { services, disk, id, backend } = await setup(t); const send = disk.platform.request; let accepted;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) {
      options.success = (response) => { accepted = response.data; options.fail(new Error('response lost')); };
    }
    send(options);
  };
  assert.equal((await services.jobs.startImageCards(id)).ok, false);
  const pending = services.records.getRecord(id).record;
  assert.equal(pending.images[0].stageJobs.image_cards, null);
  assert.equal(pending.images[0].jobRequests.image_cards.input.contextSnapshotVersion, 2);
  disk.platform.request = send;
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal((await reopened.jobs.startImageCards(id)).ok, true);
  const saved = reopened.records.getRecord(id).record;
  assert.equal(saved.images[0].stageJobs.image_cards.jobId, accepted.jobId); assert.equal(saved.cards.length, 1);
});

test('native unknown-price, empty and uncertain-dish states use the actual stored result without borrowing another image', async (t) => {
  for (const scenario of ['unknown-price', 'no-cards', 'dish']) {
    const { services, id } = await setup(t, { SEEFOOD_MOCK_SCENARIO: scenario }, scenario === 'dish' ? 'dish' : 'menu'); await services.jobs.startImageCards(id);
    const old = { Page: global.Page, wx: global.wx, getApp: global.getApp }; t.after(() => Object.assign(global, old));
    global.getApp = () => ({ services }); global.wx = { setNavigationBarTitle() {} };
    let definition; global.Page = (value) => { definition = value; }; const file = require.resolve('../miniprogram/pages/result/result'); delete require.cache[file]; require(file);
    const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
    page.onLoad({ recordId: id }); page.onShow();
    if (scenario === 'no-cards') { assert.deepEqual(page.data.dishCards, []); assert.equal(page.data.cardsJob.state, 'succeeded'); assert.ok(page.data.dishCopy.noCards); }
    else if (scenario === 'dish') { assert.equal(page.data.dishCards[0].uncertainIdentity, true); assert.equal(page.data.dishCards[0].price.amount, null); assert.equal(page.data.dishCards[0].displayName, 'Dish not identified'); }
    else { assert.equal(page.data.dishCards[0].priceLabel, 'Price unknown'); assert.equal(page.data.dishCards[0].price.amount, null); assert.equal(page.data.dishCards[0].priceRaw, '时价'); }
    page.onUnload();
  }
});

test('a late progress response cannot erase newer displayed cards when result storage is full', async (t) => {
  const { disk, services, id } = await setup(t); const send = disk.platform.request; const write = disk.storage.set;
  disk.platform.request = (options) => {
    if (options.method === 'GET' && options.url.includes('/v1/jobs/')) {
      const success = options.success; options.success = (response) => {
        if (response.data.state === 'succeeded') disk.storage.set = () => { throw new Error('disk full'); };
        success(response);
      };
    }
    send(options);
  };
  assert.equal((await services.jobs.startImageCards(id)).error, 'storage-write');
  const ready = services.jobs.getState(id).unsavedJob;
  const late = { ...ready, state: 'running', revision: ready.revision - 1, output: null };
  assert.deepEqual(services.jobs.applyJob(id, late), { ok: false, error: 'stale-job' });
  assert.deepEqual(services.jobs.getState(id).unsavedJob, ready);
  disk.storage.set = write;
  assert.equal(services.jobs.retrySave(id).ok, true);
  assert.deepEqual(services.records.getRecord(id).record.cards, ready.output.cards);
});
