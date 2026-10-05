const page = require('../../ui/page');
const capturePage = require('../../ui/capture');
const recordsPage = require('../../ui/records');
const { getRecordsCopy, recordError } = require('../../core/records-copy');

Page({
  data: { copy: {}, images: [], scrollTop: 0, draggingId: null, dropIndex: -1, confirmed: false, saveState: 'pending', saveError: '', recordCopy: {} },
  onShow() {
    const state = capturePage.previewState();
    this.actualScrollTop = state.previewPosition;
    this.setData(Object.assign({}, state, { scrollTop: state.previewPosition,
      recordCopy: getRecordsCopy(page.services().application.getState().language) }));
    wx.setNavigationBarTitle({ title: state.copy.preview });
    this.measureRows();
  },
  onReady() { this.measureRows(); },
  measureRows() {
    wx.nextTick(() => {
      this.createSelectorQuery().selectAll('.preview-row').boundingClientRect((rows) => {
        this.rowBounds = rows.map((bounds) => Object.assign({}, bounds, { top: bounds.top + (this.actualScrollTop || 0) }));
      })
        .select('.preview-list').boundingClientRect((bounds) => { this.listBounds = bounds; }).exec();
    });
  },
  refresh() {
    this.setData(capturePage.previewState());
    this.measureRows();
  },
  onListScroll(event) {
    this.actualScrollTop = event.detail.scrollTop;
    page.services().capture.setPreviewPosition(this.actualScrollTop);
  },
  viewOriginal(event) {
    if (this.data.draggingId || this.data.saveState === 'saving') return;
    page.services().capture.openOriginal(event.currentTarget.dataset.id);
    wx.navigateTo({ url: '/pages/preview-image/preview-image' });
  },
  removeImage(event) {
    if (this.data.draggingId) return;
    page.services().capture.removeImage(event.currentTarget.dataset.id);
    this.refresh();
  },
  moveOne(event) {
    const { id, direction } = event.currentTarget.dataset;
    const index = this.data.images.findIndex((image) => image.id === id);
    page.services().capture.moveImage(id, index + Number(direction));
    this.refresh();
  },
  startDrag(event) {
    if (this.data.confirmed || !event.touches[0] || !this.rowBounds || !this.rowBounds.length) return;
    const id = event.currentTarget.dataset.id;
    this.dragY = event.touches[0].clientY;
    this.setData({ draggingId: id, dropIndex: this.data.images.findIndex((image) => image.id === id) });
    this.dragTimer = setInterval(() => this.updateDrop(true), 60);
  },
  moveDrag(event) {
    if (!this.data.draggingId || !event.touches[0]) return;
    this.dragY = event.touches[0].clientY;
    this.updateDrop(false);
  },
  updateDrop(autoScroll) {
    if (!this.data.draggingId) return;
    if (autoScroll && this.listBounds) {
      let offset = 0;
      if (this.dragY < this.listBounds.top + 45) offset = -22;
      else if (this.dragY > this.listBounds.bottom - 45) offset = 22;
      if (offset) this.setData({ scrollTop: Math.max(0, (this.actualScrollTop || 0) + offset) });
    }
    const y = this.dragY + (this.actualScrollTop || 0);
    let index = this.rowBounds.findIndex((bounds) => y < bounds.top + bounds.height / 2);
    if (index < 0) index = this.rowBounds.length - 1;
    this.setData({ dropIndex: index });
  },
  finishDrag() {
    if (!this.data.draggingId) return;
    page.services().capture.moveImage(this.data.draggingId, this.data.dropIndex);
    this.clearDrag();
    this.refresh();
  },
  clearDrag() {
    clearInterval(this.dragTimer);
    this.setData({ draggingId: null, dropIndex: -1 });
  },
  confirm() {
    if (this.data.draggingId) return;
    const result = page.services().capture.confirm();
    this.refresh();
    if (!result.ok) return Promise.resolve(result);
    this.confirmedBatchId = result.batch.id;
    this.setData({ saveState: 'saving', saveError: '' });
    return new Promise((resolve) => {
      this.getOpenerEventChannel().emit('captureConfirmed', result.batch, (outcome) => {
        this.finishSave(outcome);
        resolve(outcome);
      });
    });
  },
  finishSave(result) {
    if (this.unloaded) return;
    const submission = page.services().records.getSubmission(this.confirmedBatchId);
    this.setData({ saveState: result.ok ? 'saved' : 'failed',
      saveError: recordError(this.data.recordCopy, result.error || (submission && submission.error)) });
    if (result.ok) recordsPage.openResult(result.recordId, true);
  },
  async retrySave() {
    if (this.data.saveState === 'saving') return;
    this.setData({ saveState: 'saving', saveError: '' });
    const result = await page.services().records.retrySave(this.confirmedBatchId);
    this.finishSave(result);
    return result;
  },
  cancel() {
    if (this.data.saveState === 'saving') return;
    page.services().capture.cancel();
    capturePage.leavePreview();
  },
  onHide() { this.clearDrag(); },
  onUnload() {
    this.unloaded = true;
    clearInterval(this.dragTimer);
    page.services().capture.cancel();
  }
});
