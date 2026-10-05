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

test('editing a preset preserves its displayed content until an atomic save and reveals its new category without reordering cards', (t) => {
  const { services, platform, backend } = client(t); const drafts = services.cardDrafts;
  services.application.chooseLanguage('ja');
  const original = services.cardLibrary.getState().allCards.find((card) => card.presetId === 'ingredients');
  const order = services.cardLibrary.getState().allCards.map((card) => [card.id, card.order]);
  assert.equal(drafts.beginEdit(original.id).ok, true);
  assert.equal(drafts.getState().draft.mode, 'edit');
  assert.equal(drafts.getState().draft.title, '材料を教えてください');
  assert.equal(drafts.getState().draft.text, 'この料理にはどんな食材と調味料を使っていますか。');
  assert.equal(drafts.getState().draft.sourceLanguage, 'ja');
  assert.equal(drafts.getState().draft.color, 'orange');
  drafts.edit({ title: 'アレルギーについて', text: 'この料理にナッツは入っていますか。', textZh: '这道菜有坚果吗？', category: 'service', color: 'blue' });
  services.cardLibrary.showCard(original.id);
  assert.equal(services.cardLibrary.getState().displayCard.primaryText, '请问这道菜用了哪些食材和调料？');
  assert.equal(services.cardLibrary.getState().displayCard.title, '材料を教えてください');
  const reopened = createWechatServices(platform, { backend });
  assert.equal(reopened.cardDrafts.beginEdit(original.id).resumable, true);
  assert.equal(reopened.cardDrafts.resumeEdit().ok, true);
  const saved = reopened.cardDrafts.save(); assert.equal(saved.ok, true);
  assert.equal(saved.card.id, original.id); assert.equal(saved.card.edited, true);
  const library = reopened.cardLibrary.getState();
  assert.deepEqual(library.allCards.map((card) => [card.id, card.order]), order);
  assert.equal(library.category, 'service'); assert.equal(library.expanded, true);
  assert.deepEqual(library.position, { cardId: original.id, offset: 0 });
  assert.equal(reopened.cardDrafts.getState().draft, null);
  reopened.application.chooseLanguage('es');
  const offline = createWechatServices(platform, { backend }); offline.cardLibrary.showCard(original.id);
  assert.equal(offline.cardLibrary.getState().displayCard.title, 'アレルギーについて');
  assert.equal(offline.cardLibrary.getState().displayCard.primaryText, '这道菜有坚果吗？');
  assert.equal(offline.cardLibrary.getState().displayCard.secondaryText, 'この料理にナッツは入っていますか。');
  assert.equal(offline.records.listRecent().records.length, 0);
});

test('edit-save faults keep the official card and recoverable draft separate from new and other-card drafts', (t) => {
  const { services, platform, backend, storage } = client(t); const drafts = services.cardDrafts;
  const first = services.cardLibrary.getState().allCards[0]; const second = services.cardLibrary.getState().allCards[1];
  drafts.beginNew(); drafts.edit({ text: 'A separate unfinished new card' });
  drafts.beginEdit(first.id); drafts.edit({ text: 'One saved edit', textZh: '第一张修改。', title: 'First edit' });
  drafts.beginEdit(second.id); drafts.edit({ title: 'Second unfinished edit' });
  drafts.beginEdit(first.id); drafts.resumeEdit();
  const write = storage.set;
  storage.set = (key, value) => {
    if (key.endsWith('personal-cards') && value.value.cards.find((card) => card.id === first.id)?.edited) throw new Error('disk full');
    write(key, value);
  };
  assert.equal(drafts.save().error, 'storage-write');
  const beforeRetry = createWechatServices(platform, { backend }); beforeRetry.cardLibrary.showCard(first.id);
  assert.equal(beforeRetry.cardLibrary.getState().displayCard.title, first.title);
  assert.equal(beforeRetry.cardDrafts.beginEdit(first.id).resumable, true); beforeRetry.cardDrafts.resumeEdit();
  assert.equal(beforeRetry.cardDrafts.getState().draft.text, 'One saved edit');
  storage.set = write;
  assert.equal(beforeRetry.cardDrafts.save().ok, true);
  const after = createWechatServices(platform, { backend });
  assert.equal(after.cardDrafts.beginNew().resumable, true); after.cardDrafts.resumeNew();
  assert.equal(after.cardDrafts.getState().draft.text, 'A separate unfinished new card');
  after.cardDrafts.beginEdit(second.id); after.cardDrafts.resumeEdit();
  assert.equal(after.cardDrafts.getState().draft.title, 'Second unfinished edit');
  after.cardDrafts.discard();
  assert.equal(after.cardDrafts.beginEdit(first.id).resumable, undefined);
  assert.equal(after.cardDrafts.getState().draft.text, 'One saved edit');
  storage.set = () => { throw new Error('draft write failed'); };
  after.cardDrafts.edit({ text: 'Unsaved words still in the editor' });
  assert.equal(after.cardDrafts.getState().dirty, true);
  assert.equal(after.cardDrafts.beginEdit(first.id).resumable, true);
  after.cardDrafts.resumeEdit();
  assert.equal(after.cardDrafts.getState().draft.text, 'Unsaved words still in the editor');
  assert.equal(after.cardDrafts.beginNew().ok, false);
  assert.equal(after.cardDrafts.getState().draft.cardId, first.id);
  storage.set = write; assert.equal(after.cardDrafts.retrySave().ok, true);
});

