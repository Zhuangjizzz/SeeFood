const recordsPage = require('../../ui/records');
const { getHistoryCopy } = require('../../core/history-copy');
const page = require('../../ui/page');

Page({
  data: { copy: {} },
  onShow() { page.showPage(this, 'mine'); this.setData({ historyCopy: getHistoryCopy(page.services().application.getState().language) }); },
  openLanguage: page.openLanguage,
  openPreferences: page.openPreferences,
  openHistory() { recordsPage.openHistory('mine'); }
});
