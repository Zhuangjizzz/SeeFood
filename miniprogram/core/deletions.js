function createDeletions({ records, backend, network }) {
  const active = new Map();
  async function retryOne(id) {
    if (active.has(id)) return active.get(id);
    const pending = Promise.resolve().then(async () => {
      const local = records.finishDeletion(id);
      const result = records.getDeletions(); if (!result.ok) return result;
      const entry = result.entries.find((item) => item.localScopeId === id);
      if (!entry) return { ok: false, error: 'record-missing' };
      if (!entry.cleanups.length) return { ok: local.ok, pending: !local.ok, error: local.error };
      if (!backend.enabled || network && !network.getState().online) return { ok: local.ok, pending: true, error: local.error };
      for (const cleanup of entry.cleanups) {
        if (cleanup.state === 'succeeded') continue;
        try {
          let value = cleanup.cleanupId && cleanup.state !== 'failed' ? await backend.getCleanup(cleanup.cleanupId) : await backend.deleteContext(cleanup.contextId);
          for (let poll = 0; ; poll += 1) {
          if (!value || value.contextId !== cleanup.contextId || typeof value.cleanupId !== 'string' || !['queued', 'running', 'succeeded', 'failed'].includes(value.state) || cleanup.cleanupId && value.cleanupId !== cleanup.cleanupId) throw { code: 'DEPENDENCY_MISSING' };
          const stored = records.updateDeletion(id, (draft) => {
            const target = draft.cleanups.find((item) => item.contextId === cleanup.contextId);
            if (target.cleanupId && target.cleanupId !== value.cleanupId) throw new Error('Cleanup identity changed');
            if (target.state !== 'succeeded') Object.assign(target, value);
            draft.pendingCleanupIds = draft.cleanups.filter((item) => item.state !== 'succeeded' && item.cleanupId).map((item) => item.cleanupId);
          });
          if (!stored.ok) return stored;
          if (!['queued', 'running'].includes(value.state) || poll >= 99) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
          value = await backend.getCleanup(value.cleanupId);
          }
        } catch (error) {
          records.updateDeletion(id, (draft) => { const target = draft.cleanups.find((item) => item.contextId === cleanup.contextId); target.error = error.code || 'TEMPORARY_FAILURE'; });
          return { ok: false, pending: true, error: error.code || 'TEMPORARY_FAILURE' };
        }
      }
      const latest = records.getDeletions().entries.find((item) => item.localScopeId === id);
      const pendingCleanup = !latest || latest.cleanups.some((item) => item.state !== 'succeeded');
      return { ok: local.ok, pending: !local.ok || pendingCleanup, error: local.error };
    }).finally(() => active.delete(id));
    active.set(id, pending); return pending;
  }
  const service = {
    subscribe: records.subscribe,
    getState() {
      const value = records.getDeletions();
      return { ...value, entries: value.entries.map((entry) => ({ ...entry,
        backendState: !entry.cleanups.length ? 'not-required' : entry.cleanups.every((item) => item.state === 'succeeded') ? 'succeeded' :
          entry.cleanups.some((item) => item.state === 'failed' || item.error) ? 'failed' :
            entry.cleanups.some((item) => item.state === 'running') ? 'running' : 'queued' })) };
    },
    async deleteRecord(id) {
      const marked = records.markDeleted([id]); if (!marked.ok) return marked;
      const result = await retryOne(id);
      return { ok: true, localComplete: records.getDeletions().entries.find((entry) => entry.localScopeId === id)?.localState === 'succeeded', pending: !result.ok || !!result.pending };
    },
    async clearHistory(ids) {
      const history = records.listHistory(); if (!history.ok) return history;
      const marked = records.markDeleted(ids || history.records.map((record) => record.id)); if (!marked.ok) return marked;
      await service.retry(); return { ok: true };
    },
    async retry(id) {
      const state = records.getDeletions(); if (!state.ok) return state;
      const entries = id ? state.entries.filter((entry) => entry.localScopeId === id) : state.entries.filter((entry) =>
        entry.localState !== 'succeeded' || entry.cleanups.some((cleanup) => cleanup.state !== 'succeeded'));
      if (id && !entries.length) return { ok: false, error: 'record-missing' };
      const results = await Promise.all(entries.map((entry) => retryOne(entry.localScopeId)));
      return results.find((result) => !result.ok) || { ok: true };
    }
  };
  if (network) network.subscribe((state) => { if (state.online) void service.retry(); });
  return service;
}
module.exports = { createDeletions };
