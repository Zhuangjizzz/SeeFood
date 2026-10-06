const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');
async function record(disk, services) {
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => 'en' });
  await capture.chooseImages({ source: 'album' });
  const saved = await services.records.confirmCapture(capture.confirm().batch); assert.equal(saved.ok, true); return saved.recordId;
}
async function setup(t, online = false) {
  const disk = recordPlatform(t); const traffic = []; let backend;
  if (online) {
    const server = await start(t, temporary(t), { SEEFOOD_WORKER_DELAY_MS: '100' });
    backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
    disk.platform.request = (options) => {
      traffic.push({ method: options.method, url: options.url, data: structuredClone(options.data) });
      fetch(options.url, { method: options.method, headers: options.header,
        body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
        .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
    };
    disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  }
  const services = createWechatServices(disk.platform, { backend }); const id = await record(disk, services);
  if (online) { assert.equal((await services.uploads.uploadRecord(id)).ok, true); assert.equal((await services.jobs.startImageCards(id)).ok, true); }
  return { disk, services, id, backend, traffic };
}

test('unsent questions persist per record across recreation, and explicit clear only removes the selected draft', async (t) => {
  const { disk, services, id } = await setup(t); const second = await record(disk, services);
  assert.equal(services.chat.editDraft(id, '  Is this vegetarian?\n请确认  ').ok, true);
  assert.equal(services.chat.editDraft(second, 'No peanuts, please.').ok, true);
  const reopened = createWechatServices(disk.platform);
  assert.equal(reopened.chat.getState(id).draft.text, '  Is this vegetarian?\n请确认  ');
  assert.equal(reopened.chat.getState(second).draft.text, 'No peanuts, please.');
  assert.deepEqual(reopened.chat.getState(id).messages, []);
  assert.equal(reopened.chat.clearDraft(id).ok, true);
  const again = createWechatServices(disk.platform);
  assert.equal(again.chat.getState(id).draft.text, '');
  assert.equal(again.chat.getState(second).draft.text, 'No peanuts, please.');
  assert.ok(again.chat.getState(id).draft.inputVersion > 1);
  assert.deepEqual(again.chat.getState(id).messages, []);
});

test('sending durably commits the question before consuming only its exact draft version, even if acceptance is lost', async (t) => {
  const { disk, services, id, backend, traffic } = await setup(t, true);
  services.chat.editDraft(id, 'First question');
  const first = services.chat.sendDraft(id);
  services.chat.editDraft(id, 'Second question typed during send');
  assert.equal((await first).ok, true);
  let reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.chat.getState(id).draft.text, 'Second question typed during send');
  assert.equal(reopened.chat.getState(id).messages[0].text, 'First question');
  assert.equal(reopened.chat.getState(id).messages.length, 2);
  const send = disk.platform.request; let durableAtPost;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.data.kind === 'chat') {
      durableAtPost = createWechatServices(disk.platform, { backend }).chat.getState(id);
      options.success = () => options.fail(new Error('acceptance lost'));
    }
    send(options);
  };
  assert.equal((await services.chat.sendDraft(id)).error, 'network-unavailable');
  assert.equal(durableAtPost.draft.text, '');
  assert.equal(durableAtPost.messages[2].text, 'Second question typed during send');
  assert.equal(durableAtPost.messages.length, 4);
  assert.deepEqual(traffic.filter((item) => item.method === 'PUT').at(-1).data.snapshot.messages.map((message) => message.text),
    durableAtPost.messages.slice(0, 2).map((message) => message.text));
  services.chat.editDraft(id, 'Only this draft is cleared');
  assert.equal(services.chat.clearDraft(id).ok, true);
  reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.chat.getState(id).draft.text, '');
  assert.equal(reopened.chat.getState(id).messages.length, 4);
});

