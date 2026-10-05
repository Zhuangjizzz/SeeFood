const { createWechatServices } = require('./platform/wechat');

App({
  onLaunch() {
    this.services = createWechatServices(wx);
  }
});
