const { createJobRecovery } = require('./recovery');

const STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'];
function clone(value) { return JSON.parse(JSON.stringify(value)); }

// Card drafts and the current exchange own their local data. This service owns
// immutable communication submissions and recovery; it never creates records.
function createTextTranslations({ backend, pollMs = 100 }) {
  const recovery = createJobRecovery({ backend });
  const queues = new Map();
  function isCurrent(operation, consumer) {
    const current = consumer.current();
    return current && current.localScopeId === operation.context.localScopeId &&
      current.inputVersion === operation.request.input.inputVersion && current.requestId === operation.request.target.requestId;
  }
  function deliver(operation, job, consumer) {
    if (!isCurrent(operation, consumer)) return { ok: false, error: 'stale-job' };
    const { request } = operation;
    if (!job || job.kind !== 'text_translation' || job.contextId !== request.contextId ||
        !job.target || job.target.requestId !== request.target.requestId || job.contextSnapshotVersion !== request.input.contextSnapshotVersion ||
        typeof job.jobId !== 'string' || !job.jobId || !Number.isInteger(job.attempt) || job.attempt < 1 ||
        !Number.isInteger(job.revision) || job.revision < 1 || !STATES.includes(job.state)) return { ok: false, error: 'DEPENDENCY_MISSING' };
    if (job.state === 'succeeded' ? !job.output || typeof job.output.text !== 'string' || !job.output.text ||
        job.output.contentLanguage !== request.input.targetLanguage || job.output.inputVersion !== request.input.inputVersion : job.output !== null) {
      return { ok: false, error: 'DEPENDENCY_MISSING' };
    }
    const previous = consumer.current().job;
    if (previous ? previous.jobId !== job.jobId || previous.attempt !== job.attempt || job.revision <= previous.revision : job.attempt !== 1) return { ok: false, error: 'stale-job' };
    return consumer.apply(clone(job));
  }
  async function poll(operation, job, consumer) {
    for (let count = 0; count < 300; count += 1) {
      if (!isCurrent(operation, consumer)) return { ok: false, error: 'stale-job' };
      if (!['queued', 'running'].includes(job.state)) return { ok: true, jobId: job.jobId };
      job = await backend.getJob(job.jobId);
      const result = deliver(operation, job, consumer);
      if (!result.ok && result.error !== 'stale-job') return result;
      if (['queued', 'running'].includes(job.state)) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return { ok: true, pending: true };
  }
  return {
    prepare({ localScopeId, contextId, snapshotVersion, inputVersion, requestId, text, sourceLanguage, targetLanguage }) {
      const snapshot = { text, sourceLanguage, targetLanguage, inputVersion };
      return {
        context: { purpose: 'communication', localScopeId, snapshotVersion, snapshot: clone(snapshot) },
        request: { contextId, kind: 'text_translation', target: { requestId }, input: { contextSnapshotVersion: snapshotVersion, ...snapshot } }
      };
    },
    applyJob: deliver,
    async submit(operation, consumer) {
      const id = operation.request.contextId;
      const submission = (queues.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
        if (!isCurrent(operation, consumer)) return null;
        // A shared communication context may have an older submission whose
        // PUT response was lost. Keep every retained snapshot reachable before
        // advancing the context; creating snapshots does not start translation.
        const snapshots = consumer.contextSnapshots ? consumer.contextSnapshots() : [operation.context];
        for (const snapshot of snapshots.sort((a, b) => a.snapshotVersion - b.snapshotVersion)) {
          if (!isCurrent(operation, consumer)) return null;
          if (snapshot.localScopeId !== operation.context.localScopeId || snapshot.purpose !== 'communication' ||
              snapshot.snapshotVersion > operation.context.snapshotVersion) throw { code: 'DEPENDENCY_MISSING' };
          await backend.putContext(id, snapshot);
        }
        if (!isCurrent(operation, consumer)) return null;
        return backend.createJob(operation.request, operation.request.target.requestId);
      });
      queues.set(id, submission);
      let job;
      try { job = await submission; } finally { if (queues.get(id) === submission) queues.delete(id); }
      if (!job) return { ok: false, error: 'stale-job' };
      const result = deliver(operation, job, consumer);
      return result.ok || result.error === 'stale-job' ? poll(operation, job, consumer) : result;
    },
    async recover(operation, consumer) {
      if (!isCurrent(operation, consumer)) return { ok: false, error: 'stale-job' };
      let found;
      const result = await recovery.recover({ contextId: operation.request.contextId, requests: [operation.request], apply(job) {
        found = job;
        return deliver(operation, job, consumer);
      } });
      if (!result.ok) return result;
      return found ? poll(operation, found, consumer) : { ok: true, pending: true };
    }
  };
}

module.exports = { createTextTranslations };
