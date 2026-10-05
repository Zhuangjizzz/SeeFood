function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createUploads({ records, preferences, backend, contexts = require('./record-context').createRecordContexts({ records, backend }) }) {
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
        cards: clone(record.cards || []), messages: completeMessages(record), preferences: preferences.getSnapshot() } };
  }
  async function publishContext(id) {
    const result = await contexts.publishPending(id); notify(id); return result;
  }
  function completeMessages(record) {
    const completed = (record.messages || []).filter((message) => message.role === 'assistant' && message.state === 'complete');
    const included = new Set(completed.flatMap((message) => [message.id, message.inReplyTo]));
    return (record.messages || []).filter((message) => included.has(message.id)).map((message) => {
      const { id, role, text, contentLanguage, inReplyTo, preferencesVersion, attachments } = message;
      return { id, role, text, contentLanguage, inReplyTo, preferencesVersion, attachments: clone(attachments) };
    });
  }
  function sameImages(record) {
    const images = record.contextSnapshot && record.contextSnapshot.snapshot.images;
    return images && images.length === record.images.length && record.images.every((image) => images.some((accepted) =>
      accepted.imageId === image.id && accepted.assetId === image.assetId && accepted.kind === image.kind && accepted.order === image.order));
  }
  async function upload(id, imageId, key) {
    let record;
    let targetId;
    const target = (value) => value.images.find((image) => image.id === targetId);
    try {
      record = read(id);
      const unfinished = record.images.filter((image) => image.uploadState !== 'uploaded');
      if (!imageId && !unfinished.length) return { ok: true, recordId: id };
      const selected = imageId ? record.images.find((image) => image.id === imageId) : unfinished.length === 1 ? unfinished[0] : null;
      if (!selected) return { ok: false, error: imageId ? 'image-missing' : 'single-image-only' };
      targetId = selected.id;
      if (selected.uploadState === 'uploaded') return { ok: true, recordId: id };
      if (!backend.enabled) return { ok: false, error: 'backend-unavailable' };
      if (target(record).original.saveState !== 'saved') throw { code: 'original-missing' };
      save(id, (draft) => { target(draft).uploadState = 'uploading'; delete target(draft).uploadError; });
      // Resolve uncertain acceptance before allocating the next version.
      record = await publishContext(id);
      if (!sameImages(record)) {
        save(id, (draft) => { draft.pendingContextSnapshot = snapshot(draft, draft.contextSnapshotVersion + 1); });
        record = await publishContext(id);
      }
      let image = target(read(id));
      if (!image.assetId) {
        let asset;
        let renewed = false;
        while (!asset) {
          image = target(read(id));
          if (!image.uploadTicket) {
            const key = image.uploadAttempt ? image.uploadAttempt.requestId : image.requests.upload;
            const ticket = await backend.createUpload({ contextId: record.contextId, imageId: image.id,
              kind: image.kind, mimeType: image.mimeType, sizeBytes: image.sizeBytes }, key);
            save(id, (draft) => { target(draft).uploadTicket = ticket; });
            image = target(read(id));
          }
          const complete = () => backend.completeUpload(image.uploadTicket.uploadId,
            { contextId: record.contextId, imageId: image.id }, image.requests.complete);
          try {
            if (resuming.has(key)) {
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
              const current = target(draft);
              const generation = (current.uploadAttempt ? current.uploadAttempt.generation : 0) + 1;
              current.uploadAttempt = { generation, requestId: `${current.requests.upload}:renew:${generation}`,
                previousUploadId: current.uploadTicket.uploadId };
              delete current.uploadTicket;
            });
            renewed = true;
          }
        }
        if (asset.contextId !== record.contextId || asset.imageId !== image.id || asset.uploadId !== image.uploadTicket.uploadId || !asset.assetId) throw { code: 'DEPENDENCY_MISSING' };
        save(id, (draft) => { target(draft).assetId = asset.assetId; target(draft).original.assetId = asset.assetId; });
      }
      record = read(id);
      if (!sameImages(record)) save(id, (draft) => {
        draft.pendingContextSnapshot = snapshot(draft, draft.contextSnapshotVersion + 1);
      });
      if (read(id).pendingContextSnapshot) await publishContext(id);
      save(id, (draft) => { target(draft).uploadState = 'uploaded'; delete target(draft).uploadError; });
      return { ok: true, recordId: id };
    } catch (error) {
      const code = error.code || error.message || 'TEMPORARY_FAILURE';
      if (record && targetId) {
        const failed = records.updateRecord(id, (draft) => { target(draft).uploadState = 'failed'; target(draft).uploadError = code; });
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
      const running = [...active.keys()].some((key) => key.startsWith(id + ':'));
      const isResuming = [...resuming].some((key) => key.startsWith(id + ':'));
      const originalMissing = unfinished.some((image) => image.original.saveState !== 'saved' || image.uploadError === 'original-missing');
      return { running, resuming: running && isResuming,
        error: errors.get(id) || (images.find((image) => image.uploadError) || {}).uploadError || null,
        interrupted: !running && unfinished.some((image) => image.uploadState === 'uploading'),
        canRetry: backend.enabled && !running && unfinished.length > 0 && !originalMissing,
        originalMissing };
    },
    uploadRecord(id, imageId) {
      const key = `${id}:${imageId || 'single'}`;
      if (!active.has(key)) {
        const previous = records.getRecord(id);
        if (previous.ok && previous.record.images.some((image) => (!imageId || image.id === imageId) && !['pending', 'uploaded'].includes(image.uploadState))) resuming.add(key);
        errors.delete(id);
        active.set(key, contexts.run(id, () => upload(id, imageId, key)).then((result) => {
          if (!result.ok) errors.set(id, result.error);
          return result;
        }).finally(() => { active.delete(key); resuming.delete(key); notify(id); }));
      }
      return active.get(key);
    }
  };
}

module.exports = { createUploads };
