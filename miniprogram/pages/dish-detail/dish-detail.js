const page = require('../../ui/page');
const { getDishesCopy, presentDish } = require('../../core/dishes-copy');
Page({
  data: { card: null, dishCopy: {}, error: '', sourceImages: [] },
  onLoad(options) { this.recordId = page.routeValue(options.recordId); this.cardId = page.routeValue(options.cardId); },
  onShow() {
    const services = page.services(); const dishCopy = getDishesCopy(services.application.getState().language);
    const result = services.records.getRecord(this.recordId);
    const unsaved = services.jobs.getState(this.recordId).unsavedJob;
    const card = result.ok && ((result.record.cards || []).find((item) => item.id === this.cardId) ||
      (unsaved && unsaved.state === 'succeeded' && unsaved.output.cards.find((item) => item.id === this.cardId)));
    wx.setNavigationBarTitle({ title: dishCopy.title });
    this.setData({ dishCopy, card: card ? presentDish(card, dishCopy) : null, error: card ? '' : dishCopy.missing,
      sourceImages: card ? result.record.images.filter((image) => card.sourceImageIds.includes(image.id) && image.original.saveState === 'saved') : [] });
  },
  viewOriginal() {
    if (!this.data.sourceImages.length) return;
    const paths = this.data.sourceImages.map((image) => image.localOriginalPath);
    wx.previewImage({ current: paths[0], urls: paths });
  },
  back() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.redirectTo({ url: `/pages/result/result?recordId=${encodeURIComponent(this.recordId)}` }); }
});