test('failed draft writes remain explicit and retryable, failed send never consumes input, and deletion fences stale editors', async (t) => {
  const { disk, services, id, backend, traffic } = await setup(t, true);
  services.chat.editDraft(id, 'Saved question'); const write = disk.storage.set;
  disk.storage.set = () => { throw new Error('disk full'); };
  assert.equal(services.chat.editDraft(id, 'Newest unsaved question').error, 'storage-write');
  assert.equal(services.chat.getState(id).draft.text, 'Newest unsaved question');
  assert.equal(services.chat.getState(id).draft.saveState, 'failed');
  assert.equal(services.chat.getState(id).draftError, 'storage-write');
  assert.equal(createWechatServices(disk.platform, { backend }).chat.getState(id).draft.text, 'Saved question');
  const before = traffic.length;
  assert.equal((await services.chat.sendDraft(id)).error, 'storage-write'); assert.equal(traffic.length, before);
  disk.storage.set = write;
  assert.equal(services.chat.retryDraftSave(id).ok, true);
  assert.equal(createWechatServices(disk.platform, { backend }).chat.getState(id).draft.text, 'Newest unsaved question');
  disk.storage.set = () => { throw new Error('disk full'); };
  assert.equal((await services.chat.sendDraft(id)).error, 'storage-write');
  assert.equal(services.chat.getState(id).draft.text, 'Newest unsaved question');
  assert.equal(services.chat.getState(id).messages.length, 0);
  disk.storage.set = write;
  assert.equal(services.records.markDeleted([id]).ok, true);
  assert.equal(services.chat.editDraft(id, 'Stale page input').error, 'record-missing');
  assert.equal(services.chat.getState(id).draft.text, '');
  assert.equal(services.chat.retryDraftSave(id).error, 'record-missing');
});

test('chat reading anchors and bottom intent survive recreation independently of result reading, with stable invalid-anchor fallback', async (t) => {
  const { disk, services, id, backend } = await setup(t, true);
  await services.chat.sendQuickQuestion(id, 'explain'); await services.chat.sendQuickQuestion(id, 'price');
  const state = services.chat.getState(id); const replyId = state.messages[1].id;
  const reading = { anchorId: replyId, offset: -92, scrollTop: 560, atBottom: false,
    seenReplies: { [replyId]: state.record.chatJobs[replyId].revision } };
  assert.equal(services.history.saveChatPosition(id, reading).ok, true);
  services.history.saveResultPosition(id, { anchorId: null, offset: 0, scrollTop: 20 });
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.history.getChatPosition(id), reading);
  assert.equal(reopened.history.getResultPosition(id).scrollTop, 20);
  assert.equal(reopened.history.saveChatPosition(id, { ...reading, anchorId: 'deleted-message' }).ok, true);
  assert.deepEqual(reopened.history.getChatPosition(id), { anchorId: null, offset: 0, scrollTop: 0, atBottom: false, seenReplies: {} });
  const write = disk.storage.set; disk.storage.set = () => { throw new Error('no space'); };
  assert.equal(reopened.history.saveChatPosition(id, reading).error, 'storage-write'); disk.storage.set = write;
  services.records.markDeleted([id]);
  assert.equal(reopened.history.saveChatPosition(id, reading).error, 'record-missing');
  assert.equal(reopened.history.getChatPosition(id).anchorId, null);
});

function nativePage(t, env) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, previous));
  let services = env.services; let viewHeight = 430; let page; const scrollWrites = []; const navigations = [];
  let tops = [];
  function rectangles() {
    return page.data.messages.map((message, index) => ({ id: `message-${message.id}`, dataset: { messageId: message.id },
      top: 70 + (tops[index] === undefined ? index * 350 : tops[index]) - page.data.chatScrollTop,
      bottom: 70 + (tops[index] === undefined ? index * 350 : tops[index]) + 310 - page.data.chatScrollTop }));
  }
  global.getApp = () => ({ services }); global.getCurrentPages = () => [{}, {}];
  global.wx = { setNavigationBarTitle() {}, nextTick(fn) { fn(); }, navigateTo({ url }) { navigations.push(url); }, navigateBack() { navigations.push('back'); },
    createSelectorQuery() {
      const operations = []; let selector;
      return { in() { return this; }, select(value) { selector = value; return this; }, selectAll(value) { selector = value; return this; },
        fields() { operations.push(selector); return this; }, boundingClientRect() { operations.push(selector); return this; },
        scrollOffset() { operations.push('offset'); return this; }, exec(fn) { fn(operations.map((value) => value === '.chat-messages' ? { top: 70, bottom: 70 + viewHeight, height: viewHeight } : value === 'offset' ? { scrollTop: page.data.chatScrollTop || 0 } : value === '.chat-content' ? { height: page.data.messages.length * 350 + 100 } : rectangles())); } };
    }
  };
  function load() {
    let definition; global.Page = (value) => { definition = value; }; const filename = require.resolve('../miniprogram/pages/chat/chat'); delete require.cache[filename]; require(filename);
    page = { ...definition, data: structuredClone(definition.data), setData(values, callback) {
      if ('chatScrollTop' in values) scrollWrites.push(values.chatScrollTop);
      Object.assign(this.data, values); if (callback) callback();
    } };
    page.onLoad({ recordId: encodeURIComponent(env.id) }); return page;
  }
  return { load, scrollWrites, navigations, setServices(value) { services = value; }, setHeight(value) { viewHeight = value; }, setTops(value) { tops = value; } };
}

