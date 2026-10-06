const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');

async function setup(t, language = 'en') {
  const disk = recordPlatform(t); const server = await start(t, temporary(t)); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => {
    traffic.push({ method: options.method, url: options.url });
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const text = await response.text(); options.success({ statusCode: response.status, data: text ? JSON.parse(text) : null }); }).catch(options.fail);
  };
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend }); services.application.chooseLanguage(language);
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => language });
  await capture.chooseImages({ source: 'album' }); const saved = await services.records.confirmCapture(capture.confirm().batch); const id = saved.recordId;
  assert.equal((await services.uploads.uploadRecord(id)).ok, true);
  assert.equal((await services.jobs.startImageCards(id)).ok, true);
  assert.equal((await services.chat.sendQuickQuestion(id, 'communicate')).ok, true);
  const message = services.chat.getState(id).messages[1];
  return { disk, server, backend, services, id, message, traffic };
}

test('a real chat favorite saves a complete independent copy at the front and remains readable with unavailable source storage', async (t) => {
  const { disk, server, backend, services, id, message, traffic } = await setup(t, 'ja');
  const originalOrder = services.cardLibrary.getState().allCards.map((card) => [card.id, card.order]);
  services.cardDrafts.beginNew(); services.cardDrafts.edit({ text: 'An unrelated draft' });
  const originalMessages = services.chat.getState(id).messages;
  const result = services.cardFavorites.save(id, message.id, 1);
  assert.equal(result.ok, true); assert.notEqual(result.card.id, message.id);
  assert.deepEqual({ title: result.card.title, category: result.card.category, textZh: result.card.textZh,
    pairedText: result.card.pairedText, pairedLanguage: result.card.pairedLanguage }, {
    title: '示例炒饭について質問', category: 'service', textZh: '请问示例炒饭使用哪些食材，具体怎么做？有什么配料需要进一步确认？',
    pairedText: '示例炒饭の食材と調理方法を教えてください。確認すべき食材はありますか？', pairedLanguage: 'ja'
  });
  assert.equal(result.card.sourceMessageId, message.id); assert.equal(result.card.sourceRecordId, id);
  assert.equal(result.card.saveState, 'saved');
  assert.deepEqual(services.cardLibrary.getState().allCards.slice(1).map((card) => [card.id, card.order]), originalOrder);
  assert.equal(services.cardLibrary.getState().allCards[0].id, result.card.id);
  assert.deepEqual(services.chat.getState(id).messages, originalMessages);
  assert.equal(services.cardDrafts.getState().draft.text, 'An unrelated draft');
  await server.stop(); const sent = traffic.length; const read = disk.storage.get;
  disk.storage.get = (key) => { if (key.endsWith(':records')) throw new Error('source storage unavailable'); return read(key); };
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.records.getRecord(id).ok, false);
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    reopened.application.chooseLanguage(language); reopened.cardLibrary.selectCategory('service');
    assert.equal(reopened.cardLibrary.getState().cards[0].id, result.card.id);
    assert.equal(reopened.cardLibrary.showCard(result.card.id).ok, true);
    assert.equal(reopened.cardLibrary.getState().displayCard.primaryText, '请问示例炒饭使用哪些食材，具体怎么做？有什么配料需要进一步确认？');
    assert.equal(reopened.cardLibrary.getState().displayCard.secondaryText, '示例炒饭の食材と調理方法を教えてください。確認すべき食材はありますか？');
    assert.equal(reopened.cardLibrary.getState().displayCard.pairedLanguage, 'ja');
  }
  assert.equal(traffic.length, sent);
});

