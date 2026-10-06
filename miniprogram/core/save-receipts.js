function clone(value) { return JSON.parse(JSON.stringify(value)); }
function merge(left, right) {
  return { appliedRevision: Math.max(left?.appliedRevision || 0, right.appliedRevision || 0),
    locallySavedRevision: Math.max(left?.locallySavedRevision || 0, right.locallySavedRevision || 0) || null,
    locallySavedArtifactIds: [...new Set([...(left?.locallySavedArtifactIds || []), ...(right.locallySavedArtifactIds || [])])].sort() };
}
/** Metadata-only outbox. Background persistence never invents page presentation. */
function createSaveReceipts({ store, backend, network }) {
  const key = 'save-receipts:' + (backend.identityKey || 'default');
  let entries; let journalError = null; let active = null;
  try { entries = store.get(key, {}); } catch (_) { entries = {}; journalError = 'storage-read'; }
  function persist() {
    if (journalError === 'storage-read') return;
    try { store.set(key, entries); journalError = null; } catch (_) { journalError = 'storage-write'; }
  }
  function acceptedFacts(job, persistence) {
    if (!job || typeof job.jobId !== 'string' || !job.jobId || !Number.isInteger(job.revision) || job.revision < 1 ||
      !persistence || persistence.locallySavedRevision !== null && (!Number.isInteger(persistence.locallySavedRevision) || persistence.locallySavedRevision < 1 || persistence.locallySavedRevision > job.revision) ||
      !Array.isArray(persistence.locallySavedArtifactIds)) throw new Error('Invalid save facts');
    const delivered = job.kind === 'image_translation' && job.output?.state === 'ready' ? [job.output.artifact.id] : [];
    if (persistence.locallySavedArtifactIds.some((id) => !delivered.includes(id))) throw new Error('Foreign saved artifact');
    return { locallySavedRevision: persistence.locallySavedRevision, locallySavedArtifactIds: [...new Set(persistence.locallySavedArtifactIds)] };
  }
  function queue(job, persistence) {
    const old = entries[job.jobId];
    if (old && job.revision < old.body.appliedRevision) return;
    const body = merge(old?.body, { appliedRevision: job.revision, ...persistence });
    if (!old || job.revision > old.body.appliedRevision) body.locallySavedRevision = persistence.locallySavedRevision;
    if (old && JSON.stringify(old.body) === JSON.stringify(body)) return;
    entries[job.jobId] = { contextId: job.contextId, identity: { kind: job.kind, target: clone(job.target), attempt: job.attempt, contextSnapshotVersion: job.contextSnapshotVersion }, body, confirmed: old?.confirmed || null };
    persist();
  }
  async function flush() {
    if (active) { await active; return flush(); }
    if (!backend.enabled || !backend.ackJob || network && !network.getState().online) return { ok: true, pending: true };
    const work = async () => {
      let failure = null;
      for (const [jobId, entry] of Object.entries(entries)) {
        if (JSON.stringify(entry.body) === JSON.stringify(entry.confirmed)) continue;
        const body = clone(entry.body);
        try {
          let receipt;
          try { receipt = await backend.ackJob(jobId, body); }
          catch (error) {
            if (error.code !== 'JOB_STATE_CONFLICT' || !entry.identity) throw error;
            // Legacy jobs may predate the server delivery ledger. Re-fetch only
            // the same job, and never turn a newer server revision into a claim
            // that the user displayed or saved it.
            const delivered = await backend.getJob(jobId);
            if (delivered.jobId !== jobId || delivered.contextId !== entry.contextId || delivered.revision !== body.appliedRevision ||
                delivered.kind !== entry.identity.kind || delivered.attempt !== entry.identity.attempt ||
                delivered.contextSnapshotVersion !== entry.identity.contextSnapshotVersion || JSON.stringify(delivered.target) !== JSON.stringify(entry.identity.target) ||
                body.locallySavedArtifactIds.some((id) => delivered.output?.artifact?.id !== id)) throw error;
            receipt = await backend.ackJob(jobId, body);
          }
          if (receipt.jobId !== jobId || receipt.appliedRevision < body.appliedRevision ||
              (receipt.locallySavedRevision || 0) < (body.locallySavedRevision || 0) ||
              body.locallySavedArtifactIds.some((id) => !receipt.locallySavedArtifactIds.includes(id))) throw { code: 'DEPENDENCY_MISSING' };
          if (!entries[jobId]) continue;
          entries[jobId].confirmed = body; entries[jobId].error = null; persist();
        } catch (error) {
          if (entries[jobId]) entries[jobId].error = error.code || 'TEMPORARY_FAILURE';
          failure = error.code || 'TEMPORARY_FAILURE'; persist();
          if (['network-unavailable', 'AUTH_REQUIRED', 'backend-unavailable'].includes(failure)) break;
        }
      }
      return failure ? { ok: false, error: failure } : { ok: true };
    };
    active = work();
    try { return await active; } finally { active = null; }
  }
  const api = {
    present(job, persistence) {
      try {
        const saved = acceptedFacts(job, persistence);
        queue(job, saved); void flush(); return { ok: true };
      } catch (_) { return { ok: false, error: 'DEPENDENCY_MISSING' }; }
    },
    saved(job, persistence) {
      try {
        const saved = acceptedFacts(job, persistence);
        const shown = entries[job.jobId];
        if (shown && shown.body.appliedRevision === job.revision) { queue(job, saved); void flush(); }
        return { ok: true };
      } catch (_) { return { ok: false, error: 'DEPENDENCY_MISSING' }; }
    },
    flush,
    forgetContexts(ids) {
      for (const [id, entry] of Object.entries(entries)) if (ids.includes(entry.contextId)) { delete entries[id]; }
      persist();
    },
    getState(jobId) {
      const value = jobId ? entries[jobId] : entries;
      return { entries: clone(value || {}), journalError };
    }
  };
  if (network) network.subscribe((state) => { if (state.online) void flush(); });
  return api;
}
module.exports = { createSaveReceipts };
