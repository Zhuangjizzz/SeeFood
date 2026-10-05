const { createPresetCards } = require('./card-presets');
const CATEGORIES = ['all', 'dietary', 'service'];
const GESTURE = { holdMs: 420, moveSlop: 10 };

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createCardLibrary({ store, getLanguage = () => 'en' }) {
  let cards = [];
  let error = null;
  let readable = false;
  let displayId = null;
  let menuId = null;
  let pendingDeletionId = null;
  let deleteError = null;
  let touch = null;
  let suppressTap = false;
  let view = { category: 'all', expanded: false, position: null, expandLearned: false };
  function load() {
    readable = false;
    let saved;
    let savedView;
    try {
      saved = store.get('personal-cards');
      savedView = store.get('card-library-view', {});
    } catch (_) { error = 'storage-read'; return { ok: false, error }; }
    if (saved === undefined) {
      saved = { initialized: true, cards: createPresetCards(getLanguage()) };
      try { store.set('personal-cards', saved); }
      catch (_) { error = 'storage-write'; return { ok: false, error }; }
    }
    if (!saved || saved.initialized !== true || !Array.isArray(saved.cards) ||
        saved.cards.some((card) => !card || typeof card.id !== 'string' || !Number.isFinite(card.order) || typeof card.textZh !== 'string') ||
        new Set(saved.cards.map((card) => card.id)).size !== saved.cards.length ||
        !savedView || typeof savedView !== 'object' || Array.isArray(savedView)) {
      error = 'storage-read';
      return { ok: false, error };
    }
    cards = saved.cards;
    view = Object.assign(view, savedView);
    if (!CATEGORIES.includes(view.category)) view.category = 'all';
    view.expanded = view.expanded === true;
    readable = true;
    error = null;
    return { ok: true };
  }
  load();

  function visibleCards() {
    return cards.filter((card) => view.category === 'all' || card.category === view.category)
      .sort((a, b) => a.order - b.order);
  }

  function position() {
    const visible = visibleCards();
    const saved = view.position;
    if (saved && visible.some((card) => card.id === saved.cardId) && Number.isFinite(saved.offset) && saved.offset >= 0) {
      return clone(saved);
    }
    return { cardId: visible.length ? visible[0].id : null, offset: 0 };
  }

  function saveView(patch) {
    if (!readable) return { ok: false, error: error || 'storage-read' };
    const next = Object.assign({}, view, patch);
    try { store.set('card-library-view', next); }
    catch (_) { error = 'storage-write'; return { ok: false, error }; }
    view = next;
    error = null;
    return { ok: true };
  }

  const library = {
    reload: load,
    getState() {
      const allCards = clone(cards).sort((a, b) => a.order - b.order).map((card) => {
        if (!card.edited && card.presetId && card.translations) {
          Object.assign(card, card.translations[getLanguage()] || card.translations.en);
        }
        return card;
      });
      const visible = allCards.filter((card) => view.category === 'all' || card.category === view.category);
      const displayed = allCards.find((card) => card.id === displayId);
      return Object.assign({}, view, {
        error: deleteError || error, pendingDeletionId, deleteError,
        allCards, cards: visible, topCard: visible[0] || null,
        menuCard: view.expanded ? visible.find((card) => card.id === menuId) || null : null,
        position: position(), showExpandHint: !view.expandLearned,
        displayCard: displayed ? Object.assign({}, displayed, {
          primaryText: displayed.textZh,
          secondaryText: displayed.pairedLanguage === 'zh-CN' || displayed.pairedText === displayed.textZh ? null : displayed.pairedText
        }) : null,
        counts: {
          all: cards.length,
          dietary: cards.filter((card) => card.category === 'dietary').length,
          service: cards.filter((card) => card.category === 'service').length
        }
      });
    },
    selectCategory(category) {
      if (!CATEGORIES.includes(category)) return { ok: false, error: 'invalid-category' };
      if (category === view.category) return { ok: true };
      library.closeMenu();
      return saveView({ category, position: null });
    },
    expand() { return saveView({ expanded: true, expandLearned: true }); },
    collapse() {
      library.closeMenu();
      suppressTap = true;
      touch = null;
      return saveView({ expanded: false, position: null });
    },
    rememberPosition(next) { return saveView({ position: clone(next) }); },
    openMenu(id) {
      if (!view.expanded || !visibleCards().some((card) => card.id === id)) return { ok: false, error: 'menu-unavailable' };
      library.cancelTouch();
      displayId = null;
      menuId = id;
      return { ok: true };
    },
    closeMenu() { menuId = null; library.cancelTouch(); },
    deleteCard(id) {
      library.cancelTouch();
      if (!readable) return { ok: false, error: error || 'storage-read' };
      if (!cards.some((card) => card.id === id)) return { ok: false, error: 'card-not-found' };
      const remaining = cards.filter((card) => card.id !== id);
      let saved;
      try { saved = store.get('personal-cards'); }
      catch (_) { pendingDeletionId = id; deleteError = 'storage-read'; return { ok: false, error: deleteError }; }
      try { store.set('personal-cards', Object.assign({}, saved, { cards: remaining })); }
      catch (_) { pendingDeletionId = id; deleteError = 'storage-write'; return { ok: false, error: deleteError }; }
      cards = remaining;
      if (displayId === id) displayId = null;
      if (menuId === id) menuId = null;
      error = null;
      pendingDeletionId = null;
      deleteError = null;
      return { ok: true };
    },
    retryDeletion() { return pendingDeletionId ? library.deleteCard(pendingDeletionId) : { ok: true }; },
    showCard(id) {
      if (!cards.some((card) => card.id === id)) {
        displayId = null;
        return { ok: false, error: 'card-not-found' };
      }
      displayId = id;
      return { ok: true };
    },
    closeCard() { displayId = null; },
    beginTouch({ cardId, x, y }) {
      suppressTap = false;
      touch = { cardId, x, y, moved: false, held: false };
    },
    moveTouch({ x, y }) {
      if (!touch) return;
      if (Math.hypot(x - touch.x, y - touch.y) > GESTURE.moveSlop) {
        touch.moved = true;
        suppressTap = true;
      }
    },
    longPress() {
      if (!touch || touch.moved || touch.held || !visibleCards().some((card) => card.id === touch.cardId)) return { ok: true, action: 'none' };
      touch.held = true;
      suppressTap = true;
      if (view.expanded) return { ok: true, action: 'hold' };
      const result = library.expand();
      return Object.assign({}, result, { action: result.ok ? 'expand' : 'none' });
    },
    endTouch() { touch = null; },
    cancelTouch() { touch = null; suppressTap = true; },
    tapCard(id) {
      if (suppressTap) return { ok: true, action: 'none' };
      return library.showCard(id);
    }
  };
  return library;
}

module.exports = { createCardLibrary, CATEGORIES, GESTURE };
