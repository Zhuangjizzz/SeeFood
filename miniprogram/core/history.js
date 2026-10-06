function dateTime(value) {
  const date = new Date(value); const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const TOP = { anchorId: null, offset: 0, scrollTop: 0 };
function position(value) {
  if (!value || !Number.isFinite(value.offset) || !Number.isFinite(value.scrollTop) || value.scrollTop < 0) return { ...TOP };
  return { anchorId: typeof value.anchorId === 'string' ? value.anchorId : null, offset: value.offset, scrollTop: value.scrollTop };
}
function source(value) { return { view: value && value.view === 'history' ? 'history' : 'home', historySource: value && value.historySource === 'mine' ? 'mine' : 'home' }; }
function createHistory({ records, application, jobs, chat, uploads, store, dietaryReview }) {
  function processingState(record, imageState, chatState, dietaryState) {
    const stages = record.images.flatMap((image) => ['image_cards', 'image_translation'].map((kind) =>
      (imageState.unsavedJobs || []).find((job) => job.kind === kind && job.target.imageId === image.id) ||
      image.stageJobs[kind] || { state: 'pending' }));
    const replies = Object.values(record.chatJobs || {}).map((job) => chatState.unsavedJob && chatState.unsavedJob.jobId === job.jobId ? chatState.unsavedJob : job);
    const reviews = (dietaryState.jobs || []).map(job => dietaryState.unsavedJob?.jobId === job.jobId ? dietaryState.unsavedJob : job);
    const states = stages.concat(replies, reviews).map((job) => job.state);
    const succeeded = states.some((state) => state === 'succeeded');
    const failed = states.some((state) => ['failed', 'cancelled', 'expired'].includes(state)) || record.images.some((image) => image.uploadState === 'failed');
    if (failed) return succeeded ? 'partialFailed' : 'failed';
    if (states.every((state) => state === 'succeeded') && !chatState.running) return 'complete';
    if (succeeded) return 'partial';
    if (states.some((state) => ['running', 'queued'].includes(state)) || chatState.running) return 'processing';
    if (record.images.some((image) => ['image_cards', 'image_translation'].some((kind) => image.jobRequests && image.jobRequests[kind] && !image.stageJobs[kind]))) return 'checking';
    if (record.images.some((image) => image.uploadState === 'uploading')) return 'uploading';
    if (record.images.some((image) => image.uploadState === 'pending')) return 'pending';
    return 'uploaded';
  }
  function describe(record) {
    const copy = application.getState().copy;
    const originalsSaved = record.images.every((image) => image.original.saveState === 'saved');
    const translationsSaved = record.images.every((image) => !image.translation || image.translation.saveState === 'saved');
    const dietaryState = dietaryReview ? dietaryReview.getState(record.id) : {};
    const imageState = jobs.getState(record.id); const chatState = chat.getState(record.id); const upload = uploads.getState(record.id);
    const artifacts = record.images.flatMap((image) => [image.original].concat(image.translation || []));
    const missingImages = artifacts.filter((artifact) => artifact.saveState !== 'saved').length;
    const unsaved = (imageState.unsavedJobs || []).length || chatState.unsavedJob || dietaryState.unsavedJob || ['storage-read', 'storage-write'].includes(upload.error);
    const saving = record.images.some((image) => image.original.saveState === 'saving' ||
      image.translation && image.translation.saveState === 'saving' && (imageState.savingTranslations || []).includes(image.id)) || record.saveState === 'saving';
    const saveState = unsaved || record.saveState === 'failed' ? 'failed' : saving ? 'saving' : originalsSaved && translationsSaved ? 'saved' : 'partial';
    const first = record.images[0];
    return { id: record.id, title: record.title || `${record.kind === 'dish' ? copy.dish : copy.menu} · ${dateTime(record.createdAt).split(' ')[0]}`,
      createdAtLabel: dateTime(record.createdAt), imageCount: record.images.length,
      thumbnail: first && first.original.saveState === 'saved' ? first.localOriginalPath : null,
      processingState: processingState(record, imageState, chatState, dietaryState), saveState, missingImages, offlineAvailable: saveState === 'saved' };
  }
  return { describe,
    subscribe(listener) {
      const stops = [uploads, jobs, chat, records, dietaryReview].filter(Boolean).map((service) => service.subscribe(listener));
      return () => stops.forEach((stop) => stop());
    },
    saveListPosition(view, value) {
      if (!['history', 'home'].includes(view)) return { ok: false, error: 'view-invalid' };
      try {
        const state = store.get('history-browse', {}); state[view] = position(value); store.set('history-browse', state);
        return { ok: true };
      } catch (_) { return { ok: false, error: 'storage-write' }; }
    },
    getListPosition(view) {
      try {
        const saved = position(store.get('history-browse', {})[view]);
        const list = view === 'home' ? records.listRecent(3) : records.listHistory();
        return list.ok && (!saved.anchorId || list.records.some((record) => record.id === saved.anchorId)) ? saved : { ...TOP };
      } catch (_) { return { ...TOP }; }
    },
    enterRecord(id, value) { return records.updateRecord(id, (record) => { record.browseState = { ...record.browseState, resultSource: source(value) }; }); },
    getResultSource(id) { const result = records.getRecord(id); return source(result.ok && result.record.browseState && result.record.browseState.resultSource); },
    saveResultPosition(id, value) { return records.updateRecord(id, (record) => { record.browseState = { ...record.browseState, resultPosition: position(value) }; }); },
    getResultPosition(id) {
      const result = records.getRecord(id); if (!result.ok) return { ...TOP };
      const record = result.record; const browse = record.browseState || {}; const saved = position(browse.resultPosition);
      const image = record.images.find((item) => item.id === browse.currentImageId) || record.images[0];
      const anchors = image ? [`image:${image.id}`].concat((record.cards || []).filter((card) => card.sourceImageIds.includes(image.id)).map((card) => `card:${card.id}`)) : [];
      return !saved.anchorId || anchors.includes(saved.anchorId) ? saved : { ...TOP };
    },
    list({ recent = false } = {}) {
      const result = recent ? records.listRecent(3) : records.listHistory();
      return result.ok ? { ok: true, entries: result.records.map(describe) } : { ok: false, entries: [], error: result.error };
    }
  };
}
module.exports = { createHistory };
