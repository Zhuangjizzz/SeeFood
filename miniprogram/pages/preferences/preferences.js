const page = require('../../ui/page');

Page({
  data: { copy: {}, preferences: { groups: [], copy: {}, readable: true } },
  onLoad() {
    if (page.services().application.getState().page !== 'preferences') {
      page.services().application.openPreferences();
    }
  },
  onShow() { page.showPage(this, 'preferences'); },
  toggleOption(event) {
    const { category, value } = event.currentTarget.dataset;
    page.services().preferences.toggleOption(category, value);
    page.showPage(this, 'preferences');
  },
  updateNotes(event) {
    page.services().preferences.updateNotes(event.currentTarget.dataset.category, event.detail.value);
  },
  savePreferences() {
    const result = page.services().preferences.save();
    page.showPage(this, 'preferences');
    if (result.ok) {
      wx.showToast({ title: this.data.preferences.copy.saved, icon: 'none' });
      page.finishPreferences();
    }
  },
  retryRead() {
    page.services().preferences.retryRead();
    page.showPage(this, 'preferences');
  },
  skipPreferences() {
    const result = page.services().application.skipPreferenceInvite();
    page.showPage(this, 'preferences');
    if (result.ok) page.finishPreferences();
  },
  onUnload() { page.services().application.closePreferences(); }
});
