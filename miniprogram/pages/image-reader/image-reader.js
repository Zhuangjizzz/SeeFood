const receiptPage = require('../../ui/save-receipts');
const page = require('../../ui/page');
const { getCaptureCopy } = require('../../core/capture-copy');
const { getImagesCopy } = require('../../core/images-copy');
const { getRecordsCopy, recordError } = require('../../core/records-copy');

function distance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}
const TOP = { scale: 1, scrollTop: 0, scrollLeft: 0 };
Page({
  data: { copy: {}, imageCopy: {}, imagePath: null, error: '', imageError: false, index: 0, count: 0, scale: 1, pinching: false },
  onLoad(options) {
    this.recordId = page.routeValue(options.recordId); this.initialImageId = page.routeValue(options.imageId);
    this.source = options.source === 'detail' ? 'detail' : 'result'; this.cardId = page.routeValue(options.cardId);
    this.positions = new Map();
    const result = page.services().records.getRecord(this.recordId);
    this.sourcePosition = result.ok && result.record.browseState && result.record.browseState.resultPosition;
    this.resultSource = page.services().history.getResultSource(this.recordId);
  },
  onShow() {
    this.receiptVisible = true;
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); this.viewportWidth = info.windowWidth;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = page.services().jobs.subscribe((id) => { if (id === this.recordId) this.render(); });
    this.render(this.initialImageId); this.initialImageId = null;
  },
  render(imageId) {
    const services = page.services(); const language = services.application.getState().language;
    const copy = getCaptureCopy(language); const imageCopy = getImagesCopy(language); const recordCopy = getRecordsCopy(language);
    const record = services.records.getRecord(this.recordId); const view = record.ok && services.imageView.open(this.recordId, imageId);
    wx.setNavigationBarTitle({ title: recordCopy.photo });
    if (!view || !view.ok) {
      this.current = null;
      this.setData({ copy, imageCopy, imagePath: null, count: 0, error: recordError(recordCopy, record.error || view.error) }); return;
    }
    const key = `${view.imageId}:${view.variant}`;
    if (!this.positions.has(key)) this.positions.set(key, { ...TOP });
    const position = this.positions.get(key); const changed = !this.current || this.current.key !== key || this.current.path !== view.path;
    this.current = { key, imageId: view.imageId, path: view.path };
    const artifact = view.variant === 'translation' && (view.image.translation || view.translationJob && view.translationJob.output && view.translationJob.output.artifact);
    const rotated = !artifact && /^(left|right)/.test(view.image.orientation || 'up');
    const width = artifact ? artifact.width : view.image.width; const height = artifact ? artifact.height : view.image.height;
    const ratio = rotated ? width / height : height / width;
    const job = view.translationJob;
    const renderedJobs = services.jobs.getState(this.recordId);
    const translationNotice = job && job.state === 'succeeded' && job.output.state === 'not_required' ?
      (job.output.reasonKey === 'images.already_chinese' ? imageCopy.alreadyChinese : job.output.reasonKey === 'images.no_translatable_text' ? imageCopy.noText : imageCopy.notRequired) :
      job ? imageCopy[job.state === 'succeeded' ? 'ready' : job.state] : imageCopy.unstarted;
    this.setData({ copy, imageCopy, error: '', imagePath: view.path, variant: view.variant,
      index: record.record.images.findIndex((image) => image.id === view.imageId), count: record.record.images.length,
      currentImageId: view.imageId, translationAvailable: view.translationAvailable,
      translationNotRequired: !!(job && job.output && job.output.state === 'not_required'), translationNotice,
      choiceSaveError: !!view.saveError, missingImage: view.variant === 'translation' ? imageCopy.missingTranslation : recordCopy.missingOriginal,
      imageError: changed ? false : this.data.imageError, scale: position.scale, zoomPercent: Math.round(position.scale * 100),
      imageWidth: this.viewportWidth * position.scale, imageHeight: this.viewportWidth * position.scale * ratio,
      scrollTop: position.scrollTop, scrollLeft: position.scrollLeft }, () => { if (this.receiptVisible) this.renderedImageReceipt = { path: view.variant === 'translation' ? view.path : null,
        entries: receiptPage.imageEntries(record.record, renderedJobs, view.imageId, { translationOnly: true, imageLoaded: true }) }; });
  },
  scrollImage(event) {
    if (!this.current) return;
    const value = this.positions.get(this.current.key);
    for (const key of ['scrollTop', 'scrollLeft']) if (Number.isFinite(event.detail[key])) value[key] = Math.max(0, event.detail[key]);
  },
  setZoom(scale) {
    if (!this.current || !Number.isFinite(scale)) return;
    const value = this.positions.get(this.current.key); const next = Math.max(1, Math.min(4, scale));
    value.scrollTop *= next / value.scale; value.scrollLeft *= next / value.scale; value.scale = next; this.render();
  },
  zoomIn() { this.setZoom(this.data.scale + 0.5); },
  zoomOut() { this.setZoom(this.data.scale - 0.5); },
  fitWidth() { if (this.current) { this.positions.set(this.current.key, { ...TOP }); this.render(); } },
  startTouch(event) {
    if (event.touches.length !== 2) return;
    this.pinch = { distance: distance(event.touches), scale: this.data.scale }; this.setData({ pinching: true });
  },
  moveTouch(event) {
    if (event.touches.length !== 2) return;
    if (!this.pinch) this.startTouch(event);
    if (this.pinch.distance > 0) this.setZoom(this.pinch.scale * distance(event.touches) / this.pinch.distance);
  },
  finishTouch() { this.pinch = null; this.setData({ pinching: false }); },
  changeImage(event) {
    const record = page.services().records.getRecord(this.recordId); if (!record.ok) { this.render(); return; }
    const direction = Number(event.currentTarget.dataset.direction); if (direction !== -1 && direction !== 1) return;
    const index = record.record.images.findIndex((image) => image.id === this.data.currentImageId) + direction;
    if (record.record.images[index]) { this.finishTouch(); this.render(record.record.images[index].id); }
  },
  selectVariant(event) {
    if (!this.current) return;
    page.services().imageView.selectVariant(this.recordId, this.current.imageId, event.currentTarget.dataset.variant);
    this.finishTouch(); this.render();
  },
  retryChoice() { page.services().imageView.retrySave(this.recordId); this.render(); },
  presentImage(event) {
    const shown = this.renderedImageReceipt;
    if (!this.receiptVisible || !shown?.path || event.currentTarget.dataset.path !== shown.path) return;
    receiptPage.present(page.services(), shown.entries);
  },
  failedImage() { this.setData({ imageError: true }); },
  onResize(event) { if (event.size && event.size.windowWidth) { this.viewportWidth = event.size.windowWidth; this.render(); } },
  preserveSourcePosition() {
    if (this.source !== 'result' || !this.current || !this.sourcePosition || !this.sourcePosition.anchorId || !this.sourcePosition.anchorId.startsWith('image:')) return;
    const result = page.services().records.getRecord(this.recordId); if (!result.ok) return;
    const previousImageId = this.sourcePosition.anchorId.slice(6);
    if (result.record.images.some((image) => image.id === previousImageId)) page.services().history.saveResultPosition(this.recordId,
      { ...this.sourcePosition, anchorId: `image:${this.current.imageId}` });
  },
  close() {
    this.preserveSourcePosition();
    if (getCurrentPages().length > 1) { wx.navigateBack(); return; }
    const result = page.services().records.getRecord(this.recordId);
    if (result.ok) {
      const detailExists = this.source === 'detail' && (result.record.cards || []).some((card) => card.id === this.cardId);
      const destination = detailExists ? `/pages/dish-detail/dish-detail?recordId=${encodeURIComponent(this.recordId)}&cardId=${encodeURIComponent(this.cardId)}` :
        `/pages/result/result?recordId=${encodeURIComponent(this.recordId)}`;
      wx.redirectTo({ url: destination });
    } else if (this.resultSource && this.resultSource.view === 'history') wx.redirectTo({ url: `/pages/history/history?source=${this.resultSource.historySource}` });
    else wx.switchTab({ url: '/pages/index/index' });
  },
  onHide() { this.receiptVisible = false; this.preserveSourcePosition(); if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; } },
  onUnload() { this.onHide(); }
});
