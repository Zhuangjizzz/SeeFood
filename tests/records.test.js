const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');

async function confirmedBatch(materials, language = 'ja', mode = 'menu') {
  const capture = createCapture({ media: { chooseImages: async () => materials }, getLanguage: () => language });
  capture.chooseMode(mode);
  await capture.chooseImages({ source: 'album' });
  return capture.confirm().batch;
}

test('confirmed final materials reopen after client recreation with real original files and stable request associations', async (t) => {
  const disk = recordPlatform(t);
  const photo = disk.material('menu-photo.png');
  const screenshot = disk.material('menu-screenshot.png');
  const long = disk.material('menu-long.png');
  const capture = createCapture({ media: { chooseImages: async () => [photo, screenshot, long] }, getLanguage: () => 'ja' });
  await capture.chooseImages({ source: 'album' });
  const inputs = capture.getState().images;
  capture.removeImage(inputs[1].id);
  capture.moveImage(inputs[2].id, 0);
  const batch = capture.confirm().batch;
  const services = createWechatServices(disk.platform);
  const confirmation = await services.records.confirmCapture(batch);
  assert.equal(confirmation.ok, true);
  const initial = services.records.getRecord(confirmation.recordId).record;
  assert.equal(initial.saveState, 'saved');
  assert.deepEqual(initial.images.map((item) => [item.id, item.kind, item.order, item.targetLanguage]), [
    [inputs[2].id, 'menu', 0, 'ja'], [inputs[0].id, 'menu', 1, 'ja']
  ]);
  assert.equal(initial.requestId.length > 0, true);
  assert.equal(initial.contextId.length > 0, true);
  assert.equal(initial.contextSnapshotVersion, 0);
  for (const image of initial.images) {
    assert.equal(image.recordId, initial.id);
    assert.equal(image.uploadState, 'pending');
    assert.equal(image.assetId, null);
    assert.equal(image.original.saveState, 'saved');
    assert.equal(image.localOriginalPath, image.original.localPath);
    assert.equal(image.requests.upload.length > 0, true);
    assert.equal(image.requests.complete.length > 0, true);
    assert.equal(image.stageJobs.image_cards, null);
    assert.equal(image.stageJobs.image_translation, null);
  }
  const expected = [fs.readFileSync(long.localPath), fs.readFileSync(photo.localPath)];
  [photo, screenshot, long].forEach((item) => fs.unlinkSync(item.localPath));
  capture.cancel();
  const reopened = createWechatServices(disk.platform).records.getRecord(initial.id);
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.record, initial);
  reopened.record.images.forEach((image, index) => assert.deepEqual(fs.readFileSync(image.localOriginalPath), expected[index]));
  assert.equal(createWechatServices(disk.platform).records.listRecent().records[0].id, initial.id);
});

test('new capture confirmations create independent records while replay keeps the original association and recent list stays bounded', async (t) => {
  const disk = recordPlatform(t);
  const photo = disk.material('menu-photo.png');
  const services = createWechatServices(disk.platform);
  const batches = [];
  const ids = [];
  for (let index = 0; index < 4; index += 1) {
    const batch = await confirmedBatch([photo], index === 0 ? 'ja' : 'en', index === 0 ? 'dish' : 'menu');
    batches.push(batch);
    ids.push((await services.records.confirmCapture(batch)).recordId);
  }
  const original = services.records.getRecord(ids[0]).record;
  const replay = await createWechatServices(disk.platform).records.confirmCapture(batches[0]);
  assert.deepEqual(replay, { ok: true, recordId: ids[0] });
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(services.records.getRecord(ids[0]).record, original);
  assert.equal(original.images[0].kind, 'dish');
  assert.equal(original.images[0].targetLanguage, 'ja');
  assert.equal(new Set(ids.map((id) => services.records.getRecord(id).record.contextId)).size, 4);
  const recent = services.records.listRecent().records;
  assert.deepEqual(recent.map((item) => item.id), ids.slice(1).reverse());
  assert.equal(new Set(recent.map((item) => item.images[0].localOriginalPath)).size, 3);
  recent[0].images[0].targetLanguage = 'ko';
  assert.equal(services.records.getRecord(ids[3]).record.images[0].targetLanguage, 'en');
});

