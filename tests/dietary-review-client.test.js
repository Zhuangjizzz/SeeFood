const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');
async function setup(t, env = {}) {
  const disk = recordPlatform(t); const directory = temporary(t); const server = await start(t, directory, env); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => {
    traffic.push({ method: options.method, url: options.url, data: structuredClone(options.data), key: options.header?.['Idempotency-Key'] });
    fetch(options.url, { method: options.method, headers: options.header, body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async response => { const value = await response.text(); options.success({ statusCode: response.status, data: value ? JSON.parse(value) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' }); const saved = await services.records.confirmCapture(capture.confirm().batch);
  await services.uploads.uploadRecord(saved.recordId); await services.jobs.startImageCards(saved.recordId);
  return { services, id: saved.recordId, disk, server, traffic, backend, directory };
}
test('saved preferences immediately invalidate old dish assessments and complete an independent durable review without changing dish explanations', async t => {
  const { services, id, disk, backend, traffic } = await setup(t, { SEEFOOD_MOCK_SCENARIO: 'dietary-conflict' });
  const cards = services.records.getRecord(id).record.cards;
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg');
  assert.equal(services.dietaryReview.getState(id).assessments[cards[0].id].preferencesVersion, 1);
  assert.equal(traffic.filter(item => item.data?.kind === 'dietary_review').length, 0);
  assert.equal(services.preferences.save().ok, true);
  assert.equal(services.dietaryReview.getState(id).assessments[cards[0].id].state, 'pending');
  assert.equal((await services.dietaryReview.startRecord(id)).ok, true);
  const current = services.dietaryReview.getState(id).assessments[cards[0].id];
  assert.equal(current.state, 'current'); assert.equal(current.preferencesVersion, 2); assert.equal(current.concern, 'conflict');
  assert.match(current.warnings[0], /egg/); assert.deepEqual(services.records.getRecord(id).record.cards, cards);
  const reopened = createWechatServices(disk.platform, { backend }); const before = traffic.length;
  assert.deepEqual(reopened.dietaryReview.getState(id).assessments[cards[0].id], current);
  assert.equal((await reopened.dietaryReview.refreshRecord(id)).ok, true); assert.equal(traffic.length, before);
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg'); services.preferences.toggleOption('allergies', 'soy');
  const write = disk.storage.set; disk.storage.set = () => { throw Error('full'); };
  assert.equal(services.preferences.save().ok, false); assert.equal(services.dietaryReview.getState(id).assessments[cards[0].id].state, 'current');
  disk.storage.set = write; services.preferences.cancelEdit();
});
module.exports = { setup };

test('explicit multi-image submission checks newly generated cards against already saved preferences without opening a page', async t => {
  const { services, disk, id } = await setup(t);
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg'); services.preferences.save();
  assert.equal((await services.dietaryReview.startRecord(id)).ok, true);
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png'), disk.material('menu-screenshot.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' }); const batch = capture.confirm().batch;
  const saved = await services.records.confirmCapture(batch);
  assert.equal((await services.imageBatches.startBatch(saved.recordId, batch.id)).ok, true);
  const record = services.records.getRecord(saved.recordId).record;
  assert.equal(record.cards.length, 2);
  const state = services.dietaryReview.getState(saved.recordId);
  assert.equal(state.pending, false);
  for (const card of record.cards) assert.equal(state.assessments[card.id].preferencesVersion, services.preferences.getSnapshot().version);
});

test('late old-preference delivery cannot overwrite newer saved hints, and pending editing never mutates the original cards', async t => {
  const { services, id, disk } = await setup(t); const send = disk.platform.request; let release; let received;
  const arrived = new Promise(resolve => { received = resolve; });
  disk.platform.request = options => {
    if (options.method === 'POST' && options.data?.kind === 'dietary_review' && options.data.target.preferencesVersion === 2) {
      const success = options.success; options.success = value => { release = () => success(value); received(); };
    }
    send(options);
  };
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg'); services.preferences.save();
  const oldWork = services.dietaryReview.startRecord(id); await arrived;
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg'); services.preferences.toggleOption('restrictions', 'halal'); services.preferences.save();
  assert.equal((await services.dietaryReview.startRecord(id)).ok, true);
  const before = services.dietaryReview.getState(id); release(); assert.equal((await oldWork).ok, false);
  assert.deepEqual(services.dietaryReview.getState(id).assessments, before.assessments);
  const cardId = services.records.getRecord(id).record.cards[0].id;
  assert.equal(before.assessments[cardId].preferencesVersion, 3); assert.match(before.assessments[cardId].warnings.join(' '), /certification/);
  const record = services.records.getRecord(id).record; const job = Object.values(record.dietaryReviews).find(entry => entry.job?.state === 'succeeded').job;
  for (const change of [value => value.jobId = 'other', value => value.attempt++, value => value.output.assessments[0].cardId = 'foreign-card',
    value => value.output.assessments[0].preferencesVersion = 1, value => value.output.assessments.push(structuredClone(value.output.assessments[0])), value => value.contextId = 'foreign-context']) {
    const bad = structuredClone(job); bad.revision++; change(bad); assert.equal(services.dietaryReview.applyJob(id, bad).ok, false);
    assert.deepEqual(services.dietaryReview.getState(id).assessments, before.assessments);
  }
});

test('failed checks remain pending for the current version after reopen and successful hints survive local save failure without re-generation', async t => {
  const failed = await setup(t, { SEEFOOD_MOCK_SCENARIO: 'dietary-failure' });
  failed.services.preferences.beginEdit(); failed.services.preferences.toggleOption('restrictions', 'vegan'); failed.services.preferences.save();
  await failed.services.dietaryReview.startRecord(failed.id);
  const state = failed.services.dietaryReview.getState(failed.id); const cardId = Object.keys(state.assessments)[0];
  assert.equal(state.assessments[cardId].state, 'failed'); assert.equal(state.pending, true); assert.equal(state.canRetry, true);
  const reopened = createWechatServices(failed.disk.platform, { backend: failed.backend }); const before = failed.traffic.length;
  await reopened.dietaryReview.refreshRecord(failed.id); assert.equal(failed.traffic.length, before); assert.equal(reopened.dietaryReview.getState(failed.id).assessments[cardId].state, 'failed');
  const ready = await setup(t); const send = ready.disk.platform.request; const write = ready.disk.storage.set;
  ready.disk.platform.request = options => {
    if (options.method === 'GET' && options.url.includes('/v1/jobs/')) {
      const success = options.success; options.success = response => { if (response.data.kind === 'dietary_review' && response.data.state === 'succeeded') ready.disk.storage.set = () => { throw Error('full'); }; success(response); };
    }
    send(options);
  };
  ready.services.preferences.beginEdit(); ready.services.preferences.toggleOption('allergies', 'soy'); ready.services.preferences.save();
  assert.equal((await ready.services.dietaryReview.startRecord(ready.id)).error, 'storage-write');
  assert.equal(ready.services.dietaryReview.getState(ready.id).unsavedJob.state, 'succeeded');
  assert.equal(ready.services.history.describe(ready.services.records.getRecord(ready.id).record).saveState, 'failed');
  ready.disk.storage.set = write; const requests = ready.traffic.length;
  assert.equal(ready.services.dietaryReview.retrySave(ready.id).ok, true); assert.equal(ready.traffic.length, requests);
  assert.equal(ready.services.dietaryReview.getState(ready.id).unsavedJob, null);
  const saved = createWechatServices(ready.disk.platform, { backend: ready.backend }).dietaryReview.getState(ready.id);
  assert.equal(Object.values(saved.assessments)[0].state, 'current');
});

test('result and detail Pages expose current warnings and localized pending state while leaving card explanations unchanged in every interface language', async t => {
  const { services, id } = await setup(t); const card = services.records.getRecord(id).record.cards[0];
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages }; t.after(() => Object.assign(global, old));
  global.getApp = () => ({ services }); global.getCurrentPages = () => [{}, {}]; global.wx = { setNavigationBarTitle() {}, pageScrollTo() {} };
  const load = name => { let definition; global.Page = value => { definition = value; }; const file = require.resolve('../miniprogram/pages/' + name + '/' + name); delete require.cache[file]; require(file); return { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } }; };
  const result = load('result'); result.onLoad({ recordId: id }); const detail = load('dish-detail'); detail.onLoad({ recordId: id, cardId: card.id });
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); result.onShow(); detail.onShow();
    assert.equal(detail.data.dietary.assessment.state, 'pending'); assert.ok(detail.data.dietary.assessment.stateLabel);
    assert.equal(result.data.dishCards[0].dietary.state, 'pending');
  }
  services.application.chooseLanguage('en');
  services.preferences.beginEdit(); services.preferences.toggleOption('restrictions', 'kosher'); services.preferences.save();
  await services.dietaryReview.startRecord(id);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); result.onShow(); detail.onShow();
    assert.equal(detail.data.dietary.assessment.state, 'current'); assert.ok(detail.data.dietary.copy.title);
    assert.equal(detail.data.card.summary, card.summary); assert.deepEqual(detail.data.card.details, card.details);
    assert.match(detail.data.dietary.assessment.warnings.join(' '), /certification/);
    assert.equal(result.data.dishCards[0].dietary.state, 'current');
  }
  result.onUnload(); detail.onUnload();
});

