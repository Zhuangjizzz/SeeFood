const { makeId } = require('./identity');
const { getChatCopy } = require('./chat-copy');
const { LANGUAGES } = require('./i18n');
const { createJobRecovery } = require('./recovery');
const { createChatDrafts } = require('./chat-drafts');
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function messageSnapshot(message) {
  const { id, role, text, contentLanguage, inReplyTo, preferencesVersion, attachments } = message;
  return { id, role, text, contentLanguage, inReplyTo, preferencesVersion, attachments: clone(attachments) };
}
function createChat({ records, backend, network, preferences, contexts, getLanguage, pollMs = 100 }) {
  const active = new Map(); const errors = new Map(); const unsaved = new Map(); const listeners = new Set();
  records.subscribe((id) => { if (records.isDeleted(id)) { unsaved.delete(id); errors.delete(id); } });
  const recovery = createJobRecovery({ backend });
  const drafts = createChatDrafts({ records, notify });
  function notify(id) { listeners.forEach((listener) => { try { listener(id); } catch (_) { /* Page lifetime does not control persistence. */ } }); }
  function read(id) { const result = records.getRecord(id); if (!result.ok) throw { code: result.error }; return result.record; }
  function save(id, update, publish = true) { const result = records.updateRecord(id, update); if (!result.ok) throw { code: result.error }; if (publish) notify(id); return result.record; }
  function pendingMessage(record) { return (record.messages || []).find((message) => message.role === 'assistant' && ['sending', 'waiting', 'partial'].includes(message.state)); }
  function checked(record, job) {
    const target = job && job.target; const entry = target && record.chatRequests && record.chatRequests[target.assistantMessageId];
    const request = entry && entry.request;
    if (!request || job.kind !== 'chat' || job.contextId !== record.contextId || job.contextId !== request.contextId ||
      job.contextSnapshotVersion !== request.input.contextSnapshotVersion || target.userMessageId !== request.target.userMessageId ||
      target.assistantMessageId !== request.target.assistantMessageId || target.userMessageId === target.assistantMessageId ||
      typeof job.jobId !== 'string' || !job.jobId || !Number.isInteger(job.attempt) || job.attempt < 1 || !Number.isInteger(job.revision) || job.revision < 1 ||
      !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'].includes(job.state)) throw { code: 'DEPENDENCY_MISSING' };
    const user = (record.messages || []).find((message) => message.id === target.userMessageId && message.role === 'user');
    const assistant = (record.messages || []).find((message) => message.id === target.assistantMessageId && message.role === 'assistant');
    if (!user || !assistant || assistant.inReplyTo !== user.id || user.text !== request.input.text || entry.snapshot.recordId !== record.id) throw { code: 'DEPENDENCY_MISSING' };
    if (job.output !== null) {
      const output = job.output;
      if (!output || typeof output.text !== 'string' || output.contentLanguage !== request.input.targetLanguage ||
        typeof output.complete !== 'boolean' || !Array.isArray(output.attachments) || output.attachments.some((attachment) => {
          if (attachment.type === 'dish_reference') return !entry.snapshot.snapshot.cards.some((card) => card.id === attachment.cardId && card.recordId === record.id);
          if (attachment.type !== 'communication_card' || !attachment.card) return true;
          const card = attachment.card;
          return typeof card.title !== 'string' || !card.title || typeof card.textZh !== 'string' || !card.textZh ||
            !['dietary', 'service'].includes(card.category) || !LANGUAGES.some((language) => language.code === card.pairedLanguage) ||
            (card.pairedLanguage === 'zh-CN' ? card.pairedText !== null : typeof card.pairedText !== 'string' || !card.pairedText);
        })) throw { code: 'DEPENDENCY_MISSING' };
    }
    if (job.state === 'succeeded' && (!job.output || !job.output.complete)) throw { code: 'DEPENDENCY_MISSING' };
    return entry;
  }
  function apply(id, job, allowAssociation) {
    try {
      const record = read(id); checked(record, job);
      const key = job.target.assistantMessageId; const previous = record.chatJobs && record.chatJobs[key];
      if (!previous && job.attempt !== 1) return { ok: false, error: 'stale-job' };
      if ((!previous && !allowAssociation) || previous && (previous.jobId !== job.jobId || previous.attempt !== job.attempt || job.revision < previous.revision ||
        job.revision === previous.revision && previous.locallySavedRevision === job.revision)) return { ok: false, error: 'stale-job' };
      const waiting = unsaved.get(id);
      if (waiting && waiting.jobId === job.jobId && waiting !== job && (waiting.attempt !== job.attempt || job.revision <= waiting.revision)) return { ok: false, error: 'stale-job' };
      unsaved.set(id, clone(job));
      save(id, (draft) => {
        draft.chatJobs = Object.assign({}, draft.chatJobs, { [key]: Object.assign({}, clone(job), { locallySavedRevision: job.revision }) });
        const user = draft.messages.find((message) => message.id === job.target.userMessageId);
        const assistant = draft.messages.find((message) => message.id === key);
        user.state = 'complete';
        assistant.state = job.state === 'succeeded' ? 'complete' : ['failed', 'cancelled', 'expired'].includes(job.state) ? 'failed' : job.output ? 'partial' : 'waiting';
        assistant.jobId = job.jobId;
        if (job.output) Object.assign(assistant, { text: job.output.text, contentLanguage: job.output.contentLanguage, attachments: clone(job.output.attachments) });
      }, false);
      unsaved.delete(id); errors.delete(id); notify(id); return { ok: true, jobId: job.jobId };
    } catch (error) { const code = error.code || 'TEMPORARY_FAILURE'; errors.set(id, code); notify(id); return { ok: false, error: code }; }
  }
  async function poll(id, assistantId) {
    for (let count = 0; count < 300; count += 1) {
      const record = read(id); const job = record.chatJobs && record.chatJobs[assistantId];
      if (!job) return { ok: false, error: 'DEPENDENCY_MISSING' };
      if (!['queued', 'running'].includes(job.state)) return { ok: true, jobId: job.jobId };
      const result = apply(id, await backend.getJob(job.jobId), false);
      if (!result.ok && result.error !== 'stale-job') return result;
      if (['queued', 'running'].includes(read(id).chatJobs[assistantId].state)) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return { ok: true, pending: true };
  }
  function run(id, operation) {
    if (active.has(id)) return Promise.resolve({ ok: false, error: 'JOB_STATE_CONFLICT' });
    errors.delete(id);
    const work = Promise.resolve().then(operation).catch((error) => {
      const code = error.code || error.message || 'TEMPORARY_FAILURE'; errors.set(id, code); return { ok: false, error: code };
    }).finally(() => { active.delete(id); notify(id); });
    active.set(id, work); notify(id); return work;
  }
  function send(id, text, submittedDraft) {
    const language = getLanguage();
    if (typeof text !== 'string' || !text.trim() || !LANGUAGES.some((item) => item.code === language)) return Promise.resolve({ ok: false, error: 'INPUT_UNSUPPORTED' });
    return run(id, async () => {
      if (network) await network.requireOnline();
      if (!backend.enabled) throw { code: 'backend-unavailable' };
      if (pendingMessage(read(id))) throw { code: 'JOB_STATE_CONFLICT' };
      const assistantId = makeId('assistant'); const userId = makeId('user');
      const acceptance = await contexts.run(id, async () => {
        await contexts.publishPending(id);
        const record = read(id); const preferenceSnapshot = preferences.getSnapshot();
        const complete = (record.messages || []).filter((message) => message.role === 'assistant' && message.state === 'complete');
        const included = new Set(complete.flatMap((message) => [message.id, message.inReplyTo]));
        const snapshot = { purpose: 'record', recordId: id, localScopeId: id, snapshotVersion: record.contextSnapshotVersion + 1,
          snapshot: { images: record.images.map((image) => ({ imageId: image.id, kind: image.kind, order: image.order, assetId: image.assetId })),
            cards: clone(record.cards || []), messages: (record.messages || []).filter((message) => included.has(message.id)).map(messageSnapshot), preferences: preferenceSnapshot } };
        const request = { contextId: record.contextId, kind: 'chat', target: { userMessageId: userId, assistantMessageId: assistantId },
          input: { contextSnapshotVersion: snapshot.snapshotVersion, text: text.trim(), targetLanguage: language } };
        const requestId = makeId('chat');
        save(id, (draft) => {
          const common = { contentLanguage: language, preferencesVersion: preferenceSnapshot.version, attachments: [], state: 'sending' };
          draft.messages = (draft.messages || []).concat([{ ...common, id: userId, role: 'user', text: request.input.text, inReplyTo: null },
            { ...common, id: assistantId, role: 'assistant', text: '', inReplyTo: userId }]);
          draft.messageIds = draft.messages.map((message) => message.id);
          draft.chatRequests = Object.assign({}, draft.chatRequests, { [assistantId]: { requestId, request, snapshot } });
          draft.pendingContextSnapshot = snapshot;
          drafts.consume(draft, submittedDraft);
        });
        await contexts.publishPending(id);
        const job = await backend.createJob(request, requestId);
        const result = apply(id, job, true);
        return result.error === 'stale-job' ? { ok: true, jobId: job.jobId } : result;
      });
      return acceptance.ok ? poll(id, assistantId) : acceptance;
    });
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getState(id) {
      try {
        const record = read(id); const messages = clone(record.messages || []); const waiting = unsaved.get(id);
        if (waiting && waiting.output) {
          const message = messages.find((item) => item.id === waiting.target.assistantMessageId);
          if (message) Object.assign(message, waiting.output, { state: waiting.output.complete ? 'complete' : 'partial', unsaved: true });
        }
        return { ...drafts.read(id, record), record, messages, running: active.has(id) || !!pendingMessage(record), error: errors.get(id) || null,
          unsavedJob: waiting ? clone(waiting) : null, copy: getChatCopy(getLanguage()) };
      } catch (error) { return { ...drafts.read(id), record: null, messages: [], running: false, error: error.code, unsavedJob: null, copy: getChatCopy(getLanguage()) }; }
    },
    sendDraft(id) { const current = drafts.read(id); return current.draftError ? Promise.resolve({ ok: false, error: current.draftError }) : send(id, current.draft.text, current.draft); },
    editDraft: drafts.edit,
    clearDraft: drafts.clear,
    retryDraftSave: drafts.retry,
    send,
    sendQuickQuestion(id, questionId) {
      const question = getChatCopy(getLanguage()).questions.find((item) => item.id === questionId);
      return question ? send(id, question.text) : Promise.resolve({ ok: false, error: 'INPUT_UNSUPPORTED' });
    },
    applyJob: (id, job) => apply(id, job, false),
    acceptRecoveredJob: (id, job) => apply(id, job, true),
    retrySave(id) { const job = unsaved.get(id); return job ? apply(id, job, true) : { ok: true }; },
    refreshRecord(id) {
      if (active.has(id)) return active.get(id);
      let eligible;
      try {
        const record = read(id);
        eligible = Object.values(record.chatRequests || {}).filter((entry) => {
          const job = record.chatJobs && record.chatJobs[entry.request.target.assistantMessageId];
          return !job || ['queued', 'running'].includes(job.state) || job.locallySavedRevision !== job.revision;
        }).map((entry) => entry.request);
        if (!eligible.length) return Promise.resolve({ ok: true });
      }
      catch (error) { return Promise.resolve({ ok: false, error: error.code }); }
      return run(id, async () => {
        const recovered = await recovery.recover({ contextId: read(id).contextId, requests: eligible, apply: (job) => apply(id, job, true) });
        if (!recovered.ok) return recovered;
        const jobs = read(id).chatJobs || {};
        for (const key of Object.keys(jobs)) if (['queued', 'running'].includes(jobs[key].state)) {
          const result = await poll(id, key); if (!result.ok) return result;
        }
        return { ok: true };
      });
    }
  };
}
module.exports = { createChat };
