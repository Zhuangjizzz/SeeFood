const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary } = require('./support/http-service');
async function batch(disk, name, target = { kind: 'new' }) {
  const capture = createCapture({ media: { chooseImages: async () => [disk.material(name)] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album', target }); return capture.confirm().batch;
}
async function setup(t, options = {}) {
  const { createService } = await import('../server/service.ts');
  let time = Date.now(); const directory = temporary(t);
  const server = createService({ dataDir: directory, enableDevSession: true, devIdentities: ['demo-owner-a'], now: () => time, contextRetentionMs: 10000, ...options });
  await new Promise(resolve => server.server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const disk = recordPlatform(t); const traffic = []; let online = true;
  disk.platform.getNetworkType = ({ success }) => success({ networkType: online ? 'wifi' : 'none' });
  disk.platform.request = options => {
    traffic.push({ method: options.method, url: options.url, data: structuredClone(options.data) });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async response => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const backend = { enabled: true, baseUrl: `http://127.0.0.1:${server.server.address().port}`, identity: 'demo-owner-a' };
  const services = createWechatServices(disk.platform, { backend });
  const capture = await batch(disk, 'menu-photo.png');
  const id = (await services.records.confirmCapture(capture)).recordId;
  assert.equal((await services.imageBatches.startBatch(id, capture.id)).ok, true);
  assert.equal((await services.chat.sendQuickQuestion(id, 'communicate')).ok, true);
  return { server, disk, backend, services, id, traffic, expire() { time += 10001; server.retention.sweep(); },
    advance(milliseconds) { time += milliseconds; server.retention.sweep(); }, offline(value) { online = !value; } };
}

test('expired history stays readable offline; an explicit new question rebuilds from saved text without changing old record, cards, messages or images', async t => {
  const app = await setup(t); const { disk, backend, services, id, traffic } = app;
  const before = services.records.getRecord(id).record; const translated = fs.readFileSync(before.images[0].translation.localPath);
  app.expire(); app.offline(true); const start = traffic.length;
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.records.getRecord(id).record, before);
  assert.deepEqual(reopened.chat.getState(id).messages, before.messages);
  assert.equal((await reopened.chat.refreshRecord(id)).ok, true);
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
  assert.equal(traffic.length, start);
  app.offline(false); await reopened.network.refresh();
  const sent = await reopened.chat.sendQuickQuestion(id, 'explain'); assert.equal(sent.ok, true, JSON.stringify(sent));
  const after = reopened.records.getRecord(id).record;
  assert.notEqual(after.contextId, before.contextId); assert.equal(after.id, before.id);
  assert.ok(after.contextIds.includes(before.contextId));
  assert.deepEqual(after.cards, before.cards); assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
  assert.deepEqual(after.messageIds.slice(0, before.messageIds.length), before.messageIds);
  assert.deepEqual(fs.readFileSync(after.images[0].translation.localPath), translated);
  const newOperations = traffic.slice(start).filter(item => item.method === 'POST');
  assert.equal(newOperations.filter(item => item.data?.kind === 'chat').length, 1);
  assert.equal(newOperations.filter(item => item.url.endsWith('/v1/uploads') || ['image_cards', 'image_translation'].includes(item.data?.kind)).length, 0);
  assert.equal(reopened.chat.applyJob(id, { ...before.chatJobs[before.messages.at(-1).id], revision: 999 }).ok, false);
});

test('appending after temporary expiry rebuilds the same record and uploads only the new image; old saved content survives offline', async t => {
  const app = await setup(t); const { disk, backend, services, id, traffic } = app;
  const before = services.records.getRecord(id).record;
  const bytes = fs.readFileSync(before.images[0].translation.localPath);
  app.expire(); const start = traffic.length;
  const addition = await batch(disk, 'menu-screenshot.png', { kind: 'append', recordId: id });
  assert.equal((await services.records.confirmCapture(addition)).ok, true);
  const processed = await services.imageBatches.startBatch(id, addition.id);
  assert.equal(processed.ok, true, JSON.stringify(processed));
  const after = services.records.getRecord(id).record;
  assert.equal(after.id, before.id); assert.notEqual(after.contextId, before.contextId);
  assert.deepEqual(after.imageIds, [...before.imageIds, addition.images[0].id]);
  assert.deepEqual(after.cards.slice(0, before.cards.length), before.cards);
  assert.deepEqual(after.messages, before.messages); assert.deepEqual(after.images[0].translation, before.images[0].translation);
  assert.deepEqual(fs.readFileSync(after.images[0].translation.localPath), bytes);
  const operations = traffic.slice(start).filter(item => item.method === 'POST');
  assert.deepEqual(operations.filter(item => item.url.endsWith('/v1/uploads')).map(item => item.data.imageId), [addition.images[0].id]);
  assert.deepEqual(operations.filter(item => item.data?.kind?.startsWith('image_')).map(item => item.data.target.imageId), [addition.images[0].id, addition.images[0].id]);
  app.offline(true); const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.records.getRecord(id).record, after);
  assert.equal(reopened.records.listHistory().records.length, 1);
  assert.equal(reopened.jobs.applyJob(id, { ...before.images[0].stageJobs.image_cards, revision: 999 }).ok, false);
});

for (const renewal of [false, true]) test(`a ${renewal ? 'renewed' : 'new'} upload ticket delivered after concurrent context rebuilding cannot poison the appended image or its explicit retry`, async t => {
  const app = await setup(t, renewal ? { contextRetentionMs: 30 * 60 * 1000 } : {}); const { disk, services, id } = app;
  const addition = await batch(disk, 'menu-screenshot.png', { kind: 'append', recordId: id });
  assert.equal((await services.records.confirmCapture(addition)).ok, true);
  const send = disk.platform.request; let release; let received;
  if (renewal) {
    disk.platform.request = options => options.method === 'PUT' && options.url.includes('/_uploads/') ? options.fail(new Error('network lost before bytes')) : send(options);
    assert.equal((await services.uploads.uploadRecord(id, addition.images[0].id)).error, 'network-unavailable');
    disk.platform.request = send;
    app.advance(15 * 60 * 1000 + 1);
  }
  const arrived = new Promise(resolve => { received = resolve; });
  disk.platform.request = options => {
    if (options.method === 'POST' && options.url.endsWith('/v1/uploads')) {
      const success = options.success;
      options.success = response => { release = () => success(response); received(response); };
      disk.platform.request = send;
    }
    send(options);
  };
  const oldWork = services.imageBatches.startBatch(id, addition.id);
  const delivered = await arrived; assert.equal(delivered.statusCode, 201);
  const oldContextId = services.records.getRecord(id).record.contextId;
  if (renewal) app.advance(15 * 60 * 1000); else app.expire();
  assert.equal((await services.chat.sendQuickQuestion(id, 'explain')).ok, true);
  const rebuilt = services.records.getRecord(id).record;
  assert.notEqual(rebuilt.contextId, oldContextId);
  release(); assert.equal((await oldWork).error, 'stale-job');
  assert.deepEqual(services.records.getRecord(id).record.images, rebuilt.images);
  const retried = await services.imageBatches.retryUploads(id, addition.images[0].id);
  assert.equal(retried.ok, true, JSON.stringify(retried));
  const after = services.records.getRecord(id).record;
  assert.equal(after.contextId, rebuilt.contextId);
  assert.equal(after.images[1].uploadState, 'uploaded');
  assert.equal(after.images[1].stageJobs.image_cards.state, 'succeeded');
  assert.equal(after.images[1].stageJobs.image_translation.state, 'succeeded');
  assert.deepEqual(after.messages, rebuilt.messages);
  assert.deepEqual(after.cards.slice(0, rebuilt.cards.length), rebuilt.cards);
});

test('a record without saved dish text uploads its required original for a new question, and a missing original asks for replacement', async t => {
  const app = await setup(t, { mockScenario: 'no-cards' }); const { services, disk, id, traffic } = app;
  const before = services.records.getRecord(id).record; assert.deepEqual(before.cards, []);
  app.expire(); const start = traffic.length;
  const sent = await services.chat.sendQuickQuestion(id, 'explain'); assert.equal(sent.ok, true, JSON.stringify(sent));
  const uploads = traffic.slice(start).filter(item => item.method === 'POST' && item.url.endsWith('/v1/uploads'));
  assert.deepEqual(uploads.map(item => item.data.imageId), before.imageIds);
  assert.equal(traffic.slice(start).filter(item => item.method === 'POST' && item.data?.kind?.startsWith('image_')).length, 0);
  app.expire(); fs.unlinkSync(before.images[0].localOriginalPath);
  const latest = services.records.getRecord(id).record; const boundary = traffic.length;
  const missing = await services.chat.sendQuickQuestion(id, 'explain');
  assert.deepEqual(missing, { ok: false, error: 'rebuild-material-missing' });
  assert.equal(services.records.getRecord(id).record.contextId, latest.contextId);
  assert.deepEqual(services.records.getRecord(id).record.messageIds, latest.messageIds);
  assert.equal(traffic.slice(boundary).filter(item => item.method === 'POST' || item.method === 'PUT').length, 0);
});

test('an expired failed image retry creates only its selected stage in a new context and rejects old delivery', async t => {
  const app = await setup(t); const { services, id, traffic } = app;
  const before = services.records.getRecord(id).record; const image = before.images[0];
  // Material expiry is observed by a task lookup at the public HTTP boundary.
  app.expire(); const expired = await services.backend.getJob(image.stageJobs.image_translation.jobId);
  assert.equal(services.jobs.applyJob(id, expired).ok, true);
  assert.equal(services.jobs.getStageState(id, image.id, 'image_translation').canRetry, true);
  const start = traffic.length; const retried = await services.jobs.retryStage(id, image.id, 'image_translation');
  assert.equal(retried.ok, true, JSON.stringify(retried));
  const after = services.records.getRecord(id).record;
  assert.notEqual(after.contextId, before.contextId);
  assert.equal(after.images[0].stageJobs.image_translation.state, 'succeeded');
  assert.notEqual(after.images[0].stageJobs.image_translation.jobId, expired.jobId);
  assert.deepEqual(after.cards, before.cards); assert.deepEqual(after.messages, before.messages);
  assert.equal(traffic.slice(start).filter(item => item.method === 'POST' && item.data?.kind === 'image_cards').length, 0);
  assert.equal(services.jobs.applyJob(id, { ...image.stageJobs.image_translation, revision: 999 }).ok, false);
});

test('explicit retry after a partial reply expires preserves its question and reply IDs while rejecting the old task', async t => {
  const app = await setup(t, { mockScenario: 'chat-partial-failure', chatPartialDelayMs: 10 });
  const { services, id, traffic } = app; const before = services.records.getRecord(id).record;
  const reply = before.messages.at(-1); const oldJob = before.chatJobs[reply.id];
  assert.equal(reply.state, 'failed'); assert.ok(reply.text);
  app.expire(); const start = traffic.length;
  const retried = await services.chat.retryReply(id, reply.id); assert.equal(retried.ok, true, JSON.stringify(retried));
  const after = services.records.getRecord(id).record;
  assert.deepEqual(after.messageIds, before.messageIds); assert.equal(after.messages.length, before.messages.length);
  assert.notEqual(after.contextId, before.contextId); assert.notEqual(after.chatJobs[reply.id].jobId, oldJob.jobId);
  assert.equal(after.chatRequests[reply.id].request.input.text, before.chatRequests[reply.id].request.input.text);
  assert.equal(after.chatRequests[reply.id].snapshot.snapshot.preferences.version, before.chatRequests[reply.id].snapshot.snapshot.preferences.version);
  assert.equal(services.chat.applyJob(id, { ...oldJob, revision: 999 }).ok, false);
  assert.equal(traffic.slice(start).filter(item => item.method === 'POST' && item.data?.kind === 'chat').length, 1);
  assert.equal(traffic.slice(start).filter(item => item.url.endsWith('/v1/uploads')).length, 0);
});

test('an unconfirmed question is never regenerated on expired reentry; explicit continuation rebuilds that same saved pair', async t => {
  const app = await setup(t); const { services, disk, id, traffic, backend } = app;
  const send = disk.platform.request;
  disk.platform.request = options => options.method === 'POST' && options.data?.kind === 'chat' ? options.fail(new Error('offline before acceptance')) : send(options);
  assert.equal((await services.chat.send(id, 'Keep this exact question')).error, 'network-unavailable');
  const saved = services.records.getRecord(id).record; const replyId = saved.messages.at(-1).id;
  disk.platform.request = send; app.expire(); const start = traffic.length;
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal((await reopened.chat.refreshRecord(id)).error, 'CONTEXT_EXPIRED');
  assert.equal(traffic.slice(start).filter(item => item.method === 'PUT' || item.method === 'POST').length, 0);
  assert.equal(reopened.chat.getState(id).running, false);
  const continued = await reopened.chat.continueSubmission(id, replyId); assert.equal(continued.ok, true, JSON.stringify(continued));
  const after = reopened.records.getRecord(id).record;
  assert.deepEqual(after.messageIds, saved.messageIds); assert.equal(after.messages.at(-2).text, 'Keep this exact question');
  assert.equal(after.messages.at(-1).state, 'complete'); assert.notEqual(after.contextId, saved.contextId);
});

test('rebuild metadata failure leaves the old identity and draft intact; lost new-context acceptance reuses its durable identity after recreation', async t => {
  const app = await setup(t); const { services, disk, id, traffic, backend } = app;
  services.chat.editDraft(id, 'Preserve this draft');
  const original = services.records.getRecord(id).record;
  app.expire(); const write = disk.storage.set; const start = traffic.length;
  disk.storage.set = (key, value) => { if (key.endsWith(':records')) throw new Error('ENOSPC'); return write(key, value); };
  assert.equal((await services.chat.sendDraft(id)).error, 'storage-write'); disk.storage.set = write;
  assert.equal(services.records.getRecord(id).record.contextId, original.contextId);
  assert.equal(services.chat.getState(id).draft.text, 'Preserve this draft');
  assert.equal(traffic.slice(start).filter(item => item.method === 'PUT' || item.method === 'POST').length, 0);
  const send = disk.platform.request; let lost;
  disk.platform.request = options => {
    if (!lost && options.method === 'PUT') { lost = { url: options.url, body: structuredClone(options.data) }; options.success = () => options.fail(new Error('new context response lost')); }
    send(options);
  };
  assert.equal((await services.chat.sendDraft(id)).error, 'network-unavailable');
  const pending = services.records.getRecord(id).record;
  assert.notEqual(pending.contextId, original.contextId); assert.deepEqual(pending.messageIds, original.messageIds);
  disk.platform.request = send;
  const reopened = createWechatServices(disk.platform, { backend }); const resume = traffic.length;
  assert.equal((await reopened.chat.sendDraft(id)).ok, true);
  const firstPut = traffic.slice(resume).find(item => item.method === 'PUT');
  assert.equal(firstPut.url, lost.url); assert.deepEqual(firstPut.data, lost.body);
  assert.equal(reopened.records.getRecord(id).record.contextId, pending.contextId);
  assert.equal(reopened.records.getRecord(id).record.messages.at(-2).text, 'Preserve this draft');
  assert.equal(reopened.chat.getState(id).draft.text, '');
});

function nativePage(t, services, name) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, previous)); let definition; const routes = [];
  global.getApp = () => ({ services }); global.getCurrentPages = () => [1, 2];
  global.wx = { setNavigationBarTitle() {}, setTabBarItem() {}, pageScrollTo() {}, navigateTo({ url }) { routes.push(url); } };
  global.Page = value => { definition = value; };
  const file = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[file]; require(file);
  return { ...definition, routes, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
}

test('native chat and result show five-language missing-material recovery and open the existing record append sheet', async t => {
  const app = await setup(t, { mockScenario: 'no-cards' }); const { services, id, traffic } = app;
  app.expire(); fs.unlinkSync(services.records.getRecord(id).record.images[0].localOriginalPath);
  assert.equal((await services.chat.send(id, 'Please explain')).error, 'rebuild-material-missing');
  const chat = nativePage(t, services, 'chat'); chat.onLoad({ recordId: id });
  const before = traffic.length;
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); chat.show();
    assert.equal(chat.data.needsMaterial, true); assert.equal(chat.data.errorText, chat.data.expirationCopy.missing);
    assert.ok(chat.data.expirationCopy.addPhotos.length); chat.addPhotos();
    assert.equal(chat.routes.at(-1), `/pages/result/result?recordId=${encodeURIComponent(id)}&addPhotos=1`);
  }
  assert.equal(traffic.length, before);
  const result = nativePage(t, services, 'result'); result.onLoad({ recordId: id, addPhotos: '1' });
  result.onShow(); assert.equal(result.data.showAppendInput, true); assert.equal(result.data.record.id, id); result.onUnload();
});