test('deleting the edit target removes its draft and delayed real translations cannot recreate either the draft or the card', async (t) => {
  const server = await start(t, temporary(t));
  const { services, platform, backend } = client(t, { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' });
  const drafts = services.cardDrafts; const target = services.cardLibrary.getState().allCards[0];
  drafts.beginNew(); drafts.edit({ text: 'Keep this separate new draft' });
  drafts.beginEdit(target.id); drafts.edit({ text: 'Please do not add peanuts. Thank you.' });
  const send = platform.request; let release; let accepted;
  const received = new Promise((resolve) => { accepted = resolve; });
  platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) {
      const success = options.success; options.success = (response) => { release = () => success(response); accepted(); };
    }
    send(options);
  };
  const pending = drafts.translate(); await received;
  const current = createWechatServices(platform, { backend });
  assert.equal(current.cardLibrary.deleteCard(target.id).ok, true);
  release(); await pending;
  assert.equal(drafts.getState().draft, null);
  assert.equal(drafts.getState().targetMissing, true);
  assert.equal(drafts.save().ok, false);
  const reopened = createWechatServices(platform, { backend });
  assert.equal(reopened.cardDrafts.beginEdit(target.id).error, 'card-not-found');
  assert.equal(reopened.cardDrafts.getState().targetMissing, true);
  assert.equal(reopened.cardDrafts.getState().draft, null);
  assert.equal(reopened.cardLibrary.getState().allCards.length, 5);
  assert.equal(reopened.cardLibrary.showCard(target.id).error, 'card-not-found');
  reopened.cardDrafts.beginNew(); reopened.cardDrafts.resumeNew();
  assert.equal(reopened.cardDrafts.getState().draft.text, 'Keep this separate new draft');
});

test('returning to an editor whose target was deleted exits its draft even when no translation was started', async (t) => {
  const { services, platform, backend } = client(t); const drafts = services.cardDrafts;
  const target = services.cardLibrary.getState().allCards[1];
  drafts.beginEdit(target.id); drafts.edit({ title: 'A pending title' });
  const anotherPage = createWechatServices(platform, { backend }); anotherPage.cardLibrary.deleteCard(target.id);
  assert.equal((await drafts.refresh()).error, 'card-not-found');
  assert.equal(drafts.getState().targetMissing, true); assert.equal(drafts.getState().draft, null);
  assert.equal(drafts.resumeEdit().error, 'card-not-found');
});

