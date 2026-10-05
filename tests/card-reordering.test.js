const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalStore } = require('../miniprogram/core/local-store');
const { fileStorage } = require('./support/storage');
const { createCardLibrary } = require('../miniprogram/core/card-library');

test('a new hold after spreading lifts a card and dropping saves the complete global order without displaying it', (t) => {
  const driver = fileStorage(t);
  const library = createCardLibrary({ store: createLocalStore(driver) });
  const before = library.getState().cards;
  library.beginTouch({ cardId: before[0].id, x: 20, y: 60 });
  assert.equal(library.longPress().action, 'expand');
  library.moveTouch({ x: 20, y: 460 });
  library.endTouch();
  assert.deepEqual(library.getState().cards, before);

  library.beginTouch({ cardId: before[2].id, x: 20, y: 460, layout: { stride: 200, scrollTop: 0 } });
  assert.equal(library.longPress().action, 'drag');
  library.moveTouch({ x: 20, y: 60 });
  assert.equal(library.getState().drag.toIndex, 0);
  assert.equal(library.getState().drag.cardId, before[2].id);
  assert.deepEqual(library.getState().cards.map((card) => card.presetId), ['ingredients', 'less-spicy', 'water', 'tableware', 'no-meat', 'bill']);
  assert.deepEqual(library.getState().allCards, before);
  assert.deepEqual(library.endTouch(), { ok: true, action: 'reorder' });
  library.tapCard(before[2].id);
  assert.equal(library.getState().displayCard, null);
  assert.equal(library.getState().drag, null);
  assert.equal(library.getState().reorderSaveState, 'saved');
  const restarted = createCardLibrary({ store: createLocalStore(driver) });
  assert.deepEqual(restarted.getState().cards.map((card) => card.presetId), ['ingredients', 'less-spicy', 'water', 'tableware', 'no-meat', 'bill']);
  assert.equal(restarted.getState().showSortHint, false);
});

test('ordinary movement, unchanged drops, and empty or single-card categories do not count as a completed reorder', (t) => {
  const store = createLocalStore(fileStorage(t));
  const library = createCardLibrary({ store });
  library.expand();
  const first = library.getState().topCard;
  library.beginTouch({ cardId: first.id, x: 20, y: 60 });
  library.moveTouch({ x: 20, y: 71 });
  assert.equal(library.longPress().action, 'none');
  library.endTouch();
  library.tapCard(first.id);
  assert.equal(library.getState().displayCard, null);
  library.beginTouch({ cardId: first.id, x: 20, y: 60, layout: { stride: 200 } });
  library.moveTouch({ x: 20, y: 70 });
  assert.equal(library.longPress().action, 'drag');
  library.moveTouch({ x: 20, y: 100 });
  assert.equal(library.endTouch().action, 'none');
  assert.equal(library.getState().showSortHint, true);
  assert.equal(createCardLibrary({ store }).getState().showSortHint, true);
  store.set('personal-cards', { initialized: true, cards: [first] });
  library.reload();
  library.beginTouch({ cardId: first.id, x: 20, y: 60 });
  assert.equal(library.longPress().action, 'none');
  assert.equal(library.getState().drag, null);
  assert.equal(library.getState().showSortHint, false);
  library.selectCategory('service');
  library.beginTouch({ cardId: first.id, x: 20, y: 60 });
  assert.equal(library.longPress().action, 'none');
  assert.equal(library.getState().drag, null);
});

test('holding at a viewport edge scrolls a long library within its bounds and moves the drop slot with the content', (t) => {
  const store = createLocalStore(fileStorage(t));
  store.set('personal-cards', { initialized: true, cards: Array.from({ length: 30 }, (_, order) => ({
    id: 'long-' + order, order, title: 'Card ' + order, category: 'dietary',
    color: 'green', edited: true, saveState: 'saved', textZh: '请确认。', pairedText: 'Please check.', pairedLanguage: 'en'
  })) });
  const library = createCardLibrary({ store });
  library.expand();
  library.beginTouch({ cardId: 'long-1', x: 20, y: 300, layout: { stride: 100, scrollTop: 0, top: 100, bottom: 500, maxScroll: 2600 } });
  library.longPress();
  library.moveTouch({ x: 20, y: 490 });
  assert.deepEqual(library.advanceDragScroll(), { ok: true, action: 'scroll', scrollTop: 18 });
  for (let tick = 0; tick < 180; tick++) library.advanceDragScroll();
  assert.equal(library.getState().drag.scrollTop, 2600);
  assert.equal(library.getState().drag.toIndex, 29);
  assert.equal(library.advanceDragScroll().action, 'none');
  library.moveTouch({ x: 20, y: 110 });
  assert.equal(library.advanceDragScroll().scrollTop, 2582);
  for (let tick = 0; tick < 180; tick++) library.advanceDragScroll();
  assert.equal(library.getState().drag.scrollTop, 0);
  assert.equal(library.getState().drag.toIndex, 0);
  library.moveTouch({ x: 20, y: 300 });
  assert.equal(library.advanceDragScroll().action, 'none');
  library.cancelTouch();
  assert.equal(library.advanceDragScroll().action, 'none');
  assert.equal(library.getState().reorderFeedback, 'cancelled');
  assert.equal(createCardLibrary({ store }).getState().allCards[0].id, 'long-0');
});

