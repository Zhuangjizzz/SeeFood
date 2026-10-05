const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCapture } = require('../miniprogram/core/capture');
const { createWechatMedia } = require('../miniprogram/platform/image-input');

test('native album selection hands real photo, screenshot, and long-image files to the final batch', async () => {
  const paths = ['menu-photo.png', 'menu-screenshot.png', 'menu-long.png'].map((name) => path.join(__dirname, 'fixtures', name));
  let pickerOptions;
  const platform = {
    chooseMedia(options) {
      pickerOptions = options;
      options.success({ tempFiles: paths.map((tempFilePath) => ({ tempFilePath, size: fs.statSync(tempFilePath).size })) });
    },
    getImageInfo({ src, success }) {
      const bytes = fs.readFileSync(src);
      success({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), type: 'png', orientation: 'up' });
    }
  };
  const capture = createCapture({ media: createWechatMedia(platform) });
  assert.equal((await capture.chooseImages({ source: 'album' })).ok, true);
  assert.deepEqual(pickerOptions.sourceType, ['album']);
  assert.deepEqual(pickerOptions.mediaType, ['image']);
  assert.deepEqual(pickerOptions.sizeType, ['original']);
  assert.equal(pickerOptions.count, 9);
  const batch = capture.confirm().batch;
  assert.deepEqual(batch.images.map((image) => [image.width, image.height]), [[640, 960], [720, 1280], [600, 6000]]);
  for (const [index, image] of batch.images.entries()) {
    assert.equal(image.mimeType, 'image/png');
    assert.deepEqual(fs.readFileSync(image.localPath), fs.readFileSync(paths[index]));
  }
});

test('native picker cancellation and denied camera access have distinct visible outcomes', async () => {
  for (const [errMsg, expected] of [
    ['chooseMedia:fail cancel', { ok: false, cancelled: true }],
    ['chooseMedia:fail auth deny', { ok: false, error: 'camera-denied' }],
    ['chooseMedia:fail camera not available', { ok: false, error: 'camera-unavailable' }]
  ]) {
    const capture = createCapture({ media: createWechatMedia({ chooseMedia({ fail }) { fail({ errMsg }); } }) });
    assert.deepEqual(await capture.chooseImages({ source: 'camera' }), expected);
  }
  const capture = createCapture({ media: createWechatMedia({
    chooseMedia({ success }) { success({ tempFiles: [{ tempFilePath: '/missing.png', size: 200 }] }); },
    getImageInfo({ fail }) { fail({ errMsg: 'getImageInfo:fail invalid image' }); }
  }) });
  assert.deepEqual(await capture.chooseImages({ source: 'album' }), { ok: false, error: 'image-unreadable' });
});

test('native camera preserves EXIF direction so portrait originals can be displayed without distortion', async () => {
  const media = createWechatMedia({
    chooseMedia({ success }) { success({ tempFiles: [{ tempFilePath: '/portrait.jpg', size: 4000 }] }); },
    getImageInfo({ success }) { success({ width: 1600, height: 1200, type: 'jpeg', orientation: 'right' }); }
  });
  const capture = createCapture({ media });
  await capture.chooseImages({ source: 'camera' });
  const image = capture.confirm().batch.images[0];
  assert.equal(image.orientation, 'right');
  assert.deepEqual([image.width, image.height], [1600, 1200]);
});
