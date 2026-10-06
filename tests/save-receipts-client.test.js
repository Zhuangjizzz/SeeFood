const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');
async function setup(t) {
  const disk = recordPlatform(t); const directory = temporary(t); const server = await start(t, directory); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => {
    traffic.push({ method: options.method, path: new URL(options.url).pathname, data: options.data });
    fetch(options.url, { method: options.method, headers: options.header, body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' }); const { recordId: id } = await services.records.confirmCapture(capture.confirm().batch);
  await services.uploads.uploadRecord(id); return { disk, server, directory, traffic, backend, services, id };
}
function nativePage(t, services, name) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, previous)); let definition;
  global.getApp = () => ({ services }); global.getCurrentPages = () => [1, 2];
  global.wx = { setNavigationBarTitle() {}, setTabBarItem() {}, pageScrollTo() {} };
  global.Page = (value) => { definition = value; };
  const file = require.resolve(`../miniprogram/pages/${name}/${name}`); delete require.cache[file]; require(file);
  const callbacks = []; const page = { ...definition, data: { ...definition.data }, setData(value, callback) { Object.assign(this.data, value); if (callback) callbacks.push(callback); }, commitRendered() { callbacks.splice(0).forEach((callback) => callback()); } };
  return page;
}

test('background persisted results have no display receipt until the native page commits their presentation', async (t) => {
  const { services, id, traffic } = await setup(t);
  await services.jobs.startImageCards(id);
  assert.equal(traffic.filter((item) => item.path.endsWith('/ack')).length, 0);
  const page = nativePage(t, services, 'result'); page.onLoad({ recordId: id }); page.onShow();
  assert.equal(traffic.filter((item) => item.path.endsWith('/ack')).length, 0);
  page.commitRendered(); await services.receipts.flush();
  const job = services.records.getRecord(id).record.images[0].stageJobs.image_cards;
  const sent = traffic.filter((item) => item.path === `/v1/jobs/${job.jobId}/ack`);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].data, { appliedRevision: job.revision, locallySavedRevision: job.revision, locallySavedArtifactIds: [] });
  page.onUnload();
});

test('a real failed text write displays unsaved cards, allows selected history cleanup, retries and reopens offline', async (t) => {
  const { services, id, traffic, disk, backend, server } = await setup(t);
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-screenshot.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' }); const other = await services.records.confirmCapture(capture.confirm().batch);
  const otherOriginal = services.records.getRecord(other.recordId).record.images[0].localOriginalPath;
  const page = nativePage(t, services, 'result'); page.onLoad({ recordId: id }); page.onShow();
  const write = disk.storage.set;
  // Fail at the storage boundary when the successful generated cards arrive.
  const send = disk.platform.request; let failResults = true;
  disk.platform.request = (options) => {
    const success = options.success;
    options.success = (response) => {
      if (failResults && response.data?.kind === 'image_cards' && response.data.state === 'succeeded') {
        disk.storage.set = (key, value) => { if (key.endsWith(':records')) throw new Error('ENOSPC'); return write(key, value); };
      }
      success(response);
    };
    send(options);
  };
  assert.equal((await services.jobs.startImageCards(id)).error, 'storage-write'); page.commitRendered(); await services.receipts.flush();
  assert.equal(page.data.cardsSaveFailed, true); assert.equal(page.data.dishCards.length, 1);
  const pending = services.jobs.getState(id).unsavedJob;
  const receipt = traffic.filter((entry) => entry.path === `/v1/jobs/${pending.jobId}/ack`).at(-1).data;
  assert.equal(receipt.appliedRevision, pending.revision); assert.equal(receipt.locallySavedRevision, null);
  assert.equal(services.records.listHistory().records.length, 2);
  let route; global.wx.navigateTo = ({ url }) => { route = url; };
  page.openSaveCleanup(); assert.match(route, /history.*saveRecovery=1/); page.onHide();
  failResults = false; disk.storage.set = write; disk.platform.request = send;
  assert.equal((await services.deletions.deleteRecord(other.recordId)).ok, true); assert.equal(fs.existsSync(otherOriginal), false);
  page.onShow(); page.retryResultSave(); page.commitRendered(); await services.receipts.flush();
  assert.equal(page.data.cardsSaveFailed, false);
  assert.equal(traffic.filter((entry) => entry.path === `/v1/jobs/${pending.jobId}/ack`).at(-1).data.locallySavedRevision, pending.revision);
  const cards = services.records.getRecord(id).record.cards; page.onUnload(); await server.stop();
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.records.getRecord(id).record.cards, cards);
  assert.equal(reopened.records.listHistory().records.length, 1);
});

