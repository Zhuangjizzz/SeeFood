const { createLocalStore } = require('../core/local-store');
const { createApplication } = require('../core/application');
const { createCardLibrary } = require('../core/card-library');

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
  const application = createApplication({ store, systemLanguage });
  const cardLibrary = createCardLibrary({ store, getLanguage: () => application.getState().language });
  return { store, application, cardLibrary };
}

module.exports = { createWechatServices };
