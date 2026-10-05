const page = require('./page');
const { getRecordsCopy, recordError } = require('../core/records-copy');
const { getUploadCopy } = require('../core/upload-copy');
const { getDishesCopy, presentDish } = require('../core/dishes-copy');
const { getChatCopy } = require('../core/chat-copy');

function dateTime(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function uploadState(images) {
  if (images.some((image) => image.uploadState === 'failed')) return 'failed';
  if (images.some((image) => image.uploadState === 'uploading')) return 'uploading';
  if (images.some((image) => image.uploadState === 'pending')) return 'pending';
  return 'uploaded';
}
function describe(record, application, uploadStatus) {
  const copy = getRecordsCopy(application.language);
  const uploadCopy = getUploadCopy(application.language);
  const status = uploadState(record.images);
  const originalsSaved = record.images.every((image) => image.original.saveState === 'saved');
  const uploadLocalFailure = uploadStatus && ['storage-read', 'storage-write'].includes(uploadStatus.error);
  return { id: record.id, title: record.title || `${record.kind === 'dish' ? application.copy.dish : application.copy.menu} · ${dateTime(record.createdAt).split(' ')[0]}`,
    createdAtLabel: dateTime(record.createdAt), imageCount: record.images.length,
    thumbnail: record.images[0] && record.images[0].original.saveState === 'saved' ? record.images[0].localOriginalPath : null,
    uploadState: status, originalsSaved,
    processingLabel: uploadStatus && uploadStatus.originalMissing ? copy.uploadFailed : uploadStatus && uploadStatus.interrupted ? uploadCopy.interrupted :
      uploadStatus && uploadStatus.resuming ? uploadCopy.resuming :
        ({ pending: copy.pendingUpload, uploading: copy.uploading, uploaded: copy.uploaded, failed: copy.uploadFailed })[status],
    saveLabel: uploadLocalFailure ? copy.saveFailed : record.saveState === 'saved' ? (originalsSaved ? copy.saved : copy.partialSave) : record.saveState === 'saving' ? copy.saving : copy.saveFailed };
}
function showRecent(target) {
  const application = page.services().application.getState();
  const copy = getRecordsCopy(application.language);
  const result = page.services().records.listRecent();
  target.setData({ recordCopy: copy, recentRecords: result.records.map((record) => describe(record, application, page.services().uploads.getState(record.id))),
    historyReadable: result.ok, historyError: recordError(copy, result.error) });
}
function openResult(recordId, replace = false) {
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
  const currentImage = record.images.find((image) => image.id === target.data.currentImageId) || record.images[0];
  const cardsJob = jobState.unsavedJob && jobState.unsavedJob.target.imageId === currentImage.id ? jobState.unsavedJob : currentImage.stageJobs.image_cards;
  const cards = jobState.unsavedJob && cardsJob === jobState.unsavedJob && cardsJob.state === 'succeeded' ?
    (record.cards || []).filter((card) => !card.sourceImageIds.includes(currentImage.id)).concat(cardsJob.output.cards) : (record.cards || []);
  target.setData(Object.assign({}, describe(record, application, uploadStatus), { record, copy: application.copy, recordCopy,
    uploadCopy: getUploadCopy(application.language), dishCopy, cardsJob, chatCopy: getChatCopy(application.language),
    uploadInterrupted: uploadStatus.interrupted, uploadResuming: uploadStatus.resuming, canRetryUpload: uploadStatus.canRetry,
    uploadOriginalMissing: uploadStatus.originalMissing,
    dishCards: cards.filter((card) => card.sourceImageIds.includes(currentImage.id)).map((card) => presentDish(card, dishCopy)),
    cardsStateLabel: cardsJob ? dishCopy[cardsJob.state] : dishCopy.unstarted,
    saveLabel: jobState.unsavedJob ? recordCopy.saveFailed : describe(record, application, uploadStatus).saveLabel,
    cardsSaveFailed: !!jobState.unsavedJob, cardsReadFailed: !!jobState.error && !jobState.unsavedJob,
    canLeave: record.images.every((image) => image.uploadState === 'uploaded' && image.stageJobs.image_cards),
    uploadLocalFailure: uploadStatus.error === 'storage-write' || uploadStatus.error === 'storage-read',
    recordError: '', canRetryRead: false, currentImageId: currentImage ? currentImage.id : null, currentImage,
    imageStates: record.images.map((image) => Object.assign({}, describe(Object.assign({}, record, { images: [image] }), application, uploadStatus), image)) }));
  if (uploadStatus.originalMissing || uploadStatus.error && uploadStatus.error !== 'backend-unavailable' && uploadStatus.error !== 'single-image-only') {
    target.setData({ uploadState: 'failed', processingLabel: recordCopy.uploadFailed });
  }
}

module.exports = { showRecent, openResult, showResult };
