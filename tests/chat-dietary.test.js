const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start, request, session, uploaded, finished } = require('./support/http-service');

async function setup(t, env = {}) {
  const disk = recordPlatform(t); const directory = temporary(t); const server = await start(t, directory, env); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = options => {
    traffic.push({ method: options.method, url: options.url, data: structuredClone(options.data) });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async response => { const body = await response.text(); options.success({ statusCode: response.status, data: body ? JSON.parse(body) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' }); const saved = await services.records.confirmCapture(capture.confirm().batch);
  assert.equal((await services.uploads.uploadRecord(saved.recordId)).ok, true);
  assert.equal((await services.jobs.startImageCards(saved.recordId)).ok, true);
  return { disk, directory, server, backend, traffic, services, id: saved.recordId };
}

test('saved preference changes mark old recommendations for confirmation without rewriting messages, including after offline reopen', async t => {
  const { services, id, disk, backend, server } = await setup(t);
  assert.equal((await services.chat.sendQuickQuestion(id, 'recommend')).ok, true);
  assert.equal((await services.chat.sendQuickQuestion(id, 'price')).ok, true);
  const original = services.records.getRecord(id).record.messages;
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg');
  assert.equal(services.chat.getState(id).messages[1].recommendationStale, undefined);
  const write = disk.storage.set; disk.storage.set = () => { throw Error('full'); };
  assert.equal(services.preferences.save().ok, false);
  assert.equal(services.chat.getState(id).messages[1].recommendationStale, undefined);
  disk.storage.set = write;
  let notification;
  const off = services.chat.subscribe(value => { if (value === id) notification = services.chat.getState(id); });
  assert.equal(services.preferences.save().ok, true);
  assert.equal(notification.messages[1].recommendationStale, true);
  assert.equal(notification.messages[3].recommendationStale, undefined);
  assert.deepEqual(services.records.getRecord(id).record.messages, original);
  await services.dietaryReview.startRecord(id); await server.stop(); off();
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.chat.getState(id).messages[1].recommendationStale, true);
  assert.deepEqual(reopened.records.getRecord(id).record.messages, original);
});

test('queued recommendations freeze submitted preferences across SIGKILL and late recovery; new recommendations exclude confirmed conflicts using only saved preferences', async t => {
  const { services, id, disk, backend, directory, server, traffic } = await setup(t, { SEEFOOD_MOCK_SCENARIO: 'dietary-conflict', SEEFOOD_WORKER_DELAY_MS: '600' });
  const request = disk.platform.request; let accepted;
  disk.platform.request = options => {
    if (options.method === 'POST' && options.data?.kind === 'chat') options.success = response => { accepted = response.data; options.fail(Error('accepted response lost')); };
    request(options);
  };
  assert.equal((await services.chat.sendQuickQuestion(id, 'recommend')).error, 'network-unavailable');
  const old = services.records.getRecord(id).record; const oldRequest = old.chatRequests[old.messages[1].id];
  await server.stop('SIGKILL'); disk.platform.request = request;
  services.preferences.beginEdit(); services.preferences.toggleOption('allergies', 'egg'); assert.equal(services.preferences.save().ok, true);
  await services.dietaryReview.startRecord(id);
  const restarted = await start(t, directory, { SEEFOOD_MOCK_SCENARIO: 'dietary-conflict' }); backend.baseUrl = restarted.url;
  const reopened = createWechatServices(disk.platform, { backend }); const offset = traffic.length;
  assert.equal((await reopened.chat.refreshRecord(id)).ok, true);
  const late = reopened.chat.getState(id);
  assert.equal(late.messages[1].recommendationStale, true); assert.equal(late.messages[1].preferencesVersion, 1);
  assert.equal(late.record.chatJobs[old.messages[1].id].jobId, accepted.jobId);
  assert.deepEqual(late.record.chatRequests[old.messages[1].id], oldRequest);
  assert.equal(late.messages[1].attachments[0].cardId, old.cards[0].id);
  assert.equal(traffic.slice(offset).some(item => item.method === 'POST' && item.url.endsWith('/v1/jobs')), false);
  reopened.preferences.beginEdit(); reopened.preferences.toggleOption('allergies', 'egg'); reopened.preferences.updateNotes('tastes', 'Unsaved change');
  assert.equal((await reopened.chat.sendQuickQuestion(id, 'recommend')).ok, true);
  const current = reopened.chat.getState(id); const reply = current.messages[3];
  assert.equal(reply.preferencesVersion, 2); assert.equal(reply.recommendationStale, undefined);
  assert.deepEqual(reply.attachments, []);
  assert.match(reply.text, /conflict/);
  assert.equal(current.record.chatRequests[reply.id].snapshot.snapshot.preferences.notes, '');
  assert.deepEqual(current.record.chatRequests[reply.id].snapshot.snapshot.preferences.allergies, ['egg']);
  assert.equal(current.messages[1].text, late.messages[1].text); assert.equal(current.messages[1].recommendationStale, true);
});

test('a dish-specific staff question visibly names the selected dish and produces communication help for that exact frozen card', async t => {
  const { services, id, traffic } = await setup(t); const record = services.records.getRecord(id).record;
  // Public local record import represents already generated menu cards; no generation response is forged.
  const second = { ...structuredClone(record.cards[0]), id: 'second:dish', nameZh: '清蒸鱼', localizedName: 'Steamed fish' };
  assert.equal(services.records.updateRecord(id, draft => { draft.cards.push(second); draft.cardIds.push(second.id); }).ok, true);
  const offset = traffic.length;
  assert.equal((await services.chat.askAboutDish(id, 'foreign-card')).ok, false);
  assert.equal(traffic.length, offset);
  assert.equal((await services.chat.askAboutDish(id, second.id)).ok, true);
  const current = services.records.getRecord(id).record; const [user, assistant] = current.messages;
  assert.match(user.text, /清蒸鱼/); assert.equal(user.role, 'user');
  assert.equal(current.chatRequests[assistant.id].request.input.dishCardId, second.id);
  assert.deepEqual(assistant.attachments.filter(value => value.type === 'dish_reference'), [{ type: 'dish_reference', cardId: second.id }]);
  assert.match(assistant.attachments[1].card.textZh, /清蒸鱼/); assert.match(assistant.attachments[1].card.pairedText, /清蒸鱼/);
  assert.equal(assistant.attachments[1].card.textZh.includes(record.cards[0].nameZh), false);
  const frozen = current.chatRequests[assistant.id].snapshot.snapshot;
  assert.equal(frozen.cards.length, 2); assert.equal(frozen.images.length, 1);
  const invalid = structuredClone(current.chatRequests[assistant.id].request);
  invalid.target = { userMessageId: 'foreign-question', assistantMessageId: 'foreign-answer' }; invalid.input.dishCardId = 'foreign-card';
  await assert.rejects(() => services.backend.createJob(invalid, 'foreign-specific-dish'), error => error.code === 'DEPENDENCY_MISSING');
});

test('detail Pages send real dish communication help and return to the source position; chat shows old-preference prompts in all five interface languages', async t => {
  const { services, id } = await setup(t); const card = services.records.getRecord(id).record.cards[0];
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages }; t.after(() => Object.assign(global, old));
  let navigation; let backed = 0; let position; let pageCount = 2;
  global.getApp = () => ({ services }); global.getCurrentPages = () => Array(pageCount).fill({});
  global.wx = { setNavigationBarTitle() {}, navigateTo(value) { navigation = value.url; }, navigateBack() { backed++; }, redirectTo(value) { navigation = value.url; }, pageScrollTo(value) { position = value.scrollTop; } };
  function load(name) { let value; global.Page = definition => { value = definition; }; const file = require.resolve('../miniprogram/pages/' + name + '/' + name); delete require.cache[file]; require(file); return { ...value, data: { ...value.data }, setData(values, done) { Object.assign(this.data, values); if (done) done(); } }; }
  const detail = load('dish-detail'); detail.onLoad({ recordId: id, cardId: card.id }); detail.onShow();
  assert.equal(detail.data.canAskStaff, true); detail.onPageScroll({ scrollTop: 580 });
  const work = detail.askStaff();
  assert.match(navigation, /source=detail/); assert.ok(navigation.includes(encodeURIComponent(card.id))); detail.onHide();
  assert.equal((await work).ok, true);
  const chatPage = load('chat'); chatPage.onLoad({ recordId: id, source: 'detail', cardId: encodeURIComponent(card.id) }); chatPage.onShow();
  assert.match(chatPage.data.messages[0].text, new RegExp(card.nameZh));
  assert.equal(chatPage.data.messages[1].communicationCards.length, 1);
  chatPage.back(); assert.equal(backed, 1); detail.onShow(); assert.equal(position, 580);
  assert.equal((await services.chat.sendQuickQuestion(id, 'recommend')).ok, true);
  const original = services.records.getRecord(id).record.messages[3].text;
  services.preferences.beginEdit(); services.preferences.toggleOption('restrictions', 'halal'); services.preferences.save();
  await services.dietaryReview.startRecord(id);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); detail.onShow(); chatPage.onShow();
    assert.equal(detail.data.dietary.assessment.concern, 'possible_conflict'); assert.equal(detail.data.canAskStaff, true);
    assert.ok(detail.data.askStaffLabel); assert.ok(chatPage.data.messages[3].recommendationNotice);
    assert.equal(chatPage.data.messages[3].text, original); assert.equal(chatPage.data.messages[3].contentLanguage, 'en');
  }
  pageCount = 1; chatPage.back(); assert.match(navigation, /dish-detail/); assert.ok(navigation.includes(encodeURIComponent(card.id)));
  detail.onUnload(); chatPage.onUnload();
});

