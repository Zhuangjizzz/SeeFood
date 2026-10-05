const page = require('./page');
const { getCaptureCopy, getCaptureError } = require('../core/capture-copy');

function showCapture(target) {
  const state = page.services().capture.getState();
  const copy = getCaptureCopy(page.services().application.getState().language);
  target.setData({ inputMode: state.inputMode, choosing: state.choosing, captureCopy: copy,
    inputError: getCaptureError(copy, state.error) });
}

async function chooseImages(target, source, recordTarget) {
  const selection = page.services().capture.chooseImages({ source, target: recordTarget });
  showCapture(target);
  const result = await selection;
  showCapture(target);
  if (result.ok) {
    wx.navigateTo({ url: '/pages/preview/preview', events: {
      captureConfirmed(batch) {
        // The next ticket connects this public handoff to local record creation.
        if (target.handleCaptureConfirmed) target.handleCaptureConfirmed(batch);
      }
    } });
  }
  return result;
}

function previewState() {
  const application = page.services().application.getState();
  return Object.assign({}, page.services().capture.getState(), {
    copy: Object.assign({}, application.copy, getCaptureCopy(application.language))
  });
}

function leavePreview() {
  if (getCurrentPages().length > 1) wx.navigateBack();
  else wx.switchTab({ url: page.ROUTES.capture });
}

module.exports = { showCapture, chooseImages, previewState, leavePreview };
