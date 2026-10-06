const { createPresetCards } = require('./card-presets');
const { makeId } = require('./identity');
const KEY = 'personal-cards';
const CATEGORIES = ['dietary', 'service'];
const COLORS = ['green', 'blue', 'orange'];
function clone(value) { return JSON.parse(JSON.stringify(value)); }

// Drafts are separate from displayable cards. One envelope makes the final
// card write and removal of its draft one local-storage transaction.
function createCardRepository({ store, getLanguage = () => 'en' }) {
  function read() {
    const saved = store.get(KEY, { initialized: true, cards: createPresetCards(getLanguage()), drafts: {} });
    if (!saved || saved.initialized !== true || !Array.isArray(saved.cards) || saved.cards.some((card) => !card || typeof card.id !== 'string') ||
        (saved.drafts && (typeof saved.drafts !== 'object' || Array.isArray(saved.drafts)))) throw new Error('Invalid card repository');
    return saved;
  }
  function update(change) {
    let saved;
    try { saved = read(); } catch (_) { return { ok: false, error: 'storage-read' }; }
    const result = change(saved);
    if (!result.ok || result.alreadySaved) return result;
    try { store.set(KEY, saved); } catch (_) { return { ok: false, error: 'storage-write' }; }
    return result;
  }
  return {
    readFavorites(recordId) {
      try { return { ok: true, cards: clone(read().cards.filter((card) => card.sourceRecordId === recordId)) }; }
      catch (_) { return { ok: false, error: 'storage-read', cards: [] }; }
    },
    commitFavorite(content, source) {
      return update((saved) => {
        const existing = saved.cards.find((card) => card.sourceRecordId === source.sourceRecordId &&
          card.sourceMessageId === source.sourceMessageId && card.sourceAttachmentIndex === source.sourceAttachmentIndex);
        if (existing) return { ok: true, alreadySaved: true, card: clone(existing) };
        const card = { ...clone(content), ...source, id: makeId('personal-card'), color: 'green', edited: false, saveState: 'saved',
          order: saved.cards.length ? Math.min(...saved.cards.map((item) => item.order)) - 1 : 0 };
        saved.cards.unshift(card);
        return { ok: true, card: clone(card) };
      });
    },
    readDraft(slot = 'new') {
      try {
        const saved = read();
        if (slot.startsWith('edit:') && !saved.cards.some((card) => card.id === slot.slice(5))) return { ok: false, error: 'card-not-found' };
        return { ok: true, draft: clone(saved.drafts?.[slot] || null) };
      }
      catch (_) { return { ok: false, error: 'storage-read' }; }
    },
    writeDraft(draft, { slot = 'new', create = false } = {}) {
      return update((saved) => {
        if (draft.mode === 'edit' && (!saved.cards.some((card) => card.id === draft.cardId) || slot !== 'edit:' + draft.cardId)) return { ok: false, error: 'card-not-found' };
        const previous = saved.drafts?.[slot];
        if (create ? !!previous : !previous || previous.localScopeId !== draft.localScopeId || previous.inputVersion > draft.inputVersion ||
            previous.snapshotVersion > draft.snapshotVersion) return { ok: false, error: 'stale-draft' };
        saved.drafts = { ...saved.drafts, [slot]: clone(draft) }; return { ok: true };
      });
    },
    discardDraft(localScopeId, slot = 'new') {
      return update((saved) => {
        if (saved.drafts?.[slot] && saved.drafts[slot].localScopeId !== localScopeId) return { ok: false, error: 'stale-draft' };
        if (saved.drafts) delete saved.drafts[slot];
        return { ok: true };
      });
    },
    commitNew(localScopeId, inputVersion) {
      return update((saved) => {
        const draft = saved.drafts?.new;
        if (!draft || draft.localScopeId !== localScopeId || draft.inputVersion !== inputVersion) return { ok: false, error: 'stale-draft' };
        if (!draft.text.trim() || !draft.textZh.trim() || !draft.title.trim() || draft.needsChineseReview ||
            !CATEGORIES.includes(draft.category) || !COLORS.includes(draft.color)) return { ok: false, error: 'incomplete-card' };
        const card = { id: draft.cardId, title: draft.title.trim(), category: draft.category, color: draft.color,
          textZh: draft.textZh.trim(), pairedText: draft.sourceLanguage === 'zh-CN' ? null : draft.text.trim(),
          pairedLanguage: draft.sourceLanguage, edited: true, saveState: 'saved',
          order: saved.cards.length ? Math.min(...saved.cards.map((item) => item.order)) - 1 : 0 };
        saved.cards.unshift(card); delete saved.drafts.new;
        return { ok: true, card: clone(card) };
      });
    },
    commitEdit(localScopeId, inputVersion, cardId) {
      return update((saved) => {
        const slot = 'edit:' + cardId;
        const draft = saved.drafts?.[slot];
        const card = saved.cards.find((item) => item.id === cardId);
        if (!card) return { ok: false, error: 'card-not-found' };
        if (!draft || draft.mode !== 'edit' || draft.cardId !== cardId || draft.localScopeId !== localScopeId || draft.inputVersion !== inputVersion) return { ok: false, error: 'stale-draft' };
        if (!draft.text.trim() || !draft.textZh.trim() || !draft.title.trim() || draft.needsChineseReview ||
            !CATEGORIES.includes(draft.category) || !COLORS.includes(draft.color)) return { ok: false, error: 'incomplete-card' };
        Object.assign(card, { title: draft.title.trim(), category: draft.category, color: draft.color,
          textZh: draft.textZh.trim(), pairedText: draft.sourceLanguage === 'zh-CN' ? null : draft.text.trim(),
          pairedLanguage: draft.sourceLanguage, edited: true, saveState: 'saved' });
        delete saved.drafts[slot];
        return { ok: true, card: clone(card) };
      });
    }
  };
}
module.exports = { createCardRepository, CATEGORIES, COLORS };
