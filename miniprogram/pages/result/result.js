const recordsPage = require('../../ui/records');
const page = require('../../ui/page');

Page({
  data: { record: null, currentImageId: null, copy: {}, recordCopy: {} },
  onLoad(options) { this.recordId = page.routeValue(options.recordId); },
  onShow() {
    if (this.unsubscribeUpload) this.unsubscribeUpload();
    this.unsubscribeUpload = page.services().uploads.subscribe((id) => { if (id === this.recordId) recordsPage.showResult(this, this.recordId); });
    if (this.unsubscribeJobs) this.unsubscribeJobs();
    this.unsubscribeJobs = page.services().jobs.subscribe((id) => { if (id === this.recordId) recordsPage.showResult(this, this.recordId); });
    recordsPage.showResult(this, this.recordId);
    void page.services().jobs.refreshRecord(this.recordId);
  },
  onHide() { if (this.unsubscribeJobs) { this.unsubscribeJobs(); this.unsubscribeJobs = null; } if (this.unsubscribeUpload) { this.unsubscribeUpload(); this.unsubscribeUpload = null; } },
  onUnload() { this.onHide(); },
  retryRead() { recordsPage.showResult(this, this.recordId); },
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
  retryResultSave() { page.services().jobs.retrySave(this.recordId); recordsPage.showResult(this, this.recordId); },
  viewOriginal() {
    if (!this.data.currentImage || this.data.currentImage.original.saveState !== 'saved' || !this.data.currentImage.localOriginalPath) return;
    wx.previewImage({ current: this.data.currentImage.localOriginalPath,
      urls: this.data.record.images.filter((image) => image.original.saveState === 'saved').map((image) => image.localOriginalPath).filter(Boolean) });
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/index/index' });
  }
});