test('a displayed translation acknowledges structure but no image until actual failed file saving succeeds', async (t) => {
  const { services, id, traffic, disk, backend, server } = await setup(t);
  const copy = disk.fileSystem.copyFile;
  disk.fileSystem.copyFile = (options) => options.destPath.includes('/seefood-translations/') ? options.fail(new Error('ENOSPC')) : copy(options);
  assert.equal((await services.jobs.startImageTranslation(id)).error, 'translation-write');
  const page = nativePage(t, services, 'result'); page.onLoad({ recordId: id }); page.onShow(); page.commitRendered();
  const image = services.records.getRecord(id).record.images[0]; const job = image.stageJobs.image_translation;
  await services.receipts.flush();
  assert.equal(traffic.filter((entry) => entry.path === `/v1/jobs/${job.jobId}/ack`).length, 0, 'original-only display must not acknowledge bitmap');
  page.selectVariant({ currentTarget: { dataset: { variant: 'translation' } } }); page.commitRendered();
  page.presentImage({ currentTarget: { dataset: { path: page.data.imageView.path } } }); await services.receipts.flush();
  const shown = traffic.filter((entry) => entry.path === `/v1/jobs/${job.jobId}/ack`).at(-1).data;
  assert.equal(shown.locallySavedRevision, job.revision); assert.deepEqual(shown.locallySavedArtifactIds, []);
  assert.equal(page.data.translationSaveLabel, page.data.imageCopy.saveFailed);
  disk.fileSystem.copyFile = copy; await page.retryTranslationSave(); page.commitRendered();
  page.presentImage({ currentTarget: { dataset: { path: page.data.imageView.path } } }); await services.receipts.flush();
  assert.deepEqual(traffic.filter((entry) => entry.path === `/v1/jobs/${job.jobId}/ack`).at(-1).data.locallySavedArtifactIds, [image.translation.id]);
  const saved = services.records.getRecord(id).record.images[0].translation; const bytes = fs.readFileSync(saved.localPath);
  assert.ok(bytes.length); page.onUnload(); await server.stop();
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(fs.readFileSync(reopened.imageView.open(id).path), bytes);
  assert.equal(reopened.imageView.open(id).translationSaveState, 'saved');
});

test('pending truthful receipts survive client recreation and replay only acknowledgments when connectivity returns', async (t) => {
  const { services, id, disk, traffic, backend } = await setup(t); await services.jobs.startImageCards(id);
  const page = nativePage(t, services, 'result'); page.onLoad({ recordId: id }); page.onShow();
  const send = disk.platform.request; disk.platform.request = (options) => options.url.endsWith('/ack') ? options.fail(new Error('offline')) : send(options);
  page.commitRendered(); assert.equal((await services.receipts.flush()).ok, false); page.onUnload();
  const generationCount = traffic.filter((entry) => entry.path === '/v1/jobs' && entry.method === 'POST').length;
  const fresh = createWechatServices(disk.platform, { backend }); disk.platform.request = send;
  assert.equal((await fresh.receipts.flush()).ok, true);
  assert.equal(traffic.filter((entry) => entry.path === '/v1/jobs' && entry.method === 'POST').length, generationCount);
  const job = fresh.records.getRecord(id).record.images[0].stageJobs.image_cards;
  assert.equal(fresh.receipts.getState(job.jobId).entries.confirmed.locallySavedRevision, job.revision);
});

