const test = require('node:test');
const assert = require('node:assert/strict');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { fileStorage } = require('./support/storage');
const { temporary, start } = require('./support/http-service');

function client(t, backend = { enabled: false }) {
  const storage = fileStorage(t); const traffic = [];
  const platform = {
    getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: (key) => storage.remove(key),
    getAppBaseInfo: () => ({ language: 'en' }), env: { USER_DATA_PATH: '/tmp' }, getFileSystemManager: () => ({}),
    request(options) {
      traffic.push({ method: options.method, url: options.url, body: options.data });
      fetch(options.url, { method: options.method, headers: options.header, body: options.data === undefined ? undefined : JSON.stringify(options.data) })
        .then(async (response) => options.success({ statusCode: response.status, data: await response.json() })).catch(options.fail);
    }
  };
  return { storage, platform, backend, traffic, services: createWechatServices(platform, { backend }) };
}
async function online(t, env = {}) {
  const directory = temporary(t); const server = await start(t, directory, env);
  return { ...client(t, { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' }), directory, server };
}

test('new card drafts preserve source language and deterministic defaults, then save at the front and reveal their category', (t) => {
  const { services, platform, backend } = client(t); const cards = services.cardDrafts;
  const before = services.cardLibrary.getState().allCards.map((card) => card.id);
  assert.equal(cards.beginNew({ category: 'dietary' }).ok, true);
  assert.equal(cards.edit({ text: 'Please do not add peanuts. Thank you.' }).ok, true);
  let draft = cards.getState().draft;
  assert.equal(draft.title, 'Please do not add peanuts. Thank');
  assert.equal(draft.category, 'dietary'); assert.equal(draft.color, 'green');
  assert.equal(draft.sourceLanguage, 'en'); assert.equal(draft.targetLanguage, 'zh-CN');
  assert.deepEqual(services.cardLibrary.getState().allCards.map((card) => card.id), before);
  services.application.chooseLanguage('ja');
  const reopened = createWechatServices(platform, { backend });
  assert.equal(reopened.cardDrafts.beginNew({ category: 'all' }).resumable, true);
  assert.equal(reopened.cardDrafts.getState().needsResume, true);
  assert.equal(reopened.cardDrafts.resumeNew().ok, true);
  assert.equal(reopened.cardDrafts.getState().draft.sourceLanguage, 'en');
  reopened.cardDrafts.edit({ textZh: '请不要放花生，谢谢。', title: 'No peanuts', category: 'service', color: 'blue' });
  const saved = reopened.cardDrafts.save(); assert.equal(saved.ok, true);
  assert.equal(reopened.cardDrafts.getState().draft, null);
  const library = reopened.cardLibrary.getState();
  assert.equal(library.category, 'service'); assert.equal(library.topCard.id, saved.card.id);
  assert.deepEqual(library.allCards.slice(1).map((card) => card.id), before);
  const offline = createWechatServices(platform, { backend });
  assert.equal(offline.cardDrafts.getState().draft, null);
  offline.cardLibrary.showCard(saved.card.id);
  assert.equal(offline.cardLibrary.getState().displayCard.primaryText, '请不要放花生，谢谢。');
  assert.equal(offline.cardLibrary.getState().displayCard.secondaryText, 'Please do not add peanuts. Thank you.');
  assert.deepEqual(offline.records.listRecent().records, []);
});

test('a card translation survives lost acceptance and server recreation, remains editable, and never creates a formal card before save', async (t) => {
  const { services, platform, backend, server, directory, traffic } = await online(t, { SEEFOOD_WORKER_DELAY_MS: '10000' });
  const drafts = services.cardDrafts; const send = platform.request; let accepted;
  platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) options.success = (response) => { accepted = response.data; options.fail(new Error('response lost')); };
    send(options);
  };
  drafts.beginNew(); drafts.edit({ text: 'Please do not add peanuts. Thank you.' });
  assert.equal((await drafts.translate()).error, 'network-unavailable');
  const original = drafts.getState().draft;
  assert.equal(original.category, 'service');
  await server.stop('SIGKILL');
  const restarted = await start(t, directory); backend.baseUrl = restarted.url; platform.request = send;
  const reopened = createWechatServices(platform, { backend }); reopened.cardDrafts.resumeNew();
  assert.equal((await reopened.cardDrafts.refresh()).ok, true);
  const recovered = reopened.cardDrafts.getState().draft;
  assert.equal(recovered.localScopeId, original.localScopeId); assert.equal(recovered.job.jobId, accepted.jobId);
  assert.equal(recovered.job.attempt, 1); assert.equal(recovered.textZh, '请不要放花生，谢谢。');
  assert.equal(recovered.text, 'Please do not add peanuts. Thank you.');
  assert.equal(reopened.cardLibrary.getState().allCards.length, 6);
  assert.equal(traffic.filter((item) => item.method === 'POST' && item.url.endsWith('/v1/jobs')).length, 1);
  reopened.cardDrafts.edit({ textZh: '请不要放花生和花生油，谢谢。' });
  const saved = reopened.cardDrafts.save(); assert.equal(saved.ok, true);
  assert.equal(saved.card.textZh, '请不要放花生和花生油，谢谢。');
  assert.deepEqual(reopened.records.listRecent().records, []);
});

test('editing or discarding a draft rejects delayed translations, including a callback owned by an older client instance', async (t) => {
  const { services, platform, backend, traffic } = await online(t); const drafts = services.cardDrafts;
  const send = platform.request; let accepted; let release;
  function delayAcceptance() {
    return new Promise((resolve) => {
      accepted = resolve;
      platform.request = (options) => {
        if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) {
          const success = options.success; options.success = (response) => { release = () => success(response); accepted(); };
        }
        send(options);
      };
    });
  }
  drafts.beginNew(); drafts.edit({ text: 'First sentence' });
  let received = delayAcceptance(); let pending = drafts.translate(); await received;
  drafts.edit({ text: 'New unsent sentence', textZh: '我还在编辑。' }); release();
  assert.equal((await pending).error, 'stale-job');
  assert.equal(drafts.getState().draft.textZh, '我还在编辑。');
  assert.equal(traffic.filter((item) => item.method === 'POST' && item.url.endsWith('/v1/jobs')).length, 1);
  received = delayAcceptance(); pending = drafts.translate(); await received;
  const oldScope = drafts.getState().draft.localScopeId;
  const reopened = createWechatServices(platform, { backend }); reopened.cardDrafts.resumeNew();
  assert.equal(reopened.cardDrafts.discard().ok, true); release(); await pending;
  const after = createWechatServices(platform, { backend });
  assert.equal(after.cardDrafts.getState().draft, null);
  assert.equal(after.cardLibrary.getState().allCards.length, 6);
  after.cardDrafts.beginNew(); assert.notEqual(after.cardDrafts.getState().draft.localScopeId, oldScope);
});