test('a failed favorite write retains the reply, retry succeeds once, and repeated collection does not duplicate or move an edited copy', async (t) => {
  const { disk, backend, services, id, message } = await setup(t);
  const originalMessages = services.chat.getState(id).messages; const originalCards = services.cardLibrary.getState().allCards;
  const write = disk.storage.set;
  disk.storage.set = (key, value) => { if (key.endsWith(':personal-cards')) throw new Error('disk full'); write(key, value); };
  assert.equal(services.cardFavorites.save(id, message.id, 1).error, 'storage-write');
  assert.deepEqual(services.chat.getState(id).messages, originalMessages);
  assert.deepEqual(createWechatServices(disk.platform, { backend }).cardLibrary.getState().allCards, originalCards);
  disk.storage.set = write;
  const saved = services.cardFavorites.save(id, message.id, 1); assert.equal(saved.ok, true);
  services.cardDrafts.beginEdit(saved.card.id); services.cardDrafts.edit({ title: 'My saved question', category: 'dietary' });
  assert.equal(services.cardDrafts.save().ok, true);
  services.cardDrafts.beginNew(); services.cardDrafts.edit({ text: 'Another card', textZh: '另一张卡。' }); const newest = services.cardDrafts.save().card;
  const reopened = createWechatServices(disk.platform, { backend });
  const repeated = reopened.cardFavorites.save(id, message.id, 1);
  assert.equal(repeated.ok, true); assert.equal(repeated.alreadySaved, true); assert.equal(repeated.card.id, saved.card.id);
  assert.equal(repeated.card.title, 'My saved question'); assert.equal(repeated.card.category, 'dietary');
  assert.equal(reopened.cardLibrary.getState().allCards[0].id, newest.id);
  assert.equal(reopened.cardLibrary.getState().allCards.length, originalCards.length + 2);
  assert.equal(reopened.cardFavorites.getState(id).cards[0].id, saved.card.id);
  const read = disk.storage.get; disk.storage.get = (key) => { if (key.endsWith(':personal-cards')) throw new Error('read failed'); return read(key); };
  assert.equal(reopened.cardFavorites.save(id, message.id, 1).error, 'storage-read');
  assert.equal(reopened.cardFavorites.getState(id).error, 'storage-read');
  disk.storage.get = read;
  assert.equal(reopened.cardLibrary.deleteCard(saved.card.id).ok, true);
  const again = reopened.cardFavorites.save(id, message.id, 1); assert.equal(again.ok, true); assert.notEqual(again.card.id, saved.card.id);
  assert.deepEqual(reopened.chat.getState(id).messages, originalMessages);
});

test('actual favorite → delete source → offline staff display preserves the copied question while the real record, messages and files disappear', async (t) => {
  const { disk, server, backend, services, id, message, traffic } = await setup(t);
  assert.equal((await services.jobs.startImageTranslation(id)).ok, true);
  const original = services.records.getRecord(id).record;
  assert.equal(fs.existsSync(original.images[0].translation.localPath), true);
  const favorite = services.cardFavorites.save(id, message.id, 1).card;
  assert.ok(favorite);
  const deletion = await services.deletions.deleteRecord(id);
  assert.equal(deletion.ok, true); assert.equal(deletion.localComplete, true); assert.equal(deletion.pending, false);
  assert.equal(services.deletions.getState().entries[0].backendState, 'succeeded');
  assert.equal(services.records.getRecord(id).error, 'record-missing');
  assert.deepEqual(services.chat.getState(id).messages, []);
  assert.equal(fs.existsSync(original.images[0].localOriginalPath), false);
  assert.equal(fs.existsSync(original.images[0].translation.localPath), false);
  assert.equal(services.cardFavorites.save(id, message.id, 1).error, 'card-unavailable');
  await server.stop(); const sent = traffic.length;
  disk.platform.getNetworkType = ({ success }) => success({ networkType: 'none' });
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.network.getState().online, false);
  assert.equal(reopened.records.listHistory().records.length, 0);
  assert.equal(reopened.cardLibrary.showCard(favorite.id).ok, true);
  const displayed = reopened.cardLibrary.getState().displayCard;
  assert.equal(displayed.title, 'Ask about 示例炒饭');
  assert.equal(displayed.primaryText, '请问示例炒饭使用哪些食材，具体怎么做？有什么配料需要进一步确认？');
  assert.equal(displayed.secondaryText, 'Could you confirm the ingredients and preparation of 示例炒饭? Are there any ingredients I should check?');
  assert.equal(displayed.pairedLanguage, 'en'); assert.equal(traffic.length, sent);
});

