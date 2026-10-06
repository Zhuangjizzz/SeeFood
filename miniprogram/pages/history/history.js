const saveRecovery = require('../../ui/save-recovery');
const page = require('../../ui/page');
const recordsPage = require('../../ui/records');
const reading = require('../../ui/history-reading');
const deletionPage = require('../../ui/deletions');
Page({
  data: { entries: [], copy: {}, historyCopy: {}, historyReadable: true, cleanupEntries: [], showCleanup: false },
  onLoad(options = {}) { this.source = options.source === 'mine' ? 'mine' : 'home'; this.saveRecovery = options.saveRecovery === '1'; },
  onShow() {
    if (!page.showPage(this, 'history')) return;
    this.setData({ saveRecovery: this.saveRecovery, saveRecoveryCopy: saveRecovery.copy() });
    if (this.unsubscribeNetwork) this.unsubscribeNetwork();
    this.unsubscribeNetwork = page.services().network.subscribe(() => recordsPage.showHistory(this));
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = page.services().history.subscribe(() => recordsPage.showHistory(this));
    deletionPage.showDeletionState(this);
    if (this.unsubscribeDeletion) this.unsubscribeDeletion();
    this.unsubscribeDeletion = page.services().deletions.subscribe(() => deletionPage.showDeletionState(this));
    recordsPage.showHistory(this); reading.restore(this, 'history');
  },
  onPageScroll(event) { reading.capture(this, event); },
  onHide() { if (this.unsubscribeDeletion) { this.unsubscribeDeletion(); this.unsubscribeDeletion = null; } if (this.unsubscribeNetwork) { this.unsubscribeNetwork(); this.unsubscribeNetwork = null; } reading.save(this, 'history'); if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; } },
  onUnload() { this.onHide(); },
  retryHistory() { recordsPage.showHistory(this); deletionPage.showDeletionState(this); },
  recordMenu(event) { return deletionPage.remove(this, event.currentTarget.dataset.id); },
  manageHistory() { return deletionPage.manage(this); },
  async retryCleanup() { await page.services().deletions.retry(); deletionPage.showDeletionState(this); },
  hideCleanup() { this.setData({ showCleanup: false }); },
  openRecord(event) {
    if (!page.services().records.getRecord(event.currentTarget.dataset.id).ok) {
      this.setData({ deletionError: this.data.deletionCopy.unavailable }); recordsPage.showHistory(this); return;
    }
    reading.save(this, 'history');
    recordsPage.openResult(event.currentTarget.dataset.id, false, { view: 'history', historySource: this.source });
  },
  takePhoto() { wx.switchTab({ url: '/pages/index/index' }); },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: this.source === 'mine' ? '/pages/mine/mine' : '/pages/index/index' });
  }
});
