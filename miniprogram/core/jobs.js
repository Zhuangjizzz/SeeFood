const { createJobRecovery } = require('./recovery');
const { createJobRetry, canAcceptRetry } = require('./job-retry');
function clone(value) { return JSON.parse(JSON.stringify(value)); }
const IMAGE_STAGES = ['image_cards', 'image_translation'];
function createJobs({ records, backend, network, translationFiles, receipts, pollMs = 100 }) {
  const recovery = createJobRecovery({ backend });
  const retries = createJobRetry({ backend });
  const active = new Map(); const errors = new Map(); const unsaved = new Map(); const listeners = new Set();
  const previews = new Map(); const previewOwners = new Map();
  records.subscribe((id) => {
    if (!records.isDeleted(id)) return;
    for (const [key, owner] of previewOwners) if (owner === id) { previews.delete(key); previewOwners.delete(key); }
    for (const key of unsaved.keys()) if (key.startsWith(id + ':')) unsaved.delete(key);
    errors.delete(id);
  });
  const stageErrors = new Map();
  const keyFor = (id, kind, imageId) => `${id}:${kind}:${imageId}`;
  function notify(id) { listeners.forEach((listener) => { try { listener(id); } catch (_) { /* A page cannot interrupt result persistence. */ } }); }
  function read(id) { const value = records.getRecord(id); if (!value.ok) throw { code: value.error }; return value.record; }
  function save(id, update, publish = true) { const value = records.updateRecord(id, update); if (!value.ok) throw { code: value.error }; if (publish) notify(id); return value.record; }
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
    const frozen = image.jobSnapshots && image.jobSnapshots[job.kind] ||
      (record.contextSnapshotVersion === request.input.contextSnapshotVersion ? record.contextSnapshot : null);
    // Older single-image requests remain safely readable if their historical snapshot was not saved locally.
    const sourceIds = new Set(frozen && frozen.recordId === record.id && frozen.snapshotVersion === request.input.contextSnapshotVersion ?
      frozen.snapshot.images.filter((item) => item.assetId && record.images.some((source) => source.id === item.imageId)).map((item) => item.imageId) : [image.id]);
    if (!job.output || !Array.isArray(job.output.cards) ||
        new Set(job.output.cards.map((card) => card.id)).size !== job.output.cards.length || job.output.cards.some((card) =>
          card.recordId !== record.id || !Array.isArray(card.sourceImageIds) || !card.sourceImageIds.includes(image.id) ||
          new Set(card.sourceImageIds).size !== card.sourceImageIds.length || card.sourceImageIds.some((sourceId) => !sourceIds.has(sourceId)) ||
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
      const retry = image.stageRetries && image.stageRetries[job.kind];
      const nextAttempt = canAcceptRetry(retry, previous, job);
      if (!previous || previous.jobId !== job.jobId || (job.attempt !== previous.attempt && !nextAttempt) || job.revision < previous.revision ||
          (job.revision === previous.revision && previous.locallySavedRevision === job.revision)) return { ok: false, error: 'stale-job' };
      const waiting = unsaved.get(key);
      if (waiting && waiting.jobId === job.jobId && job !== waiting &&
          (job.attempt !== waiting.attempt || job.revision <= waiting.revision)) return { ok: false, error: 'stale-job' };
      unsaved.set(key, clone(job));
      save(id, (draft) => {
        const target = draft.images.find((item) => item.id === image.id);
        target.stageJobs[job.kind] = Object.assign({}, clone(job), { locallySavedRevision: job.revision });
        if (nextAttempt) delete target.stageRetries[job.kind];
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
      }, false);
      if (receipts) receipts.saved(job, { locallySavedRevision: job.revision, locallySavedArtifactIds: [] });
      unsaved.delete(key); errors.delete(id); notify(id); return { ok: true, jobId: job.jobId };
    } catch (error) { const code = error.code || 'TEMPORARY_FAILURE'; errors.set(id, code); notify(id); return { ok: false, error: code }; }
  }
  function acceptRecoveredJob(id, job) {
      try {
        const record = read(id); const image = record.images.find((item) => job.target && item.id === job.target.imageId);
        if (!image) return { ok: false, error: 'DEPENDENCY_MISSING' };
        checked(job, record, image);
        if (!image.stageJobs[job.kind]) {
          if (job.attempt !== 1) return { ok: false, error: 'stale-job' };
          save(id, (draft) => { draft.images.find((item) => item.id === image.id).stageJobs[job.kind] =
            Object.assign({}, clone(job), { locallySavedRevision: null }); });
        }
        return applyJob(id, job);
      } catch (error) { const code = error.code || 'TEMPORARY_FAILURE'; errors.set(id, code); notify(id); return { ok: false, error: code }; }
  }
  async function saveTranslation(id, imageId) {
    const key = keyFor(id, 'image_translation', imageId);
    return run(`${key}:save`, id, async () => {
      const image = read(id).images.find((item) => item.id === imageId); let artifact = image && image.translation;
      if (!artifact) return { ok: true };
      if (artifact.saveState === 'saved') return { ok: true };
      save(id, (draft) => { draft.images.find((item) => item.id === imageId).translation.saveState = 'saving'; });
      try {
        // A download credential/address can change without a new business revision.
        const current = image.stageJobs.image_translation;
        const latest = await backend.getJob(current.jobId);
        checked(latest, read(id), read(id).images.find((item) => item.id === imageId));
        if (latest.jobId !== current.jobId || latest.attempt !== current.attempt || latest.revision !== current.revision ||
            latest.state !== 'succeeded' || latest.output.state !== 'ready' || latest.output.artifact.id !== artifact.id) throw { code: 'stale-job' };
        artifact = latest.output.artifact;
        save(id, (draft) => {
          const target = draft.images.find((item) => item.id === imageId);
          if (target.translation.id !== artifact.id) throw new Error('stale translation');
          Object.assign(target.translation, clone(artifact));
          target.stageJobs.image_translation.output.artifact = clone(artifact);
        });
        const temporaryPath = await backend.downloadArtifact(artifact); previews.set(artifact.id, temporaryPath); previewOwners.set(artifact.id, id);
        read(id);
        const local = await translationFiles.copyTranslation(artifact, temporaryPath, id);
        if (records.isDeleted(id)) { previews.delete(artifact.id); records.finishDeletion(id); throw { code: 'record-missing' }; }
        save(id, (draft) => {
          const target = draft.images.find((item) => item.id === imageId);
          if (!target.translation || target.translation.id !== artifact.id) throw new Error('stale translation');
          Object.assign(target.translation, local, { saveState: 'saved', error: null });
        });
        if (receipts) receipts.saved(latest, { locallySavedRevision: latest.revision, locallySavedArtifactIds: [artifact.id] });
        return { ok: true };
      } catch (error) {
        if (records.isDeleted(id)) { previews.delete(artifact.id); records.finishDeletion(id); }
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
      if (network) await network.requireOnline();
      let request = image.jobRequests && image.jobRequests[kind];
      if (request) return continueSubmission(id, image.id, kind);
      if (!request) {
        request = { contextId: record.contextId, kind, target: { imageId: image.id }, input: {
          contextSnapshotVersion: record.contextSnapshotVersion, assetId: image.assetId, targetLanguage: image.targetLanguage } };
        if (kind === 'image_cards') request.input.inputKind = image.kind;
        save(id, (draft) => { const target = draft.images.find((item) => item.id === image.id); target.jobRequests = Object.assign({}, target.jobRequests, { [kind]: request });
          if (record.contextSnapshot) target.jobSnapshots = Object.assign({}, target.jobSnapshots, { [kind]: clone(record.contextSnapshot) }); });
      }
      const job = await backend.createJob(request, image.requests[kind]);
      const result = acceptRecoveredJob(id, job);
      if (!result.ok && result.error !== 'stale-job') return result;
      if (kind === 'image_translation' && job.state === 'succeeded') return saveTranslation(id, image.id);
      return poll(id, image.id, kind);
    });
  }
  function stageRun(id, imageId, kind, action, operation) {
    const key = keyFor(id, kind, imageId);
    stageErrors.delete(key);
    const result = run(`${key}:${action}`, id, operation);
    notify(id);
    return result.then((value) => {
      if (!value.ok && value.error !== 'stale-job') stageErrors.set(key, value.error);
      notify(id); return value;
    });
  }
  function continueSubmission(id, imageId, kind) {
    return stageRun(id, imageId, kind, 'continue', async () => {
      if (!IMAGE_STAGES.includes(kind)) return { ok: false, error: 'INPUT_UNSUPPORTED' };
      const image = read(id).images.find((item) => item.id === imageId);
      const request = image && image.jobRequests && image.jobRequests[kind];
      if (!request) return { ok: false, error: 'DEPENDENCY_MISSING' };
      if (image.stageJobs[kind]) return poll(id, imageId, kind);
      const result = await retries.continueSubmission({ request, requestId: image.requests[kind] }, {
        isCurrent() {
          const record = read(id); const target = record.images.find((item) => item.id === imageId);
          return record.contextId === request.contextId && target && JSON.stringify(target.jobRequests?.[kind]) === JSON.stringify(request);
        },
        accept: (job) => acceptRecoveredJob(id, job)
      });
      if (!result.ok && result.error !== 'stale-job') return result;
      const job = read(id).images.find((item) => item.id === imageId).stageJobs[kind];
      if (!job) return { ok: false, error: 'DEPENDENCY_MISSING' };
      if (job.state === 'succeeded' && kind === 'image_translation') return saveTranslation(id, imageId);
      return poll(id, imageId, kind);
    });
  }
  function retryStage(id, imageId, kind) {
    return stageRun(id, imageId, kind, 'retry', async () => {
      if (!IMAGE_STAGES.includes(kind)) return { ok: false, error: 'INPUT_UNSUPPORTED' };
      const retained = unsaved.get(keyFor(id, kind, imageId));
      if (retained) {
        const restored = applyJob(id, retained);
        if (!restored.ok) return restored;
        if (retained.state === 'succeeded' && kind === 'image_translation') return saveTranslation(id, imageId);
        if (['queued', 'running', 'succeeded'].includes(retained.state)) return poll(id, imageId, kind);
      }
      const image = read(id).images.find((item) => item.id === imageId);
      if (!image || !image.stageJobs[kind]) return { ok: false, error: 'DEPENDENCY_MISSING' };
      if (network) await network.requireOnline();
      let intent = image.stageRetries && image.stageRetries[kind];
      if (!intent) {
        intent = retries.prepare(image.stageJobs[kind]);
        save(id, (draft) => {
          const target = draft.images.find((item) => item.id === imageId);
          target.stageRetries = Object.assign({}, target.stageRetries, { [kind]: intent });
        });
      }
      const result = await retries.submit(intent, {
        isCurrent() {
          const record = read(id); const target = record.images.find((item) => item.id === imageId);
          return record.contextId === intent.contextId && target && target.stageRetries?.[kind]?.requestId === intent.requestId && target.stageJobs[kind].jobId === intent.jobId;
        },
        accept: (job) => acceptRecoveredJob(id, job)
      });
      const job = read(id).images.find((item) => item.id === imageId).stageJobs[kind];
      if (!result.ok && (result.error !== 'stale-job' || job.jobId !== intent.jobId || job.attempt !== intent.body.expectedAttempt + 1)) return result;
      if (job.state === 'succeeded' && kind === 'image_translation') return saveTranslation(id, imageId);
      return poll(id, imageId, kind);
    });
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getStageState(id, imageId, kind) {
      const record = read(id); const image = record.images.find((item) => item.id === imageId);
      const key = keyFor(id, kind, imageId); const job = image?.stageJobs?.[kind];
      const busy = [...active.keys()].some((value) => value === key || value.startsWith(key + ':') ||
        (record.images[0]?.id === imageId && value === keyFor(id, kind, 'first')));
      return { busy, canRetry: !busy && job?.state === 'failed' && job.error?.retryable === true,
        canContinue: !busy && !job && !!image?.jobRequests?.[kind],
        retryPending: !!image?.stageRetries?.[kind], error: stageErrors.get(key) || null };
    },
    getState(id) {
      if (!records.getRecord(id).ok) return { running: false, error: 'record-missing', unsavedJob: null, unsavedJobs: [], previewPaths: {}, savingTranslations: [] };
      const pending = [...unsaved.entries()].filter(([key]) => key.startsWith(id + ':')).map(([, job]) => clone(job));
      return { running: [...active.keys()].some((key) => key.startsWith(id + ':')), error: errors.get(id) || null,
        unsavedJob: pending.find((job) => job.kind === 'image_cards') || null, unsavedJobs: pending, previewPaths: Object.fromEntries(previews),
        savingTranslations: [...active.keys()].filter((key) => key.startsWith(id + ':image_translation:') && key.endsWith(':save'))
          .map((key) => key.slice((id + ':image_translation:').length, -5)) };
    },
    applyJob, saveTranslation, acceptRecoveredJob, retryStage, continueSubmission,
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
        const record = read(id);
        const requests = record.images.flatMap((image) => IMAGE_STAGES.filter((kind) => image.jobRequests && image.jobRequests[kind] &&
          (!image.stageJobs[kind] || image.stageRetries?.[kind] || ['queued', 'running'].includes(image.stageJobs[kind].state) ||
            image.stageJobs[kind].locallySavedRevision !== image.stageJobs[kind].revision)).map((kind) => image.jobRequests[kind]));
        const fileSaves = [];
        const recovered = await recovery.recover({ contextId: record.contextId, requests, apply: (job) => {
          const result = acceptRecoveredJob(id, job);
          if (result.ok && job.kind === 'image_translation' && job.state === 'succeeded') fileSaves.push(saveTranslation(id, job.target.imageId));
          return result;
        } });
        if (!recovered.ok) { await Promise.all(fileSaves); return recovered; }
        const outcomes = await Promise.all(fileSaves.concat(read(id).images.flatMap((image) => IMAGE_STAGES.filter((kind) => image.stageJobs[kind] &&
          ['queued', 'running'].includes(image.stageJobs[kind].state)).map((kind) => poll(id, image.id, kind)))));
        return outcomes.find((outcome) => !outcome.ok) || { ok: true };
      });
    }
  };
}
module.exports = { createJobs };
