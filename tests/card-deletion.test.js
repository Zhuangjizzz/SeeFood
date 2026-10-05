const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalStore } = require('../miniprogram/core/local-store');
const { createCardLibrary } = require('../miniprogram/core/card-library');
const { fileStorage } = require('./support/storage');

test('deleting the first preset updates the library and never restores it on reopening', (t) => {
  const driver = fileStorage(t);
  const library = createCardLibrary({ store: createLocalStore(driver) });
  const original = library.getState().allCards;

  assert.deepEqual(library.deleteCard('personal-preset-less-spicy'), { ok: true });
  assert.deepEqual(library.getState().allCards, original.slice(1));
  assert.equal(library.getState().topCard.id, 'personal-preset-water');
  assert.deepEqual(library.getState().counts, { all: 5, dietary: 2, service: 3 });

  const reopened = createCardLibrary({ store: createLocalStore(driver), getLanguage: () => 'ja' });
  assert.deepEqual(reopened.getState().allCards.map((card) => card.id), [
    'personal-preset-water', 'personal-preset-ingredients', 'personal-preset-tableware',
    'personal-preset-no-meat', 'personal-preset-bill'
  ]);
  assert.deepEqual(reopened.getState().position, { cardId: 'personal-preset-water', offset: 0 });
});

test('management is available only on visible expanded cards and menu actions never also show a card', (t) => {
  const library = createCardLibrary({ store: createLocalStore(fileStorage(t)) });
  const id = 'personal-preset-less-spicy';
  assert.deepEqual(library.openMenu(id), { ok: false, error: 'menu-unavailable' });
  assert.equal(library.getState().menuCard, null);

  library.expand();
  library.beginTouch({ cardId: id, x: 20, y: 30 });
  assert.equal(library.openMenu(id).ok, true);
  assert.equal(library.getState().menuCard.id, id);
  assert.equal(library.longPress().action, 'none');
  library.tapCard(id);
  assert.equal(library.getState().displayCard, null);
  library.closeMenu();
  library.tapCard(id);
  assert.equal(library.getState().displayCard, null);

  library.openMenu(id);
  library.selectCategory('service');
  assert.equal(library.getState().menuCard, null);
  assert.deepEqual(library.openMenu(id), { ok: false, error: 'menu-unavailable' });
  library.openMenu('personal-preset-water');
  library.collapse();
  library.expand();
  assert.equal(library.getState().menuCard, null);

  library.beginTouch({ cardId: 'personal-preset-water', x: 20, y: 30 });
  library.endTouch();
  library.tapCard('personal-preset-water');
  assert.equal(library.getState().displayCard.id, 'personal-preset-water');
});

test('a failed deletion keeps the saved card and offers an explicit retry after other view changes', (t) => {
  const driver = fileStorage(t);
  const library = createCardLibrary({ store: createLocalStore(driver) });
  const before = library.getState().allCards;
  const write = driver.set;
  driver.set = (key, value) => {
    if (key.endsWith('personal-cards')) throw new Error('Device is full');
    write(key, value);
  };
  library.expand();
  library.openMenu('personal-preset-less-spicy');
  assert.deepEqual(library.deleteCard('personal-preset-less-spicy'), { ok: false, error: 'storage-write' });
  assert.deepEqual(library.getState().allCards, before);
  assert.equal(library.getState().error, 'storage-write');
  assert.equal(library.getState().pendingDeletionId, 'personal-preset-less-spicy');
  assert.deepEqual(createCardLibrary({ store: createLocalStore(driver) }).getState().allCards, before);

  library.closeMenu();
  library.selectCategory('service');
  library.reload();
  assert.equal(library.getState().error, 'storage-write');
  assert.equal(library.getState().pendingDeletionId, 'personal-preset-less-spicy');
  driver.set = write;
  assert.deepEqual(library.retryDeletion(), { ok: true });
  assert.equal(library.getState().pendingDeletionId, null);
  assert.equal(library.getState().error, null);
  assert.deepEqual(createCardLibrary({ store: createLocalStore(driver) }).getState().allCards, before.slice(1));
});

test('deleting a reading anchor and the final cards recovers remaining content and durable empty states', (t) => {
  const driver = fileStorage(t);
  const store = createLocalStore(driver);
  const personalCards = [
    { id: 'preset', order: 0, title: 'Preset', textZh: '请少放辣。', pairedText: 'Less spicy.', pairedLanguage: 'en', category: 'dietary', presetId: 'less-spicy', edited: false, color: 'green', saveState: 'saved' },
    { id: 'created', order: 4, title: 'My request', textZh: '请给我热水。', pairedText: 'Warm water.', pairedLanguage: 'en', category: 'service', edited: true, color: 'blue', saveState: 'saved' },
    { id: 'favorite', order: 8, title: 'Saved question', textZh: '宫保鸡丁里有花生吗？', pairedText: 'Does 宫保鸡丁 contain peanuts?', pairedLanguage: 'en', category: 'dietary', sourceMessageId: 'message-1', edited: false, color: 'orange', saveState: 'saved' }
  ];
  const record = { id: 'record-1', messageIds: ['message-1'], cardIds: [], imageIds: ['image-1'] };
  store.set('records', [record]);
  store.set('personal-cards', { initialized: true, cards: personalCards, reorderLearned: true });
  const library = createCardLibrary({ store });
  library.expand();
  library.selectCategory('service');
  library.rememberPosition({ cardId: 'created', offset: 123 });
  library.beginTouch({ cardId: 'created', x: 30, y: 30 });
  assert.equal(library.deleteCard('created').ok, true);
  library.endTouch();
  library.tapCard('favorite');
  assert.equal(library.getState().displayCard, null);
  assert.equal(library.getState().category, 'service');
  assert.equal(library.getState().expanded, true);
  assert.equal(library.getState().topCard, null);
  assert.deepEqual(library.getState().counts, { all: 2, dietary: 2, service: 0 });
  assert.deepEqual(library.getState().position, { cardId: null, offset: 0 });
  library.selectCategory('all');
  assert.deepEqual(library.getState().position, { cardId: 'preset', offset: 0 });
  assert.deepEqual(library.getState().allCards, [personalCards[0], personalCards[2]]);

  library.selectCategory('dietary');
  assert.equal(library.deleteCard('preset').ok, true);
  assert.equal(library.getState().topCard.id, 'favorite');
  assert.equal(library.deleteCard('favorite').ok, true);
  assert.equal(library.getState().topCard, null);
  assert.deepEqual(library.getState().position, { cardId: null, offset: 0 });
  assert.deepEqual(library.getState().counts, { all: 0, dietary: 0, service: 0 });

  const reopened = createCardLibrary({ store: createLocalStore(driver) });
  assert.equal(reopened.getState().category, 'dietary');
  assert.equal(reopened.getState().expanded, true);
  reopened.selectCategory('all');
  assert.deepEqual(reopened.getState().cards, []);
  assert.deepEqual(store.get('records'), [record]);
  assert.equal(store.get('personal-cards').reorderLearned, true);
});
