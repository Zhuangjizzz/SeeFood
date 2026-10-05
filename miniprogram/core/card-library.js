const { createPresetCards } = require('./card-presets');
const CATEGORIES = ['all', 'dietary', 'service'];
const GESTURE = { holdMs: 420, moveSlop: 10, edgeBand: 48, edgeStep: 18, edgeTickMs: 32 };

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createCardLibrary({ store, getLanguage = () => 'en' }) {
  let cards = [];
  let error = null;
  let readable = false;
  let displayId = null;
  let pendingRevealId = null;
  let menuId = null;
  let pendingDeletionId = null;
  let deleteError = null;
  let touch = null;
  let drag = null;
  let reorderLearned = false;
  let pendingReorder = null;
  let reorderFeedback = null;
  let suppressTap = false;
  let view = { category: 'all', expanded: false, position: null, expandLearned: false };
  function load() {
    if (touch || drag) cancelGesture();
    else suppressTap = false;
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
    reorderLearned = saved.reorderLearned === true;
    view = Object.assign(view, savedView);
    if (!CATEGORIES.includes(view.category)) view.category = 'all';
    view.expanded = view.expanded === true;
    readable = true;
    error = null;
    if (pendingRevealId) revealCard(pendingRevealId);
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

  function revealCard(id) {
    const card = cards.find((item) => item.id === id);
    if (!card) { pendingRevealId = null; return { ok: false, error: 'card-not-found' }; }
    // Returning from a successful save must show that card even if persisting
    // the optional browsing position fails. A later reload retries this view.
    const first = cards.filter((item) => item.category === card.category).sort((a, b) => a.order - b.order)[0];
    view = Object.assign({}, view, { category: card.category, expanded: view.expanded || first.id !== id, position: { cardId: id, offset: 0 } });
    const result = saveView({}); pendingRevealId = result.ok ? null : id; return result;
  }

  function previewCards(visible) {
    if (!drag) return visible;
    const reordered = visible.slice();
    reordered.splice(drag.toIndex, 0, reordered.splice(drag.fromIndex, 1)[0]);
    return reordered;
  }

  function cancelGesture() {
    if (drag) reorderFeedback = 'cancelled';
    drag = null;
    touch = null;
    suppressTap = true;
  }

  function updateDrag(y) {
    touch.latestY = y;
    drag.translationY = y - touch.y + drag.scrollTop - drag.startScroll;
    drag.toIndex = Math.max(0, Math.min(visibleCards().length - 1, Math.round(drag.fromIndex + drag.translationY / drag.stride)));
    const { top, bottom } = touch.layout;
    const band = Math.min(GESTURE.edgeBand, (bottom - top) / 2);
    drag.edgeDirection = bottom > top && y < top + band && drag.scrollTop > 0 ? -1 :
      bottom > top && y > bottom - band && drag.scrollTop < drag.maxScroll ? 1 : 0;
  }

  function saveReorder(next) {
    try { store.set('personal-cards', Object.assign({}, store.get('personal-cards'), { cards: next, reorderLearned: true })); }
    catch (_) {
      pendingReorder = next.map((card) => card.id);
      reorderFeedback = 'failed';
      error = 'storage-write';
      return { ok: false, error };
    }
    cards = next;
    reorderLearned = true;
    pendingReorder = null;
    reorderFeedback = 'saved';
    error = null;
    return { ok: true, action: 'reorder' };
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
      const visible = previewCards(allCards.filter((card) => view.category === 'all' || card.category === view.category));
      const displayed = allCards.find((card) => card.id === displayId);
      return Object.assign({}, view, {
        error: deleteError || error || (pendingReorder ? 'storage-write' : null), pendingDeletionId, deleteError,
        allCards, cards: visible, topCard: visible[0] || null,
        menuCard: view.expanded ? visible.find((card) => card.id === menuId) || null : null,
        position: position(), showExpandHint: !view.expandLearned,
        drag: drag ? clone(drag) : null, pendingReorder: !!pendingReorder,
        reorderFeedback,
        reorderSaveState: pendingReorder ? 'failed' : 'saved',
        showSortHint: view.expanded && !reorderLearned && visible.length > 1,
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
      cancelGesture();
      pendingRevealId = null;
      if (category === view.category) return { ok: true };
      library.closeMenu();
      return saveView({ category, position: null });
    },
    revealCard,
    expand() { return saveView({ expanded: true, expandLearned: true }); },
    collapse() {
      library.closeMenu();
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
      let saved;
      try {
        saved = store.get('personal-cards');
        if (!saved || saved.initialized !== true || !Array.isArray(saved.cards)) throw new Error('Unreadable cards');
      }
      catch (_) { pendingDeletionId = id; deleteError = 'storage-read'; return { ok: false, error: deleteError }; }
      const remaining = saved.cards.filter((card) => card.id !== id);
      const drafts = Object.assign({}, saved.drafts);
      Object.keys(drafts).forEach((slot) => { if (drafts[slot]?.mode === 'edit' && drafts[slot].cardId === id) delete drafts[slot]; });
      try { store.set('personal-cards', Object.assign({}, saved, { cards: remaining, drafts })); }
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
    beginTouch({ cardId, x, y, layout = {} }) {
      cancelGesture();
      reorderFeedback = null;
      suppressTap = false;
      touch = { cardId, x, y, moved: false, held: false, layout };
    },
    moveTouch({ x, y, scrollTop }) {
      if (!touch) return;
      if (drag) {
        if (Number.isFinite(scrollTop)) drag.scrollTop = Math.max(0, Math.min(drag.maxScroll, scrollTop));
        updateDrag(y);
        return;
      }
      if (Math.hypot(x - touch.x, y - touch.y) > GESTURE.moveSlop) {
        touch.moved = true;
        suppressTap = true;
      }
    },
    longPress() {
      if (!touch || touch.moved || touch.held || !visibleCards().some((card) => card.id === touch.cardId)) return { ok: true, action: 'none' };
      if (!readable) return { ok: false, action: 'none', error: error || 'storage-read' };
      touch.held = true;
      suppressTap = true;
      if (view.expanded) {
        if (visibleCards().length < 2) return { ok: true, action: 'none' };
        drag = {
          cardId: touch.cardId, fromIndex: visibleCards().findIndex((card) => card.id === touch.cardId),
          stride: touch.layout.stride > 0 ? touch.layout.stride : 400, translationY: 0,
          scrollTop: Math.max(0, touch.layout.scrollTop || 0), startScroll: Math.max(0, touch.layout.scrollTop || 0),
          maxScroll: Math.max(0, touch.layout.maxScroll || 0), edgeDirection: 0
        };
        drag.toIndex = drag.fromIndex;
        updateDrag(touch.y);
        return { ok: true, action: 'drag' };
      }
      const result = library.expand();
      return Object.assign({}, result, { action: result.ok ? 'expand' : 'none' });
    },
    endTouch() {
      touch = null;
      if (!drag) return { ok: true, action: 'none' };
      if (drag.fromIndex === drag.toIndex) { drag = null; return { ok: true, action: 'none' }; }
      const moved = previewCards(visibleCards());
      let index = 0;
      const next = cards.slice().sort((a, b) => a.order - b.order).map((card) =>
        view.category === 'all' || card.category === view.category ? Object.assign({}, moved[index++], { order: card.order }) : card);
      drag = null;
      return saveReorder(next);
    },
    retryReorder() {
      if (!pendingReorder) return { ok: true, action: 'none' };
      if (!readable) return { ok: false, error: error || 'storage-read' };
      const byId = new Map(cards.map((card) => [card.id, card]));
      const moved = pendingReorder.filter((id) => byId.has(id)).map((id) => byId.get(id));
      const included = new Set(pendingReorder);
      let index = 0;
      const next = cards.slice().sort((a, b) => a.order - b.order).map((card) =>
        included.has(card.id) ? Object.assign({}, moved[index++], { order: card.order }) : card);
      return saveReorder(next);
    },
    advanceDragScroll() {
      if (!drag || !drag.edgeDirection) return { ok: true, action: 'none' };
      drag.scrollTop = Math.max(0, Math.min(drag.maxScroll, drag.scrollTop + drag.edgeDirection * GESTURE.edgeStep));
      updateDrag(touch.latestY);
      return { ok: true, action: 'scroll', scrollTop: drag.scrollTop };
    },
    cancelTouch: cancelGesture,
    tapCard(id) {
      if (suppressTap) return { ok: true, action: 'none' };
      return library.showCard(id);
    }
  };
  return library;
}

module.exports = { createCardLibrary, CATEGORIES, GESTURE };
