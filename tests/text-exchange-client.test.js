const test = require('node:test');
const assert = require('node:assert/strict');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { fileStorage } = require('./support/storage');
const { temporary, start, request, session, finished } = require('./support/http-service');

async function setup(t, env = {}) {
  const directory = temporary(t); const server = await start(t, directory, env); const storage = fileStorage(t);
  const traffic = [];
  const platform = {
    getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: (key) => storage.remove(key),
    getAppBaseInfo: () => ({ language: 'en' }), env: { USER_DATA_PATH: '/tmp' }, getFileSystemManager: () => ({}),
    request(options) {
      traffic.push({ method: options.method, url: options.url, body: options.data });
      fetch(options.url, { method: options.method, headers: options.header, body: options.data === undefined ? undefined : JSON.stringify(options.data) })
        .then(async (response) => options.success({ statusCode: response.status, data: await response.json() })).catch(options.fail);
    }
  };
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  const services = createWechatServices(platform, { backend });
  return { directory, server, storage, platform, backend, services, traffic };
}

test('both speakers keep their latest pair and separate drafts across client recreation without creating menu history', async (t) => {
  const { services, platform, backend } = await setup(t); const exchange = services.textExchange;
  assert.equal(exchange.edit('visitor', 'Please do not add peanuts. Thank you.').ok, true);
  assert.equal((await exchange.submit('visitor')).ok, true);
  assert.equal(exchange.getState().sides.visitor.result.translation, '请不要放花生，谢谢。');
  assert.equal(exchange.getState().sides.visitor.draft, '');
  exchange.edit('visitor', 'What is in this dish?');
  exchange.selectSpeaker('staff'); exchange.edit('staff', '请不要放花生，谢谢。');
  assert.equal((await exchange.submit('staff')).ok, true);
  exchange.edit('staff', '另一句话');
  const state = exchange.getState();
  assert.equal(state.latestSpeaker, 'staff');
  assert.equal(state.sides.staff.result.translation, 'Please do not add peanuts. Thank you.');
  assert.equal(state.sides.visitor.draft, 'What is in this dish?');
  assert.equal(state.sides.visitor.result.original, 'Please do not add peanuts. Thank you.');
  assert.equal(state.sides.staff.draft, '另一句话');
  services.application.chooseLanguage('ja');
  const reopened = createWechatServices(platform, { backend });
  assert.deepEqual(reopened.textExchange.getState(), state);
  assert.equal(reopened.textExchange.getState().sides.visitor.inputLanguage, 'en');
  assert.deepEqual(reopened.records.listRecent().records, []);
});

module.exports = { setup };

test('lost acceptance recovers through the shared task lookup after process death without submitting twice', async (t) => {
  const { services, server, directory, platform, backend, traffic } = await setup(t, { SEEFOOD_WORKER_DELAY_MS: '10000' });
  const send = platform.request; let accepted;
  platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) options.success = (response) => { accepted = response.data; options.fail(new Error('response lost')); };
    send(options);
  };
  services.textExchange.edit('visitor', 'Please do not add peanuts. Thank you.');
  assert.equal((await services.textExchange.submit('visitor')).error, 'network-unavailable');
  const before = services.textExchange.getState(); assert.equal(before.sides.visitor.job, null);
  await server.stop('SIGKILL');
  const restarted = await start(t, directory); backend.baseUrl = restarted.url; platform.request = send;
  const reopened = createWechatServices(platform, { backend });
  assert.equal((await reopened.textExchange.refresh()).ok, true);
  const state = reopened.textExchange.getState();
  assert.equal(state.localScopeId, before.localScopeId); assert.equal(state.sides.visitor.job.jobId, accepted.jobId);
  assert.equal(state.sides.visitor.job.attempt, 1); assert.equal(state.sides.visitor.result.translation, '请不要放花生，谢谢。');
  assert.equal(traffic.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/v1/jobs')).length, 1);
  assert.equal(createWechatServices(platform, { backend }).textExchange.getState().sides.visitor.result.original, 'Please do not add peanuts. Thank you.');
});

test('new input and a clear invalidate delayed translations; a cleared exchange reopens empty with a new scope', async (t) => {
  const { services, platform, backend } = await setup(t);
  const exchange = services.textExchange; const send = platform.request; const waiting = [];
  let nextReceived;
  function hold() {
    return new Promise((resolve) => { nextReceived = resolve; });
  }
  platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) {
      const success = options.success;
      options.success = (response) => { waiting.push(() => success(response)); nextReceived(response.data); };
    }
    send(options);
  };
  exchange.edit('visitor', 'First sentence'); const received = hold(); const submission = exchange.submit('visitor');
  await received; const originalScope = exchange.getState().localScopeId;
  exchange.edit('visitor', 'New unsent sentence'); waiting.shift()();
  assert.equal((await submission).error, 'stale-job');
  assert.equal(exchange.getState().sides.visitor.draft, 'New unsent sentence'); assert.equal(exchange.getState().sides.visitor.result, null);
  const receivedAgain = hold(); const second = exchange.submit('visitor'); await receivedAgain;
  assert.equal(exchange.clear().ok, true); waiting.shift()();
  assert.equal((await second).error, 'stale-job');
  const reopened = createWechatServices(platform, { backend }).textExchange.getState();
  assert.notEqual(reopened.localScopeId, originalScope); assert.equal(reopened.latestSpeaker, null);
  assert.equal(reopened.sides.visitor.draft, ''); assert.equal(reopened.sides.staff.draft, '');
  assert.equal(reopened.sides.visitor.result, null); assert.equal(reopened.sides.visitor.operation, null);
});

