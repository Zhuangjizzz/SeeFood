/** Result and fullscreen readers share stable per-image choices. */
function createImageView({ records, jobs }) {
  const sessions = new Map();
  function persist(id, state) {
    const result = records.updateRecord(id, (record) => { record.browseState = Object.assign({}, record.browseState, {
      currentImageId: state.currentImageId, imageVariants: state.imageVariants }); });
    state.error = result.ok ? null : result.error;
    return result;
  }
  function open(id, imageId) {
    const result = records.getRecord(id); if (!result.ok) return result;
    const record = result.record;
    let state = sessions.get(id);
    if (!state) {
      state = { currentImageId: record.browseState && record.browseState.currentImageId,
        imageVariants: Object.assign({}, record.browseState && record.browseState.imageVariants), error: null };
      sessions.set(id, state);
    }
    const image = record.images.find((item) => item.id === (imageId || state.currentImageId)) || record.images[0];
    if (!image) return { ok: false, error: 'record-missing' };
    const jobState = jobs.getState(id);
    const unsaved = (jobState.unsavedJobs || []).find((job) => job.kind === 'image_translation' && job.target.imageId === image.id);
    const job = unsaved || image.stageJobs.image_translation;
    const artifact = image.translation || (job && job.output && job.output.artifact);
    const translatedPath = artifact && (artifact.saveState === 'saved' ? artifact.localPath : jobState.previewPaths[artifact.id]);
    const translationAvailable = !!(job && job.state === 'succeeded' && job.output.state === 'ready' && translatedPath);
    let changed = state.currentImageId !== image.id;
    state.currentImageId = image.id;
    if (!state.imageVariants[image.id]) {
      state.imageVariants[image.id] = translationAvailable ? 'translation' : 'original'; changed = true;
    }
    if (changed) persist(id, state);
    const variant = state.imageVariants[image.id];
    return { ok: true, imageId: image.id, image, variant, translationAvailable, translationJob: job,
      path: variant === 'translation' ? translatedPath || null : image.original.saveState === 'saved' ? image.localOriginalPath : null,
      saveError: state.error, translationSaveState: artifact ?
        (artifact.saveState === 'saving' && !(jobState.savingTranslations || []).includes(image.id) ? 'pending' : artifact.saveState || 'pending') : null,
      translationUnsaved: !!unsaved };
  }
  return { open,
    selectVariant(id, imageId, variant) {
      if (!['original', 'translation'].includes(variant)) return { ok: false, error: 'image-variant-invalid' };
      const view = open(id, imageId); if (!view.ok) return view;
      if (variant === 'translation' && !view.translationAvailable) return { ok: false, error: 'translation-unavailable' };
      const state = sessions.get(id); state.imageVariants[imageId] = variant;
      // Keep this session's explicit choice even if persistence fails; a new result must not replace it.
      return persist(id, state);
    },
    retrySave(id) { return sessions.has(id) ? persist(id, sessions.get(id)) : { ok: true }; }
  };
}
module.exports = { createImageView };
