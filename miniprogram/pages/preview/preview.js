const page = require('../../ui/page');
const capturePage = require('../../ui/capture');

Page({
  data: { copy: {}, images: [], scrollTop: 0, draggingId: null, dropIndex: -1, confirmed: false },
  onShow() {
    const state = capturePage.previewState();
    this.actualScrollTop = state.previewPosition;
    this.setData(Object.assign({}, state, { scrollTop: state.previewPosition }));
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
    if (this.data.draggingId) return;
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
    const index = this.data.images.findIndex((image) => image.id === id);
    const bounds = this.rowBounds[index];
    if (!bounds) return;
    this.pendingDrag = { id, startY: event.touches[0].clientY,
      index, center: bounds.top + bounds.height / 2, scrollTop: this.actualScrollTop || 0 };
  },
  moveDrag(event) {
    if (!this.pendingDrag || !event.touches[0]) return;
    this.dragY = event.touches[0].clientY;
    if (!this.data.draggingId) {
      if (Math.abs(this.dragY - this.pendingDrag.startY) <= 8) return;
      this.setData({ draggingId: this.pendingDrag.id, dropIndex: this.pendingDrag.index });
      this.dragTimer = setInterval(() => this.updateDrop(true), 60);
    }
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
    const y = this.pendingDrag.center + this.dragY - this.pendingDrag.startY +
      (this.actualScrollTop || 0) - this.pendingDrag.scrollTop;
    let index = this.pendingDrag.index;
    let distance = Infinity;
    this.rowBounds.forEach((bounds, rowIndex) => {
      const nextDistance = Math.abs(y - bounds.top - bounds.height / 2);
      if (nextDistance < distance) { distance = nextDistance; index = rowIndex; }
    });
    this.setData({ dropIndex: index });
  },
  finishDrag() {
    if (!this.data.draggingId) { this.clearDrag(); return; }
    page.services().capture.moveImage(this.data.draggingId, this.data.dropIndex);
    this.clearDrag();
    this.refresh();
  },
  clearDrag() {
    clearInterval(this.dragTimer);
    this.pendingDrag = null;
    this.setData({ draggingId: null, dropIndex: -1 });
  },
  confirm() {
    if (this.data.draggingId) return;
    const result = page.services().capture.confirm();
    this.refresh();
    if (result.ok) this.getOpenerEventChannel().emit('captureConfirmed', result.batch);
  },
  cancel() {
    page.services().capture.cancel();
    capturePage.leavePreview();
  },
  onHide() { this.clearDrag(); },
  onUnload() {
    clearInterval(this.dragTimer);
    page.services().capture.cancel();
  }
});
