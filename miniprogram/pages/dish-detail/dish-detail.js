const dietaryPage = require('../../ui/dietary');
const page = require('../../ui/page');
const { getDishesCopy, presentDish } = require('../../core/dishes-copy');
const { getChatCopy } = require('../../core/chat-copy');
const { readCards } = require('../../ui/dish-results');
Page({
  data: { card: null, dishCopy: {}, error: '', sourceImages: [] },
  onLoad(options) { this.recordId = page.routeValue(options.recordId); this.cardId = page.routeValue(options.cardId); this.detailScrollTop = 0; },
  onShow() {
    if (this.unsubscribeChat) this.unsubscribeChat();
    this.unsubscribeChat = page.services().chat.subscribe((id) => { if (id === this.recordId) this.showDetail(); });
    if (this.unsubscribeNetwork) this.unsubscribeNetwork();
    this.unsubscribeNetwork = page.services().network.subscribe(() => this.showDetail());
    if (this.unsubscribeDietary) this.unsubscribeDietary();
    this.unsubscribeDietary = page.services().dietaryReview.subscribe((id) => { if (id === this.recordId) this.showDetail(); });
    this.showDetail(true); void dietaryPage.refresh(this.recordId);
  },
  onHide() {
    for (const key of ['unsubscribeDietary', 'unsubscribeChat', 'unsubscribeNetwork']) if (this[key]) { this[key](); this[key] = null; }
  },
  onUnload() { this.onHide(); },
  onPageScroll(event) { this.detailScrollTop = Math.max(0, Number(event.scrollTop) || 0); },
  showDetail(restore = false) {
    const services = page.services(); const dishCopy = getDishesCopy(services.application.getState().language);
    const result = services.records.getRecord(this.recordId);
    const card = result.ok && readCards(result.record, services.jobs.getState(this.recordId)).find((item) => item.id === this.cardId);
    wx.setNavigationBarTitle({ title: dishCopy.title });
    this.setData({ dietary: dietaryPage.getDietary(this.recordId, this.cardId), dishCopy, card: card ? presentDish(card, dishCopy) : null, error: card ? '' : dishCopy.missing,
      askStaffLabel: getChatCopy(services.application.getState().language).askStaff,
      canAskStaff: !!card && (result.record.cards || []).some(value => value.id === this.cardId) && !services.chat.getState(this.recordId).running && services.network.getState().online,
      sourceImages: card ? result.record.images.filter((image) => card.sourceImageIds.includes(image.id) && image.original.saveState === 'saved') : [] }, () => {
      if (restore && card && this.detailScrollTop > 0 && wx.pageScrollTo) wx.pageScrollTo({ scrollTop: this.detailScrollTop, duration: 0 });
    });
  },
  askStaff() {
    if (!this.data.canAskStaff) return Promise.resolve({ ok: false, error: 'JOB_STATE_CONFLICT' });
    const work = page.services().chat.askAboutDish(this.recordId, this.cardId);
    wx.navigateTo({ url: `/pages/chat/chat?recordId=${encodeURIComponent(this.recordId)}&source=detail&cardId=${encodeURIComponent(this.cardId)}` });
    return work;
  },
  checkDietary() { return dietaryPage.act(this.recordId, 'startRecord'); },
  retryDietary() { return dietaryPage.act(this.recordId, 'retry'); },
  continueDietary() { return dietaryPage.act(this.recordId, 'continueSubmission'); },
  retryDietarySave() { return dietaryPage.act(this.recordId, 'retrySave'); },
  viewOriginal() {
    if (!this.data.sourceImages.length) return;
    const services = page.services(); const current = services.imageView.open(this.recordId);
    if (!current.ok) { this.onShow(); return; }
    const source = this.data.sourceImages.find((image) => image.id === current.imageId) || this.data.sourceImages[0];
    services.imageView.selectVariant(this.recordId, source.id, 'original');
    wx.navigateTo({ url: `/pages/image-reader/image-reader?recordId=${encodeURIComponent(this.recordId)}&imageId=${encodeURIComponent(source.id)}&source=detail&cardId=${encodeURIComponent(this.cardId)}` });
  },
  back() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.redirectTo({ url: `/pages/result/result?recordId=${encodeURIComponent(this.recordId)}` }); }
});
