const { createWechatServices } = require('./platform/wechat');

App({
  onShow() { if (this.services) void this.services.network.refresh().then(() => this.services.deletions.retry()); },
  onLaunch() {
    this.services = createWechatServices(wx);
  }
});