test('autosave and formal-save faults preserve recoverable drafts and never claim a card was saved', (t) => {
  const { services, storage, platform, backend, traffic } = client(t); const drafts = services.cardDrafts;
  const write = storage.set;
  storage.set = () => { throw new Error('disk full'); };
  assert.equal(drafts.beginNew().error, 'storage-write');
  drafts.edit({ text: 'Keep these words', textZh: '保留这段话。' });
  assert.equal(drafts.getState().dirty, true);
  assert.equal(drafts.save().error, 'storage-write'); assert.equal(traffic.length, 0);
  storage.set = write; assert.equal(drafts.retrySave().ok, true);
  const reopened = createWechatServices(platform, { backend }); reopened.cardDrafts.resumeNew();
  assert.equal(reopened.cardDrafts.getState().draft.text, 'Keep these words');
  storage.set = (key, value) => {
    if (key.endsWith('personal-cards') && value.value.cards.length > 6) throw new Error('cannot save formal card');
    write(key, value);
  };
  assert.equal(reopened.cardDrafts.save().error, 'storage-write');
  assert.equal(reopened.cardDrafts.getState().draft.textZh, '保留这段话。');
  assert.equal(createWechatServices(platform, { backend }).cardLibrary.getState().allCards.length, 6);
  storage.set = write; reopened.cardDrafts.retrySave();
  assert.equal(reopened.cardDrafts.save().ok, true);
  const final = createWechatServices(platform, { backend });
  assert.equal(final.cardDrafts.getState().draft, null); assert.equal(final.cardLibrary.getState().allCards.length, 7);
});

test('reopening an unaccepted request offers explicit continuation and never automatically sends the draft', async (t) => {
  const { services, platform, backend, traffic } = await online(t); const send = platform.request;
  platform.request = (options) => options.method === 'POST' && options.url.endsWith('/v1/jobs') ? options.fail(new Error('offline before delivery')) : send(options);
  services.cardDrafts.beginNew(); services.cardDrafts.edit({ text: 'Please check this dish' });
  assert.equal((await services.cardDrafts.translate()).error, 'network-unavailable');
  const requestId = services.cardDrafts.getState().draft.operation.request.target.requestId;
  platform.request = send;
  const reopened = createWechatServices(platform, { backend }); reopened.cardDrafts.resumeNew();
  assert.equal((await reopened.cardDrafts.refresh()).ok, true);
  assert.equal(traffic.filter((item) => item.method === 'POST' && item.url.endsWith('/v1/jobs')).length, 0);
  assert.equal(reopened.cardDrafts.getState().draft.error, 'submission-pending');
  assert.equal((await reopened.cardDrafts.continueSubmission()).ok, true);
  assert.equal(reopened.cardDrafts.getState().draft.job.target.requestId, requestId);
  assert.equal(reopened.cardDrafts.getState().draft.textZh, '请不要放花生，谢谢。');
});