test('native chat restores the old-message anchor and durable composer, holds position for new replies, and follows only after explicit latest', async (t) => {
  const env = await setup(t, true); const { services, id, disk, backend } = env;
  await services.chat.sendQuickQuestion(id, 'explain'); await services.chat.sendQuickQuestion(id, 'price');
  const ui = nativePage(t, env); let page = ui.load(); page.onShow();
  page.onInput({ detail: { value: 'Draft survives leaving to read a dish' } });
  assert.equal(createWechatServices(disk.platform, { backend }).chat.getState(id).draft.text, 'Draft survives leaving to read a dish');
  page.onMessagesScroll({ detail: { scrollTop: 440, scrollHeight: 1500 } });
  assert.equal(services.history.getChatPosition(id).anchorId, page.data.messages[1].id);
  assert.equal(services.history.getChatPosition(id).offset, -90);
  const before = ui.scrollWrites.length;
  await services.chat.sendQuickQuestion(id, 'communicate');
  assert.equal(page.data.chatScrollTop, 440); assert.equal(page.data.hasNewReply, true);
  assert.equal(ui.scrollWrites.slice(before).some((top) => top > 440), false);
  page.onHide();
  ui.setServices(createWechatServices(disk.platform, { backend })); page = ui.load(); page.onShow();
  assert.equal(page.data.chatScrollTop, 440); assert.equal(page.data.hasNewReply, true);
  assert.equal(page.data.draft, 'Draft survives leaving to read a dish');
  ui.setHeight(200); page.onKeyboardHeight({ detail: { height: 230 } });
  assert.equal(page.data.chatScrollTop, 440); assert.equal(page.data.keyboardHeight, 230);
  page.viewLatest(); assert.equal(page.data.hasNewReply, false); assert.equal(page.data.chatScrollTop, 2000);
  assert.equal(services.history.getChatPosition(id).atBottom, true);
  await services.chat.sendQuickQuestion(id, 'price');
  // Reopened page uses another service instance; show is the native reentry/refresh boundary.
  page.show(); assert.equal(page.data.chatScrollTop, 2700); assert.equal(page.data.hasNewReply, false);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); page.onShow();
    assert.ok(page.data.chatCopy.newReply); assert.ok(page.data.chatCopy.clearDraft); assert.ok(page.data.chatCopy.draftSaveFailed);
    assert.equal(page.data.draft, 'Draft survives leaving to read a dish');
  }
  page.clearDraft(); assert.equal(page.data.draft, ''); assert.equal(services.chat.getState(id).messages.length, 8); page.onUnload();
});

test('five-language native draft and reading save failures are separate, visible, and explicitly retryable', async (t) => {
  const env = await setup(t, true); const { disk, services, id } = env;
  await services.chat.sendQuickQuestion(id, 'explain'); await services.chat.sendQuickQuestion(id, 'price');
  const ui = nativePage(t, env); const page = ui.load(); page.onShow();
  const write = disk.storage.set;
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language); page.onShow();
    disk.storage.set = () => { throw new Error('disk full'); };
    assert.equal(page.onInput({ detail: { value: `Keep this ${language} draft` } }).error, 'storage-write');
    page.onMessagesScroll({ detail: { scrollTop: 400, scrollHeight: 1500 } });
    assert.equal(page.data.draftSaveFailed, true); assert.equal(page.data.positionSaveFailed, true);
    assert.equal(page.data.draft, `Keep this ${language} draft`);
    assert.ok(page.data.chatCopy.draftSaveFailed); assert.ok(page.data.chatCopy.positionSaveFailed);
    assert.equal(services.history.list().entries.find((entry) => entry.id === id).saveState, 'failed');
    disk.storage.set = write;
    assert.equal(page.retryDraftSave().ok, true); assert.equal(page.retryReadingSave().ok, true);
    assert.equal(page.data.draftSaveFailed, false); assert.equal(page.data.positionSaveFailed, false);
    assert.equal(createWechatServices(disk.platform).chat.getState(id).draft.text, `Keep this ${language} draft`);
    assert.equal(createWechatServices(disk.platform).history.getChatPosition(id).scrollTop, 400);
  }
  page.onUnload();
});