test('an actual favorite uses the existing edit draft and atomic save, then displays the edited fixed-language copy offline', async (t) => {
  const { disk, server, backend, services, id, message, traffic } = await setup(t, 'es');
  const favorite = services.cardFavorites.save(id, message.id, 1).card;
  const order = services.cardLibrary.getState().allCards.map((card) => [card.id, card.order]);
  const messages = services.chat.getState(id).messages;
  services.application.chooseLanguage('ja');
  assert.equal(services.cardDrafts.beginEdit(favorite.id).ok, true);
  assert.equal(services.cardDrafts.getState().draft.sourceLanguage, 'es');
  services.cardDrafts.edit({ title: 'Confirmar los ingredientes', text: '¿示例炒饭 lleva cacahuetes?', textZh: '请问示例炒饭里面有花生吗？', category: 'dietary', color: 'orange' });
  const write = disk.storage.set;
  disk.storage.set = (key, value) => { if (key.endsWith(':personal-cards') && !value.value.drafts?.['edit:' + favorite.id]) throw new Error('formal save failed'); write(key, value); };
  assert.equal(services.cardDrafts.save().error, 'storage-write');
  const reopened = createWechatServices(disk.platform, { backend }); reopened.cardLibrary.showCard(favorite.id);
  assert.equal(reopened.cardLibrary.getState().displayCard.title, 'Preguntar por 示例炒饭');
  assert.equal(reopened.cardDrafts.beginEdit(favorite.id).resumable, true); reopened.cardDrafts.resumeEdit();
  disk.storage.set = write;
  const edited = reopened.cardDrafts.save().card;
  assert.equal(edited.id, favorite.id); assert.equal(edited.sourceMessageId, message.id); assert.equal(edited.sourceRecordId, id);
  assert.deepEqual(reopened.cardLibrary.getState().allCards.map((card) => [card.id, card.order]), order);
  assert.deepEqual(reopened.chat.getState(id).messages, messages);
  await server.stop(); const sent = traffic.length;
  disk.platform.getNetworkType = ({ success }) => success({ networkType: 'none' });
  const offline = createWechatServices(disk.platform, { backend });
  offline.cardLibrary.showCard(favorite.id);
  assert.equal(offline.cardLibrary.getState().displayCard.primaryText, '请问示例炒饭里面有花生吗？');
  assert.equal(offline.cardLibrary.getState().displayCard.secondaryText, '¿示例炒饭 lleva cacahuetes?');
  assert.equal(offline.cardLibrary.getState().displayCard.pairedLanguage, 'es');
  assert.equal(traffic.length, sent);
});

test('stale rendered card content and non-card attachments cannot save a different question under the tapped control', async (t) => {
  const { services, id, message } = await setup(t);
  const before = services.cardLibrary.getState().allCards.length;
  const wrongContent = { ...message.attachments[1].card, textZh: 'This is not the card currently shown.' };
  assert.equal(services.cardFavorites.save(id, message.id, 1, wrongContent).error, 'card-changed');
  assert.equal(services.cardFavorites.save(id, message.id, 0).error, 'card-unavailable');
  assert.equal(services.cardFavorites.save(id, message.inReplyTo, 1).error, 'card-unavailable');
  assert.equal(services.cardFavorites.save(id, 'other-message', 1).error, 'card-unavailable');
  assert.equal(services.cardFavorites.save('other-record', message.id, 1).error, 'card-unavailable');
  assert.equal(services.cardFavorites.save(id, message.id, -1).error, 'card-unavailable');
  assert.equal(services.cardLibrary.getState().allCards.length, before);
  assert.equal(services.cardFavorites.save(id, message.id, 1, message.attachments[1].card).ok, true);
});

function nativeChat(t, services, id) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  t.after(() => Object.assign(global, previous));
  const navigations = []; let definition;
  global.getApp = () => ({ services }); global.getCurrentPages = () => [{}, {}];
  global.wx = { setNavigationBarTitle() {}, navigateTo: (value) => navigations.push(value), navigateBack: () => navigations.push('back') };
  global.Page = (value) => { definition = value; };
  const filename = require.resolve('../miniprogram/pages/chat/chat'); delete require.cache[filename]; require(filename);
  const page = { ...definition, data: structuredClone(definition.data), setData(values, callback) { Object.assign(this.data, values); if (callback) callback(); } };
  page.onLoad({ recordId: encodeURIComponent(id) }); page.onShow();
  t.after(() => page.onUnload());
  return { page, navigations };
}

