const page = require('../../ui/page');

Page({
  data: { inputMode: 'menu', copy: {}, showPreferenceInvite: false },
  onShow() { page.showPage(this, 'capture'); },
  openLanguage: page.openLanguage,
  chooseMode(event) { this.setData({ inputMode: event.currentTarget.dataset.mode }); },
  skipPreferenceInvite() {
    page.services().application.skipPreferenceInvite();
    page.showPage(this, 'capture');
  },
  openPreferences: page.unavailable,
  takePhoto: page.unavailable,
  importPhoto: page.unavailable,
  openHistory: page.unavailable
});
