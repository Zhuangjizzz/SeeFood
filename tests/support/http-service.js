const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const schema = new Ajv2020({ strict: false }); addFormats(schema);
schema.addSchema({ $id: 'jobs-contract', components: require('../../docs/technical/openapi.json').components });
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seefood-jobs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory;
}
async function start(t, directory, env = {}) {
  const child = spawn(process.execPath, ['server/start.ts'], { cwd: path.join(__dirname, '../..'), env: { ...process.env,
    SEEFOOD_DATA_DIR: directory, SEEFOOD_DEV_IDENTITY: '1', SEEFOOD_DEV_IDENTITIES: 'demo-owner-a,demo-owner-b', PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', (bytes) => { errors += bytes; });
  const url = await new Promise((resolve, reject) => {
    let output = ''; child.stdout.on('data', (bytes) => { output += bytes; if (output.includes('\n')) resolve(JSON.parse(output.split('\n')[0]).url); });
    child.once('exit', () => reject(new Error(errors || 'server exited')));
  });
  async function stop(signal = 'SIGTERM') { if (child.exitCode !== null || child.signalCode) return; child.kill(signal); await once(child, 'exit'); }
  t.after(() => stop()); return { url, stop };
}
async function request(url, method, route, body, token, key) {
  const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`; if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(url + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  const name = response.status >= 400 ? 'Error' : route === '/v1/dev/session' ? 'Session' : route === '/v1/uploads' ? 'UploadTicket' : route.endsWith('/complete') ? 'UploadedAsset' : route.includes('/jobs') ? (method === 'GET' && route.includes('/contexts/') ? 'JobList' : 'Job') : 'Context';
  const valid = schema.getSchema(`jobs-contract#/components/schemas/${name}`); assert.equal(valid(value), true, JSON.stringify(valid.errors));
  return { status: response.status, body: value };
}
async function session(url, identity = 'demo-owner-a') { return (await request(url, 'POST', '/v1/dev/session', { identity })).body.accessToken; }
async function uploaded(url, token, { id = 'real-record', imageId = 'real-image', kind = 'menu' } = {}) {
  const contextId = `${id}-context`;
  const pending = { purpose: 'record', recordId: id, localScopeId: id, snapshotVersion: 1, snapshot: {
    images: [{ imageId, kind, order: 0, assetId: null }], cards: [], messages: [], preferences: { version: 1, allergies: [], restrictions: [], tastes: [], notes: '' } } };
  await request(url, 'PUT', `/v1/contexts/${contextId}`, pending, token);
  const bytes = fs.readFileSync(path.join(__dirname, '../fixtures/menu-photo.png'));
  const ticket = (await request(url, 'POST', '/v1/uploads', { contextId, imageId, kind, mimeType: 'image/png', sizeBytes: bytes.length }, token, `${id}-upload`)).body;
  assert.equal((await fetch(ticket.uploadUrl, { method: ticket.uploadMethod, headers: ticket.uploadHeaders, body: bytes })).status, 204);
  const asset = (await request(url, 'POST', `/v1/uploads/${ticket.uploadId}/complete`, { contextId, imageId }, token, `${id}-complete`)).body;
  const bound = structuredClone(pending); bound.snapshotVersion = 2; bound.snapshot.images[0].assetId = asset.assetId;
  await request(url, 'PUT', `/v1/contexts/${contextId}`, bound, token);
  const body = { contextId, kind: 'image_cards', target: { imageId }, input: { contextSnapshotVersion: 2, assetId: asset.assetId, inputKind: kind, targetLanguage: 'en' } };
  return { body, bound, asset, contextId };
}
async function finished(url, token, id) {
  for (let i = 0; i < 200; i += 1) {
    const job = (await request(url, 'GET', `/v1/jobs/${id}`, undefined, token)).body;
    if (!['queued', 'running'].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('job did not finish');
}
module.exports = { temporary, start, request, session, uploaded, finished };
