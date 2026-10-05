const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const openapi = require('../docs/technical/openapi.json');
const schemas = new Ajv2020({ strict: false }); addFormats(schemas);
schemas.addSchema({ $id: 'contract', components: openapi.components });

async function start(t, directory, enabled = true) {
  const child = spawn(process.execPath, ['server/start.ts'], { cwd: path.join(__dirname, '..'),
    env: { ...process.env, SEEFOOD_DATA_DIR: directory, PORT: '0', SEEFOOD_DEV_IDENTITY: enabled ? '1' : '0', SEEFOOD_DEV_IDENTITIES: 'demo-owner-a,demo-owner-b' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('\n')) { try { resolve(JSON.parse(output.split('\n')[0]).url); } catch (error) { reject(error); } }
    });
    child.on('exit', () => reject(new Error(stderr || 'server exited before listening')));
  });
  async function stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); }
  t.after(stop);
  return { url, stop };
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seefood-http-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
async function request(url, method, route, body, token, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(url + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const parsed = await response.json();
  const name = response.status >= 400 ? 'Error' : route === '/v1/dev/session' ? 'Session' : route === '/v1/uploads' ? 'UploadTicket' : route.endsWith('/complete') ? 'UploadedAsset' : 'Context';
  const valid = schemas.getSchema(`contract#/components/schemas/${name}`);
  assert.equal(valid(parsed), true, JSON.stringify(valid.errors));
  return { status: response.status, body: parsed };
}
async function session(url, identity = 'demo-owner-a') {
  const result = await request(url, 'POST', '/v1/dev/session', { identity });
  assert.equal(result.status, 200);
  assert.equal(typeof result.body.accessToken, 'string');
  return result.body.accessToken;
}

test('development sessions require explicit configuration and a configured identity', async (t) => {
  const disabled = await start(t, temporary(t), false);
  assert.equal((await request(disabled.url, 'POST', '/v1/dev/session', { identity: 'demo-owner-a' })).status, 404);
  const enabled = await start(t, temporary(t));
  const a = await session(enabled.url);
  const b = await session(enabled.url, 'demo-owner-b');
  assert.notEqual(a, b);
  assert.equal((await request(enabled.url, 'POST', '/v1/dev/session', { identity: 'unconfigured' })).status, 403);
  assert.equal((await request(enabled.url, 'POST', '/v1/dev/session', { identity: 'demo-owner-a', owner: 'forged' })).status, 400);
});

function context(version = 1, images = [{ imageId: 'image-one', kind: 'menu', order: 0, assetId: null }]) {
  return { purpose: 'record', localScopeId: 'record-one', recordId: 'record-one', snapshotVersion: version,
    snapshot: { images, cards: [], messages: [], preferences: { version: 1, allergies: [], restrictions: [], tastes: [], notes: '' } } };
}
test('context versions persist across a real service restart, remain immutable and reject another owner', async (t) => {
  const directory = temporary(t);
  const first = await start(t, directory);
  const a = await session(first.url);
  const b = await session(first.url, 'demo-owner-b');
  const route = '/v1/contexts/context-one';
  const original = await request(first.url, 'PUT', route, context(), a);
  assert.equal(original.status, 200);
  assert.equal(original.body.snapshotVersion, 1);
  assert.equal((await request(first.url, 'PUT', route, context(), b)).status, 403);
  assert.equal((await request(first.url, 'PUT', route, context())).status, 401);
  assert.equal((await request(first.url, 'PUT', route, { ...context(), owner: 'demo-owner-b' }, a)).status, 400);
  assert.equal((await request(first.url, 'PUT', '/v1/contexts/bad-scope', { ...context(), localScopeId: 'other' }, a)).status, 400);
  const changed = context(); changed.snapshot.preferences.notes = 'changed';
  assert.equal((await request(first.url, 'PUT', route, changed, a)).body.code, 'SNAPSHOT_CONFLICT');
  assert.equal((await request(first.url, 'PUT', route, context(2), a)).status, 200);
  await first.stop();
  const restarted = await start(t, directory);
  assert.deepEqual(await request(restarted.url, 'PUT', route, context(), a), original);
  assert.equal((await request(restarted.url, 'PUT', route, changed, a)).status, 409);
  assert.equal((await request(restarted.url, 'PUT', route, { ...context(3), recordId: 'different', localScopeId: 'different' }, a)).status, 409);
});

test('real image bytes survive restart and completion returns one asset without starting generation or changing old snapshots', async (t) => {
  const directory = temporary(t);
  const service = await start(t, directory);
  const a = await session(service.url);
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/menu-photo.png'));
  await request(service.url, 'PUT', '/v1/contexts/context-one', context(), a);
  const uploadBody = { contextId: 'context-one', imageId: 'image-one', kind: 'menu', mimeType: 'image/png', sizeBytes: bytes.length };
  const ticket = await request(service.url, 'POST', '/v1/uploads', uploadBody, a, 'ticket-one');
  assert.equal(ticket.status, 201);
  assert.equal(ticket.body.uploadMethod, 'PUT');
  assert.equal(Object.keys(ticket.body.uploadHeaders).some((key) => key.toLowerCase() === 'authorization'), false);
  const completeRoute = `/v1/uploads/${ticket.body.uploadId}/complete`;
  const completion = { contextId: 'context-one', imageId: 'image-one' };
  assert.equal((await request(service.url, 'POST', completeRoute, completion, a, 'complete-one')).body.code, 'UPLOAD_INCOMPLETE');
  const uploaded = await fetch(ticket.body.uploadUrl, { method: ticket.body.uploadMethod, headers: ticket.body.uploadHeaders, body: bytes });
  assert.equal(uploaded.status, 204);
  await service.stop();
  const restarted = await start(t, directory);
  const asset = await request(restarted.url, 'POST', completeRoute, completion, a, 'complete-one');
  assert.equal(asset.status, 200);
  assert.equal(asset.body.contextId, 'context-one');
  assert.equal(asset.body.imageId, 'image-one');
  assert.equal(typeof asset.body.assetId, 'string');
  assert.deepEqual(await request(restarted.url, 'POST', completeRoute, completion, a, 'complete-one'), asset);
  assert.deepEqual(await request(restarted.url, 'POST', completeRoute, completion, a, 'complete-new-key'), asset);
  assert.deepEqual(await request(restarted.url, 'POST', '/v1/uploads', uploadBody, a, 'ticket-one'), ticket);
  const diskFiles = fs.readdirSync(path.join(directory, 'images'));
  assert.equal(diskFiles.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'images', diskFiles[0])), bytes);
  const bound = context(2); bound.snapshot.images[0].assetId = asset.body.assetId;
  assert.equal((await request(restarted.url, 'PUT', '/v1/contexts/context-one', bound, a)).status, 200);
  const original = await request(restarted.url, 'PUT', '/v1/contexts/context-one', context(), a);
  assert.equal(original.body.snapshotVersion, 1);
  assert.deepEqual(Object.keys(asset.body).sort(), ['assetId', 'contextId', 'imageId', 'uploadId']);
});

