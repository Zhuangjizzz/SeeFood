const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');
async function setup(t, env = { SEEFOOD_MOCK_SCENARIO: 'translation-failure' }, names = ['menu-photo.png']) {
  const disk = recordPlatform(t); const directory = temporary(t); const server = await start(t, directory, env); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => { traffic.push({ method: options.method, url: options.url, body: options.data, key: options.header['Idempotency-Key'] });
    fetch(options.url, { method: options.method, headers: options.header, body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const data = await response.text(); options.success({ statusCode: response.status, data: data ? JSON.parse(data) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const capture = createCapture({ media: { chooseImages: async () => names.map((name) => disk.material(name)) }, getLanguage: () => 'ja' });
  capture.chooseMode('menu'); await capture.chooseImages({ source: 'album' });
  const saved = await services.records.confirmCapture(capture.confirm().batch); assert.equal(saved.ok, true);
  const id = saved.recordId; const imageId = services.records.getRecord(id).record.images[0].id;
  for (const image of services.records.getRecord(id).record.images) assert.equal((await services.uploads.uploadRecord(id, image.id)).ok, true);
  return { disk, directory, server, backend, services, traffic, id, imageId };
}

test('retrying only the failed translation keeps successful cards and original and saves the new attempt before offline reentry', async (t) => {
  const { disk, directory, server, backend, services, traffic, id, imageId } = await setup(t);
  await services.jobs.startImageProcessing(id);
  const before = services.records.getRecord(id).record; const failed = before.images[0].stageJobs.image_translation;
  assert.equal(failed.state, 'failed');
  await server.stop(); const restarted = await start(t, directory); backend.baseUrl = restarted.url;
  assert.equal((await services.jobs.retryStage(id, imageId, 'image_translation')).ok, true);
  const after = services.records.getRecord(id).record; const image = after.images[0];
  assert.equal(image.stageJobs.image_translation.attempt, 2); assert.ok(image.stageJobs.image_translation.revision > failed.revision);
  assert.equal(image.translation.saveState, 'saved'); assert.ok(fs.statSync(image.translation.localPath).size > 0);
  assert.deepEqual(after.cards, before.cards); assert.deepEqual(image.stageJobs.image_cards, before.images[0].stageJobs.image_cards);
  assert.deepEqual(image.original, before.images[0].original); assert.equal(image.translation.contentLanguage, 'ja');
  assert.equal(services.jobs.applyJob(id, { ...failed, revision: 1000 }).error, 'stale-job');
  assert.equal(services.jobs.applyJob(id, { ...image.stageJobs.image_translation, jobId: 'old-job', revision: 1001 }).error, 'stale-job');
  assert.equal((await services.jobs.retryStage(id, imageId, 'image_cards')).error, 'JOB_STATE_CONFLICT');
  assert.equal(traffic.filter((x) => x.method === 'POST' && x.url.endsWith('/retry')).length, 1);
  assert.equal(traffic.filter((x) => x.method === 'POST' && x.url.endsWith('/v1/jobs')).length, 2);
  await restarted.stop();
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.records.getRecord(id).record.cards, before.cards);
  assert.equal(reopened.imageView.open(id, imageId).translationAvailable, true);
});

test('lost retry acceptance survives a fresh client and GET-only recovery without repeating the failed stage', async (t) => {
  const { disk, directory, server, backend, services, traffic, id, imageId } = await setup(t);
  await services.jobs.startImageProcessing(id); await server.stop();
  const restarted = await start(t, directory, { SEEFOOD_WORKER_DELAY_MS: '300' }); backend.baseUrl = restarted.url;
  const send = disk.platform.request; let accepted;
  disk.platform.request = (options) => {
    if (options.url.endsWith('/retry')) options.success = (result) => { accepted = result.data; options.fail(new Error('reply lost')); };
    send(options);
  };
  assert.equal((await services.jobs.retryStage(id, imageId, 'image_translation')).error, 'network-unavailable');
  assert.equal(accepted.attempt, 2);
  disk.platform.request = send;
  const reopened = createWechatServices(disk.platform, { backend }); const mark = traffic.length;
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
  const image = reopened.records.getRecord(id).record.images[0];
  assert.equal(image.stageJobs.image_translation.jobId, accepted.jobId); assert.equal(image.stageJobs.image_translation.attempt, 2);
  assert.equal(image.translation.saveState, 'saved');
  assert.equal(traffic.slice(mark).filter((x) => x.method === 'POST').length, 0);
});

test('a never-delivered first stage request stays pending on reopen; explicit continuation proves absence and reuses its frozen body and key', async (t) => {
  const { disk, backend, services, traffic, id, imageId } = await setup(t, {});
  await services.jobs.startImageCards(id); const cards = services.records.getRecord(id).record.cards;
  const send = disk.platform.request; let dropped;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) { dropped = { body: options.data, key: options.header['Idempotency-Key'] }; options.fail(new Error('never reached server')); return; }
    send(options);
  };
  assert.equal((await services.jobs.startImageTranslation(id)).error, 'network-unavailable');
  disk.platform.request = send; const reopened = createWechatServices(disk.platform, { backend });
  let mark = traffic.length;
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
  assert.equal(reopened.records.getRecord(id).record.images[0].stageJobs.image_translation, null);
  assert.equal(traffic.slice(mark).filter((x) => x.method === 'POST').length, 0);
  mark = traffic.length;
  assert.equal((await reopened.jobs.continueSubmission(id, imageId, 'image_translation')).ok, true);
  const posted = traffic.slice(mark).filter((x) => x.method === 'POST'); assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].body, dropped.body); assert.equal(posted[0].key, dropped.key);
  assert.ok(traffic.slice(mark).findIndex((x) => x.method === 'GET' && x.url.includes('/contexts/')) < traffic.slice(mark).indexOf(posted[0]));
  assert.deepEqual(reopened.records.getRecord(id).record.cards, cards);
  assert.equal(reopened.records.getRecord(id).record.images[0].translation.saveState, 'saved');
});