test('reopening recovers an accepted lost response by GET only, while a never-delivered request needs explicit same-key continuation', async t => {
  for (const delivered of [true, false]) {
    const { services, id, disk, backend, directory, server, traffic } = await setup(t, { SEEFOOD_WORKER_DELAY_MS: '700' });
    const send = disk.platform.request; let accepted; let original;
    disk.platform.request = options => {
      if (options.method === 'POST' && options.data?.kind === 'dietary_review') {
        original = { request: structuredClone(options.data), key: options.header['Idempotency-Key'] };
        if (!delivered) return options.fail(Error('offline before delivery'));
        options.success = response => { accepted = response.data; options.fail(Error('response lost')); };
      }
      send(options);
    };
    services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'milk'); services.preferences.save();
    assert.equal((await services.dietaryReview.startRecord(id)).error, 'network-unavailable');
    await server.stop('SIGKILL'); const restarted = await start(t, directory); backend.baseUrl = restarted.url; disk.platform.request = send;
    const reopened = createWechatServices(disk.platform, { backend }); const offset = traffic.length;
    assert.equal((await reopened.dietaryReview.refreshRecord(id)).ok, true);
    assert.equal(traffic.slice(offset).filter(item => item.method === 'POST' && item.url.endsWith('/v1/jobs')).length, 0);
    if (delivered) {
      const entry = Object.values(reopened.records.getRecord(id).record.dietaryReviews)[0];
      assert.equal(entry.job.jobId, accepted.jobId); assert.equal(entry.job.state, 'succeeded');
    } else {
      assert.equal(reopened.dietaryReview.getState(id).canContinue, true);
      assert.equal((await reopened.dietaryReview.continueSubmission(id)).ok, true);
      const sent = traffic.slice(offset).find(item => item.method === 'POST' && item.url.endsWith('/v1/jobs'));
      assert.deepEqual(sent.data, original.request); assert.equal(sent.key, original.key);
      assert.equal(Object.values(reopened.dietaryReview.getState(id).assessments)[0].state, 'current');
    }
  }
});