test('assets and upload operations enforce owner, context, image and kind associations', async (t) => {
  const service = await start(t, temporary(t));
  const a = await session(service.url); const b = await session(service.url, 'demo-owner-b');
  await request(service.url, 'PUT', '/v1/contexts/context-one', context(), a);
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/menu-photo.png'));
  const input = { contextId: 'context-one', imageId: 'image-one', kind: 'menu', mimeType: 'image/png', sizeBytes: bytes.length };
  assert.equal((await request(service.url, 'POST', '/v1/uploads', input, b, 'foreign')).status, 403);
  assert.equal((await request(service.url, 'POST', '/v1/uploads', { ...input, kind: 'dish' }, a, 'wrong-kind')).body.code, 'DEPENDENCY_MISSING');
  assert.equal((await request(service.url, 'POST', '/v1/uploads', { ...input, imageId: 'not-in-snapshot' }, a, 'wrong-image')).status, 409);
  const ticket = (await request(service.url, 'POST', '/v1/uploads', input, a, 'ticket')).body;
  const route = `/v1/uploads/${ticket.uploadId}/complete`;
  const complete = { contextId: 'context-one', imageId: 'image-one' };
  assert.equal((await request(service.url, 'POST', route, complete, b, 'foreign')).status, 403);
  assert.equal((await fetch(ticket.uploadUrl, { method: 'PUT', headers: { ...ticket.uploadHeaders, Authorization: `Bearer ${a}` }, body: bytes })).status, 403);
  assert.equal((await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.uploadHeaders, body: bytes })).status, 204);
  const asset = (await request(service.url, 'POST', route, complete, a, 'complete')).body;
  const bound = context(2); bound.snapshot.images[0].assetId = asset.assetId;
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/context-foreign', bound, b)).status, 403);
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/context-other', bound, a)).status, 409);
  const wrongImage = context(2, [{ imageId: 'wrong-image', kind: 'menu', order: 0, assetId: asset.assetId }]);
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/context-one', wrongImage, a)).status, 409);
  const wrongKind = context(2, [{ imageId: 'image-one', kind: 'dish', order: 0, assetId: asset.assetId }]);
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/context-one', wrongKind, a)).status, 409);
  const missing = context(2); missing.snapshot.images[0].assetId = 'missing-asset';
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/context-one', missing, a)).status, 409);
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/context-one', bound, a)).status, 200);
});