test('result and detail reentry keep an unstarted dietary check read-only after expiry and language changes until an explicit check', async t => {
  const app = await setup(t); const { services, disk, backend, id, traffic } = app;
  app.offline(true); await services.network.refresh();
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg');
  assert.equal(services.preferences.save().ok, true);
  assert.equal((await services.dietaryReview.startRecord(id)).error, 'network-unavailable');
  const before = services.records.getRecord(id).record; app.expire(); app.offline(false);
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.dietaryReview.getState(id).canStart, true);
  const result = nativePage(t, reopened, 'result'); result.onLoad({ recordId: id });
  const detail = nativePage(t, reopened, 'dish-detail'); detail.onLoad({ recordId: id, cardId: before.cardIds[0] });
  const dietaryPage = require('../miniprogram/ui/dietary'); const boundary = traffic.length;
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    reopened.application.chooseLanguage(language); result.onShow(); detail.onShow();
    await dietaryPage.refresh(id);
    for (let count = 0; reopened.dietaryReview.getState(id).running && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(reopened.dietaryReview.getState(id).running, false);
    assert.equal(detail.data.dietary.assessment.state, 'pending');
    assert.equal(reopened.records.getRecord(id).record.contextId, before.contextId);
    result.onHide(); detail.onHide();
  }
  assert.equal(traffic.slice(boundary).filter(item => ['PUT', 'POST'].includes(item.method)).length, 0);
  assert.deepEqual(reopened.records.getRecord(id).record.cards, before.cards);
  assert.equal((await detail.checkDietary()).ok, true);
  assert.notEqual(reopened.records.getRecord(id).record.contextId, before.contextId);
  assert.equal(reopened.dietaryReview.getState(id).assessments[before.cardIds[0]].state, 'current');
  result.onUnload(); detail.onUnload();
});

