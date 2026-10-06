const page = require('../../ui/page');
const { getCardsCopy } = require('../../core/cards-copy');

Page({
  data: { cardCopy: {}, card: null },
  onLoad(query) {
    this.library = page.services().cardLibrary;
    this.cardId = page.routeValue(query.id) || '';
  },
  onShow() {
    const state = page.services().application.getState();
    const copy = getCardsCopy(state.language);
    this.library.reload();
    this.library.showCard(this.cardId);
    this.setData({ cardCopy: copy, card: this.library.getState().displayCard });
    wx.setNavigationBarTitle({ title: copy.staffTitle });
  },
  onUnload() { this.library.closeCard(); },
  returnCards() {
    this.library.closeCard();
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/cards/cards' });
  }
});
