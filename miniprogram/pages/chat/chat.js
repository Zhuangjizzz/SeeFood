const saveRecovery = require('../../ui/save-recovery');
const page = require('../../ui/page');
const { presentDish, getDishesCopy } = require('../../core/dishes-copy');

Page({
  data: { messages: [], draft: '', chatCopy: {}, running: false, errorText: '', keyboardHeight: 0 },
  onLoad(options) { this.recordId = page.routeValue(options.recordId); this.inputVersion = 0; },
  onShow() {
    this.receiptVisible = true;
    if (this.unsubscribeNetwork) this.unsubscribeNetwork();
    this.unsubscribeNetwork = page.services().network.subscribe(() => this.show());
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = page.services().chat.subscribe((id) => { if (id === this.recordId) this.show(); });
    this.show();
    void page.services().chat.refreshRecord(this.recordId);
  },
  onHide() { this.receiptVisible = false; if (this.unsubscribeNetwork) { this.unsubscribeNetwork(); this.unsubscribeNetwork = null; } if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; } },
  onUnload() { this.onHide(); },
  show() {
    const services = page.services(); const state = services.chat.getState(this.recordId); const copy = state.copy;
    const dishCopy = getDishesCopy(services.application.getState().language);
    wx.setNavigationBarTitle({ title: copy.title });
    const messages = state.messages.map((message) => ({ ...message,
      statusLabel: message.unsaved ? copy.saveFailed : copy[message.state] || '',
      dishReferences: (message.attachments || []).filter((attachment) => attachment.type === 'dish_reference').map((attachment) => {
        const dish = state.record && (state.record.cards || []).find((card) => card.id === attachment.cardId);
        return dish ? presentDish(dish, dishCopy) : null;
      }).filter(Boolean),
      communicationCards: (message.attachments || []).filter((attachment) => attachment.type === 'communication_card').map((attachment, index) => ({ ...attachment.card, index }))
    }));
    const offline = !services.network.getState().online;
    const errorText = offline ? copy.offline : state.error === 'JOB_STATE_CONFLICT' ? copy.busy : ['network-unavailable', 'backend-unavailable'].includes(state.error) ? copy.offline :
      state.unsavedJob ? copy.saveFailed : !state.record ? copy.missing : state.error ? copy.error : '';
    this.setData({ messages, chatCopy: copy, running: state.running, canSend: !!state.record && !state.running && !offline,
      errorText, saveRecoveryCopy: saveRecovery.copy(), saveFailed: !!state.unsavedJob, recordAvailable: !!state.record });
  },
  onInput(event) { this.inputVersion += 1; this.setData({ draft: event.detail.value }); },
  onKeyboardHeight(event) { this.setData({ keyboardHeight: Math.max(0, event.detail.height || 0) }); },
  async send() {
    const text = this.data.draft; const version = this.inputVersion;
    if (!text.trim()) return { ok: false, error: 'INPUT_UNSUPPORTED' };
    const result = await page.services().chat.send(this.recordId, text);
    if (result.ok && this.inputVersion === version) { this.inputVersion += 1; this.setData({ draft: '' }); }
    this.show();
    if (!result.ok && result.error === 'JOB_STATE_CONFLICT') this.setData({ errorText: this.data.chatCopy.busy });
    return result;
  },
  async askQuickQuestion(event) {
    const result = await page.services().chat.sendQuickQuestion(this.recordId, event.currentTarget.dataset.id);
    this.show(); return result;
  },
  openSaveCleanup: saveRecovery.open,
  retrySave() { const result = page.services().chat.retrySave(this.recordId); this.show(); return result; },
  openDish(event) {
    const { messageId, cardId } = event.currentTarget.dataset;
    const state = page.services().chat.getState(this.recordId);
    const message = state.messages.find((item) => item.id === messageId);
    if (!message || !message.attachments.some((item) => item.type === 'dish_reference' && item.cardId === cardId) ||
      !state.record || !(state.record.cards || []).some((card) => card.id === cardId && card.recordId === this.recordId)) return;
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?recordId=${encodeURIComponent(this.recordId)}&cardId=${encodeURIComponent(cardId)}` });
  },
  back() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.redirectTo({ url: `/pages/result/result?recordId=${encodeURIComponent(this.recordId)}` }); }
});