test('an original-file write failure keeps confirmed input and stable IDs for explicit save retry', async (t) => {
  const disk = recordPlatform(t);
  const materials = [disk.material('menu-photo.png'), disk.material('menu-long.png')];
  const services = createWechatServices(disk.platform);
  const batch = await confirmedBatch(materials, 'es');
  const copy = disk.fileSystem.copyFile;
  disk.fileSystem.copyFile = (options) => options.fail(new Error('ENOSPC: no space left'));
  const failed = await services.records.confirmCapture(batch);
  assert.deepEqual(failed, { ok: false, error: 'original-write', batchId: batch.id });
  const pending = services.records.getSubmission(batch.id);
  assert.equal(pending.saveState, 'failed');
  assert.equal(pending.error, 'original-write');
  assert.deepEqual(pending.batch, batch);
  assert.equal(pending.record.images[0].original.saveState, 'failed');
  assert.equal(services.records.getRecord(pending.record.id).ok, false);
  assert.deepEqual(createWechatServices(disk.platform).records.listRecent().records, []);
  assert.equal(materials.every((item) => fs.existsSync(item.localPath)), true);
  disk.fileSystem.copyFile = copy;
  const retry = await services.records.retrySave(batch.id);
  assert.deepEqual(retry, { ok: true, recordId: pending.record.id });
  const saved = createWechatServices(disk.platform).records.getRecord(retry.recordId).record;
  assert.equal(saved.requestId, pending.record.requestId);
  assert.equal(saved.contextId, pending.record.contextId);
  assert.deepEqual(saved.images.map((image) => image.requests), pending.record.images.map((image) => image.requests));
  assert.deepEqual(saved.images.map((image) => image.original.saveState), ['saved', 'saved']);
  assert.equal(services.records.getSubmission(batch.id).saveState, 'saved');
});

test('metadata failure never advertises a recoverable record or evicts history, and retry can reuse the original copies', async (t) => {
  const disk = recordPlatform(t);
  const photo = disk.material('menu-photo.png');
  const services = createWechatServices(disk.platform);
  const oldId = (await services.records.confirmCapture(await confirmedBatch([photo]))).recordId;
  const oldRecord = services.records.getRecord(oldId).record;
  const batch = await confirmedBatch([disk.material('menu-screenshot.png')]);
  const write = disk.storage.set;
  disk.storage.set = () => { throw new Error('storage quota exceeded'); };
  assert.deepEqual(await services.records.confirmCapture(batch), { ok: false, error: 'storage-write', batchId: batch.id });
  const failed = services.records.getSubmission(batch.id);
  assert.equal(failed.saveState, 'failed');
  assert.equal(failed.record.saveState, 'failed');
  assert.equal(failed.record.images[0].original.saveState, 'saved');
  assert.deepEqual(createWechatServices(disk.platform).records.listRecent().records, [oldRecord]);
  assert.deepEqual(services.records.getRecord(failed.record.id), { ok: false, error: 'record-missing' });
  fs.unlinkSync(batch.images[0].localPath);
  disk.storage.set = write;
  assert.deepEqual(await services.records.retrySave(batch.id), { ok: true, recordId: failed.record.id });
  const restored = createWechatServices(disk.platform).records;
  assert.equal(restored.getRecord(failed.record.id).record.requestId, failed.record.requestId);
  assert.deepEqual(restored.getRecord(oldId).record, oldRecord);
  assert.equal(restored.listRecent().records.length, 2);
});

