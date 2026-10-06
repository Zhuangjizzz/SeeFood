const { makeId } = require('./identity');
const { createJobRecovery } = require('./recovery');
const { createJobRetry, canAcceptRetry } = require('./job-retry');
const { getDietaryCopy } = require('./dietary-copy');
const { completedMessages } = require('./record-snapshot');
const clone = value => JSON.parse(JSON.stringify(value));
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function createDietaryReview({ records, backend, network, preferences, contexts, getLanguage, receipts, pollMs = 100 }) {
  const active = new Map(); const errors = new Map(); const unsaved = new Map(); const listeners = new Set();
  const recovery = createJobRecovery({ backend }); const retries = createJobRetry({ backend });
  function read(id) { const result = records.getRecord(id); if (!result.ok) throw { code: result.error }; return result.record; }
  function notify(id) { for (const listener of listeners) { try { listener(id); } catch (_) { /* A view cannot interrupt saved preferences. */ } } }
  function save(id, update) { const value = records.updateRecord(id, update); if (!value.ok) throw { code: value.error }; return value.record; }
  function current(record, entry) {
    const request = entry.request;
    return request.contextId === record.contextId && request.target.preferencesVersion === preferences.getSnapshot().version &&
      request.input.cards.every(card => same(card, (record.cards || []).find(item => item.id === card.id)));
  }
  function savedSource(record, card, version) {
    return Object.values(record.dietaryReviews || {}).find(entry => entry.request.target.preferencesVersion === version && entry.request.input.cards.some(item => same(item, card)));
  }
  function savedCurrent(record) {
    const version = preferences.getSnapshot().version;
    return record.cards?.length && record.cards.every(card => record.dietaryAssessments?.[card.id]?.preferencesVersion === version && savedSource(record, card, version));
  }
  function entries(record) { return Object.values(record.dietaryReviews || {}).filter(entry => current(record, entry)); }
  function latest(record) { return entries(record).find(entry => entry.request.target.cardIds.length === (record.cards || []).length); }
  function run(id, operation) {
    const version = preferences.getSnapshot().version; const key = `${id}:${version}`;
    if (active.has(key)) return active.get(key);
    errors.delete(id);
    const work = Promise.resolve().then(operation).catch(error => {
      if (error.contextId && records.getRecord(id).record?.contextId !== error.contextId) return { ok: false, error: 'stale-job' };
      const code = error.code || error.message || 'TEMPORARY_FAILURE';
      if (code === 'CONTEXT_EXPIRED' && !records.isDeleted(id)) contexts.markExpired(id, error.contextId);
      if (!records.isDeleted(id) && preferences.getSnapshot().version === version && code !== 'stale-job') errors.set(id, code);
      return { ok: false, error: code }; })
      .finally(() => { active.delete(key); notify(id); });
    active.set(key, work); notify(id); return work;
  }
  function checked(record, job) {
    if (!job || job.kind !== 'dietary_review' || !job.target || !Array.isArray(job.target.cardIds) || typeof job.jobId !== 'string' || !job.jobId ||
        !Number.isInteger(job.attempt) || job.attempt < 1 || !Number.isInteger(job.revision) || job.revision < 1 ||
        !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'].includes(job.state)) throw { code: 'DEPENDENCY_MISSING' };
    const entry = entries(record).find(item => item.request.contextId === job.contextId && item.request.input.contextSnapshotVersion === job.contextSnapshotVersion && same(item.request.target, job.target));
    if (!entry) throw { code: 'stale-job' };
    if (job.state !== 'succeeded' && job.output !== null) throw { code: 'INPUT_UNSUPPORTED' };
    if (job.state === 'succeeded') {
      const values = job.output && job.output.assessments; const ids = entry.request.target.cardIds;
      if (!Array.isArray(values) || values.length !== ids.length || new Set(values.map(value => value.cardId)).size !== ids.length || values.some(value =>
        !ids.includes(value.cardId) || value.preferencesVersion !== job.target.preferencesVersion || value.state !== 'current' ||
        !Number.isFinite(Date.parse(value.checkedAt)) || !Array.isArray(value.warnings) || value.warnings.some(warning => typeof warning !== 'string' || !warning) ||
        value.concern !== undefined && !['conflict', 'possible_conflict', 'unknown'].includes(value.concern))) throw { code: 'DEPENDENCY_MISSING' };
    }
    return entry;
  }
  function apply(id, job, allowAssociation) {
    try {
      const record = read(id); const entry = checked(record, job); const previous = entry.job;
      const nextAttempt = previous && canAcceptRetry(entry.retry, previous, job);
      if ((!previous && (!allowAssociation || job.attempt !== 1)) || previous && (previous.jobId !== job.jobId || (previous.attempt !== job.attempt && !nextAttempt) ||
          job.revision < previous.revision || job.revision === previous.revision && previous.locallySavedRevision === job.revision)) return { ok: false, error: 'stale-job' };
      const waiting = unsaved.get(id);
      if (waiting && waiting.jobId === job.jobId && waiting !== job && (waiting.attempt !== job.attempt || waiting.revision >= job.revision)) return { ok: false, error: 'stale-job' };
      unsaved.set(id, clone(job));
      save(id, draft => {
        draft.dietaryReviews[entry.requestId].job = { ...clone(job), locallySavedRevision: job.revision };
        if (nextAttempt) delete draft.dietaryReviews[entry.requestId].retry;
        if (job.state === 'succeeded') {
          draft.dietaryAssessments = { ...draft.dietaryAssessments };
          for (const assessment of job.output.assessments) draft.dietaryAssessments[assessment.cardId] = clone(assessment);
        }
      });
      if (receipts) receipts.saved(job, { locallySavedRevision: job.revision, locallySavedArtifactIds: [] });
      unsaved.delete(id); errors.delete(id); notify(id); return { ok: true, jobId: job.jobId };
    } catch (error) { const code = error.code || 'TEMPORARY_FAILURE'; if (code !== 'stale-job') errors.set(id, code); notify(id); return { ok: false, error: code }; }
  }
  async function poll(id, requestId) {
    for (let count = 0; count < 300; count++) {
      const record = read(id); const entry = record.dietaryReviews[requestId];
      if (!current(record, entry)) return { ok: false, error: 'stale-job' };
      if (!entry.job) return { ok: false, error: 'DEPENDENCY_MISSING' };
      if (!['queued', 'running'].includes(entry.job.state)) return { ok: true, jobId: entry.job.jobId };
      const result = apply(id, await backend.getJob(entry.job.jobId), false);
      if (!result.ok && result.error !== 'stale-job') return result;
      if (['queued', 'running'].includes(read(id).dietaryReviews[requestId].job.state)) await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    return { ok: true, pending: true };
  }
  async function beginRecord(id) {
    if (savedCurrent(read(id))) return { ok: true };
    const existing = latest(read(id));
    if (existing) return existing.job ? poll(id, existing.requestId) : { ok: true, pending: true };
    if (!read(id).cards?.length) return { ok: true };
    if (network) await network.requireOnline();
    const preference = preferences.getSnapshot(); let entry;
    await contexts.run(id, async () => {
      await contexts.prepare(id, { purpose: 'text' });
      await contexts.publishPending(id); const record = read(id);
      if (preference.version !== preferences.getSnapshot().version) throw { code: 'stale-job' };
      if (latest(record)) { entry = latest(record); return; }
      const cards = clone(record.cards).sort((a, b) => a.id.localeCompare(b.id));
      const snapshot = { purpose: 'record', recordId: id, localScopeId: id, snapshotVersion: (record.contextSnapshotVersion || 0) + 1,
        snapshot: { images: record.images.map(image => ({ imageId: image.id, kind: image.kind, order: image.order, assetId: image.assetId || null })),
          cards, messages: completedMessages(record), preferences: preference } };
      const request = { contextId: record.contextId, kind: 'dietary_review', target: { cardIds: cards.map(card => card.id), preferencesVersion: preference.version },
        input: { contextSnapshotVersion: snapshot.snapshotVersion, cards, preferences: preference } };
      const requestId = makeId('dietary'); entry = { requestId, request, snapshot };
      save(id, draft => { draft.pendingContextSnapshot = clone(snapshot); draft.dietaryReviews = { ...draft.dietaryReviews, [requestId]: clone(entry) }; });
      await contexts.publishPending(id);
    });
    if (!current(read(id), entry)) return { ok: false, error: 'stale-job' };
    const result = apply(id, await backend.createJob(entry.request, entry.requestId), true);
    return result.ok ? poll(id, entry.requestId) : result;
  }
  function startRecord(id) { return run(id, () => beginRecord(id)); }
  const service = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    startRecord,
    getState(id) {
      const copy = getDietaryCopy(getLanguage());
      try {
        const record = read(id); const version = preferences.getSnapshot().version; const eligible = entries(record); const entry = latest(record);
        let waiting = unsaved.get(id);
        if (waiting && !eligible.some(item => item.request.input.contextSnapshotVersion === waiting.contextSnapshotVersion && same(item.request.target, waiting.target))) waiting = null;
        const assessments = {};
        for (const card of record.cards || []) {
          const saved = record.dietaryAssessments?.[card.id];
          const delivered = waiting?.state === 'succeeded' && waiting.output.assessments.find(value => value.cardId === card.id);
          const value = delivered || saved;
          const related = eligible.find(item => item.request.target.cardIds.includes(card.id));
          const job = related && related.job;
          const valid = value?.preferencesVersion === version && !!savedSource(record, card, version);
          const state = valid ? 'current' : job && ['queued', 'running'].includes(job.state) ? 'checking' : job && ['failed', 'expired', 'cancelled'].includes(job.state) ? 'failed' : 'pending';
          assessments[card.id] = valid ? { ...clone(value), concern: value.concern || 'unknown', unsaved: !!delivered } :
            { cardId: card.id, preferencesVersion: version, state, warnings: [], concern: 'unknown', unsaved: false };
        }
        const running = active.has(`${id}:${version}`); const pending = Object.values(assessments).some(value => value.state !== 'current');
        return { assessments, pending, running, error: errors.get(id) || null, unsavedJob: waiting ? clone(waiting) : null,
          jobs: eligible.map(value => value.job).filter(Boolean).map(clone),
          canStart: !!record.cards?.length && pending && !entry && !running, canContinue: !!entry && !entry.job && !running,
          canRetry: !!entry?.job && (entry.job.state === 'expired' || entry.job.state === 'failed' && entry.job.error?.retryable === true) && !running, copy };
      } catch (error) { return { assessments: {}, jobs: [], pending: false, running: false, error: error.code || 'storage-read', unsavedJob: null, copy }; }
    },
    applyJob: (id, job) => apply(id, job, false), acceptRecoveredJob: (id, job) => apply(id, job, true),
    retrySave(id) { const job = unsaved.get(id); return job ? apply(id, job, true) : { ok: true }; },
    refreshRecord(id) {
      let eligible;
      try { eligible = entries(read(id)).filter(entry => !entry.job || ['queued', 'running'].includes(entry.job.state) || entry.retry || entry.job.locallySavedRevision !== entry.job.revision); }
      catch (error) { return Promise.resolve({ ok: false, error: error.code }); }
      if (!eligible.length) return Promise.resolve({ ok: true });
      return run(id, async () => {
        const result = await recovery.recover({ contextId: read(id).contextId, requests: eligible.map(entry => entry.request), apply: job => apply(id, job, true) });
        if (!result.ok) return result;
        for (const entry of eligible) if (read(id).dietaryReviews[entry.requestId].job) { const value = await poll(id, entry.requestId); if (!value.ok) return value; }
        return { ok: true };
      });
    },
    continueSubmission(id) {
      return run(id, async () => {
        const entry = latest(read(id)); if (!entry) return { ok: false, error: 'DEPENDENCY_MISSING' };
        if (network) await network.requireOnline();
        await contexts.run(id, () => contexts.prepare(id, { purpose: 'text' }));
        if (!current(read(id), entry)) return beginRecord(id);
        await contexts.run(id, () => contexts.publishPending(id));
        const result = await retries.continueSubmission(entry, { isCurrent: () => current(read(id), entry), accept: job => apply(id, job, true) });
        return result.ok ? poll(id, entry.requestId) : result;
      });
    },
    retry(id) {
      return run(id, async () => {
        if (unsaved.has(id)) { const saved = service.retrySave(id); if (!saved.ok) return saved; }
        const entry = latest(read(id)); if (!entry?.job) return { ok: false, error: 'DEPENDENCY_MISSING' };
        if (network) await network.requireOnline();
        await contexts.run(id, () => contexts.prepare(id, { purpose: 'text' }));
        if (!current(read(id), entry)) return beginRecord(id);
        let intent = entry.retry;
        if (!intent) { intent = retries.prepare(entry.job); save(id, draft => { draft.dietaryReviews[entry.requestId].retry = intent; }); }
        const result = await retries.submit(intent, { isCurrent: () => current(read(id), entry), accept: job => apply(id, job, true) });
        return result.ok ? poll(id, entry.requestId) : result;
      });
    }
  };
  preferences.subscribe(() => {
    const result = records.listHistory();
    for (const record of result.records) { unsaved.delete(record.id); notify(record.id); if (record.cards?.length) void startRecord(record.id); }
  });
  records.subscribe(id => { if (records.isDeleted(id)) { unsaved.delete(id); errors.delete(id); notify(id); } });
  return service;
}
module.exports = { createDietaryReview };