test('Chinese cards save one readable body offline and default titles follow source until the user rewrites them', (t) => {
  const { services, platform, backend } = client(t); const drafts = services.cardDrafts;
  services.application.chooseLanguage('zh-CN'); drafts.beginNew({ category: 'all' });
  drafts.edit({ text: '请先帮我确认这道菜的配料。' });
  assert.equal(drafts.getState().draft.title, '请先帮我确认这道菜的配料。');
  drafts.edit({ title: '核对配料', text: '请确认有没有花生或花生油。' });
  assert.equal(drafts.getState().draft.title, '核对配料');
  const saved = drafts.save(); assert.equal(saved.ok, true);
  assert.equal(saved.card.pairedText, null); assert.equal(saved.card.pairedLanguage, 'zh-CN');
  services.application.chooseLanguage('es');
  const reopened = createWechatServices(platform, { backend }); reopened.cardLibrary.showCard(saved.card.id);
  assert.equal(reopened.cardLibrary.getState().displayCard.primaryText, '请确认有没有花生或花生油。');
  assert.equal(reopened.cardLibrary.getState().displayCard.secondaryText, null);
  assert.equal(reopened.cardLibrary.getState().displayCard.title, '核对配料');
});

test('each translated result must match the current scope, request, input version, job and language', async (t) => {
  const { services } = await online(t); const drafts = services.cardDrafts;
  drafts.beginNew(); drafts.edit({ text: 'Please do not add peanuts. Thank you.' }); await drafts.translate();
  const before = drafts.getState(); const { operation, job } = before.draft;
  for (const invalid of [
    { ...job, jobId: 'wrong-job', revision: job.revision + 1 },
    { ...job, contextId: 'wrong-context', revision: job.revision + 1 },
    { ...job, target: { requestId: 'wrong-request' }, revision: job.revision + 1 },
    { ...job, output: { ...job.output, inputVersion: job.output.inputVersion + 1 }, revision: job.revision + 1 },
    { ...job, output: { ...job.output, contentLanguage: 'ja' }, revision: job.revision + 1 },
    { ...job, attempt: 2, revision: job.revision + 1 }
  ]) assert.equal(drafts.applyJob(operation, invalid).ok, false);
  const wrongScope = structuredClone(operation); wrongScope.context.localScopeId = 'another-scope';
  assert.equal(drafts.applyJob(wrongScope, job).ok, false); assert.deepEqual(drafts.getState(), before);
  drafts.edit({ text: 'New unsent text' });
  assert.equal(drafts.getState().canSave, false);
  assert.equal(drafts.applyJob(operation, { ...job, revision: job.revision + 1 }).ok, false);
  assert.equal(drafts.getState().draft.text, 'New unsent text');
  assert.equal(drafts.getState().draft.textZh, '请不要放花生，谢谢。');
  drafts.edit({ textZh: '新的内容。' }); assert.equal(drafts.getState().canSave, true);
});

test('read failure never replaces an existing draft, and failed translation preserves typed text across an offline reopen', async (t) => {
  const { services, platform, backend, storage, traffic } = await online(t, { SEEFOOD_MOCK_SCENARIO: 'text-failure' });
  services.cardDrafts.beginNew(); services.cardDrafts.edit({ text: 'Please check the ingredients' });
  await services.cardDrafts.translate();
  assert.equal(services.cardDrafts.getState().draft.job.state, 'failed');
  const read = storage.get;
  storage.get = (key) => { if (key.endsWith('personal-cards')) throw new Error('read failed'); return read(key); };
  const failed = createWechatServices(platform, { backend });
  assert.equal(failed.cardDrafts.getState().saveError, 'storage-read');
  assert.equal(failed.cardDrafts.beginNew().ok, false);
  storage.get = read; assert.equal(failed.cardDrafts.retrySave().ok, true); failed.cardDrafts.resumeNew();
  assert.equal(failed.cardDrafts.getState().draft.text, 'Please check the ingredients');
  const count = traffic.length;
  platform.request = () => { throw new Error('unexpected network'); };
  assert.equal((await failed.cardDrafts.refresh()).ok, true);
  assert.equal(traffic.length, count);
  assert.equal(failed.cardDrafts.getState().draft.job.state, 'failed');
  assert.equal(failed.cardLibrary.reload().ok, true); assert.equal(failed.cardLibrary.getState().allCards.length, 6);
});

test('a successful card save stays visible when saving the library position fails', (t) => {
  const { services, storage } = client(t);
  services.cardLibrary.selectCategory('dietary');
  services.cardDrafts.beginNew({ category: 'service' });
  services.cardDrafts.edit({ text: 'Water please', textZh: '请给我水。' });
  const write = storage.set;
  storage.set = (key, value) => { if (key.endsWith('card-library-view')) throw new Error('view storage full'); write(key, value); };
  const result = services.cardDrafts.save(); assert.equal(result.ok, true);
  services.cardLibrary.reload();
  assert.equal(services.cardLibrary.getState().category, 'service');
  assert.equal(services.cardLibrary.getState().topCard.id, result.card.id);
  assert.equal(services.cardDrafts.getState().draft, null);
});