test('an unreadable history is reported and never replaced by a new confirmation', async (t) => {
  const disk = recordPlatform(t);
  const batch = await confirmedBatch([disk.material('menu-photo.png')]);
  const services = createWechatServices(disk.platform);
  const oldId = (await services.records.confirmCapture(await confirmedBatch([disk.material('menu-long.png')]))).recordId;
  const read = disk.storage.get;
  disk.storage.get = (key) => key.endsWith(':records') ? { schema: 1, value: { damaged: true } } : read(key);
  assert.deepEqual(services.records.listRecent(), { ok: false, error: 'storage-read', records: [] });
  assert.deepEqual(services.records.getRecord(oldId), { ok: false, error: 'storage-read' });
  assert.deepEqual(await services.records.confirmCapture(batch), { ok: false, error: 'storage-read', batchId: batch.id });
  assert.equal(services.records.getSubmission(batch.id).saveState, 'failed');
  disk.storage.get = read;
  assert.deepEqual(createWechatServices(disk.platform).records.listRecent().records.map((item) => item.id), [oldId]);
  assert.equal((await services.records.retrySave(batch.id)).ok, true);
});

test('confirming or retrying while a save is pending produces one durable record and exposes saving until completion', async (t) => {
  const disk = recordPlatform(t);
  const services = createWechatServices(disk.platform);
  const batch = await confirmedBatch([disk.material('menu-photo.png')]);
  const copy = disk.fileSystem.copyFile;
  const pendingCopies = [];
  disk.fileSystem.copyFile = (options) => pendingCopies.push(options);
  const first = services.records.confirmCapture(batch);
  const again = services.records.confirmCapture(batch);
  const retry = services.records.retrySave(batch.id);
  const during = services.records.getSubmission(batch.id);
  assert.equal(during.saveState, 'saving');
  assert.equal(services.records.getRecord(during.record.id).ok, false);
  pendingCopies.forEach(copy);
  const results = await Promise.all([first, again, retry]);
  assert.deepEqual(results.map((item) => item.recordId), [during.record.id, during.record.id, during.record.id]);
  assert.equal(createWechatServices(disk.platform).records.listRecent().records.length, 1);
});

test('invalid or conflicting capture submissions cannot create or overwrite a saved record', async (t) => {
  const disk = recordPlatform(t);
  const services = createWechatServices(disk.platform);
  const batch = await confirmedBatch([disk.material('menu-photo.png')]);
  const saved = await services.records.confirmCapture(batch);
  const original = services.records.getRecord(saved.recordId).record;
  const conflict = await services.records.confirmCapture({ ...batch, targetLanguage: 'ko' });
  assert.deepEqual(conflict, { ok: false, error: 'capture-conflict', batchId: batch.id });
  for (const invalid of [null, { ...batch, id: 'empty', images: [] },
    { ...batch, id: 'bad-order', images: [{ ...batch.images[0], order: 4 }] },
    { ...batch, id: 'wrong-target', target: { kind: 'append', recordId: saved.recordId } }]) {
    assert.equal((await services.records.confirmCapture(invalid)).ok, false);
  }
  assert.deepEqual(createWechatServices(disk.platform).records.listRecent().records, [original]);
});

test('a persisted record can advance request associations without losing originals and a failed update leaves its previous version readable', async (t) => {
  const disk = recordPlatform(t);
  const services = createWechatServices(disk.platform);
  const id = (await services.records.confirmCapture(await confirmedBatch([disk.material('menu-photo.png')]))).recordId;
  const original = services.records.getRecord(id).record;
  const committed = services.records.updateRecord(id, (record) => {
    record.contextSnapshotVersion = 1;
    record.contextSaved = true;
  });
  assert.equal(committed.ok, true);
  const recovered = createWechatServices(disk.platform).records.getRecord(id).record;
  assert.equal(recovered.contextSnapshotVersion, 1);
  assert.equal(recovered.contextSaved, true);
  assert.equal(recovered.id, original.id);
  assert.equal(recovered.requestId, original.requestId);
  assert.deepEqual(recovered.images, original.images);
  disk.storage.set = () => { throw new Error('storage full'); };
  assert.deepEqual(services.records.updateRecord(id, (record) => { record.contextSnapshotVersion = 2; }),
    { ok: false, error: 'storage-write' });
  assert.equal(createWechatServices(disk.platform).records.getRecord(id).record.contextSnapshotVersion, 1);
});

