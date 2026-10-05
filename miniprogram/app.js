const { createWechatServices } = require('./platform/wechat');

App({
  onShow() { if (this.services) void this.services.network.refresh(); },
  onLaunch() {
    this.services = createWechatServices(wx);
  }
});