test('idempotency conflicts stay conflicts and duplicate raw-byte or completion requests cannot replace an asset', async (t) => {
  const service = await start(t, temporary(t)); const a = await session(service.url);
  await request(service.url, 'PUT', '/v1/contexts/context-one', context(), a);
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/menu-photo.png'));
  const input = { contextId: 'context-one', imageId: 'image-one', kind: 'menu', mimeType: 'image/png', sizeBytes: bytes.length };
  const ticket = (await request(service.url, 'POST', '/v1/uploads', input, a, 'ticket')).body;
  assert.equal((await request(service.url, 'POST', '/v1/uploads', { ...input, sizeBytes: bytes.length + 1 }, a, 'ticket')).body.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await request(service.url, 'POST', '/v1/uploads', input, a)).status, 400);
  const raw = { method: 'PUT', headers: ticket.uploadHeaders, body: bytes };
  assert.deepEqual(await Promise.all([fetch(ticket.uploadUrl, raw), fetch(ticket.uploadUrl, raw)]).then((values) => values.map((v) => v.status)), [204, 204]);
  const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  assert.equal((await fetch(ticket.uploadUrl, { ...raw, body: changed })).status, 409);
  const route = `/v1/uploads/${ticket.uploadId}/complete`;
  const complete = { contextId: 'context-one', imageId: 'image-one' };
  const both = await Promise.all([request(service.url, 'POST', route, complete, a, 'complete'), request(service.url, 'POST', route, complete, a, 'complete')]);
  assert.equal(both[0].status, 200); assert.deepEqual(both[0], both[1]);
  assert.equal((await request(service.url, 'POST', route, { ...complete, imageId: 'other' }, a, 'complete')).body.code, 'IDEMPOTENCY_CONFLICT');
});

test('a snapshot cannot contain duplicate image identities or orders', async (t) => {
  const service = await start(t, temporary(t)); const a = await session(service.url);
  const duplicate = context(1, [{ imageId: 'image-one', kind: 'menu', order: 0, assetId: null }, { imageId: 'image-one', kind: 'menu', order: 1, assetId: null }]);
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/duplicate-image', duplicate, a)).status, 400);
  const order = context(1, [{ imageId: 'image-one', kind: 'menu', order: 0, assetId: null }, { imageId: 'image-two', kind: 'menu', order: 0, assetId: null }]);
  assert.equal((await request(service.url, 'PUT', '/v1/contexts/duplicate-order', order, a)).status, 400);
});

test('completion rejects corrupt, truncated, mismatched-format and missing image files', async (t) => {
  const directory = temporary(t); const service = await start(t, directory); const a = await session(service.url);
  const png = fs.readFileSync(path.join(__dirname, 'fixtures/menu-photo.png'));
  for (const [index, bytes, mimeType] of [[1, Buffer.from('not an image'), 'image/png'], [2, png.subarray(0, 100), 'image/png'], [3, png, 'image/jpeg']]) {
    const id = `invalid-${index}`;
    await request(service.url, 'PUT', `/v1/contexts/${id}`, context(), a);
    const ticket = (await request(service.url, 'POST', '/v1/uploads', { contextId: id, imageId: 'image-one', kind: 'menu', mimeType, sizeBytes: bytes.length }, a, id)).body;
    assert.equal((await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.uploadHeaders, body: bytes })).status, 204);
    const result = await request(service.url, 'POST', `/v1/uploads/${ticket.uploadId}/complete`, { contextId: id, imageId: 'image-one' }, a, id);
    assert.equal(result.status, 400); assert.equal(result.body.code, 'INPUT_UNSUPPORTED');
  }
  await request(service.url, 'PUT', '/v1/contexts/missing', context(), a);
  const ticket = (await request(service.url, 'POST', '/v1/uploads', { contextId: 'missing', imageId: 'image-one', kind: 'menu', mimeType: 'image/png', sizeBytes: png.length }, a, 'missing')).body;
  assert.equal((await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.uploadHeaders, body: png.subarray(0, 100) })).status, 409);
  assert.equal((await request(service.url, 'POST', `/v1/uploads/${ticket.uploadId}/complete`, { contextId: 'missing', imageId: 'image-one' }, a, 'complete')).status, 409);
  assert.equal((await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.uploadHeaders, body: png })).status, 204);
  fs.rmSync(path.join(directory, 'images'), { recursive: true });
  assert.equal((await request(service.url, 'POST', `/v1/uploads/${ticket.uploadId}/complete`, { contextId: 'missing', imageId: 'image-one' }, a, 'complete')).body.code, 'UPLOAD_INCOMPLETE');
});
