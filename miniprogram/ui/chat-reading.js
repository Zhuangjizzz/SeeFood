const page = require('./page');
const BOTTOM_GAP = 48;
function replyVersions(state) {
  const versions = {};
  for (const message of state.messages) {
    if (message.role !== 'assistant' || !message.text && !(message.attachments || []).length) continue;
    const job = state.unsavedJob && state.unsavedJob.target.assistantMessageId === message.id ? state.unsavedJob : state.record && state.record.chatJobs && state.record.chatJobs[message.id];
    if (job) versions[message.id] = job.revision;
  }
  return versions;
}
function hasNew(target, state) {
  const position = target.chatReading;
  return !!position && !position.atBottom && Object.entries(replyVersions(state)).some(([id, revision]) => revision > (position.seenReplies[id] || 0));
}
function measure(target, callback) {
  if (!wx.createSelectorQuery) return;
  const query = wx.createSelectorQuery().in(target);
  query.select('.chat-messages').boundingClientRect();
  query.select('.chat-messages').scrollOffset();
  query.select('.chat-content').boundingClientRect();
  query.selectAll('.message').fields({ id: true, dataset: true, rect: true });
  query.exec((result) => {
    const [viewport, scroll, content, nodes] = result || [];
    if (viewport && scroll && content && Array.isArray(nodes) && target.chatVisible) callback({ viewport, scroll, content, nodes });
  });
}
function save(target) {
  if (!target.chatReadingDirty || !target.chatReading) return { ok: true };
  const result = page.services().history.saveChatPosition(target.recordId, target.chatReading);
  if (result.ok) target.chatReadingDirty = false;
  target.setData({ positionSaveFailed: !result.ok }); return result;
}
function remember(target, measured, state, preserveBottom) {
  const { viewport, scroll, content, nodes } = measured;
  const visible = nodes.filter((node) => node.bottom > viewport.top && node.top < viewport.bottom && node.dataset && node.dataset.messageId);
  const first = visible[0];
  const previous = target.chatReading;
  const atBottom = preserveBottom === undefined ? content.height - viewport.height - scroll.scrollTop <= BOTTOM_GAP : preserveBottom;
  target.chatReading = { anchorId: first ? first.dataset.messageId : null, offset: first ? first.top - viewport.top : 0,
    scrollTop: Math.max(0, scroll.scrollTop), atBottom, seenReplies: atBottom ? { ...previous.seenReplies, ...replyVersions(state) } : previous.seenReplies };
  target.chatReadingDirty = true;
  target.data.chatScrollTop = target.chatReading.scrollTop;
  target.setData({ hasNewReply: hasNew(target, state) }); save(target);
  if (target.presentVisibleMessages) target.presentVisibleMessages(state, visible.map((node) => node.dataset.messageId));
}
function open(target) {
  target.chatVisible = true;
  if (!target.chatReadingDirty) target.chatReading = page.services().history.getChatPosition(target.recordId);
}
function render(target, state) {
  if (!target.chatVisible || !state || !state.record) return;
  const serial = (target.chatMeasureSerial || 0) + 1; target.chatMeasureSerial = serial;
  measure(target, (measured) => {
    if (target.chatMeasureSerial !== serial) return;
    const saved = target.chatReading;
    const { viewport, scroll, content, nodes } = measured;
    const anchor = saved.anchorId && nodes.find((node) => node.dataset && node.dataset.messageId === saved.anchorId);
    const top = Math.max(0, saved.atBottom ? content.height - viewport.height : anchor ? scroll.scrollTop + anchor.top - viewport.top - saved.offset : saved.anchorId ? 0 : saved.scrollTop);
    const finish = () => measure(target, (current) => { if (target.chatMeasureSerial === serial) remember(target, current, state, saved.atBottom); });
    if (Math.abs(top - scroll.scrollTop) > 1) target.setData({ chatScrollTop: top }, finish);
    else finish();
  });
}
function scroll(target, event) {
  if (!target.chatVisible || !target.renderedChatState) return;
  target.chatMeasureSerial = (target.chatMeasureSerial || 0) + 1;
  const serial = target.chatMeasureSerial; const top = Math.max(0, event.detail.scrollTop || 0); const previous = target.chatReading;
  target.chatReading = { ...previous, scrollTop: top, offset: previous.offset - (top - previous.scrollTop) };
  target.data.chatScrollTop = top; target.chatReadingDirty = true;
  measure(target, (measured) => { if (target.chatMeasureSerial === serial) remember(target, measured, target.renderedChatState); });
}
function latest(target) {
  target.chatReading = { ...target.chatReading, atBottom: true };
  target.setData({ hasNewReply: false }); render(target, target.renderedChatState);
}
function close(target) { save(target); target.chatVisible = false; target.chatMeasureSerial = (target.chatMeasureSerial || 0) + 1; }
module.exports = { open, render, scroll, latest, close, save, hasNew };
