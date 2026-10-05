const { makeId } = require('./identity');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
const INPUT_LIMITS = { scope: 'local-integration', maxImages: 9, maxImageBytes: 20 * 1024 * 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] };

function createCapture({ media, getLanguage = () => 'en' }) {
  let inputMode = 'menu';
  let batch = null;
  let confirmed = false;
  let error = null;
  let previewPosition = 0;
  let original = null;
  let choosing = false;
  let selectionVersion = 0;
  return {
    getState() {
      return { inputMode, images: batch ? clone(batch.images) : [], target: batch ? clone(batch.target) : null,
        canConfirm: !!(batch && batch.images.length && !confirmed), confirmed, error, limits: clone(INPUT_LIMITS),
        previewPosition, original: original ? clone(original) : null, choosing };
    },
    chooseMode(mode) { if (mode === 'menu' || mode === 'dish') inputMode = mode; },
    async chooseImages({ source, target = { kind: 'new' } }) {
      if (choosing) return { ok: false, error: 'picker-busy' };
      choosing = true;
      const version = ++selectionVersion;
      const mode = inputMode;
      error = null;
      let selected;
      try { selected = await media.chooseImages({ source, count: source === 'camera' ? 1 : INPUT_LIMITS.maxImages }); }
      catch (failure) {
        if (version !== selectionVersion) return { ok: false, cancelled: true };
        if (failure.code === 'cancelled') return { ok: false, cancelled: true };
        error = failure.code || (source === 'camera' ? 'camera-unavailable' : 'album-unavailable');
        return { ok: false, error };
      } finally {
        if (version === selectionVersion) choosing = false;
      }
      if (version !== selectionVersion) return { ok: false, cancelled: true };
      if (!selected.length) return { ok: false, cancelled: true };
      if (selected.length > INPUT_LIMITS.maxImages) error = 'too-many-images';
      for (const image of selected) {
        if (error) break;
        if (!image.localPath || !Number.isFinite(image.sizeBytes) || image.sizeBytes <= 0 ||
            !Number.isFinite(image.width) || image.width <= 0 || !Number.isFinite(image.height) || image.height <= 0) error = 'image-unreadable';
        else if (!INPUT_LIMITS.mimeTypes.includes(image.mimeType)) error = 'unsupported-image';
        else if (image.sizeBytes > INPUT_LIMITS.maxImageBytes) error = 'image-too-large';
      }
      if (error) return { ok: false, error };
      const id = makeId('batch');
      batch = { id, target: clone(target), targetLanguage: getLanguage(),
        images: selected.map((image, index) => Object.assign({}, image, { id: `${id}-${index}`, kind: mode, order: index })) };
      confirmed = false;
      previewPosition = 0;
      original = null;
      return { ok: true };
    },
    removeImage(id) {
      if (!batch || confirmed) return;
      batch.images = batch.images.filter((image) => image.id !== id);
      batch.images.forEach((image, index) => { image.order = index; });
    },
    moveImage(id, to) {
      if (!batch || confirmed) return;
      const from = batch.images.findIndex((image) => image.id === id);
      if (from < 0 || !Number.isInteger(to) || to < 0 || to >= batch.images.length) return;
      batch.images.splice(to, 0, batch.images.splice(from, 1)[0]);
      batch.images.forEach((image, index) => { image.order = index; });
    },
    confirm() {
      if (confirmed) return { ok: false, error: 'batch-confirmed' };
      if (!batch || !batch.images.length) return { ok: false, error: 'empty-batch' };
      confirmed = true;
      return { ok: true, batch: clone(batch) };
    },
    cancel() {
      const target = batch ? clone(batch.target) : null;
      batch = null;
      confirmed = false;
      selectionVersion += 1;
      choosing = false;
      original = null;
      previewPosition = 0;
      return { ok: true, target };
    },
    setPreviewPosition(position) { if (Number.isFinite(position)) previewPosition = Math.max(0, position); },
    openOriginal(imageId) {
      if (!batch || !batch.images.some((image) => image.id === imageId)) return;
      original = { imageId, scale: 1, scrollTop: 0, scrollLeft: 0 };
    },
    closeOriginal() { original = null; },
    setOriginalView(view) {
      if (!original) return;
      ['scale', 'scrollTop', 'scrollLeft'].forEach((key) => {
        if (!Number.isFinite(view[key])) return;
        original[key] = key === 'scale' ? Math.max(1, Math.min(4, view[key])) : Math.max(0, view[key]);
      });
    }
  };
}

module.exports = { createCapture, INPUT_LIMITS };
