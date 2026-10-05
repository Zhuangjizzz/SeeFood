const recordsPage = require('../../ui/records');
const page = require('../../ui/page');

Page({
  data: { record: null, currentImageId: null, copy: {}, recordCopy: {} },
  onLoad(options) { this.recordId = options.recordId; },
  onShow() {
    if (this.unsubscribeUpload) this.unsubscribeUpload();
    this.unsubscribeUpload = page.services().uploads.subscribe((id) => { if (id === this.recordId) recordsPage.showResult(this, this.recordId); });
    recordsPage.showResult(this, this.recordId);
  },
  onHide() { if (this.unsubscribeUpload) { this.unsubscribeUpload(); this.unsubscribeUpload = null; } },
  onUnload() { this.onHide(); },
  retryRead() { recordsPage.showResult(this, this.recordId); },
  selectImage(event) {
    this.setData({ currentImageId: event.currentTarget.dataset.id });
    recordsPage.showResult(this, this.recordId);
  },
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
