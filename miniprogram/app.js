const { createWechatServices } = require('./platform/wechat');

App({
  onShow() { if (this.services) void this.services.network.refresh().then(() => Promise.all([this.services.deletions.retry(), this.services.receipts.flush()])); },
  onLaunch() {
    this.services = createWechatServices(wx);
  }
});
