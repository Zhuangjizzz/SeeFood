const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { fileStorage } = require('./storage');

function recordPlatform(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seefood-originals-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = fileStorage(t);
  let downloadSequence = 0;
  const fileSystem = {
    accessSync: (filename) => fs.accessSync(filename),
    mkdirSync: (directory, recursive) => fs.mkdirSync(directory, { recursive }),
    rmdirSync: (directory, recursive) => fs.rmSync(directory, { recursive, force: true }),
    statSync: (filename) => fs.statSync(filename),
    copyFile({ srcPath, destPath, success, fail }) {
      fs.copyFile(srcPath, destPath, (error) => error ? fail(error) : success({}));
    },
    unlinkSync: (filename) => fs.unlinkSync(filename)
  };
  return {
    root, storage, fileSystem,
    platform: {
      env: { USER_DATA_PATH: path.join(root, 'saved') },
      getFileSystemManager: () => fileSystem,
      downloadFile({ url, header, success, fail }) {
        const tempFilePath = path.join(root, `download-${++downloadSequence}.png`);
        fetch(url, { headers: header }).then(async (response) => {
          fs.writeFileSync(tempFilePath, Buffer.from(await response.arrayBuffer()));
          success({ statusCode: response.status, tempFilePath });
        }).catch(fail);
      },
      getImageInfo({ src, success, fail }) {
        sharp(src).metadata().then((info) => success({ width: info.width, height: info.height, type: info.format })).catch(fail);
      },
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: (key) => storage.remove(key),
      getAppBaseInfo: () => ({ language: 'en' })
    },
    material(name) {
      const filename = path.join(root, name);
      fs.copyFileSync(path.join(__dirname, '..', 'fixtures', name), filename);
      const bytes = fs.readFileSync(filename);
      return { localPath: filename, sizeBytes: bytes.length, mimeType: 'image/png',
        width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), orientation: 'up' };
    }
  };
}

module.exports = { recordPlatform };