test('a saved current dietary assessment remains current across context rebuilding, while a new preference check uses the new context', async t => {
  const app = await setup(t); const { services, id, traffic } = app;
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg'); services.preferences.save();
  assert.equal((await services.dietaryReview.startRecord(id)).ok, true);
  const before = services.records.getRecord(id).record; const cardId = before.cardIds[0];
  assert.equal(services.dietaryReview.getState(id).assessments[cardId].state, 'current');
  app.expire(); const start = traffic.length;
  assert.equal((await services.chat.sendQuickQuestion(id, 'explain')).ok, true);
  const preserved = services.dietaryReview.getState(id);
  assert.equal(preserved.assessments[cardId].state, 'current'); assert.equal(preserved.canStart, false);
  assert.deepEqual(services.records.getRecord(id).record.dietaryAssessments, before.dietaryAssessments);
  assert.equal(traffic.slice(start).filter(item => item.method === 'POST' && item.data?.kind === 'dietary_review').length, 0);
  app.expire(); services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'peanut'); services.preferences.save();
  const reviewed = await services.dietaryReview.startRecord(id); assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  assert.equal(services.dietaryReview.getState(id).assessments[cardId].preferencesVersion, services.preferences.getSnapshot().version);
});

test('new independent text and card-draft translations continue after temporary expiry without erasing saved sides or draft identity', async t => {
  const app = await setup(t); const { services, traffic } = app;
  services.textExchange.edit('visitor', 'No peanuts'); assert.equal((await services.textExchange.submit('visitor')).ok, true);
  const prior = services.textExchange.getState();
  services.cardDrafts.beginNew(); services.cardDrafts.edit({ text: 'Could you bring water?' });
  assert.equal((await services.cardDrafts.translate()).ok, true); const draft = services.cardDrafts.getState().draft;
  app.expire(); const start = traffic.length;
  assert.equal((await services.textExchange.refresh()).ok, true); assert.equal((await services.cardDrafts.refresh()).ok, true);
  assert.equal(traffic.length, start);
  services.textExchange.edit('staff', '没有花生');
  const exchange = await services.textExchange.submit('staff'); assert.equal(exchange.ok, true, JSON.stringify(exchange));
  const after = services.textExchange.getState();
  assert.deepEqual(after.sides.visitor.result, prior.sides.visitor.result); assert.notEqual(after.contextId, prior.contextId);
  services.cardDrafts.edit({ text: 'Could you bring warm water?' });
  const translated = await services.cardDrafts.translate(); assert.equal(translated.ok, true, JSON.stringify(translated));
  const next = services.cardDrafts.getState().draft; assert.equal(next.cardId, draft.cardId); assert.notEqual(next.contextId, draft.contextId);
  assert.equal(next.text, 'Could you bring warm water?'); assert.equal(services.cardDrafts.getState().canSave, true);
});

