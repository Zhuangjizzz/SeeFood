const page = require('./page');
const { getDeletionCopy } = require('../core/deletion-copy');
function showDeletionState(target) {
  const copy = getDeletionCopy(page.services().application.getState().language);
  const state = page.services().deletions.getState();
  const local = { succeeded: copy.localSucceeded, pending: copy.localPending, failed: copy.localFailed };
  const backend = { succeeded: copy.serverSucceeded, queued: copy.serverQueued, running: copy.serverRunning, failed: copy.serverFailed, 'not-required': copy.serverNotRequired };
  target.setData({ deletionCopy: copy, cleanupReadError: !state.ok ? copy.readFailed : '',
    cleanupEntries: state.entries.map((entry) => ({ id: entry.localScopeId, localLabel: local[entry.localState], backendLabel: backend[entry.backendState],
      pending: entry.localState !== 'succeeded' || !['succeeded', 'not-required'].includes(entry.backendState) })),
    cleanupPending: state.entries.some((entry) => entry.localState !== 'succeeded' || !['succeeded', 'not-required'].includes(entry.backendState)) });
}
function choose(items) { return new Promise((resolve) => wx.showActionSheet({ itemList: items, success: (value) => resolve(value.tapIndex), fail: () => resolve(-1) })); }
function confirm(copy, title, content, clear) { return new Promise((resolve) => wx.showModal({ title, content, confirmText: clear ? copy.clear : copy.deleteRecord, cancelText: copy.cancel,
  confirmColor: '#944735', success: (value) => resolve(!!value.confirm), fail: () => resolve(false) })); }
async function remove(target, id) {
  if (target.deletionDialog) return;
  target.deletionDialog = true;
  try {
    const copy = target.data.deletionCopy; const entry = target.data.entries.find((item) => item.id === id);
    if (!entry) { target.setData({ deletionError: copy.unavailable }); return; }
    if (await choose([copy.deleteRecord]) !== 0 || !await confirm(copy, copy.deleteTitle, copy.deleteBody.replace('{title}', entry.title))) return;
    const result = await page.services().deletions.deleteRecord(id);
    target.setData({ showCleanup: true, deletionError: result.ok ? '' : result.error === 'record-missing' ? copy.unavailable : copy.failed });
    return result;
  } finally { target.deletionDialog = false; showDeletionState(target); }
}
async function manage(target) {
  if (target.deletionDialog) return;
  target.deletionDialog = true;
  try {
    const copy = target.data.deletionCopy; const ids = target.data.entries.map((entry) => entry.id);
    const choice = await choose(ids.length ? [copy.clear, copy.cleanup] : [copy.cleanup]);
    if (choice < 0) return;
    if (!ids.length || choice === 1) { target.setData({ showCleanup: true }); return; }
    if (!await confirm(copy, copy.clearTitle, copy.clearBody.replace('{count}', String(ids.length)), true)) return;
    const result = await page.services().deletions.clearHistory(ids);
    target.setData({ showCleanup: true, deletionError: result.ok ? '' : copy.failed });
    return result;
  } finally { target.deletionDialog = false; showDeletionState(target); }
}
module.exports = { showDeletionState, remove, manage };
