const { makeId } = require('./identity');
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function completeMessages(record) {
  const complete = new Set((record.messages || []).filter(message => message.role === 'assistant' && message.state === 'complete').flatMap(message => [message.id, message.inReplyTo]));
  return (record.messages || []).filter(message => complete.has(message.id)).map(message => {
    const { id, role, text, contentLanguage, inReplyTo, preferencesVersion, attachments } = message;
    return { id, role, text, contentLanguage, inReplyTo, preferencesVersion, attachments: clone(attachments) };
  });
}
/** All producers of record snapshots share this queue. Polling belongs outside it. */
function createRecordContexts({ records, backend, preferences, onDeletedContext }) {
  const pending = new Map();
  function read(id) { const result = records.getRecord(id); if (!result.ok) throw { code: result.error }; return result.record; }
  function save(id, update) { const result = records.updateRecord(id, update); if (!result.ok) throw { code: result.error }; return result.record; }
  const service = {
    run(id, operation) {
      const previous = pending.get(id) || Promise.resolve();
      const next = previous.catch(() => {}).then(operation).finally(() => { if (pending.get(id) === next) pending.delete(id); });
      pending.set(id, next); return next;
    },
    markExpired(id, expectedContextId) {
      if (expectedContextId && read(id).contextId !== expectedContextId) return read(id);
      return save(id, draft => {
        draft.contextUnavailable = true;
        for (const image of draft.images) for (const job of Object.values(image.stageJobs || {})) if (job && ['queued', 'running'].includes(job.state)) { job.state = 'expired'; job.error = { code: 'CONTEXT_EXPIRED', retryable: false }; }
        for (const [messageId, entry] of Object.entries(draft.chatRequests || {})) if (entry.request.contextId === draft.contextId) {
          const job = draft.chatJobs?.[messageId]; if (job && ['queued', 'running'].includes(job.state)) { job.state = 'expired'; job.error = { code: 'CONTEXT_EXPIRED', retryable: false }; }
          const message = (draft.messages || []).find(item => item.id === messageId); if (message && message.state !== 'complete') { message.state = 'failed'; message.expired = true; }
        }
        for (const entry of Object.values(draft.dietaryReviews || {})) if (entry.job && ['queued', 'running'].includes(entry.job.state)) { entry.job.state = 'expired'; entry.job.error = { code: 'CONTEXT_EXPIRED', retryable: false }; }
        draft.chatRetries = {};
      });
    },
    // Only explicit writes call prepare. Reopening and polling never rebuild or upload.
    async prepare(id, { purpose = 'text', requiredImageIds = [] } = {}) {
      let record = read(id);
      try {
        if (record.pendingContextSnapshot) return await service.publishPending(id);
        if (record.contextSnapshotVersion) await backend.listContextJobs(record.contextId);
        return record;
      } catch (error) { if (error.code !== 'CONTEXT_EXPIRED') throw error; }
      const required = purpose === 'chat' && !record.cards?.length ? record.images.map(image => image.id) : requiredImageIds;
      if (required.some(imageId => !record.images.some(image => image.id === imageId && image.original.saveState === 'saved'))) throw { code: 'rebuild-material-missing' };
      const oldContextId = record.contextId; const nextContextId = makeId('context');
      record = save(id, draft => {
        draft.contextIds = [...new Set([...(draft.contextIds || []), oldContextId])];
        draft.contextId = nextContextId; draft.contextSnapshotVersion = 0;
        delete draft.contextSnapshot; delete draft.pendingContextSnapshot; delete draft.contextExpiresAt; delete draft.contextUnavailable;
        draft.contextRebuild = { previousContextId: oldContextId, requiredImageIds: required, reason: 'expired' };
        for (const image of draft.images) {
          image.assetId = null; image.original.assetId = null;
          delete image.uploadTicket; delete image.uploadAttempt;
          image.requests.upload = makeId('upload'); image.requests.complete = makeId('complete');
          if (required.includes(image.id) || image.uploadState !== 'uploaded') image.uploadState = 'pending';
          for (const job of Object.values(image.stageJobs || {})) if (job && ['queued', 'running'].includes(job.state)) {
            job.state = 'expired'; job.error = { code: 'CONTEXT_EXPIRED', retryable: false };
          }
          image.stageRetries = {};
        }
        for (const [messageId, entry] of Object.entries(draft.chatRequests || {})) if (entry.request.contextId === oldContextId) {
          const job = draft.chatJobs?.[messageId];
          if (job && ['queued', 'running'].includes(job.state)) { job.state = 'expired'; job.error = { code: 'CONTEXT_EXPIRED', retryable: false }; }
          const message = (draft.messages || []).find(item => item.id === messageId);
          if (message && message.state !== 'complete') { message.state = 'failed'; message.expired = true; }
        }
        draft.chatRetries = {};
        draft.pendingContextSnapshot = { purpose: 'record', recordId: id, localScopeId: id, snapshotVersion: 1,
          snapshot: { images: draft.images.map(image => ({ imageId: image.id, kind: image.kind, order: image.order, assetId: null })),
            cards: clone(draft.cards || []), messages: completeMessages(draft), preferences: preferences ? preferences.getSnapshot() : record.contextSnapshot.snapshot.preferences } };
      });
      return service.publishPending(id);
    },
    async publishPending(id) {
      const record = read(id); const body = record.pendingContextSnapshot;
      if (!body) return record;
      const response = await backend.putContext(record.contextId, clone(body));
      if (!response || response.contextId !== record.contextId || response.snapshotVersion !== body.snapshotVersion) throw { code: 'SNAPSHOT_CONFLICT' };
      if (records.isDeleted(id)) {
        if (onDeletedContext) await onDeletedContext(id);
        throw { code: 'record-missing' };
      }
      const current = read(id);
      if (current.contextId !== record.contextId || JSON.stringify(current.pendingContextSnapshot) !== JSON.stringify(body)) throw { code: 'SNAPSHOT_CONFLICT' };
      return save(id, draft => {
        draft.contextSnapshotVersion = body.snapshotVersion; draft.contextSnapshot = clone(body); draft.contextExpiresAt = response.expiresAt; delete draft.pendingContextSnapshot;
      });
    }
  };
  return service;
}
module.exports = { createRecordContexts };