test('an old upload finishing after context rebuilding cannot replace the new context or its pending image association', async t => {
  const app = await setup(t); const { services, disk, id } = app;
  const added = await batch(disk, 'menu-screenshot.png', { kind: 'append', recordId: id }); await services.records.confirmCapture(added);
  const send = disk.platform.request; let release; let ready;
  const waiting = new Promise(resolve => { ready = resolve; });
  disk.platform.request = options => {
    if (options.method === 'PUT' && options.url.includes('/_uploads/')) { release = () => send(options); ready(); }
    else send(options);
  };
  const uploading = services.uploads.uploadRecord(id, added.images[0].id); await waiting;
  app.expire(); assert.equal((await services.chat.sendQuickQuestion(id, 'explain')).ok, true);
  const rebuilt = services.records.getRecord(id).record;
  assert.equal(rebuilt.images[1].uploadState, 'pending');
  release(); await uploading;
  const after = services.records.getRecord(id).record;
  assert.equal(after.contextId, rebuilt.contextId); assert.equal(after.images[1].assetId, null);
  assert.equal(after.images[1].uploadState, 'pending');
  disk.platform.request = send;
  assert.equal((await services.imageBatches.retryUploads(id, added.images[0].id)).ok, true);
});

test('an explicitly retried dietary check can rebuild expired inputs without changing the saved preference or dish identity', async t => {
  const app = await setup(t, { mockScenario: 'dietary-failure' }); const { services, id } = app;
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg'); services.preferences.save();
  await services.dietaryReview.startRecord(id);
  const before = services.records.getRecord(id).record; const old = services.dietaryReview.getState(id).jobs[0]; assert.equal(old.state, 'failed');
  app.expire(); const retried = await services.dietaryReview.retry(id); assert.equal(retried.ok, true, JSON.stringify(retried));
  const after = services.records.getRecord(id).record; const current = services.dietaryReview.getState(id).jobs[0];
  assert.notEqual(after.contextId, before.contextId); assert.notEqual(current.jobId, old.jobId);
  assert.deepEqual(current.target, old.target); assert.deepEqual(after.cards, before.cards);
});

