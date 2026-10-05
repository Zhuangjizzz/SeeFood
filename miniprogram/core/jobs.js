function clone(value) { return JSON.parse(JSON.stringify(value)); }
const IMAGE_STAGES = ['image_cards', 'image_translation'];
function createJobs({ records, backend, translationFiles, pollMs = 100 }) {
  const active = new Map(); const errors = new Map(); const unsaved = new Map(); const listeners = new Set();
  const previews = new Map();
  const keyFor = (id, kind, imageId) => `${id}:${kind}:${imageId}`;
  function notify(id) { listeners.forEach((listener) => { try { listener(id); } catch (_) { /* A page cannot interrupt result persistence. */ } }); }
  function read(id) { const value = records.getRecord(id); if (!value.ok) throw { code: value.error }; return value.record; }
  function save(id, update) { const value = records.updateRecord(id, update); if (!value.ok) throw { code: value.error }; notify(id); return value.record; }
  function checked(job, record, image) {
    const request = image.jobRequests && image.jobRequests[job.kind];
    if (!job || !request || job.contextId !== record.contextId || !IMAGE_STAGES.includes(job.kind) || !job.target || job.target.imageId !== image.id ||
        job.contextSnapshotVersion !== request.input.contextSnapshotVersion || !Number.isInteger(job.attempt) || job.attempt < 1 ||
        !Number.isInteger(job.revision) || job.revision < 1 || typeof job.jobId !== 'string' || !job.jobId ||
        !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'].includes(job.state)) throw { code: 'DEPENDENCY_MISSING' };
    if (job.state !== 'succeeded' && job.output !== null) throw { code: 'INPUT_UNSUPPORTED' };
    if (job.state !== 'succeeded') return;
    if (job.kind === 'image_translation') {
      const output = job.output; const artifact = output && output.artifact;
      if (!output || !['ready', 'not_required'].includes(output.state) ||
          (output.state === 'not_required' && (typeof output.reasonKey !== 'string' || !output.reasonKey || artifact)) ||
          (output.state === 'ready' && (!artifact || artifact.imageId !== image.id || artifact.kind !== 'translation' ||
            artifact.contentLanguage !== request.input.targetLanguage || typeof artifact.id !== 'string' || !artifact.id ||
            typeof artifact.assetId !== 'string' || !artifact.assetId || typeof artifact.remoteUrl !== 'string' ||
            !Number.isFinite(Date.parse(artifact.remoteUrlExpiresAt)) || !['image/png', 'image/jpeg', 'image/webp'].includes(artifact.mimeType) ||
            !Number.isInteger(artifact.width) || artifact.width < 1 || !Number.isInteger(artifact.height) || artifact.height < 1))) throw { code: 'DEPENDENCY_MISSING' };
      return;
    }
    if (!job.output || !Array.isArray(job.output.cards) ||
        new Set(job.output.cards.map((card) => card.id)).size !== job.output.cards.length || job.output.cards.some((card) =>
          card.recordId !== record.id || !Array.isArray(card.sourceImageIds) || card.sourceImageIds.length !== 1 || card.sourceImageIds[0] !== image.id ||
          typeof card.id !== 'string' || !Array.isArray(card.details) || !Array.isArray(card.uncertainty) || !card.price ||
          (card.price.amount !== null && (typeof card.price.amount !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(card.price.amount))) ||
          card.contentLanguage !== request.input.targetLanguage)) throw { code: 'DEPENDENCY_MISSING' };
  }
  function applyJob(id, job) {
    try {
      const record = read(id); const image = record.images.find((item) => item.id === (job.target && job.target.imageId));
      if (!image) return { ok: false, error: 'DEPENDENCY_MISSING' };
      checked(job, record, image);
      const previous = image.stageJobs[job.kind]; const key = keyFor(id, job.kind, image.id);
      if (!previous || previous.jobId !== job.jobId || job.attempt !== previous.attempt || job.revision < previous.revision ||
          (job.revision === previous.revision && previous.locallySavedRevision === job.revision)) return { ok: false, error: 'stale-job' };
      const waiting = unsaved.get(key);
      if (waiting && waiting.jobId === job.jobId && job !== waiting &&
          (job.attempt !== waiting.attempt || job.revision <= waiting.revision)) return { ok: false, error: 'stale-job' };
      unsaved.set(key, clone(job));
      save(id, (draft) => {
        const target = draft.images.find((item) => item.id === image.id);
        target.stageJobs[job.kind] = Object.assign({}, clone(job), { locallySavedRevision: job.revision });
        if (job.state === 'succeeded' && job.kind === 'image_translation') {
          if (job.output.state === 'ready') {
            const local = target.translation && target.translation.id === job.output.artifact.id ? target.translation : { localPath: null, saveState: 'pending' };
            target.translation = Object.assign({}, local, clone(job.output.artifact));
          }
        }
        if (job.state === 'succeeded' && job.kind === 'image_cards') {
          const oldIds = new Set((previous.output && previous.output.cards || []).map((card) => card.id));
          draft.cards = (draft.cards || []).filter((card) => !oldIds.has(card.id));
          for (const card of job.output.cards) {
            const existing = draft.cards.findIndex((item) => item.id === card.id);
            if (existing >= 0) draft.cards[existing] = clone(card); else draft.cards.push(clone(card));
          }
          draft.cardIds = draft.cards.map((card) => card.id);
        }
      });
      unsaved.delete(key); errors.delete(id); return { ok: true, jobId: job.jobId };
    } catch (error) { const code = error.code || 'TEMPORARY_FAILURE'; errors.set(id, code); notify(id); return { ok: false, error: code }; }
  }
  async function saveTranslation(id, imageId) {
    const key = keyFor(id, 'image_translation', imageId);
    return run(`${key}:save`, id, async () => {
      const image = read(id).images.find((item) => item.id === imageId); const artifact = image && image.translation;
      if (!artifact) return { ok: true };
      if (artifact.saveState === 'saved') return { ok: true };
      save(id, (draft) => { draft.images.find((item) => item.id === imageId).translation.saveState = 'saving'; });
      try {
        const temporaryPath = await backend.downloadArtifact(artifact); previews.set(artifact.id, temporaryPath);
        const local = await translationFiles.copyTranslation(artifact, temporaryPath, id);
        save(id, (draft) => {
          const target = draft.images.find((item) => item.id === imageId);
          if (!target.translation || target.translation.id !== artifact.id) throw new Error('stale translation');
          Object.assign(target.translation, local, { saveState: 'saved', error: null });
        });
        return { ok: true };
      } catch (error) {
        const code = error.code || 'translation-write';
        try { save(id, (draft) => {
          const target = draft.images.find((item) => item.id === imageId);
          if (target.translation && target.translation.id === artifact.id) Object.assign(target.translation, { saveState: 'failed', error: code });
        }); } catch (_) { /* Persistent saving state is still visibly not saved. */ }
        errors.set(id, code); notify(id); return { ok: false, error: code };
      }
    });
  }
  async function poll(id, imageId, kind) {
    for (let count = 0; count < 300; count += 1) {
      const image = read(id).images.find((item) => item.id === imageId); const job = image && image.stageJobs[kind];
      if (!job) return { ok: false, error: 'DEPENDENCY_MISSING' };
      if (!['queued', 'running'].includes(job.state)) return { ok: true, jobId: job.jobId };
      const result = applyJob(id, await backend.getJob(job.jobId));
      if (!result.ok && result.error !== 'stale-job') return result;
      const current = read(id).images.find((item) => item.id === imageId).stageJobs[kind];
      if (current.state === 'succeeded' && kind === 'image_translation') {
        const saved = await saveTranslation(id, imageId); if (!saved.ok) return saved;
      }
      if (['queued', 'running'].includes(current.state)) await new Promise((resolve) => setTimeout(resolve, pollMs));
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
  function startStage(id, imageId, kind) {
    return run(keyFor(id, kind, imageId || 'first'), id, async () => {
      const record = read(id); const image = record.images.find((item) => item.id === imageId) || (!imageId && record.images[0]);
      if (!image || image.uploadState !== 'uploaded' || !image.assetId || !record.contextSnapshotVersion) return { ok: false, error: 'DEPENDENCY_MISSING' };
      if (image.stageJobs[kind]) return poll(id, image.id, kind);
      let request = image.jobRequests && image.jobRequests[kind];
      if (!request) {
        request = { contextId: record.contextId, kind, target: { imageId: image.id }, input: {
          contextSnapshotVersion: record.contextSnapshotVersion, assetId: image.assetId, targetLanguage: image.targetLanguage } };
        if (kind === 'image_cards') request.input.inputKind = image.kind;
        save(id, (draft) => { const target = draft.images.find((item) => item.id === image.id); target.jobRequests = Object.assign({}, target.jobRequests, { [kind]: request }); });
      }
      const job = await backend.createJob(request, image.requests[kind]);
      checked(job, read(id), read(id).images.find((item) => item.id === image.id));
      save(id, (draft) => { draft.images.find((item) => item.id === image.id).stageJobs[kind] = Object.assign({}, clone(job), { locallySavedRevision: null }); });
      const result = applyJob(id, job);
      if (!result.ok) return result;
      if (kind === 'image_translation' && job.state === 'succeeded') return saveTranslation(id, image.id);
      return poll(id, image.id, kind);
    });
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getState(id) {
      const pending = [...unsaved.entries()].filter(([key]) => key.startsWith(id + ':')).map(([, job]) => clone(job));
      return { running: [...active.keys()].some((key) => key.startsWith(id + ':')), error: errors.get(id) || null,
        unsavedJob: pending.find((job) => job.kind === 'image_cards') || null, unsavedJobs: pending, previewPaths: Object.fromEntries(previews),
        savingTranslations: [...active.keys()].filter((key) => key.startsWith(id + ':image_translation:') && key.endsWith(':save'))
          .map((key) => key.slice((id + ':image_translation:').length, -5)) };
    },
    applyJob, saveTranslation,
    acceptRecoveredJob(id, job) {
      try {
        const record = read(id); const image = record.images.find((item) => job.target && item.id === job.target.imageId);
        if (!image) return { ok: false, error: 'DEPENDENCY_MISSING' };
        checked(job, record, image);
        if (!image.stageJobs[job.kind]) {
          save(id, (draft) => { draft.images.find((item) => item.id === image.id).stageJobs[job.kind] =
            Object.assign({}, clone(job), { locallySavedRevision: null }); });
        }
        return applyJob(id, job);
      } catch (error) { return { ok: false, error: error.code || 'TEMPORARY_FAILURE' }; }
    },
    retrySave(id) {
      const pending = [...unsaved.entries()].filter(([key]) => key.startsWith(id + ':'));
      for (const [, job] of pending) { const result = applyJob(id, job); if (!result.ok) return result; }
      return { ok: true };
    },
    startImageCards: (id, imageId) => startStage(id, imageId, 'image_cards'),
    startImageTranslation: (id, imageId) => startStage(id, imageId, 'image_translation'),
    async startImageProcessing(id, imageId) {
      const outcomes = await Promise.all(IMAGE_STAGES.map((kind) => startStage(id, imageId, kind)));
      return outcomes.find((outcome) => !outcome.ok) || { ok: true };
    },
    refreshRecord(id) {
      return run(`${id}:refresh`, id, async () => {
        const outcomes = await Promise.all(read(id).images.flatMap((image) => IMAGE_STAGES.filter((kind) => image.stageJobs[kind] &&
          ['queued', 'running'].includes(image.stageJobs[kind].state)).map((kind) => poll(id, image.id, kind))));
        return outcomes.find((outcome) => !outcome.ok) || { ok: true };
      });
    }
  };
}
module.exports = { createJobs };
