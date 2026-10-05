const page = require('../../ui/page');

Page({
  data: { copy: {} },
  onShow() { page.showPage(this, 'mine'); },
  openLanguage: page.openLanguage,
  openPreferences: page.unavailable,
  openHistory: page.unavailable
});
