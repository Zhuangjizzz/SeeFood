const test = require('node:test');
const assert = require('node:assert/strict');
const { temporary, start, request, session, uploaded, finished } = require('./support/http-service');
async function ready(url, token, id = 'dietary-record') {
  const value = await uploaded(url, token, { id });
  const created = await request(url, 'POST', '/v1/jobs', value.body, token, id + '-cards');
  const cards = (await finished(url, token, created.body.jobId)).output.cards;
  const bound = structuredClone(value.bound); bound.snapshotVersion = 3; bound.snapshot.cards = cards;
  bound.snapshot.preferences = { version: 2, allergies: ['egg'], restrictions: [], tastes: [], notes: '[allergies]\nConfirm utensils.' };
  assert.equal((await request(url, 'PUT', '/v1/contexts/' + value.contextId, bound, token)).status, 200);
  const body = { contextId: value.contextId, kind: 'dietary_review', target: { cardIds: cards.map(card => card.id), preferencesVersion: 2 },
    input: { contextSnapshotVersion: 3, preferences: bound.snapshot.preferences, cards } };
  return { ...value, bound, cards, body };
}
test('dietary checks accept owner-bound frozen cards and preferences, and survive process restart without accepting altered input', async (t) => {
  const dir = temporary(t); let server = await start(t, dir, { SEEFOOD_WORKER_DELAY_MS: '500' });
  const token = await session(server.url); const other = await session(server.url, 'demo-owner-b'); const source = await ready(server.url, token);
  const accepted = await request(server.url, 'POST', '/v1/jobs', source.body, token, 'review-one');
  assert.equal(accepted.status, 202);
  assert.equal((await request(server.url, 'POST', '/v1/jobs', source.body, token, 'different-key')).body.jobId, accepted.body.jobId);
  assert.equal((await request(server.url, 'POST', '/v1/jobs', source.body, other, 'forbidden')).status, 403);
  for (const change of [body => body.input.cards[0].summary = 'Changed explanation', body => body.input.preferences.notes = 'Changed notes', body => body.target.preferencesVersion = 3, body => body.target.cardIds = ['unknown-card']]) {
    const bad = structuredClone(source.body); change(bad);
    assert.equal((await request(server.url, 'POST', '/v1/jobs', bad, token, 'bad-' + Math.random())).status, 409);
  }
  const newer = structuredClone(source.bound); newer.snapshotVersion = 4; newer.snapshot.preferences.version = 3; newer.snapshot.preferences.allergies = [];
  await request(server.url, 'PUT', '/v1/contexts/' + source.contextId, newer, token);
  await server.stop('SIGKILL'); server = await start(t, dir);
  const done = await finished(server.url, token, accepted.body.jobId);
  assert.equal(done.state, 'succeeded'); assert.equal(done.target.preferencesVersion, 2); assert.equal(done.contextSnapshotVersion, 3);
  assert.deepEqual(done.output.assessments.map(item => item.cardId), source.cards.map(card => card.id));
  assert.equal(done.output.assessments[0].preferencesVersion, 2); assert.equal(done.output.assessments[0].state, 'current');
  assert.ok(done.output.assessments[0].warnings.length); assert.ok(done.output.assessments[0].checkedAt);
  assert.equal((await request(server.url, 'GET', '/v1/jobs/' + done.jobId, undefined, other)).status, 403);
});
module.exports = { ready };

test('reordering dietary target and input card sets replays one job through the same or a different request key', async t => {
  const { createService } = await import('../server/service.ts');
  const { imageCardsHandler } = await import('../server/image-cards.ts');
  const normal = imageCardsHandler();
  const service = createService({ dataDir: temporary(t), enableDevSession: true, devIdentities: ['demo-owner-a'], jobHandlers: {
    image_cards: { ...normal, async generate(input) {
      const output = await normal.generate(input);
      return { cards: [...output.cards, { ...output.cards[0], id: output.cards[0].id + '-second', nameZh: '第二道固定样例' }] };
    } }
  } });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const url = `http://127.0.0.1:${service.server.address().port}`; const token = await session(url);
  const source = await ready(url, token); assert.equal(source.body.target.cardIds.length, 2);
  const accepted = await request(url, 'POST', '/v1/jobs', source.body, token, 'set-first');
  assert.equal(accepted.status, 202);
  const reordered = structuredClone(source.body); reordered.target.cardIds.reverse();
  for (const key of ['set-first', 'set-second']) {
    const replay = await request(url, 'POST', '/v1/jobs', reordered, token, key);
    assert.equal(replay.status, 202); assert.equal(replay.body.jobId, accepted.body.jobId);
  }
  reordered.input.cards.reverse();
  const replay = await request(url, 'POST', '/v1/jobs', reordered, token, 'set-third');
  assert.equal(replay.status, 202); assert.equal(replay.body.jobId, accepted.body.jobId);
  const changed = structuredClone(reordered); changed.input.cards[0].summary = 'A different meaning';
  assert.equal((await request(url, 'POST', '/v1/jobs', changed, token, 'set-fourth')).status, 409);
  const jobs = (await request(url, 'GET', `/v1/contexts/${source.contextId}/jobs`, undefined, token)).body.items;
  assert.equal(jobs.filter(job => job.kind === 'dietary_review').length, 1);
});

test('checks reject foreign known cards even when copied into a rewritten snapshot and reject unbound output card IDs or preference versions', async t => {
  const server = await start(t, temporary(t)); const token = await session(server.url); const other = await session(server.url, 'demo-owner-b');
  const own = await ready(server.url, token, 'owned'); const foreign = await ready(server.url, other, 'foreign'); const sibling = await ready(server.url, token, 'sibling');
  for (const [source, status] of [[foreign, 403], [sibling, 409]]) {
    const snapshot = structuredClone(own.bound); snapshot.snapshotVersion++;
    if (source === sibling) snapshot.snapshotVersion++;
    const card = { ...source.cards[0], recordId: 'owned', sourceImageIds: [own.bound.snapshot.images[0].imageId] };
    snapshot.snapshot.cards = [card];
    assert.equal((await request(server.url, 'PUT', '/v1/contexts/' + own.contextId, snapshot, token)).status, 200);
    const body = { ...own.body, target: { ...own.body.target, cardIds: [card.id] }, input: { ...own.body.input, contextSnapshotVersion: snapshot.snapshotVersion, cards: [card] } };
    assert.equal((await request(server.url, 'POST', '/v1/jobs', body, token, 'foreign-' + status)).status, status);
  }
  const { createService } = await import('../server/service.ts'); const { dietaryReviewHandler } = await import('../server/dietary-review.ts'); const { once } = require('node:events');
  for (const change of [output => output.assessments[0].cardId = 'foreign-card', output => output.assessments[0].preferencesVersion++, output => output.assessments.push(structuredClone(output.assessments[0]))]) {
    const normal = dietaryReviewHandler();
    const service = createService({ dataDir: temporary(t), enableDevSession: true, devIdentities: ['demo-owner-a'], jobHandlers: { dietary_review: { ...normal, async generate(input) { const output = await normal.generate(input); change(output); return output; } } } });
    service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening'); t.after(() => service.close());
    const url = `http://127.0.0.1:${service.server.address().port}`; const key = await session(url); const source = await ready(url, key);
    const accepted = await request(url, 'POST', '/v1/jobs', source.body, key, 'invalid-output');
    assert.equal(accepted.status, 202); const failed = await finished(url, key, accepted.body.jobId);
    assert.equal(failed.state, 'failed'); assert.equal(failed.output, null); assert.equal(failed.error.code, 'DEPENDENCY_MISSING');
  }
});