test('unknown and possible-conflict examples keep specific caution and staff questions through every language without becoming safety claims', async t => {
  const { services, id } = await setup(t);
  assert.equal((await services.chat.sendQuickQuestion(id, 'recommend')).ok, true);
  let record = services.records.getRecord(id).record;
  assert.match(record.messages[1].text, /cannot confirm suitability/); assert.match(record.messages[1].text, /does not account for personal restrictions/);
  services.preferences.beginEdit(); services.preferences.toggleOption('restrictions', 'halal'); services.preferences.save(); await services.dietaryReview.startRecord(id);
  const reasons = { en: /may contain ingredients/, ja: /含まれる可能性/, ko: /포함될 수/, es: /puede contener ingredientes/, 'zh-CN': /可能含有/ };
  for (const [language, reason] of Object.entries(reasons)) {
    services.application.chooseLanguage(language);
    assert.equal((await services.chat.sendQuickQuestion(id, 'recommend')).ok, true);
    record = services.records.getRecord(id).record; const reply = record.messages.at(-1);
    assert.match(reply.text, reason); assert.equal(reply.contentLanguage, language);
    assert.deepEqual(reply.attachments, [{ type: 'dish_reference', cardId: record.cards[0].id }]);
    assert.equal((await services.chat.askAboutDish(id, reply.attachments[0].cardId)).ok, true);
    const card = services.chat.getState(id).messages.at(-1).attachments.find(value => value.type === 'communication_card').card;
    assert.match(card.textZh, /示例炒饭/); assert.equal(card.pairedLanguage, language);
    assert.equal(language === 'zh-CN' ? card.pairedText : !!card.pairedText, language === 'zh-CN' ? null : true);
  }
});

