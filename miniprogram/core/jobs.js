const { createJobRecovery } = require('./recovery');
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function createJobs({ records, backend, pollMs = 100 }) {
  const recovery = createJobRecovery({ backend });
  const active = new Map(); const errors = new Map(); const unsaved = new Map(); const listeners = new Set();
  function notify(id) { listeners.forEach((listener) => { try { listener(id); } catch (_) { /* A page cannot interrupt result persistence. */ } }); }
  function read(id) { const value = records.getRecord(id); if (!value.ok) throw { code: value.error }; return value.record; }
  function save(id, update) { const value = records.updateRecord(id, update); if (!value.ok) throw { code: value.error }; notify(id); return value.record; }
  function checked(job, record, image) {
    const request = image.jobRequests && image.jobRequests.image_cards;
    if (!job || !request || job.contextId !== record.contextId || job.kind !== 'image_cards' || !job.target || job.target.imageId !== image.id ||
        job.contextSnapshotVersion !== request.input.contextSnapshotVersion || !Number.isInteger(job.attempt) || job.attempt < 1 ||
        !Number.isInteger(job.revision) || job.revision < 1 || typeof job.jobId !== 'string' || !job.jobId ||
        !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'].includes(job.state)) throw { code: 'DEPENDENCY_MISSING' };
    if (job.state !== 'succeeded' && job.output !== null) throw { code: 'INPUT_UNSUPPORTED' };
    if (job.state === 'succeeded' && (!job.output || !Array.isArray(job.output.cards) ||
        new Set(job.output.cards.map((card) => card.id)).size !== job.output.cards.length || job.output.cards.some((card) =>
          card.recordId !== record.id || !Array.isArray(card.sourceImageIds) || card.sourceImageIds.length !== 1 || card.sourceImageIds[0] !== image.id ||
          typeof card.id !== 'string' || !Array.isArray(card.details) || !Array.isArray(card.uncertainty) || !card.price ||
          (card.price.amount !== null && (typeof card.price.amount !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(card.price.amount))) ||
          card.contentLanguage !== request.input.targetLanguage))) throw { code: 'DEPENDENCY_MISSING' };
  }
  function applyJob(id, job) {
    try {
      const record = read(id); const image = record.images.find((item) => item.id === (job.target && job.target.imageId));
      if (!image) return { ok: false, error: 'DEPENDENCY_MISSING' };
      checked(job, record, image);
      const previous = image.stageJobs.image_cards;
      if (!previous || previous.jobId !== job.jobId || job.attempt !== previous.attempt || job.revision < previous.revision ||
          (job.revision === previous.revision && previous.locallySavedRevision === job.revision)) return { ok: false, error: 'stale-job' };
      const waiting = unsaved.get(id);
      if (waiting && waiting.jobId === job.jobId && job !== waiting &&
          (job.attempt !== waiting.attempt || job.revision <= waiting.revision)) return { ok: false, error: 'stale-job' };
      unsaved.set(id, clone(job));
      save(id, (draft) => {
        const target = draft.images.find((item) => item.id === image.id);
        target.stageJobs.image_cards = Object.assign({}, clone(job), { locallySavedRevision: job.revision });
        if (job.state === 'succeeded') {
          // A stage replaces only the cards it previously produced. Other photos remain intact.
          const oldIds = new Set((previous.output && previous.output.cards || []).map((card) => card.id));
          draft.cards = (draft.cards || []).filter((card) => !oldIds.has(card.id));
          for (const card of job.output.cards) {
            const existing = draft.cards.findIndex((item) => item.id === card.id);
            if (existing >= 0) draft.cards[existing] = clone(card); else draft.cards.push(clone(card));
          }
          draft.cardIds = draft.cards.map((card) => card.id);
        }
      });
      unsaved.delete(id); errors.delete(id); return { ok: true, jobId: job.jobId };
    } catch (error) { const code = error.code || 'TEMPORARY_FAILURE'; errors.set(id, code); notify(id); return { ok: false, error: code }; }
  }
  function acceptRecoveredJob(id, job) {
    try {
      const record = read(id); const image = record.images.find((item) => item.id === (job.target && job.target.imageId));
      if (!image) return { ok: false, error: 'DEPENDENCY_MISSING' };
      checked(job, record, image);
      if (!image.stageJobs.image_cards) {
        // A missing acceptance response is the first attempt, never permission to
        // adopt a newer attempt the user has not requested on this device.
        if (job.attempt !== 1) return { ok: false, error: 'stale-job' };
        save(id, (draft) => { draft.images.find((item) => item.id === image.id).stageJobs.image_cards = Object.assign({}, clone(job), { locallySavedRevision: null }); });
      }
      return applyJob(id, job);
    } catch (error) { const code = error.code || 'TEMPORARY_FAILURE'; errors.set(id, code); notify(id); return { ok: false, error: code }; }
  }
  async function poll(id, imageId) {
    for (let count = 0; count < 300; count += 1) {
      const record = read(id); const image = record.images.find((item) => item.id === imageId); const job = image && image.stageJobs.image_cards;
      if (!job) return { ok: false, error: 'DEPENDENCY_MISSING' };
      if (!['queued', 'running'].includes(job.state)) return { ok: true, jobId: job.jobId };
      const result = applyJob(id, await backend.getJob(job.jobId));
      if (!result.ok && result.error !== 'stale-job') return result;
      if (['queued', 'running'].includes(read(id).images.find((item) => item.id === imageId).stageJobs.image_cards.state)) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return { ok: true, pending: true };
  }
  function run(key, id, operation) {
    if (!active.has(key)) {
      errors.delete(id);
      active.set(key, Promise.resolve().then(operation).catch((error) => { const code = error.code || 'TEMPORARY_FAILURE'; errors.set(id, code); return { ok: false, error: code }; })
        .finally(() => { active.delete(key); notify(id); }));
    }
    return active.get(key);
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getState(id) { return { running: [...active.keys()].some((key) => key.startsWith(id + ':')), error: errors.get(id) || null, unsavedJob: unsaved.has(id) ? clone(unsaved.get(id)) : null }; },
    applyJob,
    acceptRecoveredJob,
    retrySave(id) { const job = unsaved.get(id); return job ? applyJob(id, job) : { ok: true }; },
    startImageCards(id, imageId) {
      return run(`${id}:cards:${imageId || 'first'}`, id, async () => {
        const record = read(id); const image = record.images.find((item) => item.id === imageId) || (!imageId && record.images[0]);
        if (!image || image.uploadState !== 'uploaded' || !image.assetId || !record.contextSnapshotVersion) return { ok: false, error: 'DEPENDENCY_MISSING' };
        if (image.stageJobs.image_cards) return poll(id, image.id);
        let request = image.jobRequests && image.jobRequests.image_cards;
        if (!request) {
          request = { contextId: record.contextId, kind: 'image_cards', target: { imageId: image.id }, input: {
            contextSnapshotVersion: record.contextSnapshotVersion, assetId: image.assetId, inputKind: image.kind, targetLanguage: image.targetLanguage } };
          save(id, (draft) => { const target = draft.images.find((item) => item.id === image.id); target.jobRequests = Object.assign({}, target.jobRequests, { image_cards: request }); });
        }
        const job = await backend.createJob(request, image.requests.image_cards);
        const result = acceptRecoveredJob(id, job);
        return result.ok || result.error === 'stale-job' ? poll(id, image.id) : result;
      });
    },
    refreshRecord(id) {
      return run(`${id}:refresh`, id, async () => {
        const record = read(id);
        const requests = record.images.filter((image) => image.jobRequests && image.jobRequests.image_cards &&
          (!image.stageJobs.image_cards || ['queued', 'running'].includes(image.stageJobs.image_cards.state) ||
            image.stageJobs.image_cards.locallySavedRevision !== image.stageJobs.image_cards.revision))
          .map((image) => image.jobRequests.image_cards);
        const recovered = await recovery.recover({ contextId: record.contextId, requests, apply: (job) => acceptRecoveredJob(id, job) });
        if (!recovered.ok) return recovered;
        for (const image of read(id).images) {
          if (image.stageJobs.image_cards && ['queued', 'running'].includes(image.stageJobs.image_cards.state)) {
            const outcome = await poll(id, image.id); if (!outcome.ok) return outcome;
          }
        }
        return { ok: true };
      });
    }
  };
}
module.exports = { createJobs };
