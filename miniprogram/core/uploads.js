function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createUploads({ records, preferences, backend }) {
  const active = new Map();
  const resuming = new Set();
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
        let asset;
        let renewed = false;
        while (!asset) {
          image = read(id).images[0];
          if (!image.uploadTicket) {
            const key = image.uploadAttempt ? image.uploadAttempt.requestId : image.requests.upload;
            const ticket = await backend.createUpload({ contextId: record.contextId, imageId: image.id,
              kind: image.kind, mimeType: image.mimeType, sizeBytes: image.sizeBytes }, key);
            save(id, (draft) => { draft.images[0].uploadTicket = ticket; });
            image = read(id).images[0];
          }
          const complete = () => backend.completeUpload(image.uploadTicket.uploadId,
            { contextId: record.contextId, imageId: image.id }, image.requests.complete);
          try {
            if (resuming.has(id)) {
              // A lost completion response may already own an asset, even after the byte ticket expires.
              try { asset = await complete(); }
              catch (error) { if (error.code !== 'UPLOAD_INCOMPLETE') throw error; }
            }
            if (!asset) {
              try { await backend.sendUpload(image.uploadTicket, image.localOriginalPath); }
              catch (error) {
                if (error.code !== 'UPLOAD_EXPIRED') throw error;
                // Only the completion endpoint can establish that the old ticket owns no asset.
                asset = await complete();
              }
              if (!asset) asset = await complete();
            }
          } catch (error) {
            if (error.code !== 'UPLOAD_EXPIRED' || renewed) throw error;
            save(id, (draft) => {
              const current = draft.images[0];
              const generation = (current.uploadAttempt ? current.uploadAttempt.generation : 0) + 1;
              current.uploadAttempt = { generation, requestId: `${current.requests.upload}:renew:${generation}`,
                previousUploadId: current.uploadTicket.uploadId };
              delete current.uploadTicket;
            });
            renewed = true;
          }
        }
        if (asset.contextId !== record.contextId || asset.imageId !== image.id || asset.uploadId !== image.uploadTicket.uploadId || !asset.assetId) throw { code: 'DEPENDENCY_MISSING' };
        save(id, (draft) => { draft.images[0].assetId = asset.assetId; draft.images[0].original.assetId = asset.assetId; });
      }
      record = read(id);
      const acceptedImages = record.contextSnapshot && record.contextSnapshot.snapshot.images;
      const alreadyBound = acceptedImages && acceptedImages.length === record.images.length && record.images.every((item) =>
        acceptedImages.some((accepted) => accepted.imageId === item.id && accepted.assetId === item.assetId && accepted.kind === item.kind && accepted.order === item.order));
      if (!record.pendingContextSnapshot && !alreadyBound) save(id, (draft) => {
        // Bind the asset to a new version while preserving the accepted snapshot's other content.
        const next = clone(draft.contextSnapshot);
        next.snapshotVersion = draft.contextSnapshotVersion + 1;
        next.snapshot.images = draft.images.map((item) => ({ imageId: item.id, kind: item.kind, order: item.order, assetId: item.assetId }));
        draft.pendingContextSnapshot = next;
      });
      if (read(id).pendingContextSnapshot) await publishContext(id);
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
    getState(id) {
      const result = records.getRecord(id);
      const images = result.ok ? result.record.images : [];
      const unfinished = images.filter((image) => image.uploadState !== 'uploaded');
      const running = active.has(id);
      const originalMissing = unfinished.some((image) => image.original.saveState !== 'saved' || image.uploadError === 'original-missing');
      return { running, resuming: running && resuming.has(id),
        error: errors.get(id) || (images.find((image) => image.uploadError) || {}).uploadError || null,
        interrupted: !running && unfinished.some((image) => image.uploadState === 'uploading'),
        canRetry: backend.enabled && !running && unfinished.length > 0 && !originalMissing,
        originalMissing };
    },
    uploadRecord(id) {
      if (!active.has(id)) {
        const previous = records.getRecord(id);
        if (previous.ok && previous.record.images.some((image) => image.uploadState !== 'pending')) resuming.add(id);
        errors.delete(id);
        active.set(id, Promise.resolve().then(() => upload(id)).then((result) => {
          if (!result.ok) errors.set(id, result.error);
          return result;
        }).finally(() => { active.delete(id); resuming.delete(id); notify(id); }));
      }
      return active.get(id);
    }
  };
}

module.exports = { createUploads };
