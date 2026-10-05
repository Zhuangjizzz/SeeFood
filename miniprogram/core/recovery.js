function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

// Only lookup is shared. Each consumer validates its current scope, request and
// output again when applying, so an intervening edit or deletion stays authoritative.
function createJobRecovery({ backend }) {
  return {
    async recover({ contextId, requests, apply }) {
      if (!requests.length) return { ok: true, jobIds: [] };
      const jobs = new Map(); const cursors = new Set(); let cursor;
      do {
        const page = await backend.listContextJobs(contextId, cursor);
        if (!page || !Array.isArray(page.items) || (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor))) throw { code: 'INPUT_UNSUPPORTED' };
        for (const job of page.items) {
          if (!job || job.contextId !== contextId || typeof job.jobId !== 'string' || !job.jobId ||
              !Number.isInteger(job.attempt) || job.attempt < 1 || !Number.isInteger(job.revision) || job.revision < 1) throw { code: 'INPUT_UNSUPPORTED' };
          const matches = requests.some((request) => request.contextId === contextId && request.kind === job.kind &&
            canonical(request.target) === canonical(job.target) && request.input.contextSnapshotVersion === job.contextSnapshotVersion);
          if (!matches) continue;
          const previous = jobs.get(job.jobId);
          if (!previous || (job.attempt >= previous.attempt && job.revision > previous.revision)) jobs.set(job.jobId, job);
        }
        cursor = page.nextCursor;
        if (cursor !== null) {
          if (cursors.has(cursor)) throw { code: 'INPUT_UNSUPPORTED' };
          cursors.add(cursor);
        }
      } while (cursor !== null);
      for (const job of jobs.values()) {
        const result = await apply(job);
        if (!result.ok && result.error !== 'stale-job') return result;
      }
      return { ok: true, jobIds: [...jobs.keys()] };
    }
  };
}

module.exports = { createJobRecovery };
