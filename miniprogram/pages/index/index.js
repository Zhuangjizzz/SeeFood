const page = require('../../ui/page');
const capturePage = require('../../ui/capture');
const recordsPage = require('../../ui/records');

Page({
  data: { inputMode: 'menu', copy: {}, showPreferenceInvite: false },
  onShow() {
    if (page.showPage(this, 'capture')) {
      capturePage.showCapture(this);
      recordsPage.showRecent(this);
    }
  },
  openLanguage: page.openLanguage,
  chooseMode(event) {
    page.services().capture.chooseMode(event.currentTarget.dataset.mode);
    capturePage.showCapture(this);
  },
  skipPreferenceInvite() {
    page.services().application.skipPreferenceInvite();
    page.showPage(this, 'capture');
  },
  openPreferences: page.openPreferences,
  takePhoto() { return capturePage.chooseImages(this, 'camera'); },
  importPhoto() { return capturePage.chooseImages(this, 'album'); },
  handleCaptureConfirmed(batch) { return page.services().records.confirmCapture(batch); },
  openRecord(event) { recordsPage.openResult(event.currentTarget.dataset.id); },
  retryHistory() { recordsPage.showRecent(this); },
  openHistory: page.unavailable
});
