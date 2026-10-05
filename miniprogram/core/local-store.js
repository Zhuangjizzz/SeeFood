const PREFIX = 'seefood:v1:';

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createLocalStore(driver) {
  return {
    get(key, fallback) {
      const entry = driver.get(PREFIX + key);
      if (entry === undefined || entry === '') return copy(fallback);
      if (!entry || entry.schema !== 1 || !Object.prototype.hasOwnProperty.call(entry, 'value')) {
        throw new Error('Unsupported local data');
      }
      return copy(entry.value);
    },
    set(key, value) {
      driver.set(PREFIX + key, { schema: 1, value: copy(value) });
    },
    remove(key) { driver.remove(PREFIX + key); }
  };
}

module.exports = { createLocalStore };
