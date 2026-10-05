const reading = require('../../ui/history-reading');
const recordsPage = require('../../ui/records');
const page = require('../../ui/page');
const capturePage = require('../../ui/capture');
const { recordError } = require('../../core/records-copy');

Page({
  data: { record: null, currentImageId: null, copy: {}, recordCopy: {} },
  onLoad(options) { this.recordId = page.routeValue(options.recordId); this.source = page.services().history.getResultSource(this.recordId); },
  onShow() {
    if (this.unsubscribeNetwork) this.unsubscribeNetwork();
    this.unsubscribeNetwork = page.services().network.subscribe(() => recordsPage.showResult(this, this.recordId));
    if (this.unsubscribeChat) this.unsubscribeChat();
    this.unsubscribeChat = page.services().chat.subscribe((id) => { if (id === this.recordId) recordsPage.showResult(this, this.recordId); });
    if (this.unsubscribeUpload) this.unsubscribeUpload();
    this.unsubscribeUpload = page.services().uploads.subscribe((id) => { if (id === this.recordId) recordsPage.showResult(this, this.recordId); });
    if (this.unsubscribeJobs) this.unsubscribeJobs();
    this.unsubscribeJobs = page.services().jobs.subscribe((id) => { if (id === this.recordId) recordsPage.showResult(this, this.recordId); });
    recordsPage.showResult(this, this.recordId);
    capturePage.showCapture(this);
    if (this.appendReturnPosition) {
      wx.pageScrollTo({ scrollTop: this.appendReturnPosition.scrollTop, duration: 0 });
      this.appendReturnPosition = null;
    } else reading.restore(this, 'result', this.recordId);

    void page.services().jobs.refreshRecord(this.recordId);
  },
  onPageScroll(event) { this.scrollTop = event.scrollTop; reading.capture(this, event); },
  onHide() { if (this.unsubscribeChat) { this.unsubscribeChat(); this.unsubscribeChat = null; } if (this.unsubscribeNetwork) { this.unsubscribeNetwork(); this.unsubscribeNetwork = null; } reading.save(this, 'result', this.recordId); if (this.unsubscribeJobs) { this.unsubscribeJobs(); this.unsubscribeJobs = null; } if (this.unsubscribeUpload) { this.unsubscribeUpload(); this.unsubscribeUpload = null; } },
  onUnload() { this.onHide(); },
  addPhotos() {
    if (!this.data.record) return;
    this.appendSourcePosition = { scrollTop: this.scrollTop || 0 };
    this.setData({ showAppendInput: true, appendError: '' });
    capturePage.showCapture(this);
  },
  chooseMode(event) {
    page.services().capture.chooseMode(event.currentTarget.dataset.mode);
    capturePage.showCapture(this);
  },
  closeAppendInput() { this.setData({ showAppendInput: false, appendError: '', inputError: '' }); },
  takePhoto() { return this.chooseAppendPhoto('camera'); },
  importPhoto() { return this.chooseAppendPhoto('album'); },
  async chooseAppendPhoto(source) {
    const value = page.services().records.getRecord(this.recordId);
    if (!value.ok || value.record.deletedAt || value.record.saveState !== 'saved') {
      this.setData({ appendError: recordError(this.data.recordCopy, 'append-target-unavailable') });
      return { ok: false, error: 'append-target-unavailable' };
    }
    recordsPage.showResult(this, this.recordId);
    const result = await capturePage.chooseImages(this, source, { kind: 'append', recordId: this.recordId, title: this.data.title });
    if (result.ok) {
      this.appendReturnPosition = this.appendSourcePosition;
      this.setData({ showAppendInput: false });
    }
    return result;
  },
  handleCaptureConfirmed(batch) {
    if (!batch.target || batch.target.kind !== 'append' || batch.target.recordId !== this.recordId) return Promise.resolve({ ok: false, error: 'capture-conflict' });
    return page.services().records.confirmCapture(batch);
  },
  retryRead() { recordsPage.showResult(this, this.recordId); },
  retryProgress() { return page.services().jobs.refreshRecord(this.recordId); },
  retryUpload() {
    if (this.retryingUpload) return this.retryingUpload;
    const services = page.services();
    if (!services.uploads.getState(this.recordId).canRetry) return Promise.resolve({ ok: false, error: 'upload-unavailable' });
    const stored = services.records.getRecord(this.recordId);
    const unfinished = stored.ok ? stored.record.images.filter((image) => image.uploadState !== 'uploaded') : [];
    const imageId = unfinished.length === 1 ? unfinished[0].id : undefined;
    this.retryingUpload = services.uploads.uploadRecord(this.recordId, imageId).then((result) => {
      if (result.ok && services.jobs) return services.jobs.startImageProcessing(this.recordId, imageId);
      return result;
    }).finally(() => { this.retryingUpload = null; recordsPage.showResult(this, this.recordId); });
    return this.retryingUpload;
  },
  selectImage(event) {
    this.setData({ currentImageId: event.currentTarget.dataset.id });
    recordsPage.showResult(this, this.recordId);
  },
  selectVariant(event) {
    page.services().imageView.selectVariant(this.recordId, this.data.currentImageId, event.currentTarget.dataset.variant);
    recordsPage.showResult(this, this.recordId);
  },
  async retryTranslationSave() {
    const result = page.services().jobs.retrySave(this.recordId);
    if (result.ok) await page.services().jobs.saveTranslation(this.recordId, this.data.currentImageId);
    recordsPage.showResult(this, this.recordId);
  },
  retryImageChoice() { page.services().imageView.retrySave(this.recordId); recordsPage.showResult(this, this.recordId); },
  viewImage() {
    const view = page.services().imageView.open(this.recordId, this.data.currentImageId);
    if (view.ok && view.path) wx.previewImage({ current: view.path, urls: [view.path] });
  },
  openDish(event) {
    const cardId = event.currentTarget.dataset.id;
    if (!this.data.dishCards.some((card) => card.id === cardId)) return;
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?recordId=${encodeURIComponent(this.recordId)}&cardId=${encodeURIComponent(cardId)}` });
  },
  openChat() {
    if (!this.data.record) return;
    wx.navigateTo({ url: `/pages/chat/chat?recordId=${encodeURIComponent(this.recordId)}` });
  },
  retryResultSave() { page.services().jobs.retrySave(this.recordId); recordsPage.showResult(this, this.recordId); },
  viewOriginal() {
    if (!this.data.currentImage || this.data.currentImage.original.saveState !== 'saved' || !this.data.currentImage.localOriginalPath) return;
    wx.previewImage({ current: this.data.currentImage.localOriginalPath,
      urls: this.data.record.images.filter((image) => image.original.saveState === 'saved').map((image) => image.localOriginalPath).filter(Boolean) });
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else if (this.source && this.source.view === 'history') wx.redirectTo({ url: `/pages/history/history?source=${this.source.historySource}` });
    else wx.switchTab({ url: '/pages/index/index' });
  }
});
