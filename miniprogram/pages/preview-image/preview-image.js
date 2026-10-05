const page = require('../../ui/page');
const capturePage = require('../../ui/capture');

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

Page({
  data: { copy: {}, image: null, index: 0, count: 0, scale: 1, pinching: false, imageError: false },
  onShow() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.viewportWidth = info.windowWidth;
    this.renderOriginal();
  },
  renderOriginal() {
    const state = capturePage.previewState();
    const index = state.original ? state.images.findIndex((image) => image.id === state.original.imageId) : -1;
    if (index < 0) { capturePage.leavePreview(); return; }
    const image = state.images[index];
    const scale = state.original.scale;
    const rotated = /^(left|right)/.test(image.orientation || 'up');
    const ratio = rotated ? image.width / image.height : image.height / image.width;
    this.setData({ copy: state.copy, image, index, count: state.images.length, scale,
      zoomPercent: Math.round(scale * 100), imageWidth: this.viewportWidth * scale,
      imageHeight: this.viewportWidth * scale * ratio,
      scrollTop: state.original.scrollTop, scrollLeft: state.original.scrollLeft });
    wx.setNavigationBarTitle({ title: state.copy.original });
  },
  scrollImage(event) {
    page.services().capture.setOriginalView({ scrollTop: event.detail.scrollTop, scrollLeft: event.detail.scrollLeft });
  },
  setZoom(scale) {
    const view = page.services().capture.getState().original;
    if (!view) return;
    const next = Math.max(1, Math.min(4, scale));
    page.services().capture.setOriginalView({ scale: next,
      scrollTop: view.scrollTop * next / view.scale, scrollLeft: view.scrollLeft * next / view.scale });
    this.renderOriginal();
  },
  zoomIn() { this.setZoom(this.data.scale + 0.5); },
  zoomOut() { this.setZoom(this.data.scale - 0.5); },
  fitWidth() {
    page.services().capture.setOriginalView({ scale: 1, scrollTop: 0, scrollLeft: 0 });
    this.renderOriginal();
  },
  startTouch(event) {
    if (event.touches.length !== 2) return;
    this.pinch = { distance: touchDistance(event.touches), scale: this.data.scale };
    this.setData({ pinching: true });
  },
  moveTouch(event) {
    if (event.touches.length !== 2) return;
    if (!this.pinch) this.startTouch(event);
    if (this.pinch.distance > 0) this.setZoom(this.pinch.scale * touchDistance(event.touches) / this.pinch.distance);
  },
  finishTouch() { this.pinch = null; this.setData({ pinching: false }); },
  changeImage(event) {
    const images = page.services().capture.getState().images;
    const index = this.data.index + Number(event.currentTarget.dataset.direction);
    if (!images[index]) return;
    page.services().capture.openOriginal(images[index].id);
    this.setData({ imageError: false });
    this.renderOriginal();
  },
  failedImage() { this.setData({ imageError: true }); },
  close() { capturePage.leavePreview(); },
  onUnload() { page.services().capture.closeOriginal(); }
});