test('discarding an edit preserves the original personal card and rejects a delayed translation from the abandoned scope', async (t) => {
  const server = await start(t, temporary(t));
  const { services, platform, backend } = client(t, { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' });
  const drafts = services.cardDrafts;
  drafts.beginNew(); drafts.edit({ text: 'Water for this table, please.', textZh: '请给这桌一壶水。', title: 'Water for the table', color: 'blue' });
  const original = drafts.save().card;
  drafts.beginEdit(original.id); drafts.edit({ text: 'An unfinished replacement' });
  const send = platform.request; let release; let accepted;
  const received = new Promise((resolve) => { accepted = resolve; });
  platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) {
      const success = options.success; options.success = (response) => { release = () => success(response); accepted(); };
    }
    send(options);
  };
  const pending = drafts.translate(); await received;
  const reopened = createWechatServices(platform, { backend }); reopened.cardDrafts.beginEdit(original.id); reopened.cardDrafts.resumeEdit();
  assert.equal(reopened.cardDrafts.discard().ok, true); release(); await pending;
  const after = createWechatServices(platform, { backend }); after.cardLibrary.showCard(original.id);
  assert.equal(after.cardLibrary.getState().displayCard.title, 'Water for the table');
  assert.equal(after.cardLibrary.getState().displayCard.primaryText, '请给这桌一壶水。');
  assert.equal(after.cardDrafts.beginEdit(original.id).resumable, undefined);
  assert.equal(after.cardDrafts.getState().draft.text, 'Water for this table, please.');
  assert.equal(after.cardDrafts.getState().draft.operation, null);
  after.cardDrafts.edit({ textZh: '请给这桌一壶温水。' });
  const saved = after.cardDrafts.save(); assert.equal(saved.ok, true);
  assert.equal(saved.card.order, original.order); assert.equal(saved.card.color, 'blue');
});

test('editing existing favorite data preserves source metadata and all five saved content languages after interface changes', (t) => {
  const { services, platform, backend, traffic } = client(t);
  // Prior saved personal cards are an input fixture at the local-storage boundary.
  const favorite = { id: 'favorite-1', sourceMessageId: 'message-1', order: -1, title: 'Ask about 宫保鸡丁',
    textZh: '宫保鸡丁里有花生吗？', pairedText: 'Does 宫保鸡丁 contain peanuts?', pairedLanguage: 'en',
    category: 'dietary', color: 'orange', saveState: 'saved', edited: false };
  const envelope = services.store.get('personal-cards'); envelope.cards.unshift(favorite); services.store.set('personal-cards', envelope);
  services.cardDrafts.beginEdit(favorite.id); services.cardDrafts.edit({ title: 'Confirm the peanuts', category: 'service' });
  const updated = services.cardDrafts.save().card;
  assert.equal(updated.sourceMessageId, 'message-1'); assert.equal(updated.order, -1); assert.equal(updated.color, 'orange');
  assert.equal(updated.pairedText, 'Does 宫保鸡丁 contain peanuts?');
  for (const language of ['en', 'ja', 'ko', 'es', 'zh-CN']) {
    services.application.chooseLanguage(language);
    services.cardDrafts.beginEdit('personal-preset-less-spicy');
    assert.equal(services.cardDrafts.getState().draft.sourceLanguage, language);
    services.cardDrafts.discard();
    services.cardDrafts.beginNew(); services.cardDrafts.edit({ text: language === 'zh-CN' ? '请给我热水。' : 'Keep ' + language, textZh: '请给我热水。' });
    const created = services.cardDrafts.save().card;
    services.application.chooseLanguage(language === 'en' ? 'ja' : 'en');
    services.cardDrafts.beginEdit(created.id); services.cardDrafts.edit({ title: 'Edited ' + language });
    assert.equal(services.cardDrafts.getState().draft.sourceLanguage, language);
    const saved = services.cardDrafts.save().card;
    assert.equal(saved.pairedLanguage, language); assert.equal(saved.pairedText, language === 'zh-CN' ? null : 'Keep ' + language);
    const offline = createWechatServices(platform, { backend }); offline.cardLibrary.showCard(created.id);
    assert.equal(offline.cardLibrary.getState().displayCard.title, 'Edited ' + language);
  }
  assert.equal(traffic.length, 0);
});

test('a later read failure cannot erase edited text retained after an autosave failure', async (t) => {
  const { services, storage } = client(t); const drafts = services.cardDrafts;
  const id = services.cardLibrary.getState().allCards[0].id;
  drafts.beginEdit(id); const write = storage.set; const read = storage.get;
  storage.set = () => { throw new Error('write failed'); };
  drafts.edit({ text: 'Please keep this unsaved edit', textZh: '请保留这次修改。' });
  storage.set = write; storage.get = () => { throw new Error('read failed'); };
  assert.equal((await drafts.refresh()).error, 'storage-read');
  storage.get = read; assert.equal(drafts.retrySave().ok, true);
  assert.equal(drafts.getState().draft.text, 'Please keep this unsaved edit');
  assert.equal(drafts.getState().canSave, true);
  assert.equal(drafts.save().card.textZh, '请保留这次修改。');
});
