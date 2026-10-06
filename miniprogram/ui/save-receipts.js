function item(job, savedRevision, artifactIds = []) {
  return job ? { job, persistence: { locallySavedRevision: savedRevision === job.revision ? savedRevision : null, locallySavedArtifactIds: artifactIds } } : null;
}
function imageEntries(record, state, imageId, options = {}) {
  const image = record.images.find((entry) => entry.id === imageId); if (!image) return [];
  const pending = state.unsavedJobs || [];
  const entries = [];
  for (const kind of options.translationOnly ? ['image_translation'] : ['image_cards', 'image_translation']) {
    const retained = pending.find((job) => job.kind === kind && job.target.imageId === imageId);
    const job = retained || image.stageJobs[kind]; if (!job) continue;
    // A ready bitmap is presented only by its image-load event. Showing the
    // original alongside a "translation ready" label does not show the bitmap.
    if (kind === 'image_translation' && job.output?.state === 'ready' && !options.imageLoaded) continue;
    const artifact = image.translation;
    entries.push(item(job, retained ? null : job.locallySavedRevision,
      artifact?.saveState === 'saved' && artifact.localPath && artifact.id === job.output?.artifact?.id ? [artifact.id] : []));
  }
  return entries.filter(Boolean);
}
function chatEntries(state, visibleMessageIds = []) {
  if (!state.record) return [];
  const visible = new Set(visibleMessageIds);
  return Object.values(state.record.chatJobs || {}).filter((job) => visible.has(job.target.assistantMessageId)).map((saved) => {
    const job = state.unsavedJob?.jobId === saved.jobId ? state.unsavedJob : saved;
    return item(job, job === saved ? saved.locallySavedRevision : null);
  }).concat(state.unsavedJob && visible.has(state.unsavedJob.target.assistantMessageId) && !Object.values(state.record.chatJobs || {}).some((job) => job.jobId === state.unsavedJob.jobId) ? [item(state.unsavedJob, null)] : []);
}
function dietaryEntries(record, state) {
  const savedJobs = Object.values(record.dietaryReviews || {}).map((entry) => entry.job).filter(Boolean);
  return (state?.jobs || []).map((shown) => {
    const job = state?.unsavedJob?.jobId === shown.jobId ? state.unsavedJob : shown;
    const saved = savedJobs.find((candidate) => candidate.jobId === job.jobId && candidate.revision === job.revision);
    return item(job, state?.unsavedJob?.jobId === job.jobId ? null : saved?.locallySavedRevision);
  }).filter(Boolean);
}
function textEntries(state) { return Object.values(state.sides || {}).map((side) => item(side.job, state.dirty || state.saveError ? null : side.job?.revision)).filter(Boolean); }
function draftEntries(state) { return state.needsResume ? [] : [item(state.draft?.job, state.dirty || state.saveError ? null : state.draft?.job?.revision)].filter(Boolean); }
function present(services, entries) { if (services.receipts) for (const entry of entries) services.receipts.present(entry.job, entry.persistence); }
module.exports = { imageEntries, chatEntries, dietaryEntries, textEntries, draftEntries, present };