test('cancel, collapse, category changes and reload discard a lifted move without saving or opening a card', (t) => {
  for (const cancel of ['cancelTouch', 'collapse', 'selectCategory', 'reload']) {
    const library = createCardLibrary({ store: createLocalStore(fileStorage(t)) });
    library.expand();
    const original = library.getState().allCards;
    library.beginTouch({ cardId: original[0].id, x: 20, y: 60, layout: { stride: 200 } });
    library.longPress();
    library.moveTouch({ x: 20, y: 460 });
    library[cancel]('service');
    assert.equal(library.getState().drag, null, cancel);
    library.endTouch();
    library.tapCard(original[0].id);
    assert.equal(library.getState().displayCard, null, cancel);
    assert.deepEqual(library.getState().allCards, original, cancel);
    library.expand();
    assert.equal(library.getState().showSortHint, true, cancel);
  }
});

test('a failed drop restores the last complete saved order and remains retryable after browsing and reload', (t) => {
  const driver = fileStorage(t);
  const library = createCardLibrary({ store: createLocalStore(driver) });
  library.expand();
  const original = library.getState().allCards;
  const write = driver.set;
  driver.set = (key, value) => { if (key.endsWith('personal-cards')) throw new Error('no free space'); write(key, value); };
  library.beginTouch({ cardId: original[2].id, x: 20, y: 460, layout: { stride: 200 } });
  library.longPress();
  library.moveTouch({ x: 20, y: 60 });
  assert.deepEqual(library.endTouch(), { ok: false, error: 'storage-write' });
  assert.equal(library.getState().pendingReorder, true);
  assert.equal(library.getState().reorderSaveState, 'failed');
  assert.equal(library.getState().showSortHint, true);
  assert.deepEqual(library.getState().allCards, original);
  library.rememberPosition({ cardId: original[1].id, offset: 20 });
  library.selectCategory('service');
  library.reload();
  assert.equal(library.getState().error, 'storage-write');
  assert.equal(library.getState().pendingReorder, true);
  assert.deepEqual(createCardLibrary({ store: createLocalStore(driver) }).getState().allCards, original);
  driver.set = write;
  assert.equal(library.retryReorder().ok, true);
  assert.equal(library.getState().pendingReorder, false);
  assert.equal(library.getState().reorderSaveState, 'saved');
  const reopened = createCardLibrary({ store: createLocalStore(driver) });
  assert.deepEqual(reopened.getState().allCards.map((card) => card.presetId), ['ingredients', 'less-spicy', 'water', 'tableware', 'no-meat', 'bill']);
  assert.equal(reopened.getState().showSortHint, false);
});

test('reordering dietary cards swaps only their occupied global positions and collapse shows the new first card', (t) => {
  const store = createLocalStore(fileStorage(t));
  const library = createCardLibrary({ store });
  const original = library.getState().allCards;
  library.selectCategory('dietary');
  library.expand();
  library.beginTouch({ cardId: original[2].id, x: 20, y: 260, layout: { stride: 200 } });
  library.longPress();
  library.moveTouch({ x: 20, y: 60 });
  assert.equal(library.endTouch().ok, true);
  assert.deepEqual(library.getState().allCards.map((card) => card.presetId), ['ingredients', 'water', 'less-spicy', 'tableware', 'no-meat', 'bill']);
  assert.deepEqual(library.getState().allCards.filter((card) => card.category === 'service'), original.filter((card) => card.category === 'service'));
  library.collapse();
  assert.equal(library.getState().topCard.presetId, 'ingredients');
  library.showCard(original[4].id);
  library.closeCard();
  const restarted = createCardLibrary({ store });
  assert.deepEqual(restarted.getState().allCards.map((card) => card.presetId), ['ingredients', 'water', 'less-spicy', 'tableware', 'no-meat', 'bill']);
  assert.deepEqual(restarted.getState().cards.map((card) => card.presetId), ['ingredients', 'less-spicy', 'no-meat']);
});