test('results require matching scope, input version, request and job IDs and never cross speakers', async (t) => {
  const { services, platform } = await setup(t); const exchange = services.textExchange;
  exchange.edit('visitor', 'Please do not add peanuts. Thank you.'); await exchange.submit('visitor');
  exchange.selectSpeaker('staff'); exchange.edit('staff', '请不要放花生，谢谢。'); await exchange.submit('staff');
  const before = exchange.getState(); const operation = before.sides.visitor.operation; const job = before.sides.visitor.job;
  for (const altered of [
    { ...job, jobId: 'another-job', revision: job.revision + 1 },
    { ...job, target: { requestId: 'another-request' }, revision: job.revision + 1 },
    { ...job, output: { ...job.output, inputVersion: job.output.inputVersion + 1 }, revision: job.revision + 1 },
    { ...job, contextId: 'another-context', revision: job.revision + 1 },
    { ...job, output: { ...job.output, contentLanguage: 'es' }, revision: job.revision + 1 }
  ]) assert.equal(exchange.applyJob('visitor', operation, altered).ok, false);
  assert.equal(exchange.applyJob('staff', operation, job).ok, false);
  const wrongScope = structuredClone(operation); wrongScope.context.localScopeId = 'discarded-scope';
  assert.equal(exchange.applyJob('visitor', wrongScope, job).ok, false);
  assert.deepEqual(exchange.getState(), before);
});

test('saving failure leaves typed input available, blocks generation, and can be retried', async (t) => {
  const { services, storage, traffic, platform, backend } = await setup(t); const exchange = services.textExchange;
  const write = storage.set; storage.set = () => { throw new Error('disk full'); };
  assert.equal(exchange.edit('visitor', 'Keep my words').error, 'storage-write');
  assert.equal((await exchange.submit('visitor')).error, 'storage-write');
  assert.equal(exchange.getState().sides.visitor.draft, 'Keep my words');
  assert.equal(traffic.length, 0);
  storage.set = write; assert.equal(exchange.retrySave().ok, true);
  const reopened = createWechatServices(platform, { backend });
  assert.equal(reopened.textExchange.getState().sides.visitor.draft, 'Keep my words');
  assert.equal((await reopened.textExchange.submit('visitor')).ok, true);
});

test('a new draft uses the selected input language and retains it through an interface change and restart', async (t) => {
  const { services, platform, backend } = await setup(t);
  services.application.chooseLanguage('ja'); services.textExchange.edit('visitor', 'ピーナッツなしでお願いします');
  assert.equal(services.textExchange.getState().sides.visitor.inputLanguage, 'ja');
  services.application.chooseLanguage('es');
  const reopened = createWechatServices(platform, { backend });
  assert.equal(reopened.textExchange.getState().sides.visitor.inputLanguage, 'ja');
  assert.equal((await reopened.textExchange.submit('visitor')).ok, true);
  assert.equal(reopened.textExchange.getState().sides.visitor.result.sourceLanguage, 'ja');
  reopened.textExchange.restoreInput('visitor');
  assert.equal(reopened.textExchange.getState().sides.visitor.inputLanguage, 'ja');
  reopened.textExchange.edit('visitor', '');
  reopened.textExchange.edit('visitor', 'Sin cacahuetes, por favor');
  assert.equal(reopened.textExchange.getState().sides.visitor.inputLanguage, 'es');
});

test('an explicit continue can submit the saved request when connection failed before the context reached the server', async (t) => {
  const { services, platform } = await setup(t); const send = platform.request;
  platform.request = (options) => options.fail(new Error('offline'));
  services.textExchange.edit('visitor', 'No peanuts, please');
  assert.equal((await services.textExchange.submit('visitor')).error, 'network-unavailable');
  platform.request = send;
  assert.equal((await services.textExchange.continueSubmission('visitor')).ok, true);
  assert.equal(services.textExchange.getState().sides.visitor.job.state, 'succeeded');
});