test('five language cleanup destinations preserve unsaved page state and rendered exchange and draft receipts use actual saved text', async (t) => {
  const { services, disk, traffic, backend } = await setup(t);
  services.textExchange.edit('visitor', 'Please bring water');
  await services.textExchange.submit('visitor');
  const exchange = nativePage(t, services, 'text-exchange'); exchange.onLoad(); exchange.onShow(); exchange.commitRendered(); await services.receipts.flush();
  const exchangeJob = services.textExchange.getState().sides.visitor.job;
  assert.equal(traffic.filter((entry) => entry.path === `/v1/jobs/${exchangeJob.jobId}/ack`).at(-1).data.locallySavedRevision, exchangeJob.revision);
  exchange.onUnload();
  services.cardDrafts.beginNew(); services.cardDrafts.edit({ text: 'No peanuts please' }); await services.cardDrafts.translate();
  const draft = nativePage(t, services, 'card-editor'); draft.onLoad(); draft.onShow();
  // Existing drafts require explicit continuation before the translated text is presented.
  draft.commitRendered(); await services.receipts.flush(); const draftJob = services.cardDrafts.getState().draft.job;
  assert.equal(traffic.filter((entry) => entry.path === `/v1/jobs/${draftJob.jobId}/ack`).length, 0);
  draft.continueDraft(); draft.commitRendered(); await services.receipts.flush();
  assert.equal(traffic.filter((entry) => entry.path === `/v1/jobs/${draftJob.jobId}/ack`).at(-1).data.locallySavedRevision, draftJob.revision);
  const original = services.cardDrafts.getState().draft.text;
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); draft.renderDraft(); draft.commitRendered();
    assert.ok(draft.data.saveRecoveryCopy.help); assert.ok(draft.data.saveRecoveryCopy.manage);
    let url; global.wx.navigateTo = (options) => { url = options.url; }; draft.openSaveCleanup(); assert.match(url, /saveRecovery=1/);
    assert.equal(services.cardDrafts.getState().draft.text, original);
    const history = nativePage(t, services, 'history'); history.onLoad({ saveRecovery: '1' }); history.onShow(); history.commitRendered();
    assert.equal(history.data.saveRecovery, true); assert.ok(history.data.saveRecoveryCopy.return); history.onUnload();
  }
  draft.onUnload(); await services.receipts.flush();
  const fresh = createWechatServices(disk.platform, { backend });
  assert.equal(fresh.textExchange.getState().sides.visitor.result.translation, services.textExchange.getState().sides.visitor.result.translation);
  assert.equal(fresh.cardDrafts.getState().draft.textZh, services.cardDrafts.getState().draft.textZh);
});

test('saving an already presented bitmap after the page hides updates only its durable facts', async (t) => {
  const { services, id, disk, traffic } = await setup(t); const copy = disk.fileSystem.copyFile;
  disk.fileSystem.copyFile = (options) => options.destPath.includes('/seefood-translations/') ? options.fail(new Error('ENOSPC')) : copy(options);
  await services.jobs.startImageTranslation(id);
  const page = nativePage(t, services, 'result'); page.onLoad({ recordId: id }); page.onShow();
  page.selectVariant({ currentTarget: { dataset: { variant: 'translation' } } }); page.commitRendered();
  page.presentImage({ currentTarget: { dataset: { path: page.data.imageView.path } } }); await services.receipts.flush(); page.onHide();
  const image = services.records.getRecord(id).record.images[0]; const job = image.stageJobs.image_translation;
  disk.fileSystem.copyFile = copy; await services.jobs.saveTranslation(id, image.id); await services.receipts.flush();
  const ack = traffic.filter((entry) => entry.path === `/v1/jobs/${job.jobId}/ack`).at(-1).data;
  assert.equal(ack.appliedRevision, job.revision); assert.deepEqual(ack.locallySavedArtifactIds, [image.translation.id]);
});

test('an upgraded retained directory proves a legacy job by GET before acknowledging its unchanged saved revision', async (t) => {
  const { services, id, disk, traffic, backend, server, directory } = await setup(t); await services.jobs.startImageProcessing(id);
  const before = services.records.getRecord(id).record; await server.stop('SIGKILL');
  // Migration fixture: all jobs and files were made over public HTTP. Only the
  // additive receipt tables are absent, as in a pre-receipt installation.
  const { DatabaseSync } = require('node:sqlite'); const path = require('node:path');
  const database = new DatabaseSync(path.join(directory, 'metadata.sqlite'));
  database.exec('DROP TABLE job_receipts; DROP TABLE job_deliveries;'); database.close();
  const next = await start(t, directory); backend.baseUrl = next.url;
  const fresh = createWechatServices(disk.platform, { backend }); const job = before.images[0].stageJobs.image_cards;
  const page = nativePage(t, fresh, 'result'); page.onLoad({ recordId: id }); page.onShow(); page.commitRendered();
  assert.equal((await fresh.receipts.flush()).ok, true);
  const requests = traffic.filter((entry) => entry.path.includes(job.jobId));
  assert.equal(requests.some((entry) => entry.method === 'GET'), true);
  assert.equal(requests.filter((entry) => entry.path.endsWith('/ack')).at(-1).data.locallySavedRevision, job.revision);
  assert.deepEqual(fresh.records.getRecord(id).record.cards, before.cards);
  assert.equal(fresh.records.getRecord(id).record.images[0].stageJobs.image_cards.revision, job.revision);
  assert.equal(traffic.filter((entry) => entry.method === 'POST' && entry.path === '/v1/jobs').length, 2);
  page.onUnload();
});
