const test = require('node:test');
const assert = require('node:assert/strict');
const { createCapture } = require('../miniprogram/core/capture');

const photos = [
  { localPath: '/photos/menu.jpg', sizeBytes: 2048, mimeType: 'image/jpeg', width: 1200, height: 1600 },
  { localPath: '/photos/screenshot.png', sizeBytes: 1024, mimeType: 'image/png', width: 800, height: 1200 },
  { localPath: '/photos/long-menu.png', sizeBytes: 4096, mimeType: 'image/png', width: 800, height: 12000 }
];

test('capture defaults to menu and opens the camera only after a photo action', async () => {
  let cameraOpened = false;
  const capture = createCapture({ media: { async chooseImages() { cameraOpened = true; return []; } } });
  assert.equal(capture.getState().inputMode, 'menu');
  assert.equal(cameraOpened, false);
  capture.chooseMode('dish');
  assert.equal(capture.getState().inputMode, 'dish');
  await capture.chooseImages({ source: 'camera' });
  assert.equal(cameraOpened, true);
});

test('three selected materials can be removed and reordered into one complete final batch', async () => {
  const capture = createCapture({ media: { chooseImages: async () => photos }, getLanguage: () => 'ja' });
  const selected = await capture.chooseImages({ source: 'album' });
  assert.equal(selected.ok, true);
  const preview = capture.getState();
  assert.deepEqual(preview.target, { kind: 'new' });
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.images.length, 3);
  capture.removeImage(preview.images[1].id);
  capture.moveImage(preview.images[2].id, 0);
  const confirmed = capture.confirm();
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.batch.targetLanguage, 'ja');
  assert.deepEqual(confirmed.batch.images.map(({ localPath, kind, order }) => ({ localPath, kind, order })), [
    { localPath: '/photos/long-menu.png', kind: 'menu', order: 0 },
    { localPath: '/photos/menu.jpg', kind: 'menu', order: 1 }
  ]);
  assert.deepEqual(capture.confirm(), { ok: false, error: 'batch-confirmed' });
  capture.removeImage(confirmed.batch.images[0].id);
  assert.equal(confirmed.batch.images.length, 2);
});

test('cancel returns the append target without handing off a batch, and removing every image disables confirmation', async () => {
  const capture = createCapture({ media: { chooseImages: async () => photos.slice(0, 1) } });
  const target = { kind: 'append', recordId: 'record-original', title: 'Lunch menu' };
  await capture.chooseImages({ source: 'album', target });
  assert.deepEqual(capture.getState().target, target);
  capture.removeImage(capture.getState().images[0].id);
  assert.equal(capture.getState().canConfirm, false);
  assert.deepEqual(capture.confirm(), { ok: false, error: 'empty-batch' });
  assert.deepEqual(capture.cancel(), { ok: true, target });
  assert.equal(capture.getState().target, null);
  assert.deepEqual(capture.confirm(), { ok: false, error: 'empty-batch' });
});

test('an unavailable camera leaves album import usable and a dismissed picker creates no preview', async () => {
  const capture = createCapture({ media: { async chooseImages({ source }) {
    if (source === 'camera') throw { code: 'camera-denied' };
    return photos.slice(0, 1);
  } } });
  assert.deepEqual(await capture.chooseImages({ source: 'camera' }), { ok: false, error: 'camera-denied' });
  assert.equal(capture.getState().error, 'camera-denied');
  assert.equal(capture.getState().canConfirm, false);
  assert.equal((await capture.chooseImages({ source: 'album' })).ok, true);
  assert.equal(capture.getState().error, null);
  const dismissed = createCapture({ media: { chooseImages: async () => { throw { code: 'cancelled' }; } } });
  assert.deepEqual(await dismissed.chooseImages({ source: 'album' }), { ok: false, cancelled: true });
  assert.equal(dismissed.getState().target, null);
});

test('local integration boundaries reject oversized, unsupported, unreadable, and excess materials before preview', async () => {
  const examples = [
    [[{ ...photos[0], sizeBytes: 20 * 1024 * 1024 + 1 }], 'image-too-large'],
    [[{ ...photos[0], mimeType: 'image/gif' }], 'unsupported-image'],
    [[{ ...photos[0], width: 0 }], 'image-unreadable'],
    [Array.from({ length: 10 }, () => photos[0]), 'too-many-images']
  ];
  for (const [selection, expected] of examples) {
    const capture = createCapture({ media: { chooseImages: async () => selection } });
    assert.deepEqual(await capture.chooseImages({ source: 'album' }), { ok: false, error: expected });
    assert.equal(capture.getState().canConfirm, false);
  }
  const capture = createCapture({ media: { chooseImages: async () => [{ ...photos[2], sizeBytes: 20 * 1024 * 1024 }] } });
  assert.equal((await capture.chooseImages({ source: 'album' })).ok, true);
  assert.deepEqual(capture.getState().limits, {
    scope: 'local-integration', maxImages: 9, maxImageBytes: 20971520, mimeTypes: ['image/jpeg', 'image/png', 'image/webp']
  });
});

test('closing a zoomed long original restores the same preview order and reading position', async () => {
  const capture = createCapture({ media: { chooseImages: async () => photos } });
  await capture.chooseImages({ source: 'album' });
  const images = capture.getState().images;
  capture.moveImage(images[2].id, 0);
  capture.setPreviewPosition(246);
  capture.openOriginal(images[2].id);
  assert.deepEqual(capture.getState().original, { imageId: images[2].id, scale: 1, scrollTop: 0, scrollLeft: 0 });
  capture.setOriginalView({ scale: 2, scrollTop: 1700, scrollLeft: 80 });
  assert.equal(capture.getState().original.scale, 2);
  capture.closeOriginal();
  const returned = capture.getState();
  assert.equal(returned.original, null);
  assert.equal(returned.previewPosition, 246);
  assert.deepEqual(returned.images.map((image) => image.localPath), ['/photos/long-menu.png', '/photos/menu.jpg', '/photos/screenshot.png']);
  assert.equal(returned.canConfirm, true);
});

test('a pending picker freezes its selected mode and cannot create a late batch after cancellation', async () => {
  let finishPicker;
  const capture = createCapture({ media: { chooseImages: () => new Promise((resolve) => { finishPicker = resolve; }) } });
  capture.chooseMode('dish');
  const selection = capture.chooseImages({ source: 'camera' });
  assert.equal(capture.getState().choosing, true);
  assert.deepEqual(await capture.chooseImages({ source: 'album' }), { ok: false, error: 'picker-busy' });
  capture.chooseMode('menu');
  finishPicker(photos.slice(0, 1));
  assert.equal((await selection).ok, true);
  assert.equal(capture.confirm().batch.images[0].kind, 'dish');
  const later = capture.chooseImages({ source: 'album' });
  capture.cancel();
  finishPicker(photos);
  assert.deepEqual(await later, { ok: false, cancelled: true });
  assert.equal(capture.getState().images.length, 0);
});

test('leaving a confirmed preview clears its page state without redelivering its materials', async () => {
  const capture = createCapture({ media: { chooseImages: async () => photos.slice(0, 1) } });
  await capture.chooseImages({ source: 'album' });
  const delivered = capture.confirm();
  capture.cancel();
  assert.equal(capture.getState().confirmed, false);
  assert.deepEqual(capture.confirm(), { ok: false, error: 'empty-batch' });
  assert.equal(delivered.batch.images.length, 1);
});