test('a missing original remains an identifiable pending record and is never presented as an offline saved photo', async (t) => {
  const disk = recordPlatform(t);
  const services = createWechatServices(disk.platform);
  const id = (await services.records.confirmCapture(await confirmedBatch([disk.material('menu-photo.png')]))).recordId;
  const original = services.records.getRecord(id).record;
  fs.unlinkSync(original.images[0].localOriginalPath);
  const reopened = createWechatServices(disk.platform).records;
  const record = reopened.getRecord(id).record;
  assert.equal(record.saveState, 'saved');
  assert.equal(record.images[0].original.saveState, 'failed');
  assert.equal(record.images[0].original.error, 'original-missing');
  assert.equal(record.images[0].uploadState, 'pending');
  assert.equal(record.requestId, original.requestId);
  assert.equal(reopened.listRecent().records[0].images[0].original.saveState, 'failed');
});

test('abandoning a failed submission removes only its uncommitted original copies and preserves saved history', async (t) => {
  const disk = recordPlatform(t);
  const services = createWechatServices(disk.platform);
  const photo = disk.material('menu-photo.png');
  const oldId = (await services.records.confirmCapture(await confirmedBatch([photo]))).recordId;
  const oldOriginal = services.records.getRecord(oldId).record.images[0].localOriginalPath;
  const batch = await confirmedBatch([disk.material('menu-screenshot.png')]);
  const write = disk.storage.set;
  disk.storage.set = () => { throw new Error('storage quota exceeded'); };
  await services.records.confirmCapture(batch);
  const copiedOriginal = services.records.getSubmission(batch.id).record.images[0].localOriginalPath;
  assert.equal(fs.existsSync(copiedOriginal), true);
  disk.storage.set = write;
  assert.deepEqual(await services.records.discardSubmission(batch.id), { ok: true });
  assert.equal(fs.existsSync(copiedOriginal), false);
  assert.equal(fs.existsSync(oldOriginal), true);
  assert.equal(fs.existsSync(batch.images[0].localPath), true);
  assert.equal(services.records.getSubmission(batch.id), null);
  assert.deepEqual(createWechatServices(disk.platform).records.listRecent().records.map((record) => record.id), [oldId]);
});

test('a failed discard keeps its cleanup association so releasing uncommitted files can be retried honestly', async (t) => {
  const disk = recordPlatform(t);
  const services = createWechatServices(disk.platform);
  const batch = await confirmedBatch([disk.material('menu-photo.png')]);
  const write = disk.storage.set;
  disk.storage.set = () => { throw new Error('quota'); };
  await services.records.confirmCapture(batch);
  const copied = services.records.getSubmission(batch.id).record.images[0].localOriginalPath;
  disk.storage.set = write;
  const access = disk.fileSystem.accessSync;
  const remove = disk.fileSystem.rmdirSync;
  disk.fileSystem.accessSync = () => { const error = new Error('permission denied'); error.code = 'EACCES'; throw error; };
  disk.fileSystem.rmdirSync = disk.fileSystem.accessSync;
  assert.deepEqual(await services.records.discardSubmission(batch.id), { ok: false, error: 'original-cleanup' });
  assert.equal(fs.existsSync(copied), true);
  assert.equal(services.records.getSubmission(batch.id).discarding, true);
  disk.fileSystem.accessSync = access;
  disk.fileSystem.rmdirSync = remove;
  assert.deepEqual(await services.records.discardSubmission(batch.id), { ok: true });
  assert.equal(fs.existsSync(copied), false);
});
