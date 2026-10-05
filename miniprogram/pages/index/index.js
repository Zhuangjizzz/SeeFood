const page = require('../../ui/page');
const capturePage = require('../../ui/capture');
const reading = require('../../ui/history-reading');
const recordsPage = require('../../ui/records');

Page({
  data: { inputMode: 'menu', copy: {}, showPreferenceInvite: false },
  onShow() {
    if (page.showPage(this, 'capture')) {
      if (this.unsubscribeNetwork) this.unsubscribeNetwork();
      this.unsubscribeNetwork = page.services().network.subscribe(() => recordsPage.showRecent(this));
      if (this.unsubscribeHistory) this.unsubscribeHistory();
      this.unsubscribeHistory = page.services().history.subscribe(() => recordsPage.showRecent(this));
      capturePage.showCapture(this);
      recordsPage.showRecent(this);
      reading.restore(this, 'home');
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
  takePhoto() { return capturePage.chooseImages(this, 'camera', { kind: 'new' }); },
  importPhoto() { return capturePage.chooseImages(this, 'album', { kind: 'new' }); },
  handleCaptureConfirmed(batch) {
    if (!batch.target || batch.target.kind !== 'new') return Promise.resolve({ ok: false, error: 'capture-conflict' });
    return page.services().records.confirmCapture(batch);
  },
  onPageScroll(event) { reading.capture(this, event); },
  onHide() { if (this.unsubscribeNetwork) { this.unsubscribeNetwork(); this.unsubscribeNetwork = null; } if (this.unsubscribeHistory) { this.unsubscribeHistory(); this.unsubscribeHistory = null; } reading.save(this, 'home'); },
  onUnload() { this.onHide(); },
  openRecord(event) { reading.save(this, 'home'); recordsPage.openResult(event.currentTarget.dataset.id); },
  retryHistory() { recordsPage.showRecent(this); },
  openHistory() { reading.save(this, 'home'); recordsPage.openHistory('home'); }
});
