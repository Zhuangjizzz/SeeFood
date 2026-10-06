function createCardFavorites({ chat, repository, library }) {
  return {
    getState(recordId) { return repository.readFavorites(recordId); },
    save(recordId, messageId, attachmentIndex, expectedContent) {
      const state = chat.getState(recordId);
      const message = state.messages.find((item) => item.id === messageId && item.role === 'assistant');
      const attachment = Number.isInteger(attachmentIndex) && message?.attachments?.[attachmentIndex];
      if (!state.record || !attachment || attachment.type !== 'communication_card') return { ok: false, error: 'card-unavailable' };
      if (expectedContent && ['title', 'category', 'textZh', 'pairedText', 'pairedLanguage'].some((key) => expectedContent[key] !== attachment.card[key])) return { ok: false, error: 'card-changed' };
      const result = repository.commitFavorite(attachment.card, { sourceRecordId: recordId, sourceMessageId: messageId, sourceAttachmentIndex: attachmentIndex });
      if (result.ok) library.reload();
      return result;
    }
  };
}
module.exports = { createCardFavorites };
