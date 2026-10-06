const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { temporary, start, session, uploaded, request, finished } = require('./support/http-service');
const Ajv = require('ajv/dist/2020'); const formats = require('ajv-formats'); const ajv = new Ajv({ strict: false }); formats(ajv);
ajv.addSchema({ $id: 'cleanup', components: require('../docs/technical/openapi.json').components });
async function api(url, token, method, route) {
  const response = await fetch(url + route, { method, headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  const valid = ajv.getSchema(`cleanup#/components/schemas/${response.status >= 400 ? 'Error' : 'Cleanup'}`);
  assert.equal(valid(body), true, JSON.stringify(valid.errors)); return { status: response.status, body };
}
async function cleaned(url, token, id) {
  for (let count = 0; count < 150; count++) { const result = await api(url, token, 'GET', `/v1/cleanups/${id}`); if (result.body.state === 'succeeded') return result.body; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail('cleanup never completed');
}
test('owner-bound deletion rejects late mutations, removes actual original and translated artifacts, and remains idempotent after process restart', async (t) => {
  const directory = temporary(t); let server = await start(t, directory); const token = await session(server.url); const foreign = await session(server.url, 'demo-owner-b');
  const setup = await uploaded(server.url, token);
  const cards = (await request(server.url, 'POST', '/v1/jobs', setup.body, token, 'cards')).body;
  await finished(server.url, token, cards.jobId);
  const translatedBody = structuredClone(setup.body); translatedBody.kind = 'image_translation'; delete translatedBody.input.inputKind;
  const translation = (await request(server.url, 'POST', '/v1/jobs', translatedBody, token, 'translation')).body;
  const translated = await finished(server.url, token, translation.jobId); const artifactUrl = translated.output.artifact.remoteUrl;
  assert.ok(fs.readdirSync(path.join(directory, 'images')).length); assert.ok(fs.readdirSync(path.join(directory, 'translations')).length);
  assert.equal((await api(server.url, foreign, 'DELETE', `/v1/contexts/${setup.contextId}`)).status, 403);
  const deletion = await api(server.url, token, 'DELETE', `/v1/contexts/${setup.contextId}`); assert.equal(deletion.status, 202);
  assert.equal((await api(server.url, foreign, 'GET', `/v1/cleanups/${deletion.body.cleanupId}`)).status, 403);
  assert.equal((await request(server.url, 'PUT', `/v1/contexts/${setup.contextId}`, setup.bound, token)).body.code, 'CONTEXT_DELETED');
  assert.ok([404, 410].includes((await request(server.url, 'POST', `/v1/uploads/${setup.asset.uploadId}/complete`, { contextId: setup.contextId, imageId: setup.body.target.imageId }, token, 'late-complete')).status));
  assert.equal((await request(server.url, 'POST', '/v1/jobs', setup.body, token, 'late-cards')).body.code, 'CONTEXT_DELETED');
  await cleaned(server.url, token, deletion.body.cleanupId);
  assert.deepEqual(fs.readdirSync(path.join(directory, 'images')), []); assert.deepEqual(fs.readdirSync(path.join(directory, 'translations')), []);
  assert.ok([404, 410].includes((await fetch(artifactUrl, { headers: { Authorization: `Bearer ${token}` } })).status));
  assert.equal((await api(server.url, token, 'DELETE', `/v1/contexts/${setup.contextId}`)).body.cleanupId, deletion.body.cleanupId);
  await server.stop('SIGKILL'); server = await start(t, directory);
  assert.equal((await api(server.url, token, 'DELETE', `/v1/contexts/${setup.contextId}`)).body.cleanupId, deletion.body.cleanupId);
  assert.equal((await request(server.url, 'PUT', `/v1/contexts/${setup.contextId}`, setup.bound, token)).body.code, 'CONTEXT_DELETED');
  assert.equal((await api(server.url, token, 'DELETE', '/v1/contexts/never-created')).status, 404);
});

test('a running translation finishes after deletion without publishing files or making the record context usable again', async (t) => {
  const directory = temporary(t); const server = await start(t, directory, { SEEFOOD_TRANSLATION_DELAY_MS: '400' }); const token = await session(server.url);
  const setup = await uploaded(server.url, token);
  const body = structuredClone(setup.body); body.kind = 'image_translation'; delete body.input.inputKind;
  const created = (await request(server.url, 'POST', '/v1/jobs', body, token, 'slow-translation')).body;
  let running = false;
  for (let i = 0; i < 100; i++) { const job = (await request(server.url, 'GET', `/v1/jobs/${created.jobId}`, undefined, token)).body; if (job.state === 'running') { running = true; break; } await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.equal(running, true);
  const deletion = await api(server.url, token, 'DELETE', `/v1/contexts/${setup.contextId}`);
  await cleaned(server.url, token, deletion.body.cleanupId);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.deepEqual(fs.readdirSync(path.join(directory, 'translations')), []);
  assert.ok([404, 410].includes((await request(server.url, 'GET', `/v1/jobs/${created.jobId}`, undefined, token)).status));
  assert.equal((await request(server.url, 'PUT', `/v1/contexts/${setup.contextId}`, setup.bound, token)).body.code, 'CONTEXT_DELETED');
});

test('bytes still arriving during deletion cannot complete an upload or persist an orphan file', async (t) => {
  const directory = temporary(t); const server = await start(t, directory); const token = await session(server.url);
  const setup = await uploaded(server.url, token); const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/menu-photo.png'));
  const ticket = (await request(server.url, 'POST', '/v1/uploads', { contextId: setup.contextId, imageId: setup.body.target.imageId, kind: 'menu', mimeType: 'image/png', sizeBytes: bytes.length }, token, 'late-upload')).body;
  const http = require('node:http'); let firstSent;
  const sent = new Promise((resolve) => { firstSent = resolve; });
  let req;
  const delivered = new Promise((resolve, reject) => {
    req = http.request(ticket.uploadUrl, { method: 'PUT', headers: ticket.uploadHeaders }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject); req.write(bytes.subarray(0, 100), firstSent);
  });
  await sent;
  const deletion = await api(server.url, token, 'DELETE', `/v1/contexts/${setup.contextId}`);
  req.end(bytes.subarray(100));
  assert.ok([404, 410].includes(await delivered));
  await cleaned(server.url, token, deletion.body.cleanupId);
  assert.deepEqual(fs.readdirSync(path.join(directory, 'images')), []);
});

test('a real filesystem cleanup failure keeps the deletion fence and a repeated delete retries the same cleanup identity', async (t) => {
  const directory = temporary(t); const server = await start(t, directory); const token = await session(server.url);
  const setup = await uploaded(server.url, token);
  const image = path.join(directory, 'images', fs.readdirSync(path.join(directory, 'images'))[0]);
  fs.unlinkSync(image); fs.mkdirSync(image); // External filesystem boundary rejects unlink with EISDIR.
  const first = await api(server.url, token, 'DELETE', `/v1/contexts/${setup.contextId}`);
  let failed;
  for (let i = 0; i < 100; i++) { const result = await api(server.url, token, 'GET', `/v1/cleanups/${first.body.cleanupId}`); if (result.body.state === 'failed') { failed = result.body; break; } await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.equal(failed.state, 'failed'); assert.equal(failed.error.retryable, true);
  assert.equal((await request(server.url, 'PUT', `/v1/contexts/${setup.contextId}`, setup.bound, token)).body.code, 'CONTEXT_DELETED');
  fs.rmdirSync(image);
  const retry = await api(server.url, token, 'DELETE', `/v1/contexts/${setup.contextId}`);
  assert.equal(retry.body.cleanupId, first.body.cleanupId); await cleaned(server.url, token, first.body.cleanupId);
});