test('explicit failed-check retry retains frozen preference inputs and a late result cannot recreate a deleted record', async t => {
  const value = await setup(t, { SEEFOOD_MOCK_SCENARIO: 'dietary-failure' });
  const { services, id, disk, backend, directory, traffic } = value;
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'soy'); services.preferences.save();
  await services.dietaryReview.startRecord(id);
  const first = Object.values(services.records.getRecord(id).record.dietaryReviews)[0];
  await value.server.stop(); const server = await start(t, directory); backend.baseUrl = server.url;
  const reopened = createWechatServices(disk.platform, { backend }); const before = traffic.length;
  assert.equal((await reopened.dietaryReview.retry(id)).ok, true);
  const next = Object.values(reopened.records.getRecord(id).record.dietaryReviews)[0];
  assert.equal(next.job.jobId, first.job.jobId); assert.equal(next.job.attempt, 2); assert.deepEqual(next.request, first.request);
  assert.equal(traffic.slice(before).filter(item => item.url.endsWith('/v1/jobs') && item.method === 'POST').length, 0);
  assert.equal(traffic.slice(before).filter(item => item.url.endsWith('/retry') && item.method === 'POST').length, 1);
  const send = disk.platform.request; let release; let mark; const waiting = new Promise(resolve => { mark = resolve; });
  disk.platform.request = options => {
    if (options.method === 'POST' && options.data?.kind === 'dietary_review') {
      const success = options.success; options.success = response => { release = () => success(response); mark(); };
    }
    send(options);
  };
  reopened.preferences.beginEdit(); reopened.preferences.toggleOption('allergies', 'egg'); reopened.preferences.save();
  const work = reopened.dietaryReview.startRecord(id); await waiting;
  assert.equal(reopened.records.markDeleted([id]).ok, true); assert.equal(reopened.records.finishDeletion(id).ok, true);
  release(); assert.equal((await work).ok, false);
  assert.equal(reopened.records.getRecord(id).ok, false);
  assert.equal(reopened.dietaryReview.getState(id).unsavedJob, null);
  assert.equal(createWechatServices(disk.platform, { backend }).records.getRecord(id).ok, false);
});

test('a late network failure for an older preference version cannot replace the current successful check status', async t => {
  const { services, id, disk } = await setup(t); const send = disk.platform.request; let rejectOld; let mark;
  const waiting = new Promise(resolve => { mark = resolve; });
  disk.platform.request = options => {
    if (options.method === 'POST' && options.data?.kind === 'dietary_review' && options.data.target.preferencesVersion === 2) {
      rejectOld = () => options.fail(Error('old offline response')); mark(); return;
    }
    send(options);
  };
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg'); services.preferences.save();
  const oldWork = services.dietaryReview.startRecord(id); await waiting;
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg'); services.preferences.toggleOption('restrictions', 'halal'); services.preferences.save();
  assert.equal((await services.dietaryReview.startRecord(id)).ok, true); rejectOld(); await oldWork;
  assert.equal(services.dietaryReview.getState(id).error, null);
  assert.equal(Object.values(services.dietaryReview.getState(id).assessments)[0].state, 'current');
});
