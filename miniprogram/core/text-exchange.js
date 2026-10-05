const { makeId } = require('./identity');

const SPEAKERS = ['visitor', 'staff'];
const KEY = 'current-text-exchange';
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function createTextExchange({ store, translations, getLanguage }) {
  function side(language) { return { draft: '', inputLanguage: language, inputVersion: 1, operation: null, job: null, result: null, error: null }; }
  function empty() { return { localScopeId: makeId('exchange'), contextId: makeId('communication'), snapshotVersion: 0,
    selectedSpeaker: 'visitor', latestSpeaker: null, sides: { visitor: side(getLanguage() || 'en'), staff: side('zh-CN') } }; }
  let state; let saveError = null; let dirty = false;
  const listeners = new Set(); const active = new Map();
  try { state = store.get(KEY, null) || empty(); } catch (_) { state = empty(); saveError = 'storage-read'; }
  function notify() { listeners.forEach((listener) => { try { listener(); } catch (_) { /* UI cannot interrupt local persistence. */ } }); }
  function persist(next) {
    state = next;
    try { store.set(KEY, state); dirty = false; saveError = null; notify(); return { ok: true }; }
    catch (_) { dirty = true; saveError = 'storage-write'; notify(); return { ok: false, error: saveError }; }
  }
  function change(update) {
    if (saveError === 'storage-read') return { ok: false, error: saveError };
    const next = clone(state); update(next); return persist(next);
  }
  function valid(speaker) { return SPEAKERS.includes(speaker); }
  function current(speaker, operation) {
    const target = state.sides[speaker];
    return target && state.localScopeId === operation.context.localScopeId && target.inputVersion === operation.request.input.inputVersion &&
      target.operation && target.operation.request.target.requestId === operation.request.target.requestId;
  }
  function consumer(speaker, operation) {
    return {
      contextSnapshots() {
        return SPEAKERS.map((name) => state.sides[name].operation)
          .filter((saved) => saved && saved.request.contextId === operation.request.contextId && saved.context.snapshotVersion <= operation.context.snapshotVersion)
          .map((saved) => clone(saved.context));
      },
      current() {
        if (!current(speaker, operation)) return null;
        const target = state.sides[speaker];
        return { localScopeId: state.localScopeId, inputVersion: target.inputVersion, requestId: target.operation.request.target.requestId, job: target.job };
      },
      apply(job) {
        if (!current(speaker, operation)) return { ok: false, error: 'stale-job' };
        return change((next) => {
          const target = next.sides[speaker]; target.job = job; target.error = null;
          if (job.state === 'succeeded') {
            target.result = { original: operation.request.input.text, translation: job.output.text,
              sourceLanguage: operation.request.input.sourceLanguage, targetLanguage: job.output.contentLanguage };
            next.latestSpeaker = speaker;
          }
        });
      }
    };
  }
  function run(speaker, operation, action) {
    const key = operation.request.target.requestId + ':' + action;
    if (!active.has(key)) {
      const promise = Promise.resolve().then(() => translations[action](operation, consumer(speaker, operation)))
        .catch((error) => ({ ok: false, error: error.code || 'TEMPORARY_FAILURE' }))
        .then((result) => {
          if (!result.ok && result.error !== 'stale-job' && current(speaker, operation)) {
            change((next) => { next.sides[speaker].error = result.error; });
          }
          return result;
        }).finally(() => { active.delete(key); notify(); });
      active.set(key, promise); notify();
    }
    return active.get(key);
  }
  return {
    getState() { return { ...clone(state), saveError, dirty }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    selectSpeaker(speaker) { return valid(speaker) ? change((next) => { next.selectedSpeaker = speaker; }) : { ok: false, error: 'INPUT_UNSUPPORTED' }; },
    edit(speaker, text, inputLanguage) {
      if (!valid(speaker) || typeof text !== 'string') return { ok: false, error: 'INPUT_UNSUPPORTED' };
      if (state.sides[speaker].draft === text) return { ok: true };
      return change((next) => {
        const target = next.sides[speaker];
        if (inputLanguage) target.inputLanguage = inputLanguage;
        else if (!target.draft) target.inputLanguage = speaker === 'visitor' ? getLanguage() || 'en' : 'zh-CN';
        target.draft = text; target.inputVersion += 1;
        target.operation = null; target.job = null; target.error = null;
      });
    },
    submit(speaker) {
      if (!valid(speaker)) return Promise.resolve({ ok: false, error: 'INPUT_UNSUPPORTED' });
      if (dirty || saveError) return Promise.resolve({ ok: false, error: saveError });
      const target = state.sides[speaker];
      if (!target.draft.trim()) return Promise.resolve({ ok: false, error: 'empty-input' });
      const operation = translations.prepare({ localScopeId: state.localScopeId, contextId: state.contextId,
        snapshotVersion: state.snapshotVersion + 1, inputVersion: target.inputVersion, requestId: makeId('translation'),
        text: target.draft.trim(), sourceLanguage: target.inputLanguage, targetLanguage: speaker === 'visitor' ? 'zh-CN' : getLanguage() || 'en' });
      const before = clone(state);
      const saved = change((next) => {
        next.snapshotVersion += 1; const item = next.sides[speaker];
        item.operation = operation; item.job = null; item.error = null; item.draft = '';
      });
      if (!saved.ok) { state = before; notify(); }
      return saved.ok ? run(speaker, operation, 'submit') : Promise.resolve(saved);
    },
    async refresh() {
      if (dirty) return { ok: false, error: saveError };
      for (const speaker of SPEAKERS) {
        const target = state.sides[speaker];
        if (!target.operation || (target.job && !['queued', 'running'].includes(target.job.state))) continue;
        const result = await run(speaker, clone(target.operation), 'recover');
        if (!result.ok && result.error !== 'stale-job') return result;
      }
      return { ok: true };
    },
    async continueSubmission(speaker) {
      if (!valid(speaker)) return { ok: false, error: 'INPUT_UNSUPPORTED' };
      if (dirty || saveError) return { ok: false, error: saveError };
      const operation = state.sides[speaker].operation;
      if (!operation) return { ok: false, error: 'empty-input' };
      const recovered = await run(speaker, clone(operation), 'recover');
      return (recovered.ok && recovered.pending) || recovered.error === 'NOT_FOUND' ? run(speaker, clone(operation), 'submit') : recovered;
    },
    applyJob(speaker, operation, job) { return translations.applyJob(operation, job, consumer(speaker, operation)); },
    restoreInput(speaker) {
      const target = state.sides[speaker];
      return target && target.operation ? this.edit(speaker, target.operation.request.input.text, target.operation.request.input.sourceLanguage) : { ok: false, error: 'empty-input' };
    },
    clear() { return persist(empty()); },
    retrySave() {
      if (saveError === 'storage-read') {
        try { state = store.get(KEY, null) || empty(); saveError = null; notify(); return { ok: true }; }
        catch (_) { return { ok: false, error: 'storage-read' }; }
      }
      return persist(clone(state));
    }
  };
}
module.exports = { createTextExchange, SPEAKERS };
