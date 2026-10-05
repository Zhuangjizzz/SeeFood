const STAGES = ['image_cards', 'image_translation'];

function createImageBatches({ records, uploads, jobs }) {
  function imageIds(record, batchId) {
    const batch = (record.captureBatches || {})[batchId];
    if (batch) return batch.imageIds;
    // Records saved before batch orchestration retain the original capture signature.
    if (record.sourceBatchId === batchId) return JSON.parse(record.captureSignature).images.map((image) => image.id);
    return null;
  }
  function startImages(recordId, ids) {
    return Promise.all(ids.map((imageId) => {
      return uploads.uploadRecord(recordId, imageId).then((result) =>
        result.ok ? jobs.startImageProcessing(recordId, imageId) : result
      ).catch((error) => ({ ok: false, error: error.code || 'TEMPORARY_FAILURE' })).then((result) => Object.assign({ imageId }, result));
    })).then((results) => {
      const failed = results.find((result) => !result.ok);
      return Object.assign({ ok: !failed, results }, failed ? { error: failed.error } : {});
    });
  }
  return {
    startBatch(recordId, batchId) {
      const value = records.getRecord(recordId);
      if (!value.ok) return Promise.resolve(value);
      const ids = imageIds(value.record, batchId);
      if (!ids || !ids.length || ids.some((id) => !value.record.imageIds.includes(id))) return Promise.resolve({ ok: false, error: 'batch-missing' });
      return startImages(recordId, ids);
    },
    retryUploads(recordId, imageId) {
      const value = records.getRecord(recordId);
      if (!value.ok) return Promise.resolve(value);
      const ids = value.record.images.filter((image) => (!imageId || image.id === imageId) && uploads.getState(recordId, image.id).canRetry).map((image) => image.id);
      return ids.length ? startImages(recordId, ids) : Promise.resolve({ ok: false, error: 'upload-unavailable' });
    },
    getState(recordId) {
      const value = records.getRecord(recordId);
      return { canLeave: value.ok && value.record.images.length > 0 && value.record.images.every((image) =>
        image.uploadState === 'uploaded' && STAGES.every((kind) => !!image.stageJobs[kind])) };
    }
  };
}
module.exports = { createImageBatches };
