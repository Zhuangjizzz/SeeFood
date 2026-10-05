const { createLocalStore } = require('../core/local-store');
const { createApplication } = require('../core/application');
const { createCapture } = require('../core/capture');
const { createWechatMedia } = require('./image-input');
const { createRecords } = require('../core/records');
const { createWechatOriginalFiles } = require('./original-files');
const { createCardLibrary } = require('../core/card-library');
const { createWechatBackend, developmentBackend } = require('./backend');
const { createUploads } = require('../core/uploads');
const { createJobs } = require('../core/jobs');
const { createRecordContexts } = require('../core/record-context');
const { createChat } = require('../core/chat');

function createWechatServices(platform, options = {}) {
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
  const capture = createCapture({ media: createWechatMedia(platform), getLanguage: () => application.getState().language });
  const cardLibrary = createCardLibrary({ store, getLanguage: () => application.getState().language });
  const records = createRecords({ store, files: createWechatOriginalFiles(platform) });
  const backend = createWechatBackend(platform, store, options.backend || developmentBackend(platform));
  const contexts = createRecordContexts({ records, backend });
  const uploads = createUploads({ records, preferences: application.preferences, backend, contexts });
  const jobs = createJobs({ records, backend });
  const chat = createChat({ records, backend, contexts, preferences: application.preferences, getLanguage: () => application.getState().language });
  return { chat, contexts, jobs, store, application, preferences: application.preferences, cardLibrary, capture, records, backend, uploads };
}

module.exports = { createWechatServices };