test('a delayed expiry response for an old context cannot mark a rebuilt context unavailable', async t => {
  const app = await setup(t); const { services, disk, id } = app; const send = disk.platform.request;
  const added = await batch(disk, 'menu-screenshot.png', { kind: 'append', recordId: id }); await services.records.confirmCapture(added);
  disk.platform.request = options => {
    if (options.method === 'POST' && options.data?.kind === 'image_cards') options.success = () => options.fail(new Error('accepted response lost'));
    send(options);
  };
  await services.imageBatches.startBatch(id, added.id); disk.platform.request = send;
  app.expire(); let release; let ready; const waiting = new Promise(resolve => { ready = resolve; });
  disk.platform.request = options => {
    if (!release && options.method === 'GET' && /\/contexts\/.+\/jobs/.test(options.url)) {
      const success = options.success; options.success = result => { release = () => success(result); ready(); };
    }
    send(options);
  };
  const oldRefresh = services.jobs.refreshRecord(id); await waiting;
  assert.equal((await services.chat.sendQuickQuestion(id, 'explain')).ok, true);
  const before = services.records.getRecord(id).record; release(); await oldRefresh;
  const after = services.records.getRecord(id).record;
  assert.equal(after.contextId, before.contextId); assert.equal(after.contextUnavailable, undefined); assert.equal(services.jobs.getState(id).error, null);
  disk.platform.request = send;
});
