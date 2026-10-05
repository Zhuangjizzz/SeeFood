function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createUploads({ records, preferences, backend }) {
  const active = new Map();
  const errors = new Map();
  const listeners = new Set();
  function notify(id) { listeners.forEach((listener) => { try { listener(id); } catch (_) { /* A departed page cannot fail persistence. */ } }); }
  function read(id) {
    const result = records.getRecord(id);
    if (!result.ok) throw { code: result.error };
    return result.record;
  }
  function save(id, edit) {
    const result = records.updateRecord(id, edit);
    if (!result.ok) throw { code: result.error };
    notify(id);
    return result.record;
  }
  function snapshot(record, version) {
    return { purpose: 'record', localScopeId: record.id, recordId: record.id, snapshotVersion: version,
      snapshot: { images: record.images.map((image) => ({ imageId: image.id, kind: image.kind, order: image.order, assetId: image.assetId })),
        cards: clone(record.cards || []), messages: clone(record.messages || []), preferences: preferences.getSnapshot() } };
  }
  async function publishContext(id) {
    const record = read(id);
    const pending = record.pendingContextSnapshot;
    const result = await backend.putContext(record.contextId, pending);
    if (result.contextId !== record.contextId || result.snapshotVersion !== pending.snapshotVersion) throw { code: 'SNAPSHOT_CONFLICT' };
    return save(id, (draft) => {
      draft.contextSnapshotVersion = result.snapshotVersion;
      draft.contextSnapshot = pending;
      delete draft.pendingContextSnapshot;
    });
  }
  async function upload(id) {
    let record;
    try {
      record = read(id);
      if (record.images.length !== 1) return { ok: false, error: 'single-image-only' };
      if (record.images[0].uploadState === 'uploaded') return { ok: true, recordId: id };
      if (!backend.enabled) return { ok: false, error: 'backend-unavailable' };
      if (record.images[0].original.saveState !== 'saved') throw { code: 'original-missing' };
      save(id, (draft) => { draft.images[0].uploadState = 'uploading'; delete draft.images[0].uploadError; });
      if (!record.contextSnapshotVersion) {
        if (!record.pendingContextSnapshot) save(id, (draft) => { draft.pendingContextSnapshot = snapshot(draft, 1); });
        record = await publishContext(id);
      }
      let image = read(id).images[0];
      if (!image.assetId) {
        if (!image.uploadTicket) {
          const ticket = await backend.createUpload({ contextId: record.contextId, imageId: image.id,
            kind: image.kind, mimeType: image.mimeType, sizeBytes: image.sizeBytes }, image.requests.upload);
          save(id, (draft) => { draft.images[0].uploadTicket = ticket; });
          image = read(id).images[0];
        }
        await backend.sendUpload(image.uploadTicket, image.localOriginalPath);
        const asset = await backend.completeUpload(image.uploadTicket.uploadId, { contextId: record.contextId, imageId: image.id }, image.requests.complete);
        if (asset.contextId !== record.contextId || asset.imageId !== image.id || asset.uploadId !== image.uploadTicket.uploadId || !asset.assetId) throw { code: 'DEPENDENCY_MISSING' };
        save(id, (draft) => { draft.images[0].assetId = asset.assetId; draft.images[0].original.assetId = asset.assetId; });
      }
      record = read(id);
      if (!record.pendingContextSnapshot) save(id, (draft) => {
        // Bind the asset to a new version while preserving the accepted snapshot's other content.
        const next = clone(draft.contextSnapshot);
        next.snapshotVersion = draft.contextSnapshotVersion + 1;
        next.snapshot.images = draft.images.map((item) => ({ imageId: item.id, kind: item.kind, order: item.order, assetId: item.assetId }));
        draft.pendingContextSnapshot = next;
      });
      await publishContext(id);
      save(id, (draft) => { draft.images[0].uploadState = 'uploaded'; delete draft.images[0].uploadError; });
      return { ok: true, recordId: id };
    } catch (error) {
      const code = error.code || error.message || 'TEMPORARY_FAILURE';
      if (record) {
        const failed = records.updateRecord(id, (draft) => { draft.images[0].uploadState = 'failed'; draft.images[0].uploadError = code; });
        notify(id);
        if (!failed.ok) return { ok: false, error: failed.error };
      }
      return { ok: false, error: code };
    }
  }
  return {
    enabled: backend.enabled,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getState(id) { return { running: active.has(id), error: errors.get(id) || null }; },
    uploadRecord(id) {
      if (!active.has(id)) {
        errors.delete(id);
        active.set(id, upload(id).then((result) => {
          if (!result.ok) errors.set(id, result.error);
          return result;
        }).finally(() => { active.delete(id); notify(id); }));
      }
      return active.get(id);
    }
  };
}

module.exports = { createUploads };
