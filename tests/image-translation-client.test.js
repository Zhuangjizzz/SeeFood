const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createWechatServices } = require('../miniprogram/platform/wechat');
const { createCapture } = require('../miniprogram/core/capture');
const { recordPlatform } = require('./support/record-platform');
const { temporary, start } = require('./support/http-service');
async function setup(t, env = {}, language = 'ja', kind = 'menu') {
  const disk = recordPlatform(t); const server = await start(t, temporary(t), env); const traffic = [];
  const backend = { enabled: true, baseUrl: server.url, identity: 'demo-owner-a' };
  disk.platform.request = (options) => { traffic.push({ method: options.method, url: options.url });
    fetch(options.url, { method: options.method, headers: options.header, body: options.method === 'GET' ? undefined : options.data instanceof ArrayBuffer ? options.data : JSON.stringify(options.data) })
      .then(async (response) => { const data = await response.text(); options.success({ statusCode: response.status, data: data ? JSON.parse(data) : null }); }).catch(options.fail);
  };
  disk.platform.downloadFile = (options) => { traffic.push({ method: 'DOWNLOAD', url: options.url });
    fetch(options.url, { headers: options.header }).then(async (response) => {
      const tempFilePath = path.join(disk.root, `download-${traffic.length}.png`);
      fs.writeFileSync(tempFilePath, Buffer.from(await response.arrayBuffer()));
      options.success({ statusCode: response.status, tempFilePath });
    }).catch(options.fail);
  };
  disk.platform.getImageInfo = ({ src, success, fail }) => sharp(src).metadata().then((metadata) => success({ width: metadata.width, height: metadata.height, type: metadata.format })).catch(fail);
  disk.fileSystem.readFile = ({ filePath, success, fail }) => fs.readFile(filePath, (error, bytes) => error ? fail(error) : success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const services = createWechatServices(disk.platform, { backend });
  const capture = createCapture({ media: { chooseImages: async () => [disk.material('menu-photo.png')] }, getLanguage: () => language });
  capture.chooseMode(kind); await capture.chooseImages({ source: 'album' });
  const saved = await services.records.confirmCapture(capture.confirm().batch); assert.equal(saved.ok, true);
  assert.equal((await services.uploads.uploadRecord(saved.recordId)).ok, true);
  return { disk, services, id: saved.recordId, traffic, backend, server };
}

test('translation has independent real download and durable file state while cards and originals remain intact offline', async (t) => {
  const { services, disk, id, backend, traffic, server } = await setup(t);
  assert.equal((await services.jobs.startImageCards(id)).ok, true);
  const before = services.records.getRecord(id).record;
  assert.equal((await services.jobs.startImageTranslation(id)).ok, true);
  const translated = services.records.getRecord(id).record;
  assert.deepEqual(translated.cards, before.cards); assert.deepEqual(translated.images[0].original, before.images[0].original);
  const image = translated.images[0]; assert.equal(image.stageJobs.image_translation.state, 'succeeded');
  assert.equal(image.translation.saveState, 'saved'); assert.equal(image.translation.contentLanguage, 'ja');
  assert.ok(fs.statSync(image.translation.localPath).size > 0); assert.notEqual(image.translation.localPath, image.original.localPath);
  assert.equal(traffic.filter((entry) => entry.method === 'DOWNLOAD').length, 1);
  await server.stop();
  const reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.records.getRecord(id).record.images[0].translation.saveState, 'saved');
  const requests = traffic.length; assert.equal((await reopened.jobs.startImageTranslation(id)).ok, true); assert.equal(traffic.length, requests);
  fs.unlinkSync(image.translation.localPath);
  const missing = reopened.records.getRecord(id).record.images[0];
  assert.equal(missing.translation.saveState, 'failed'); assert.equal(missing.original.saveState, 'saved');
});
module.exports = { setup };

test('first view prefers an existing translation but completion never steals an original; choices survive a fresh client', async (t) => {
  const { services, disk, id, backend } = await setup(t);
  const imageId = services.records.getRecord(id).record.images[0].id;
  assert.equal(services.imageView.open(id, imageId).variant, 'original');
  assert.equal((await services.jobs.startImageTranslation(id)).ok, true);
  assert.equal(services.imageView.open(id, imageId).variant, 'original');
  assert.equal(services.imageView.open(id, imageId).translationAvailable, true);
  assert.equal(services.imageView.selectVariant(id, imageId, 'translation').ok, true);
  let reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.imageView.open(id).variant, 'translation');
  assert.equal(reopened.imageView.selectVariant(id, imageId, 'original').ok, true);
  reopened = createWechatServices(disk.platform, { backend });
  assert.equal(reopened.imageView.open(id).variant, 'original');
  const fresh = await setup(t);
  await fresh.services.jobs.startImageTranslation(fresh.id);
  assert.equal(fresh.services.imageView.open(fresh.id).variant, 'translation');
});

test('lost translation acceptance binds the original job through recovery without resubmitting generation', async (t) => {
  const { services, disk, id, backend, traffic } = await setup(t);
  const send = disk.platform.request; let accepted;
  disk.platform.request = (options) => {
    if (options.method === 'POST' && options.url.endsWith('/v1/jobs')) options.success = (result) => { accepted = result.data; options.fail(new Error('lost reply')); };
    send(options);
  };
  assert.equal((await services.jobs.startImageTranslation(id)).ok, false);
  disk.platform.request = send; const reopened = createWechatServices(disk.platform, { backend });
  const before = traffic.filter((entry) => entry.method === 'POST').length;
  assert.equal(reopened.jobs.acceptRecoveredJob(id, accepted).ok, true);
  assert.equal((await reopened.jobs.refreshRecord(id)).ok, true);
  assert.equal(reopened.records.getRecord(id).record.images[0].stageJobs.image_translation.jobId, accepted.jobId);
  assert.equal(reopened.records.getRecord(id).record.images[0].translation.saveState, 'saved');
  assert.equal(traffic.filter((entry) => entry.method === 'POST').length, before);
});
