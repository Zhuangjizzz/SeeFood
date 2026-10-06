const { createSaveReceipts } = require('../core/save-receipts');
const { createDietaryReview } = require('../core/dietary-review');
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
const { createTextTranslations } = require('../core/text-translations');
const { createTextExchange } = require('../core/text-exchange');
const { createCardRepository } = require('../core/card-repository');
const { createCardDrafts } = require('../core/card-drafts');
const { createCardFavorites } = require('../core/card-favorites');
const { createImageView } = require('../core/image-view');
const { createWechatTranslationFiles } = require('./translation-files');
const { createRecordContexts } = require('../core/record-context');
const { createWechatNetwork } = require('./network');
const { createHistory } = require('../core/history');
const { createChat } = require('../core/chat');
const { createImageBatches } = require('../core/image-batches');
const { createDeletions } = require('../core/deletions');


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
  const translationFiles = createWechatTranslationFiles(platform);
  const records = createRecords({ store, now: options.now, files: createWechatOriginalFiles(platform), translationFiles });
  const network = createWechatNetwork(platform);
  const backend = createWechatBackend(platform, store, options.backend || developmentBackend(platform), network);
  const receipts = createSaveReceipts({ store, backend, network });
  let deletions;
  const contexts = createRecordContexts({ records, backend, preferences: application.preferences, onDeletedContext: (id) => deletions.retry(id) });
  const uploads = createUploads({ records, network, preferences: application.preferences, backend, contexts });
  const dietaryReview = createDietaryReview({ records, backend, network, contexts, receipts, preferences: application.preferences, getLanguage: () => application.getState().language });
  const jobs = createJobs({ records, backend, translationFiles, network, receipts, contexts, uploads, async onCardsReady(id) {
    if (!application.preferences.getState().isSet) return;
    // New explicit image work can finish while another image's check is active.
    // Recheck only when that successful check did not yet include the new cards.
    let result;
    do { result = await dietaryReview.startRecord(id); }
    while (result.ok && dietaryReview.getState(id).canStart);
  } });
  const imageBatches = createImageBatches({ records, uploads, jobs });
  const textTranslations = createTextTranslations({ backend });
  const cardRepository = createCardRepository({ store, getLanguage: () => application.getState().language });
  const cardDrafts = createCardDrafts({ repository: cardRepository, library: cardLibrary, translations: textTranslations, getLanguage: () => application.getState().language, receipts });
  const textExchange = createTextExchange({ store, translations: textTranslations, getLanguage: () => application.getState().language, receipts });
  const chat = createChat({ records, backend, network, contexts, uploads, receipts, preferences: application.preferences, getLanguage: () => application.getState().language });
  const cardFavorites = createCardFavorites({ chat, repository: cardRepository, library: cardLibrary });
  const imageView = createImageView({ records, jobs });
  const history = createHistory({ records, application, jobs, chat, uploads, store, dietaryReview });
  deletions = createDeletions({ records, backend, network });
  records.subscribe((id) => {
    if (records.isDeleted(id)) {
      const entry = records.getDeletions().entries?.find((item) => item.localScopeId === id);
      if (entry) receipts.forgetContexts(entry.contextIds);
      return;
    }

  });
  return { dietaryReview, receipts, deletions, imageBatches, cardRepository, cardDrafts, cardFavorites, textTranslations, textExchange, network, history, imageView, chat, contexts, jobs, store, application, preferences: application.preferences, cardLibrary, capture, records, backend, uploads };
}

module.exports = { createWechatServices };
