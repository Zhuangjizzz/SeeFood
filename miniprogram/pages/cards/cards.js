const page = require('../../ui/page');

Page({
  data: { copy: {} },
  onShow() { page.showPage(this, 'cards'); },
  openLanguage: page.openLanguage
});