test('both speakers can submit through the one current communication context without snapshot races', async (t) => {
  const { services, traffic } = await setup(t); const exchange = services.textExchange;
  exchange.edit('visitor', 'Please do not add peanuts. Thank you.'); exchange.edit('staff', '请不要放花生，谢谢。');
  const results = await Promise.all([exchange.submit('visitor'), exchange.submit('staff')]);
  assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  const state = exchange.getState();
  assert.equal(state.sides.visitor.job.contextId, state.sides.staff.job.contextId);
  assert.equal(state.sides.visitor.result.targetLanguage, 'zh-CN'); assert.equal(state.sides.staff.result.targetLanguage, 'en');
  const snapshots = traffic.filter((entry) => entry.method === 'PUT');
  assert.deepEqual([...new Set(snapshots.map((entry) => entry.body.snapshotVersion))], [1, 2]);
  assert.ok(snapshots.every((entry) => entry.body.purpose === 'communication' && !Object.hasOwn(entry.body, 'recordId')));
});

test('one speaker can continue an interrupted submission after the other speaker has submitted a newer snapshot', async (t) => {
  const { services, platform } = await setup(t); const exchange = services.textExchange; const send = platform.request;
  platform.request = (options) => options.fail(new Error('offline'));
  exchange.edit('visitor', 'My first words'); assert.equal((await exchange.submit('visitor')).ok, false);
  platform.request = send;
  exchange.edit('staff', '店员的新话'); assert.equal((await exchange.submit('staff')).ok, true);
  assert.equal((await exchange.continueSubmission('visitor')).ok, true);
  const state = exchange.getState(); assert.equal(state.sides.visitor.result.original, 'My first words');
  assert.equal(state.sides.staff.result.original, '店员的新话');
});

test('waiting, generation failure and offline reopening keep the previous result and never restart a failed job automatically', async (t) => {
  const { services, server, directory, platform, backend, traffic } = await setup(t); const exchange = services.textExchange;
  exchange.edit('visitor', 'Please do not add peanuts. Thank you.'); await exchange.submit('visitor');
  const previous = exchange.getState().sides.visitor.result;
  await server.stop(); const failing = await start(t, directory, { SEEFOOD_MOCK_SCENARIO: 'text-failure' }); backend.baseUrl = failing.url;
  const reopened = createWechatServices(platform, { backend }); const send = platform.request;
  let accepted; const received = new Promise((resolve) => { accepted = resolve; }); let release;
  platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) {
      const success = options.success; options.success = (response) => { release = () => success(response); accepted(); };
    }
    send(options);
  };
  reopened.textExchange.edit('visitor', 'Could you check the ingredients?');
  const submit = reopened.textExchange.submit('visitor'); await received;
  assert.deepEqual(reopened.textExchange.getState().sides.visitor.result, previous);
  release(); await submit;
  assert.equal(reopened.textExchange.getState().sides.visitor.job.state, 'failed');
  assert.deepEqual(reopened.textExchange.getState().sides.visitor.result, previous);
  const count = traffic.length; platform.request = () => { throw new Error('unexpected offline network access'); };
  const offline = createWechatServices(platform, { backend }); await offline.textExchange.refresh();
  assert.deepEqual(offline.textExchange.getState().sides.visitor.result, previous);
  assert.equal(offline.textExchange.getState().sides.visitor.job.state, 'failed'); assert.equal(traffic.length, count);
});

test('a result that could not save remains visible and is recovered durably after client recreation', async (t) => {
  const { services, storage, platform, backend } = await setup(t); const write = storage.set;
  storage.set = (key, value) => {
    if (value.value && value.value.sides && value.value.sides.visitor.result) throw new Error('full storage');
    write(key, value);
  };
  services.textExchange.edit('visitor', 'Please do not add peanuts. Thank you.');
  assert.equal((await services.textExchange.submit('visitor')).error, 'storage-write');
  assert.equal(services.textExchange.getState().sides.visitor.result.translation, '请不要放花生，谢谢。');
  assert.equal(services.textExchange.getState().dirty, true);
  storage.set = write;
  const reopened = createWechatServices(platform, { backend });
  assert.equal((await reopened.textExchange.refresh()).ok, true);
  assert.equal(reopened.textExchange.getState().sides.visitor.result.translation, '请不要放花生，谢谢。');
  assert.equal(createWechatServices(platform, { backend }).textExchange.getState().dirty, false);
});

test('read failure retries the saved exchange instead of overwriting it with an empty conversation', async (t) => {
  const { services, storage, platform, backend } = await setup(t);
  services.textExchange.edit('staff', '请核对这段话'); const read = storage.get;
  storage.get = (key) => { if (key.endsWith('current-text-exchange')) throw new Error('temporary read error'); return read(key); };
  const reopened = createWechatServices(platform, { backend });
  assert.equal(reopened.textExchange.getState().saveError, 'storage-read');
  assert.equal(reopened.textExchange.edit('staff', 'overwrite').ok, false);
  assert.equal(reopened.textExchange.retrySave().ok, false);
  storage.get = read;
  assert.equal(reopened.textExchange.retrySave().ok, true);
  assert.equal(reopened.textExchange.getState().sides.staff.draft, '请核对这段话');
});
