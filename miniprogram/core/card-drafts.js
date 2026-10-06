const { makeId } = require('./identity');
const { CATEGORIES, COLORS } = require('./card-repository');
function has(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function defaultTitle(text) { return Array.from(text.trim().replace(/\s+/g, ' ')).slice(0, 32).join(''); }

function createCardDrafts({ repository, library, translations, getLanguage }) {
  let draft = null; let saveError = null; let dirty = false; let needsResume = false; let pendingCreate = false;
  let slot = 'new'; let targetMissing = false;
  const listeners = new Set(); const active = new Map();
  function notify() { listeners.forEach((listener) => { try { listener(); } catch (_) { /* Rendering cannot interrupt persistence. */ } }); }
  function missingTarget() {
    draft = null; targetMissing = true; saveError = null; dirty = false; needsResume = false; pendingCreate = false; notify();
    return { ok: false, error: 'card-not-found' };
  }
  function checkTarget() {
    if (!slot.startsWith('edit:')) return { ok: true };
    const result = repository.readDraft(slot);
    if (result.error === 'card-not-found') return missingTarget();
    if (!result.ok) { saveError = result.error; notify(); }
    return result;
  }
  function load(nextSlot = slot) {
    slot = nextSlot;
    const result = repository.readDraft(slot);
    if (result.error === 'card-not-found') return missingTarget();
    if (!result.ok) { saveError = result.error; return result; }
    draft = result.draft; targetMissing = false; pendingCreate = false; needsResume = !!draft; dirty = false; saveError = null; notify(); return result;
  }
  load();
  function persist(next, options) {
    draft = next;
    if (options?.create) pendingCreate = true;
    const result = repository.writeDraft(next, { slot, create: pendingCreate });
    if (result.ok) pendingCreate = false;
    if (result.error === 'card-not-found') return missingTarget();
    if (result.error === 'stale-draft') { load(); return result; }
    dirty = !result.ok; saveError = result.ok ? null : result.error; notify(); return result;
  }
  function current(operation) {
    return draft && draft.localScopeId === operation.context.localScopeId && draft.inputVersion === operation.request.input.inputVersion &&
      draft.operation && draft.operation.request.target.requestId === operation.request.target.requestId;
  }
  function consumer(operation) {
    return {
      current() {
        return current(operation) ? { localScopeId: draft.localScopeId, inputVersion: draft.inputVersion,
          requestId: draft.operation.request.target.requestId, job: draft.job } : null;
      },
      apply(job) {
        if (!current(operation)) return { ok: false, error: 'stale-job' };
        const next = clone(draft); next.job = job; next.error = null;
        if (job.state === 'succeeded') { next.textZh = job.output.text; next.needsChineseReview = false; }
        return persist(next);
      }
    };
  }
  function run(operation, action) {
    const key = operation.request.target.requestId + ':' + action;
    if (!active.has(key)) {
      const promise = Promise.resolve().then(() => translations[action](operation, consumer(operation)))
        .catch((error) => ({ ok: false, error: error.code || 'TEMPORARY_FAILURE' }))
        .then((result) => {
          if (result.ok && result.pending && current(operation)) { const next = clone(draft); next.error = 'submission-pending'; persist(next); }
          if (!result.ok && result.error !== 'stale-job' && result.error !== 'storage-write' && current(operation)) {
            const next = clone(draft); next.error = result.error; persist(next);
          }
          return result;
        }).finally(() => { active.delete(key); notify(); });
      active.set(key, promise); notify();
    }
    return active.get(key);
  }
  const service = {
    getState() { return { draft: clone(draft), needsResume, saveError, dirty, targetMissing,
      canSave: !!draft && !needsResume && !dirty && !saveError && !!draft.text.trim() && !!draft.textZh.trim() && !!draft.title.trim() && !draft.needsChineseReview }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    beginNew({ category = 'all' } = {}) {
      if (dirty && slot !== 'new') return { ok: false, error: saveError };
      if (slot !== 'new') { const result = load('new'); if (!result.ok) return result; }
      if (saveError === 'storage-read') return { ok: false, error: saveError };
      if (draft) { needsResume = true; notify(); return { ok: true, resumable: true }; }
      needsResume = false;
      return persist({ mode: 'new', cardId: makeId('personal-card'), localScopeId: makeId('card-draft'), contextId: makeId('communication'),
        snapshotVersion: 0, inputVersion: 1, sourceLanguage: getLanguage() || 'en', targetLanguage: 'zh-CN',
        text: '', textZh: '', title: '', titleEdited: false, category: CATEGORIES.includes(category) ? category : 'service', color: 'green',
        needsChineseReview: false, operation: null, job: null, error: null }, { create: true });
    },
    beginEdit(cardId) {
      if (dirty) {
        if (slot !== 'edit:' + cardId) return { ok: false, error: saveError };
        needsResume = true; notify(); return { ok: true, resumable: true };
      }
      const result = load('edit:' + cardId); if (!result.ok) return result;
      const loaded = library.reload(); if (!loaded.ok) { saveError = loaded.error; notify(); return loaded; }
      const card = library.getState().allCards.find((item) => item.id === cardId);
      if (!card) return missingTarget();
      if (draft) { needsResume = true; notify(); return { ok: true, resumable: true }; }
      needsResume = false;
      return persist({ mode: 'edit', cardId, localScopeId: makeId('card-draft'), contextId: makeId('communication'),
        snapshotVersion: 0, inputVersion: 1, sourceLanguage: card.pairedLanguage, targetLanguage: 'zh-CN',
        text: card.pairedLanguage === 'zh-CN' ? card.textZh : card.pairedText, textZh: card.textZh,
        title: card.title, titleEdited: true, category: card.category, color: card.color,
        needsChineseReview: false, operation: null, job: null, error: null }, { create: true });
    },
    resumeEdit() { const result = checkTarget(); return result.ok ? service.resumeNew() : result; },
    resumeNew() { if (!draft) return { ok: false, error: 'draft-not-found' }; needsResume = false; notify(); return { ok: true }; },
    edit(patch) {
      if (!draft || needsResume) return { ok: false, error: 'draft-not-found' };
      if (saveError === 'storage-read') return { ok: false, error: saveError };
      if (Object.keys(patch).some((key) => !['text', 'textZh', 'title', 'category', 'color'].includes(key) || typeof patch[key] !== 'string') ||
          (has(patch, 'category') && !CATEGORIES.includes(patch.category)) || (has(patch, 'color') && !COLORS.includes(patch.color))) return { ok: false, error: 'INPUT_UNSUPPORTED' };
      const next = clone(draft);
      if (!Object.keys(patch).some((key) => next[key] !== patch[key])) return { ok: true };
      Object.assign(next, patch); next.inputVersion += 1; next.operation = null; next.job = null; next.error = null;
      if (has(patch, 'title')) next.titleEdited = !!patch.title.trim();
      if (!next.titleEdited) next.title = defaultTitle(next.text);
      if (has(patch, 'text')) {
        next.needsChineseReview = next.sourceLanguage !== 'zh-CN';
        if (next.sourceLanguage === 'zh-CN') next.textZh = next.text;
      }
      if (has(patch, 'textZh')) next.needsChineseReview = false;
      return persist(next);
    },
    translate() {
      if (!draft || needsResume || !draft.text.trim()) return Promise.resolve({ ok: false, error: 'empty-input' });
      if (dirty || saveError) return Promise.resolve({ ok: false, error: saveError });
      if (draft.operation && (!draft.job || ['queued', 'running'].includes(draft.job.state))) return service.continueSubmission();
      const operation = translations.prepare({ localScopeId: draft.localScopeId, contextId: draft.contextId,
        snapshotVersion: draft.snapshotVersion + 1, inputVersion: draft.inputVersion, requestId: makeId('translation'),
        text: draft.text.trim(), sourceLanguage: draft.sourceLanguage, targetLanguage: 'zh-CN' });
      const next = clone(draft); next.snapshotVersion += 1; next.operation = operation; next.job = null; next.error = null;
      const saved = persist(next);
      return saved.ok ? run(operation, 'submit') : Promise.resolve(saved);
    },
    async refresh() {
      const target = checkTarget(); if (!target.ok) return target;
      if (dirty || saveError) return { ok: false, error: saveError };
      if (!draft || needsResume || !draft.operation || (draft.job && !['queued', 'running'].includes(draft.job.state))) return { ok: true };
      return run(clone(draft.operation), 'recover');
    },
    async continueSubmission() {
      if (dirty || saveError) return { ok: false, error: saveError };
      if (!draft || needsResume || !draft.operation) return { ok: false, error: 'empty-input' };
      const operation = clone(draft.operation);
      const result = await run(operation, 'recover');
      return (result.ok && result.pending) || result.error === 'NOT_FOUND' ? run(operation, 'submit') : result;
    },
    applyJob(operation, job) { return translations.applyJob(operation, job, consumer(operation)); },
    save() {
      if (!draft || !service.getState().canSave) return { ok: false, error: saveError || 'incomplete-card' };
      const result = draft.mode === 'edit' ? repository.commitEdit(draft.localScopeId, draft.inputVersion, draft.cardId) :
        repository.commitNew(draft.localScopeId, draft.inputVersion);
      if (result.error === 'card-not-found') return missingTarget();
      if (!result.ok) { saveError = result.error; notify(); return result; }
      draft = null; needsResume = false; dirty = false; saveError = null;
      library.reload(); library.revealCard(result.card.id); notify(); return result;
    },
    discard() {
      if (!draft) return { ok: true };
      const result = repository.discardDraft(draft.localScopeId, slot);
      if (!result.ok) { saveError = result.error; notify(); return result; }
      draft = null; needsResume = false; dirty = false; saveError = null; notify(); return result;
    },
    retrySave() { return draft && dirty ? persist(clone(draft)) : saveError === 'storage-read' ? load() : draft ? persist(clone(draft)) : { ok: true }; }
  };
  return service;
}
module.exports = { createCardDrafts };
