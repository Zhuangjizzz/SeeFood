const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// An actual disk boundary, with one JSON file per small local-storage key.
function fileStorage(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seefood-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = (key) => path.join(directory, encodeURIComponent(key) + '.json');
  return {
    get(key) {
      try { return JSON.parse(fs.readFileSync(filename(key), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    set(key, value) { fs.writeFileSync(filename(key), JSON.stringify(value)); },
    remove(key) { fs.rmSync(filename(key), { force: true }); }
  };
}

module.exports = { fileStorage };