test('legacy dish suggestions with missing request or preference metadata remain conservatively marked after reopening', async t => {
  const { services, id, disk, backend } = await setup(t);
  assert.equal((await services.chat.sendQuickQuestion(id, 'recommend')).ok, true);
  const record = services.records.getRecord(id).record; const replyId = record.messages[1].id;
  // Import an older saved conversation whose generation metadata is unavailable.
  assert.equal(services.records.updateRecord(id, draft => {
    delete draft.chatRequests[replyId]; draft.messages[0].text = 'Older custom recommendation'; draft.messages[1].preferencesVersion = null;
  }).ok, true);
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.chat.getState(id).messages[1].recommendationStale, true);
  assert.equal(reopened.records.getRecord(id).record.messages[1].text, record.messages[1].text);
});

test('the generation boundary rejects a fixed recommendation that returns a confirmed-conflict card', async t => {
  const { createService } = await import('../server/service.ts'); const { chatHandler } = await import('../server/chat.ts');
  const service = createService({ dataDir: temporary(t), enableDevSession: true, devIdentities: ['demo-owner-a'], jobHandlers: { chat: {
    ...chatHandler('dietary-conflict'), generate: async ({ snapshot }) => ({ text: 'Incorrect recommendation', contentLanguage: 'en', complete: true,
      attachments: [{ type: 'dish_reference', cardId: snapshot.snapshot.cards[0].id }] })
  } } });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const url = `http://127.0.0.1:${service.server.address().port}`; const token = await session(url); const data = await uploaded(url, token);
  const created = await request(url, 'POST', '/v1/jobs', data.body, token, 'conflict-cards');
  const cards = (await finished(url, token, created.body.jobId)).output.cards;
  const snapshot = structuredClone(data.bound); snapshot.snapshotVersion = 3; snapshot.snapshot.cards = cards;
  snapshot.snapshot.preferences = { version: 2, allergies: ['egg'], restrictions: [], tastes: [], notes: '' };
  await request(url, 'PUT', `/v1/contexts/${data.contextId}`, snapshot, token);
  const job = await request(url, 'POST', '/v1/jobs', { contextId: data.contextId, kind: 'chat', target: { userMessageId: 'ask', assistantMessageId: 'reply' },
    input: { contextSnapshotVersion: 3, text: 'Suggest dishes from this menu.', targetLanguage: 'en' } }, token, 'conflict-recommendation');
  const result = await finished(url, token, job.body.jobId);
  assert.equal(result.state, 'failed'); assert.equal(result.output, null); assert.equal(result.error.code, 'DEPENDENCY_MISSING');
});

test('an unreadable preferences store does not hide saved chat and conservatively marks unverified recommendation basis', async t => {
  const { services, id, disk, backend } = await setup(t);
  assert.equal((await services.chat.sendQuickQuestion(id, 'recommend')).ok, true);
  const original = services.records.getRecord(id).record.messages;
  const read = disk.storage.get; disk.storage.get = key => { if (key.endsWith(':preferences')) throw Error('preferences unreadable'); return read(key); };
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.preferences.getState().readable, false);
  const state = reopened.chat.getState(id);
  assert.ok(state.record); assert.equal(state.messages[1].text, original[1].text);
  assert.equal(state.messages[1].recommendationStale, true); assert.equal(state.messages[1].recommendationBasisUnknown, true);
});
