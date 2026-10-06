/** Freeze only completed question/reply pairs, retaining their reading order. */
function completedMessages(record) {
  const messages = record.messages || [];
  const included = new Set(messages.filter(message => message.role === 'assistant' && message.state === 'complete')
    .flatMap(message => [message.id, message.inReplyTo]));
  return messages.filter(message => included.has(message.id)).map(message => {
    const { id, role, text, contentLanguage, inReplyTo, preferencesVersion, attachments } = message;
    return { id, role, text, contentLanguage, inReplyTo, preferencesVersion, attachments: JSON.parse(JSON.stringify(attachments)) };
  });
}
module.exports = { completedMessages };
