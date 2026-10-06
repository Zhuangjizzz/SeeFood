const page = require('../../ui/page');
const reading = require('../../ui/chat-reading');
const { presentDish, getDishesCopy } = require('../../core/dishes-copy');

Page({
  data: { messages: [], draft: '', chatCopy: {}, running: false, errorText: '', keyboardHeight: 0, chatScrollTop: 0, hasNewReply: false, positionSaveFailed: false },
  onLoad(options) { this.recordId = page.routeValue(options.recordId); },
  onShow() {
    reading.open(this);
    if (this.unsubscribeNetwork) this.unsubscribeNetwork();
    this.unsubscribeNetwork = page.services().network.subscribe(() => this.show());
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = page.services().chat.subscribe((id) => { if (id === this.recordId) this.show(); });
    this.show();
    void page.services().chat.refreshRecord(this.recordId);
  },
  onHide() { reading.close(this); this.setData({ keyboardHeight: 0 }); if (this.unsubscribeNetwork) { this.unsubscribeNetwork(); this.unsubscribeNetwork = null; } if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; } },
  onUnload() { this.onHide(); },
  show() {
    const services = page.services(); const state = services.chat.getState(this.recordId); const copy = state.copy;
    const favorites = services.cardFavorites.getState(this.recordId);
    const dishCopy = getDishesCopy(services.application.getState().language);
    wx.setNavigationBarTitle({ title: copy.title });
    const messages = state.messages.map((message) => ({ ...message, ...(state.replyActions[message.id] || {}),
      statusLabel: [message.role === 'assistant' && !state.processing && state.replyActions[message.id]?.retryPending ? copy.retryUnconfirmed :
        message.role === 'assistant' && !state.processing && state.replyActions[message.id]?.canContinue ? copy.sendUnconfirmed : copy[message.state] || '',
        message.unsaved ? copy.saveFailed : ''].filter(Boolean).join(' '),
      dishReferences: (message.attachments || []).filter((attachment) => attachment.type === 'dish_reference').map((attachment) => {
        const dish = state.record && (state.record.cards || []).find((card) => card.id === attachment.cardId);
        return dish ? presentDish(dish, dishCopy) : null;
      }).filter(Boolean),
      communicationCards: (message.attachments || []).map((attachment, index) => {
        if (attachment.type !== 'communication_card') return null;
        const saved = favorites.cards.some((card) => card.sourceMessageId === message.id && card.sourceAttachmentIndex === index);
        const error = this.favoriteErrors?.[message.id + ':' + index] || favorites.error;
        return { ...attachment.card, index, sourceContent: attachment.card, saved,
          favoriteError: error ? ['card-unavailable', 'card-changed'].includes(error) ? copy.favoriteUnavailable : copy.favoriteFailed : '' };
      }).filter(Boolean)
    }));
    const offline = !services.network.getState().online;
    const errorText = offline ? copy.offline : state.error === 'JOB_STATE_CONFLICT' ? copy.busy : ['network-unavailable', 'backend-unavailable'].includes(state.error) ? copy.offline :
      state.unsavedJob ? copy.saveFailed : !state.record ? copy.missing : state.error ? copy.error : '';
    this.renderedChatState = state;
    this.setData({ draft: state.draft.text, draftSaveFailed: !!state.draftError, hasNewReply: reading.hasNew(this, state), messages, chatCopy: copy, running: state.running, canSend: !!state.record && !state.running && !offline,
      errorText, offline, saveFailed: !!state.unsavedJob, recordAvailable: !!state.record }, () => reading.render(this, state));

  },
  onInput(event) { const result = page.services().chat.editDraft(this.recordId, event.detail.value); this.show(); return result; },
  clearDraft() { const result = page.services().chat.clearDraft(this.recordId); this.show(); return result; },
  retryDraftSave() { const result = page.services().chat.retryDraftSave(this.recordId); this.show(); return result; },
  onMessagesScroll(event) { reading.scroll(this, event); },
  viewLatest() { reading.latest(this); },
  retryReadingSave() { return reading.save(this); },
  onKeyboardHeight(event) { this.setData({ keyboardHeight: Math.max(0, event.detail.height || 0) }, () => reading.render(this, this.renderedChatState)); },
  onComposerResize() { reading.render(this, this.renderedChatState); },
  onResize() { this.onComposerResize(); },
  async send() {
    const result = await page.services().chat.sendDraft(this.recordId);
    this.show();
    if (!result.ok && result.error === 'JOB_STATE_CONFLICT') this.setData({ errorText: this.data.chatCopy.busy });
    return result;
  },
  async askQuickQuestion(event) {
    const result = await page.services().chat.sendQuickQuestion(this.recordId, event.currentTarget.dataset.id);
    this.show(); return result;
  },
  async retryReply(event) { const result = await page.services().chat.retryReply(this.recordId, event.currentTarget.dataset.id); this.show(); return result; },
  async continueSend(event) { const result = await page.services().chat.continueSubmission(this.recordId, event.currentTarget.dataset.id); this.show(); return result; },
  retrySave() { const result = page.services().chat.retrySave(this.recordId); this.show(); return result; },
  favoriteCard(event) {
    const { messageId, index } = event.currentTarget.dataset;
    const attachmentIndex = Number(index);
    const shown = this.data.messages.find((message) => message.id === messageId)?.communicationCards.find((card) => card.index === attachmentIndex);
    if (!shown) return { ok: false, error: 'card-unavailable' };
    const result = page.services().cardFavorites.save(this.recordId, messageId, attachmentIndex, shown.sourceContent);
    this.favoriteErrors = { ...this.favoriteErrors, [messageId + ':' + attachmentIndex]: result.ok ? null : result.error };
    this.show();
    return result;
  },
  openDish(event) {
    const { messageId, cardId } = event.currentTarget.dataset;
    const state = page.services().chat.getState(this.recordId);
    const message = state.messages.find((item) => item.id === messageId);
    if (!message || !message.attachments.some((item) => item.type === 'dish_reference' && item.cardId === cardId) ||
      !state.record || !(state.record.cards || []).some((card) => card.id === cardId && card.recordId === this.recordId)) return;
    reading.save(this);
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?recordId=${encodeURIComponent(this.recordId)}&cardId=${encodeURIComponent(cardId)}` });
  },
  back() { reading.save(this); if (getCurrentPages().length > 1) wx.navigateBack(); else wx.redirectTo({ url: `/pages/result/result?recordId=${encodeURIComponent(this.recordId)}` }); }
});
