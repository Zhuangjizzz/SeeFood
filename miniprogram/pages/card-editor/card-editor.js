const page = require('../../ui/page');
const { LANGUAGES } = require('../../core/i18n');
const { CATEGORIES, COLORS } = require('../../core/card-repository');
const { getCardEditorCopy } = require('../../core/card-editor-copy');

Page({
  data: { editorCopy: {}, draft: null, categories: [], colors: [], canSave: false },
  onLoad(options = {}) {
    this.drafts = page.services().cardDrafts;
    this.entryCategory = page.routeValue(options.category) || 'all';
    this.drafts.beginNew({ category: this.entryCategory });
  },
  onShow() {
    if (!this.unsubscribe) this.unsubscribe = this.drafts.subscribe(() => this.renderDraft());
    this.renderDraft(); this.drafts.refresh();
  },
  onHide() { if (this.unsubscribe) this.unsubscribe(); this.unsubscribe = null; },
  onUnload() { this.onHide(); },
  renderDraft() {
    const state = this.drafts.getState();
    const copy = getCardEditorCopy(page.services().application.getState().language);
    const draft = state.draft;
    const jobState = draft?.job?.state;
    const translating = !!draft?.operation && !draft.error && (!draft.job || ['queued', 'running'].includes(jobState));
    const error = draft?.error;
    this.setData({ ...state, editorCopy: copy, isChinese: draft?.sourceLanguage === 'zh-CN',
      sourceLanguageName: LANGUAGES.find((item) => item.code === draft?.sourceLanguage)?.name || '',
      categories: CATEGORIES.map((value) => ({ value, label: copy[value] })), colors: COLORS.map((value) => ({ value, label: copy[value] })),
      canTranslate: !!draft?.text.trim() && !state.dirty && !state.saveError && !state.needsResume && !translating,
      canContinueTranslation: !!draft?.operation && !state.dirty && !state.saveError && !!error && !draft.job,
      saveMessage: state.saveError ? copy[state.saveError === 'storage-read' ? 'storageRead' : 'draftFailed'] : draft ? copy.draftSaved : '',
      translationMessage: error ? copy[error === 'submission-pending' ? 'interrupted' : error === 'network-unavailable' || error === 'backend-unavailable' ? 'offline' : 'translationFailed'] :
        jobState === 'failed' || jobState === 'expired' || jobState === 'cancelled' ? copy.translationFailed : translating ? copy.generating :
          draft?.needsChineseReview ? copy.needsReview : draft?.textZh ? copy.translated : ''
    });
    wx.setNavigationBarTitle({ title: copy.title });
  },
  onSourceInput(event) { this.drafts.edit({ text: event.detail.value }); },
  onChineseInput(event) { this.drafts.edit({ textZh: event.detail.value }); },
  onTitleInput(event) { this.drafts.edit({ title: event.detail.value }); },
  selectCategory(event) { this.drafts.edit({ category: event.currentTarget.dataset.value }); },
  selectColor(event) { this.drafts.edit({ color: event.currentTarget.dataset.value }); },
  continueDraft() { this.drafts.resumeNew(); this.drafts.refresh(); },
  async translate() { await this.drafts.translate(); this.renderDraft(); },
  async continueTranslation() { await this.drafts.continueSubmission(); this.renderDraft(); },
  retrySave() {
    const result = this.drafts.retrySave();
    if (result.ok && !this.drafts.getState().draft) this.drafts.beginNew({ category: this.entryCategory });
    this.renderDraft();
  },
  discardDraft() {
    const copy = this.data.editorCopy;
    wx.showModal({ title: copy.discardTitle, content: copy.discardBody, confirmText: copy.discard, cancelText: copy.cancel,
      success: (result) => { if (result.confirm && this.drafts.discard().ok) this.returnCards(); } });
  },
  saveCard() {
    if (this.drafts.save().ok) { wx.showToast({ title: this.data.editorCopy.saved, icon: 'success' }); wx.switchTab({ url: '/pages/cards/cards' }); }
  },
  returnCards() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.switchTab({ url: '/pages/cards/cards' }); }
});
