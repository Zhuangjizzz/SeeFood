function clone(value) { return JSON.parse(JSON.stringify(value)); }

/** All producers of record snapshots share this queue. Polling belongs outside it. */
function createRecordContexts({ records, backend }) {
  const pending = new Map();
  function read(id) { const result = records.getRecord(id); if (!result.ok) throw { code: result.error }; return result.record; }
  return {
    run(id, operation) {
      const previous = pending.get(id) || Promise.resolve();
      const next = previous.catch(() => {}).then(operation).finally(() => { if (pending.get(id) === next) pending.delete(id); });
      pending.set(id, next); return next;
    },
    async publishPending(id) {
      const record = read(id); const body = record.pendingContextSnapshot;
      if (!body) return record;
      const response = await backend.putContext(record.contextId, clone(body));
      if (!response || response.contextId !== record.contextId || response.snapshotVersion !== body.snapshotVersion) throw { code: 'SNAPSHOT_CONFLICT' };
      const current = read(id);
      if (current.contextId !== record.contextId || JSON.stringify(current.pendingContextSnapshot) !== JSON.stringify(body)) throw { code: 'SNAPSHOT_CONFLICT' };
      const saved = records.updateRecord(id, (draft) => {
        draft.contextSnapshotVersion = body.snapshotVersion; draft.contextSnapshot = clone(body); delete draft.pendingContextSnapshot;
      });
      if (!saved.ok) throw { code: saved.error }; return saved.record;
    }
  };
}
module.exports = { createRecordContexts };