test('an undelivered retry stays failed without automatic resubmission and repeats the same persisted retry key only on user action', async (t) => {
  const { disk, directory, server, backend, services, traffic, id, imageId } = await setup(t);
  await services.jobs.startImageProcessing(id); await server.stop();
  const restarted = await start(t, directory); backend.baseUrl = restarted.url;
  const send = disk.platform.request; let dropped;
  disk.platform.request = (options) => {
    if (options.url.endsWith('/retry')) { dropped = { body: options.data, key: options.header['Idempotency-Key'] }; options.fail(new Error('offline before send')); return; }
    send(options);
  };
  assert.equal((await services.jobs.retryStage(id, imageId, 'image_translation')).ok, false);
  disk.platform.request = send;
  const reopened = createWechatServices(disk.platform, { backend }); let mark = traffic.length;
  await reopened.jobs.refreshRecord(id);
  assert.equal(reopened.records.getRecord(id).record.images[0].stageJobs.image_translation.attempt, 1);
  assert.equal(traffic.slice(mark).some((x) => x.method === 'POST'), false);
  mark = traffic.length;
  await reopened.jobs.retryStage(id, imageId, 'image_translation');
  const posted = traffic.slice(mark).filter((x) => x.url.endsWith('/retry'));
  assert.equal(posted.length, 1); assert.deepEqual(posted[0].body, dropped.body); assert.equal(posted[0].key, dropped.key);
  assert.equal(reopened.records.getRecord(id).record.images[0].translation.saveState, 'saved');
});

function resultPage(t, services) {
  const prior = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  t.after(() => Object.assign(global, prior));
  global.getApp = () => ({ services }); global.wx = { setNavigationBarTitle() {}, pageScrollTo() {} };
  let definition; global.Page = (value) => { definition = value; };
  const file = require.resolve('../miniprogram/pages/result/result'); delete require.cache[file]; require(file);
  return { ...definition, data: {}, setData(value) { Object.assign(this.data, value); } };
}

test('native result exposes only eligible target-stage actions in all five languages and double click retries once', async (t) => {
  const { disk, directory, server, backend, services, traffic, id, imageId } = await setup(t);
  await services.jobs.startImageProcessing(id); const cards = services.records.getRecord(id).record.cards;
  const page = resultPage(t, services); page.onLoad({ recordId: id }); page.onShow();
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); page.onShow();
    assert.equal(page.data.cardsRetry.canRetry, false); assert.equal(page.data.translationRetry.canRetry, true);
    assert.ok(page.data.stageCopy.retryTranslation); assert.ok(page.data.stageCopy.continueCards);
    assert.deepEqual(services.records.getRecord(id).record.cards, cards);
  }
  await server.stop(); const restarted = await start(t, directory); backend.baseUrl = restarted.url;
  const event = { currentTarget: { dataset: { id: imageId, kind: 'image_translation' } } };
  await Promise.all([page.retryImageStage(event), page.retryImageStage(event)]);
  assert.equal(page.data.translationRetry.canRetry, false); assert.equal(page.data.translationSaveLabel, '已保存到本机');
  assert.equal(traffic.filter((x) => x.url.endsWith('/retry')).length, 1);
  page.onUnload();
});

