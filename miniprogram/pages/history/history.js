const page = require('../../ui/page');
const recordsPage = require('../../ui/records');
const reading = require('../../ui/history-reading');
Page({
  data: { entries: [], copy: {}, historyCopy: {}, historyReadable: true },
  onLoad(options = {}) { this.source = options.source === 'mine' ? 'mine' : 'home'; },
  onShow() {
    if (!page.showPage(this, 'history')) return;
    if (this.unsubscribeNetwork) this.unsubscribeNetwork();
    this.unsubscribeNetwork = page.services().network.subscribe(() => recordsPage.showHistory(this));
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = page.services().history.subscribe(() => recordsPage.showHistory(this));
    recordsPage.showHistory(this); reading.restore(this, 'history');
  },
  onPageScroll(event) { reading.capture(this, event); },
  onHide() { if (this.unsubscribeNetwork) { this.unsubscribeNetwork(); this.unsubscribeNetwork = null; } reading.save(this, 'history'); if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; } },
  onUnload() { this.onHide(); },
  retryHistory() { recordsPage.showHistory(this); },
  openRecord(event) {
    reading.save(this, 'history');
    recordsPage.openResult(event.currentTarget.dataset.id, false, { view: 'history', historySource: this.source });
  },
  takePhoto() { wx.switchTab({ url: '/pages/index/index' }); },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: this.source === 'mine' ? '/pages/mine/mine' : '/pages/index/index' });
  }
});
