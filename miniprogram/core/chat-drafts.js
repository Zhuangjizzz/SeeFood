function empty(id) { return { recordId: id, text: '', inputVersion: 0, updatedAt: null, saveState: 'saved' }; }
function createChatDrafts({ records, notify }) {
  const pending = new Map(); const errors = new Map();
  records.subscribe((id) => { if (records.isDeleted(id)) { pending.delete(id); errors.delete(id); } });
  function read(id, record) {
    const result = record ? { ok: true, record } : records.getRecord(id);
    if (!result.ok) return { draft: empty(id), draftError: result.error };
    const saved = result.record.chatDraft || empty(id); const waiting = pending.get(id);
    if (waiting && saved.inputVersion > waiting.inputVersion) pending.delete(id);
    return { draft: { ...(pending.get(id) || saved) }, draftError: errors.get(id) || null };
  }
  function persist(id, draft) {
    const result = records.updateRecord(id, (record) => { record.chatDraft = { ...draft, saveState: 'saved' }; });
    if (result.ok) { pending.delete(id); errors.delete(id); }
    else { pending.set(id, { ...draft, saveState: 'failed' }); errors.set(id, result.error); }
    notify(id); return result.ok ? { ok: true } : result;
  }
  function edit(id, text) {
    if (typeof text !== 'string') return { ok: false, error: 'INPUT_UNSUPPORTED' };
    const current = read(id); if (current.draftError && ['record-missing', 'storage-read'].includes(current.draftError)) return { ok: false, error: current.draftError };
    return persist(id, { recordId: id, text, inputVersion: current.draft.inputVersion + 1, updatedAt: new Date().toISOString() });
  }
  function retry(id) {
    const current = read(id);
    if (['record-missing', 'storage-read'].includes(current.draftError)) return { ok: false, error: current.draftError };
    return pending.has(id) ? persist(id, pending.get(id)) : { ok: true };
  }
  return { read, edit, retry, clear: (id) => edit(id, ''),
    consume(record, submitted) {
      if (!submitted) return;
      const current = read(record.id, record).draft;
      if (current.inputVersion === submitted.inputVersion && current.text === submitted.text) {
        record.chatDraft = { ...current, text: '', inputVersion: current.inputVersion + 1, updatedAt: new Date().toISOString(), saveState: 'saved' };
      }
    }
  };
}
module.exports = { createChatDrafts };
