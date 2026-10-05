const page = require('../../ui/page');

Page({
  data: { copy: {}, languages: [] },
  onShow() { page.showPage(this, 'language'); },
  selectLanguage(event) {
    const result = page.services().application.chooseLanguage(event.currentTarget.dataset.code);
    page.showPage(this, 'language');
    if (result.ok) page.finishLanguage();
  },
  onUnload() { page.services().application.closeLanguage(); }
});
