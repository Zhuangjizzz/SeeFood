const { makeId } = require('./identity');
const { LANGUAGES } = require('./i18n');
const { INPUT_LIMITS } = require('./capture');
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createRecords({ store, files, translationFiles, now = () => new Date().toISOString() }) {
  const submissions = new Map();
  const activeSaves = new Map();
  function readRecords() {
    const records = store.get('records', []);
    if (!Array.isArray(records) || records.some((record) => !record || typeof record.id !== 'string' ||
        typeof record.createdAt !== 'string' || !Array.isArray(record.images) || !Array.isArray(record.imageIds) ||
        record.images.some((image) => !image || !image.original || image.recordId !== record.id))) {
      throw new Error('Unreadable local records');
    }
    return records;
  }
  function readableRecord(record) {
    const result = clone(record);
    result.images.forEach((image) => {
      if (image.original.saveState === 'saved' && !files.hasOriginal(image.localOriginalPath, image.sizeBytes)) {
        image.original.saveState = 'failed';
        image.original.error = 'original-missing';
      }
      if (image.translation && image.translation.saveState === 'saved' &&
          (!translationFiles || !translationFiles.hasTranslation(image.translation.localPath, image.translation.sizeBytes))) {
        image.translation.saveState = 'failed'; image.translation.error = 'translation-missing';
      }
    });
    return result;
  }
  function validBatch(batch) {
    return batch && typeof batch.id === 'string' && batch.id.length > 0 && batch.target && batch.target.kind === 'new' &&
      LANGUAGES.some((language) => language.code === batch.targetLanguage) && Array.isArray(batch.images) &&
      batch.images.length > 0 && batch.images.length <= INPUT_LIMITS.maxImages &&
      new Set(batch.images.map((image) => image && image.id)).size === batch.images.length &&
      batch.images.every((image, index) => image && typeof image.id === 'string' && image.id && image.order === index &&
        ['menu', 'dish'].includes(image.kind) && typeof image.localPath === 'string' && image.localPath &&
        Number.isInteger(image.sizeBytes) && image.sizeBytes > 0 && image.sizeBytes <= INPUT_LIMITS.maxImageBytes &&
        image.width > 0 && image.height > 0 && INPUT_LIMITS.mimeTypes.includes(image.mimeType));
  }
  function signature(batch) {
    return JSON.stringify({ id: batch.id, target: batch.target, targetLanguage: batch.targetLanguage,
      images: batch.images.map((image) => ({ id: image.id, kind: image.kind, order: image.order,
        width: image.width, height: image.height, orientation: image.orientation || 'up',
        mimeType: image.mimeType, sizeBytes: image.sizeBytes })) });
  }
  function prepare(batch) {
    const id = makeId('record');
    const createdAt = now();
    const record = { id, createdAt, updatedAt: createdAt, title: null, kind: batch.images[0].kind,
      sourceBatchId: batch.id, captureSignature: signature(batch), requestId: makeId('request'), contextId: makeId('context'), contextSnapshotVersion: 0,
      imageIds: batch.images.map((image) => image.id), cardIds: [], messageIds: [], saveState: 'pending',
      images: batch.images.map((image) => ({
        id: image.id, recordId: id, kind: image.kind, order: image.order,
        width: image.width, height: image.height, orientation: image.orientation || 'up',
        sizeBytes: image.sizeBytes, mimeType: image.mimeType, targetLanguage: batch.targetLanguage,
        localOriginalPath: null, uploadState: 'pending', assetId: null,
        requests: { upload: makeId('upload'), complete: makeId('complete'), image_cards: makeId('cards'), image_translation: makeId('translation') },
        stageJobs: { image_cards: null, image_translation: null },
        original: { id: makeId('original'), imageId: image.id, kind: 'original', contentLanguage: null,
          assetId: null, localPath: null, saveState: 'pending' }
      })) };
    return { batch: clone(batch), record, saveState: 'pending', error: null };
  }
  function failure(submission, error) {
    submission.saveState = 'failed';
    submission.record.saveState = 'failed';
    submission.error = error;
    return { ok: false, error, batchId: submission.batch.id };
  }
  async function save(submission) {
    const { batch, record } = submission;
    submission.saveState = 'saving';
    submission.error = null;
    record.saveState = 'saving';
    let previous;
    try { previous = readRecords(); }
    catch (_) { return failure(submission, 'storage-read'); }
    const existing = previous.find((item) => item.sourceBatchId === batch.id);
    if (existing) {
      if (existing.captureSignature !== signature(batch)) return failure(submission, 'capture-conflict');
      submission.record = clone(existing);
      submission.saveState = 'saved';
      return { ok: true, recordId: existing.id };
    }
    for (let index = 0; index < record.images.length; index += 1) {
      const image = record.images[index];
      if (image.original.saveState === 'saved' && files.hasOriginal(image.localOriginalPath, image.sizeBytes)) continue;
      image.original.saveState = 'saving';
      try {
        image.localOriginalPath = await files.copyOriginal(batch.images[index], record.id);
        image.original.localPath = image.localOriginalPath;
        image.original.saveState = 'saved';
      } catch (_) {
        image.original.saveState = 'failed';
        return failure(submission, 'original-write');
      }
    }
    record.saveState = 'saved';
    try { previous = readRecords(); }
    catch (_) { return failure(submission, 'storage-read'); }
    try { store.set('records', previous.concat(record)); }
    catch (_) { return failure(submission, 'storage-write'); }
    submission.saveState = 'saved';
    return { ok: true, recordId: record.id };
  }
  function startSave(submission) {
    const batchId = submission.batch.id;
    if (activeSaves.has(batchId)) return activeSaves.get(batchId);
    const result = save(submission).finally(() => activeSaves.delete(batchId));
    activeSaves.set(batchId, result);
    return result;
  }
  return {
    async confirmCapture(batch) {
      if (!validBatch(batch)) return { ok: false, error: 'capture-invalid' };
      const previous = submissions.get(batch.id);
      if (previous && previous.discarding) return { ok: false, error: 'submission-discarded' };
      if (previous && previous.record.captureSignature !== signature(batch)) {
        return { ok: false, error: 'capture-conflict', batchId: batch.id };
      }
      if (!submissions.has(batch.id)) submissions.set(batch.id, prepare(batch));
      return startSave(submissions.get(batch.id));
    },
    retrySave(batchId) {
      const submission = submissions.get(batchId);
      if (!submission) return Promise.resolve({ ok: false, error: 'submission-missing' });
      if (submission.discarding) return Promise.resolve({ ok: false, error: 'submission-discarded' });
      if (submission.saveState === 'saved') return Promise.resolve({ ok: true, recordId: submission.record.id });
      return startSave(submission);
    },
    async discardSubmission(batchId) {
      const submission = submissions.get(batchId);
      if (!submission) return { ok: true };
      submission.discarding = true;
      if (activeSaves.has(batchId)) await activeSaves.get(batchId);
      if (submission.saveState !== 'saved') {
        let records;
        try { records = readRecords(); }
        catch (_) { return { ok: false, error: 'storage-read' }; }
        if (!records.some((record) => record.id === submission.record.id)) {
          try { files.removeUncommittedOriginals(submission.record.id); }
          catch (_) { return { ok: false, error: 'original-cleanup' }; }
        }
      }
      submissions.delete(batchId);
      return { ok: true };
    },
    getSubmission(batchId) {
      const submission = submissions.get(batchId);
      return submission ? clone(submission) : null;
    },
    // Synchronous transaction for request/recovery services. The callback edits a fresh
    // snapshot; a failed write leaves the last persisted record intact.
    updateRecord(id, update) {
      let records;
      try { records = readRecords(); }
      catch (_) { return { ok: false, error: 'storage-read' }; }
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return { ok: false, error: 'record-missing' };
      const previous = records[index];
      const next = clone(previous);
      try {
        const returned = update(next);
        if (returned && typeof returned.then === 'function') throw new Error('Record updates must be synchronous');
        if (next.id !== previous.id || next.createdAt !== previous.createdAt || next.sourceBatchId !== previous.sourceBatchId ||
            next.requestId !== previous.requestId || !Array.isArray(next.images) ||
            next.images.some((image) => image.recordId !== id || !image.original)) throw new Error('Record association changed');
      } catch (_) { return { ok: false, error: 'record-invalid' }; }
      next.updatedAt = now();
      next.saveState = 'saved';
      records[index] = next;
      try { store.set('records', records); }
      catch (_) { return { ok: false, error: 'storage-write' }; }
      return { ok: true, record: clone(next) };
    },
    getRecord(id) {
      try {
        const record = readRecords().find((item) => item.id === id);
        return record ? { ok: true, record: readableRecord(record) } : { ok: false, error: 'record-missing' };
      } catch (_) { return { ok: false, error: 'storage-read' }; }
    },
    listHistory() {
      try {
        return { ok: true, records: readRecords().reverse().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(readableRecord) };
      } catch (_) { return { ok: false, error: 'storage-read', records: [] }; }
    },
    listRecent(limit = 3) {
      try {
        return { ok: true, records: readRecords().reverse().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit).map(readableRecord) };
      } catch (_) { return { ok: false, error: 'storage-read', records: [] }; }
    }
  };
}

module.exports = { createRecords };
