const { createJobRecovery } = require('./recovery');
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sameTarget(a, b) { return JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort()); }
function matches(intent, job) {
  return job && job.jobId === intent.jobId && job.contextId === intent.contextId && job.kind === intent.kind &&
    job.contextSnapshotVersion === intent.contextSnapshotVersion && sameTarget(job.target, intent.target);
}
function canAcceptRetry(intent, previous, next) {
  return !!(intent && matches(intent, previous) && matches(intent, next) &&
    previous.attempt === intent.body.expectedAttempt && previous.state === 'failed' && previous.error?.retryable === true &&
    next.attempt === previous.attempt + 1 && next.revision > Math.max(previous.revision, intent.baseRevision));
}

// Consumers durably save intent before submit, and check their live scope again
// in accept. Recovery performs reads only; another POST needs another user action.
function createJobRetry({ backend }) {
  const recovery = createJobRecovery({ backend });
  return {
    prepare(job) {
      if (!job || job.state !== 'failed' || job.error?.retryable !== true) throw { code: 'JOB_STATE_CONFLICT' };
      return { jobId: job.jobId, contextId: job.contextId, kind: job.kind, target: clone(job.target),
        contextSnapshotVersion: job.contextSnapshotVersion, baseRevision: job.revision,
        requestId: `${job.jobId}:retry:${job.attempt}`, body: { expectedAttempt: job.attempt } };
    },
    async submit(intent, consumer) {
      if (!consumer.isCurrent()) return { ok: false, error: 'stale-job' };
      const current = await backend.getJob(intent.jobId);
      if (!consumer.isCurrent()) return { ok: false, error: 'stale-job' };
      if (!matches(intent, current)) return { ok: false, error: 'DEPENDENCY_MISSING' };
      if (current.attempt === intent.body.expectedAttempt + 1 && current.revision > intent.baseRevision) return consumer.accept(current);
      if (current.attempt !== intent.body.expectedAttempt || current.state !== 'failed' || current.error?.retryable !== true) return { ok: false, error: 'JOB_STATE_CONFLICT' };
      const job = await backend.retryJob(intent.jobId, intent.body, intent.requestId);
      if (!consumer.isCurrent()) return { ok: false, error: 'stale-job' };
      if (!matches(intent, job) || job.attempt !== intent.body.expectedAttempt + 1 || job.revision <= intent.baseRevision) return { ok: false, error: 'stale-job' };
      return consumer.accept(job);
    },
    async continueSubmission(operation, consumer) {
      if (!consumer.isCurrent()) return { ok: false, error: 'stale-job' };
      let found = false;
      const recovered = await recovery.recover({ contextId: operation.request.contextId, requests: [operation.request], apply(job) {
        found = true;
        return consumer.isCurrent() ? consumer.accept(job) : { ok: false, error: 'stale-job' };
      } });
      if (!recovered.ok || !consumer.isCurrent()) return recovered.ok ? { ok: false, error: 'stale-job' } : recovered;
      if (found) return { ok: true, recovered: true };
      const job = await backend.createJob(operation.request, operation.requestId);
      return consumer.isCurrent() ? consumer.accept(job) : { ok: false, error: 'stale-job' };
    }
  };
}
module.exports = { createJobRetry, canAcceptRetry };
