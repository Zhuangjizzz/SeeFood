const page = require('../../ui/page');
const capturePage = require('../../ui/capture');

Page({
  data: { inputMode: 'menu', copy: {}, showPreferenceInvite: false },
  onShow() { if (page.showPage(this, 'capture')) capturePage.showCapture(this); },
  openLanguage: page.openLanguage,
  chooseMode(event) {
    page.services().capture.chooseMode(event.currentTarget.dataset.mode);
    capturePage.showCapture(this);
  },
  skipPreferenceInvite() {
    page.services().application.skipPreferenceInvite();
    page.showPage(this, 'capture');
  },
  openPreferences: page.unavailable,
  takePhoto() { return capturePage.chooseImages(this, 'camera'); },
  importPhoto() { return capturePage.chooseImages(this, 'album'); },
  openHistory: page.unavailable
});
