const page = require('./page');
const { getRecordsCopy, recordError } = require('../core/records-copy');

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
function describe(record, application) {
  const copy = getRecordsCopy(application.language);
  const status = uploadState(record.images);
  const originalsSaved = record.images.every((image) => image.original.saveState === 'saved');
  return { id: record.id, title: record.title || `${record.kind === 'dish' ? application.copy.dish : application.copy.menu} · ${dateTime(record.createdAt).split(' ')[0]}`,
    createdAtLabel: dateTime(record.createdAt), imageCount: record.images.length,
    thumbnail: record.images[0] && record.images[0].original.saveState === 'saved' ? record.images[0].localOriginalPath : null,
    uploadState: status, originalsSaved,
    processingLabel: ({ pending: copy.pendingUpload, uploading: copy.uploading, uploaded: copy.uploaded, failed: copy.uploadFailed })[status],
    saveLabel: record.saveState === 'saved' ? (originalsSaved ? copy.saved : copy.partialSave) : record.saveState === 'saving' ? copy.saving : copy.saveFailed };
}
function showRecent(target) {
  const application = page.services().application.getState();
  const copy = getRecordsCopy(application.language);
  const result = page.services().records.listRecent();
  target.setData({ recordCopy: copy, recentRecords: result.records.map((record) => describe(record, application)),
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
  const currentImage = record.images.find((image) => image.id === target.data.currentImageId) || record.images[0];
  target.setData(Object.assign({}, describe(record, application), { record, copy: application.copy, recordCopy,
    recordError: '', canRetryRead: false, currentImageId: currentImage ? currentImage.id : null, currentImage,
    imageStates: record.images.map((image) => Object.assign({}, describe(Object.assign({}, record, { images: [image] }), application), image)) }));
}

module.exports = { showRecent, openResult, showResult };