test('five-language native chat collection reports real write failures and successful retry inline, keeps the conversation, and allows offline collection', async (t) => {
  const { disk, server, services, id, message } = await setup(t);
  services.chat.editDraft(id, 'Keep this unsent question');
  const { page, navigations } = nativeChat(t, services, id);
  const event = { currentTarget: { dataset: { messageId: message.id, index: 1 } } };
  const originalMessages = services.chat.getState(id).messages; const write = disk.storage.set;
  const labels = { en: 'Save to my cards', ja: 'カードに保存', ko: '내 카드에 저장', es: 'Guardar en mis tarjetas', 'zh-CN': '收藏到沟通卡' };
  for (const language of Object.keys(labels)) {
    services.application.chooseLanguage(language); page.show();
    const shown = page.data.messages[1].communicationCards[0];
    assert.equal(shown.index, 1); assert.equal(page.data.chatCopy.favorite, labels[language]);
    assert.equal(shown.pairedLanguage, 'en');
    disk.storage.set = (key, value) => { if (key.endsWith(':personal-cards')) throw new Error('disk full'); write(key, value); };
    const failed = page.favoriteCard(event); assert.equal(failed.error, 'storage-write');
    assert.equal(page.data.favoriteSaveFailed, true);
    assert.equal(page.data.messages[1].communicationCards[0].saved, false);
    assert.equal(page.data.messages[1].communicationCards[0].favoriteError, page.data.chatCopy.favoriteFailed);
    assert.ok(page.data.chatCopy.favoriteRetry);
    disk.storage.set = write;
    const saved = page.favoriteCard(event); assert.equal(saved.ok, true);
    assert.equal(page.data.favoriteSaveFailed, false);
    assert.equal(page.data.messages[1].communicationCards[0].saved, true);
    assert.equal(page.data.messages[1].communicationCards[0].favoriteError, '');
    assert.ok(page.data.chatCopy.favoriteSaved); assert.equal(page.data.draft, 'Keep this unsent question');
    assert.deepEqual(services.chat.getState(id).messages, originalMessages); assert.deepEqual(navigations, []);
    services.cardLibrary.deleteCard(saved.card.id); page.show();
  }
  await server.stop(); disk.platform.getNetworkType = ({ success }) => success({ networkType: 'none' });
  await services.network.refresh(); page.show();
  assert.equal(page.data.offline, true);
  const saved = page.favoriteCard(event); assert.equal(saved.ok, true);
  const markup = fs.readFileSync(require.resolve('../miniprogram/pages/chat/chat.wxml'), 'utf8');
  assert.match(markup, /class="favorite-card[^\"]*"[^>]*data-message-id="{{item.id}}"[^>]*data-index="{{card.index}}"[^>]*bindtap="favoriteCard"/);
  assert.match(markup, /card\.favoriteError/); assert.match(markup, /chatCopy\.favoriteSaved/);
});

test('all five generated card languages survive collection and Chinese displays only one body', async (t) => {
  const { disk, server, backend, services, id, message, traffic } = await setup(t);
  const savedCards = [services.cardFavorites.save(id, message.id, 1).card];
  for (const language of ['ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language);
    assert.equal((await services.chat.sendQuickQuestion(id, 'communicate')).ok, true);
    const reply = services.chat.getState(id).messages.at(-1);
    const collected = services.cardFavorites.save(id, reply.id, 1);
    assert.equal(collected.ok, true); assert.equal(collected.card.pairedLanguage, language);
    savedCards.push(collected.card);
  }
  const before = services.chat.getState(id).messages;
  await server.stop(); const sent = traffic.length;
  const reopened = createWechatServices(disk.platform, { backend });
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    reopened.application.chooseLanguage(language);
    for (const saved of savedCards) {
      reopened.cardLibrary.showCard(saved.id); const shown = reopened.cardLibrary.getState().displayCard;
      assert.equal(shown.title, saved.title); assert.equal(shown.primaryText, saved.textZh);
      assert.equal(shown.secondaryText, saved.pairedText); assert.equal(shown.pairedLanguage, saved.pairedLanguage);
    }
  }
  const chinese = savedCards.at(-1);
  assert.equal(chinese.title, '询问示例炒饭'); assert.equal(chinese.pairedText, null);
  assert.deepEqual(reopened.chat.getState(id).messages, before); assert.equal(traffic.length, sent);
});

test('a delivered reply that failed local record saving can still be collected independently without rewriting the source', async (t) => {
  const { disk, backend, services, id } = await setup(t);
  const oldMessages = services.chat.getState(id).messages; const write = disk.storage.set;
  disk.storage.set = (key, value) => {
    if (key.endsWith(':records') && value.value.find((record) => record.id === id)?.messages?.[3]?.complete) throw new Error('source save failed');
    write(key, value);
  };
  assert.equal((await services.chat.sendQuickQuestion(id, 'communicate')).error, 'storage-write');
  const reply = services.chat.getState(id).messages[3]; assert.equal(reply.unsaved, true);
  const favorite = services.cardFavorites.save(id, reply.id, 1); assert.equal(favorite.ok, true);
  const reopened = createWechatServices(disk.platform, { backend });
  assert.deepEqual(reopened.chat.getState(id).messages.slice(0, 2), oldMessages);
  assert.notEqual(reopened.chat.getState(id).messages[3].state, 'complete');
  reopened.cardLibrary.showCard(favorite.card.id);
  assert.equal(reopened.cardLibrary.getState().displayCard.primaryText, '请问示例炒饭使用哪些食材，具体怎么做？有什么配料需要进一步确认？');
  assert.equal(services.chat.getState(id).messages[3].unsaved, true);
});