test('both stage kinds retry independently in a multi-image record while a fully successful neighbour remains byte-for-byte usable', async (t) => {
  for (const [scenario, kind] of [['translation-failure', 'image_translation'], ['failure', 'image_cards']]) {
    const { disk, directory, server, backend, services, traffic, id, imageId } = await setup(t, { SEEFOOD_MOCK_SCENARIO: scenario }, ['menu-photo.png', 'menu-long.png']);
    const neighbourId = services.records.getRecord(id).record.images[1].id;
    await services.jobs.startImageProcessing(id, imageId); await server.stop();
    const restarted = await start(t, directory); backend.baseUrl = restarted.url;
    await services.jobs.startImageProcessing(id, neighbourId);
    const before = services.records.getRecord(id).record; const neighbour = before.images[1];
    const neighbourBytes = fs.readFileSync(neighbour.translation.localPath);
    const page = resultPage(t, services); page.onLoad({ recordId: id }); page.onShow();
    assert.equal(page.data.imageStates[0][kind === 'image_cards' ? 'cardsRetry' : 'translationRetry'].canRetry, true);
    assert.equal(page.data.imageStates[1].cardsRetry.canRetry, false); assert.equal(page.data.imageStates[1].translationRetry.canRetry, false);
    const mark = traffic.length;
    await page.retryImageStage({ currentTarget: { dataset: { id: imageId, kind } } });
    const after = services.records.getRecord(id).record;
    assert.equal(after.images[0].stageJobs[kind].attempt, 2); assert.equal(after.images[0].stageJobs[kind].state, 'succeeded');
    assert.deepEqual(after.images[1], neighbour); assert.deepEqual(fs.readFileSync(after.images[1].translation.localPath), neighbourBytes);
    assert.deepEqual(after.cards.filter((card) => card.sourceImageIds.includes(neighbourId)), before.cards.filter((card) => card.sourceImageIds.includes(neighbourId)));
    const otherKind = kind === 'image_cards' ? 'image_translation' : 'image_cards';
    assert.deepEqual(after.images[0].stageJobs[otherKind], before.images[0].stageJobs[otherKind]);
    assert.equal(traffic.slice(mark).filter((x) => x.method === 'POST').length, 1);
    page.onUnload();
  }
});

test('retry intent and accepted results remain recoverable when native storage rejects writes, without another generation', async (t) => {
  const { disk, directory, server, backend, services, traffic, id, imageId } = await setup(t);
  await services.jobs.startImageProcessing(id); const cards = services.records.getRecord(id).record.cards;
  const write = disk.storage.set; const send = disk.platform.request;
  disk.storage.set = () => { throw new Error('storage full before intent'); };
  let mark = traffic.length;
  assert.equal((await services.jobs.retryStage(id, imageId, 'image_translation')).error, 'storage-write');
  assert.equal(traffic.slice(mark).some((entry) => entry.url.endsWith('/retry')), false);
  disk.storage.set = write; await server.stop();
  const restarted = await start(t, directory, { SEEFOOD_WORKER_DELAY_MS: '1000' }); backend.baseUrl = restarted.url;
  disk.platform.request = (options) => {
    if (options.url.endsWith('/retry')) {
      const success = options.success; options.success = (response) => { disk.storage.set = () => { throw new Error('accepted state not saved'); }; success(response); };
    }
    send(options);
  };
  assert.equal((await services.jobs.retryStage(id, imageId, 'image_translation')).error, 'storage-write');
  assert.equal(services.history.describe(services.records.getRecord(id).record).saveState, 'failed');
  assert.deepEqual(services.records.getRecord(id).record.cards, cards);
  disk.storage.set = write; disk.platform.request = send; mark = traffic.length;
  assert.equal((await services.jobs.retryStage(id, imageId, 'image_translation')).ok, true);
  assert.equal(services.records.getRecord(id).record.images[0].translation.saveState, 'saved');
  assert.equal(traffic.slice(mark).some((entry) => entry.url.endsWith('/retry')), false);
});
