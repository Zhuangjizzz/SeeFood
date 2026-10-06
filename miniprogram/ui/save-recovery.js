const { getSaveCopy } = require('../core/save-copy');
const page = require('./page');
function open() { wx.navigateTo({ url: '/pages/history/history?source=save-recovery&saveRecovery=1' }); }
function copy() { return getSaveCopy(page.services().application.getState().language); }
module.exports = { open, copy };
