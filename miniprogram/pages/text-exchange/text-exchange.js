const receiptPage = require('../../ui/save-receipts');
const saveRecovery = require('../../ui/save-recovery');
const page = require('../../ui/page');
const { LANGUAGES } = require('../../core/i18n');
const { SPEAKERS } = require('../../core/text-exchange');
const { getTextExchangeCopy } = require('../../core/text-exchange-copy');

Page({
  data: { exchangeCopy: {}, rows: [], inputValue: '', selectedSpeaker: 'visitor' },
  onLoad() { this.exchange = page.services().textExchange; },
  onShow() {
    this.receiptVisible = true;
    if (!this.exchange) this.exchange = page.services().textExchange;
    if (!this.unsubscribe) this.unsubscribe = this.exchange.subscribe(() => this.render());
    this.render();
    this.exchange.refresh();
  },
  onHide() { this.stopWatching(); },
  onUnload() { this.stopWatching(); },
  stopWatching() { this.receiptVisible = false; if (this.unsubscribe) this.unsubscribe(); this.unsubscribe = null; },
  render() {
    const state = this.exchange.getState(); const language = page.services().application.getState().language;
    const copy = getTextExchangeCopy(language); const active = state.sides[state.selectedSpeaker];
    const languageName = (code) => (LANGUAGES.find((item) => item.code === code) || {}).name || code;
    const targetLanguage = !active.draft && active.operation ? active.operation.request.input.targetLanguage : state.selectedSpeaker === 'visitor' ? 'zh-CN' : language;
    const rows = SPEAKERS.map((speaker) => {
      const side = state.sides[speaker]; const waiting = side.operation && (!side.job || ['queued', 'running'].includes(side.job.state));
      const failed = side.job && ['failed', 'cancelled', 'expired'].includes(side.job.state);
      const status = side.error ? copy[side.error === 'network-unavailable' ? 'offline' : side.error === 'backend-unavailable' ? 'unavailable' : 'failed'] :
        failed ? copy.failed : waiting ? copy[side.job ? 'waiting' : 'checking'] : side.draft ? copy.draft : side.result ? copy.saved : '';
      return { speaker, label: copy[speaker], result: side.result, latest: state.latestSpeaker === speaker, status,
        pendingText: side.operation && (!side.job || side.job.state !== 'succeeded') ? side.operation.request.input.text : '',
        canCheck: !!waiting, canEdit: !!side.operation && (!!side.error || !!failed) };
    });
    this.setData({ exchangeCopy: copy, rows, selectedSpeaker: state.selectedSpeaker, inputValue: active.draft,
      direction: languageName(active.inputLanguage) + ' → ' + languageName(targetLanguage),
      canSubmit: !!active.draft.trim() && !state.saveError, empty: rows.every((row) => !row.result && !row.pendingText),
      saveError: state.saveError ? copy[state.saveError === 'storage-read' ? 'readFailed' : 'saveFailed'] : '',
      saveRecoveryCopy: saveRecovery.copy(), draftStatus: active.draft && !state.saveError ? copy.draft : '' }, () => { if (this.receiptVisible) receiptPage.present(page.services(), receiptPage.textEntries(state)); });
    wx.setNavigationBarTitle({ title: copy.title });
  },
  onInput(event) { this.exchange.edit(this.data.selectedSpeaker, event.detail.value); },
  selectSpeaker(event) { this.exchange.selectSpeaker(event.currentTarget.dataset.speaker); },
  submit() { return this.exchange.submit(this.data.selectedSpeaker); },
  checkProgress(event) { return this.exchange.continueSubmission(event.currentTarget.dataset.speaker); },
  editSubmitted(event) { return this.exchange.restoreInput(event.currentTarget.dataset.speaker); },
  openSaveCleanup: saveRecovery.open,
  retrySave() { return this.exchange.retrySave(); },
  clearExchange() {
    const copy = this.data.exchangeCopy;
    wx.showModal({ title: copy.clearConfirm, content: copy.clearDetail, confirmText: copy.confirmClear,
      cancelText: copy.cancel, success: (result) => { if (result.confirm) this.exchange.clear(); } });
  },
  returnCards() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/cards/cards' });
  }
});
