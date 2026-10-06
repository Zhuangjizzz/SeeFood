const page = require('./page');
const receiptPage = require('./save-receipts');
const saveRecovery = require('./save-recovery');
const { getRecordsCopy, recordError } = require('../core/records-copy');
const { getUploadCopy } = require('../core/upload-copy');
const { getDishesCopy, presentDish } = require('../core/dishes-copy');
const { getImagesCopy } = require('../core/images-copy');
const { getHistoryCopy } = require('../core/history-copy');
const { getChatCopy } = require('../core/chat-copy');
const { readCards } = require('./dish-results');
const { getStageRetryCopy } = require('../core/stage-retry-copy');

const { getRecoveryCopy } = require('../core/recovery-copy');

function uploadState(images) {
  if (images.some((image) => image.uploadState === 'failed')) return 'failed';
  if (images.some((image) => image.uploadState === 'uploading')) return 'uploading';
  if (images.some((image) => image.uploadState === 'pending')) return 'pending';
  return 'uploaded';
}
function uploadLabel(images, status, copy, uploadCopy) {
  return status && status.originalMissing ? copy.uploadFailed : status && status.interrupted ? uploadCopy.interrupted :
    status && status.resuming ? uploadCopy.resuming :
      ({ pending: copy.pendingUpload, uploading: copy.uploading, uploaded: copy.uploaded, failed: copy.uploadFailed })[uploadState(images)];
}
function translationLabel(job, pending, imageCopy, recoveryCopy) {
  if (!job) return pending ? recoveryCopy.checking : imageCopy.unstarted;
  if (job.state !== 'succeeded') return imageCopy[job.state];
  const output = job.output;
  return output.state === 'ready' ? imageCopy.ready : output.reasonKey === 'images.already_chinese' ? imageCopy.alreadyChinese :
    output.reasonKey === 'images.no_translatable_text' ? imageCopy.noText : imageCopy.notRequired;
}
function describe(record, application, uploadStatus) {
  const copy = getRecordsCopy(application.language);
  const uploadCopy = getUploadCopy(application.language);
  const status = uploadState(record.images);
  const originalsSaved = record.images.every((image) => image.original.saveState === 'saved');
  const summary = page.services().history.describe(record);
  const historyCopy = getHistoryCopy(application.language);
  return { ...summary,
    uploadState: status, originalsSaved,
    processingLabel: historyCopy[summary.processingState] || uploadLabel(record.images, uploadStatus, copy, uploadCopy),
    saveLabel: ({ saved: copy.saved, partial: historyCopy.missingImages, saving: copy.saving, failed: copy.saveFailed })[summary.saveState] };

}
function showRecent(target) {
  const application = page.services().application.getState();
  const copy = getRecordsCopy(application.language);
  const result = page.services().records.listRecent();
  target.setData({ offline: !page.services().network.getState().online, historyCopy: getHistoryCopy(application.language), recordCopy: copy, recentRecords: result.records.map((record) => describe(record, application, page.services().uploads.getState(record.id))),
    historyReadable: result.ok, historyError: recordError(copy, result.error) });
}
function openResult(recordId, replace = false, source = { view: 'home' }) {
  page.services().history.enterRecord(recordId, source);
  const url = `/pages/result/result?recordId=${encodeURIComponent(recordId)}`;
  if (replace) wx.redirectTo({ url });
  else wx.navigateTo({ url });
}
function showResult(target, recordId) {
  const application = page.services().application.getState();
  const recordCopy = getRecordsCopy(application.language);
  const result = page.services().records.getRecord(recordId);
  wx.setNavigationBarTitle({ title: recordCopy.result });
  if (!result.ok) {
    target.setData({ record: null, copy: application.copy, recordCopy, recordError: recordError(recordCopy, result.error),
      canRetryRead: result.error === 'storage-read' });
    return;
  }
  const record = result.record;
  const uploadStatus = page.services().uploads.getState(recordId);
  const dishCopy = getDishesCopy(application.language);
  const jobState = page.services().jobs.getState(recordId);
  const recoveryCopy = getRecoveryCopy(application.language);
  const imageCopy = getImagesCopy(application.language);
  const imageView = page.services().imageView.open(recordId, target.data.currentImageId);
  const currentImage = record.images.find((image) => image.id === imageView.imageId) || record.images[0];
  const translationJob = imageView.translationJob;
  const translationAcceptancePending = !translationJob && !!(currentImage.jobRequests && currentImage.jobRequests.image_translation);
  const translationStateLabel = translationLabel(translationJob, translationAcceptancePending, imageCopy, recoveryCopy);
  const unsavedCards = (jobState.unsavedJobs || []).find((job) => job.kind === 'image_cards' && job.target.imageId === currentImage.id);
  const cardsJob = unsavedCards || currentImage.stageJobs.image_cards;
  const cardsAcceptancePending = !cardsJob && !!(currentImage.jobRequests && currentImage.jobRequests.image_cards);
  const cards = readCards(record, jobState);
  const visibleUnsavedCards = (jobState.unsavedJobs || []).some((job) => job.kind === 'image_cards' && job.state === 'succeeded' &&
    job.output.cards.some((card) => card.sourceImageIds.includes(currentImage.id)));
  const cardsRetry = page.services().jobs.getStageState(recordId, currentImage.id, 'image_cards');
  const translationRetry = page.services().jobs.getStageState(recordId, currentImage.id, 'image_translation');
  const renderedImage = { path: imageView.variant === 'translation' ? imageView.path : null, entries: receiptPage.imageEntries(record, jobState, currentImage.id, { translationOnly: true, imageLoaded: true }) };
  target.setData(Object.assign({}, describe(record, application, uploadStatus), { offline: !page.services().network.getState().online, record, copy: application.copy, recordCopy,
    saveRecoveryCopy: saveRecovery.copy(), historyCopy: getHistoryCopy(application.language), chatCopy: getChatCopy(application.language), uploadCopy: getUploadCopy(application.language), dishCopy, recoveryCopy, cardsJob, cardsAcceptancePending, translationAcceptancePending, imageCopy, imageView, translationJob, translationStateLabel,

    stageCopy: getStageRetryCopy(application.language), cardsRetry, translationRetry,
    uploadInterrupted: uploadStatus.interrupted, uploadResuming: uploadStatus.resuming, canRetryUpload: uploadStatus.canRetry,
    uploadOriginalMissing: currentImage.original.saveState !== 'saved' || currentImage.uploadError === 'original-missing',
    originalSaveLabel: currentImage.original.saveState === 'saved' ? imageCopy.saved : imageCopy.saveFailed,
    translationSaveLabel: imageView.translationSaveState === 'failed' || imageView.translationUnsaved ? imageCopy.saveFailed : imageCopy[imageView.translationSaveState] || imageCopy.pending,
    dishCards: cards.filter((card) => card.sourceImageIds.includes(currentImage.id)).map((card) => presentDish(card, dishCopy)),
    cardsStateLabel: cardsJob ? dishCopy[cardsJob.state] : cardsAcceptancePending ? recoveryCopy.checking : dishCopy.unstarted,
    saveLabel: (jobState.unsavedJobs || []).length ? recordCopy.saveFailed : describe(record, application, uploadStatus).saveLabel,
    cardsSaveFailed: !!unsavedCards || visibleUnsavedCards, cardsReadFailed: !!jobState.error && !(jobState.unsavedJobs || []).length && (!cardsJob || !translationJob || ['queued', 'running'].includes(cardsJob.state) || ['queued', 'running'].includes(translationJob.state)),
    canLeave: page.services().imageBatches.getState(recordId).canLeave,

    uploadLocalFailure: uploadStatus.error === 'storage-write' || uploadStatus.error === 'storage-read',
    recordError: '', canRetryRead: false, currentImageId: currentImage ? currentImage.id : null, currentImage,
    imageStates: record.images.map((image) => {
      const pending = (jobState.unsavedJobs || []).filter((job) => job.target.imageId === image.id);
      const cards = pending.find((job) => job.kind === 'image_cards') || image.stageJobs.image_cards;
      const translation = pending.find((job) => job.kind === 'image_translation') || image.stageJobs.image_translation;
      const artifact = image.translation || (translation && translation.output && translation.output.artifact);
      const saving = artifact && artifact.saveState === 'saving' && (jobState.savingTranslations || []).includes(image.id);
      const imageUpload = page.services().uploads.getState(recordId, image.id);
      return Object.assign({}, describe(Object.assign({}, record, { images: [image] }), application, imageUpload), image, {
        processingLabel: uploadLabel([image], imageUpload, recordCopy, getUploadCopy(application.language)),
        canRetryUpload: imageUpload.canRetry,
        cardsRetry: page.services().jobs.getStageState(recordId, image.id, 'image_cards'),
        translationRetry: page.services().jobs.getStageState(recordId, image.id, 'image_translation'),
        cardsStateLabel: cards ? dishCopy[cards.state] : image.jobRequests && image.jobRequests.image_cards ? recoveryCopy.checking : dishCopy.unstarted,
        translationStateLabel: translationLabel(translation, image.jobRequests && image.jobRequests.image_translation, imageCopy, recoveryCopy),
        translationSaveLabel: pending.some((job) => job.kind === 'image_translation') ? imageCopy.saveFailed :
          artifact && artifact.saveState === 'saved' ? imageCopy.saved : saving ? imageCopy.saving : artifact && artifact.saveState === 'failed' ? imageCopy.saveFailed : imageCopy.pending,
        translationReady: !!artifact, resultSaveFailed: pending.length > 0
      });
    }) }), () => { if (target.receiptVisible !== false) { target.renderedImageReceipt = renderedImage; receiptPage.present(page.services(), receiptPage.imageEntries(record, jobState, currentImage.id)); } });
  if (uploadStatus.originalMissing || uploadStatus.error && uploadStatus.error !== 'backend-unavailable' && uploadStatus.error !== 'single-image-only') {
    target.setData({ uploadState: 'failed', processingLabel: recordCopy.uploadFailed });
  }
}

function showHistory(target) {
  const application = page.services().application.getState(); const copy = getRecordsCopy(application.language);
  const result = page.services().records.listHistory();
  target.setData({ offline: !page.services().network.getState().online, historyCopy: getHistoryCopy(application.language), recordCopy: copy,
    entries: result.records.map((record) => describe(record, application, page.services().uploads.getState(record.id))),
    historyReadable: result.ok, historyError: recordError(copy, result.error) });
}
function openHistory(source) { wx.navigateTo({ url: `/pages/history/history?source=${source === 'mine' ? 'mine' : 'home'}` }); }
module.exports = { showRecent, showHistory, openHistory, openResult, showResult };
