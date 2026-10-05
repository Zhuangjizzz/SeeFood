const { createLocalStore } = require('../core/local-store');
const { createApplication } = require('../core/application');

function createWechatServices(platform) {
  const store = createLocalStore({
    get: (key) => platform.getStorageSync(key),
    set: (key, value) => platform.setStorageSync(key, value),
    remove: (key) => platform.removeStorageSync(key)
  });
  let systemLanguage = '';
  try {
    const info = platform.getAppBaseInfo ? platform.getAppBaseInfo() : platform.getSystemInfoSync();
    systemLanguage = info.language;
  } catch (_) {
    // An unavailable platform locale falls through to the explicit language picker.
  }
  return { store, application: createApplication({ store, systemLanguage }) };
}

module.exports = { createWechatServices };
