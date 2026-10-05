# 本地 HTTP 联调

本轮采用 Node.js 26、TypeScript、SQLite 与项目外图片目录。已实现单图上传路径；生成任务与中断恢复由后续批次接入。HTTP 请求与响应遵循 [OpenAPI](openapi.json)。

## 启动

在仓库根目录安装依赖并启动：

```sh
npm ci
npm run server:dev
```

服务默认监听 `127.0.0.1:8787`，首次输出实际访问地址。`npm run server:dev` 显式设置 `SEEFOOD_DEV_IDENTITY=1`，允许 `demo-owner-a` 与 `demo-owner-b` 两个测试身份。每次换取会话会得到独立随机令牌；服务持久保存令牌散列与身份映射。

`npm run server` 不启用开发身份入口；`NODE_ENV=production` 也始终关闭此入口。真实微信登录尚未接入，不能把关闭开发入口后的服务当成生产身份实现。

可设置以下环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `SEEFOOD_DATA_DIR` | 用户主目录下 `.seefood/development` | SQLite 与图片目录；必须位于项目外 |
| `PORT` | `8787` | HTTP 监听端口，测试可使用 `0` |
| `HOST` | `127.0.0.1` | 本地监听地址 |
| `SEEFOOD_DEV_IDENTITY` | 未设置 | 仅值 `1` 显式开启开发身份 |
| `SEEFOOD_DEV_IDENTITIES` | `demo-owner-a,demo-owner-b` | 允许使用的测试身份，逗号分隔 |

退出服务使用 Ctrl+C；再次启动同一数据目录可继续读取快照、上传凭证、文件与完成关联。当前联调会话有效期为 1 小时、上传凭证为 15 分钟、临时上下文为 24 小时；这些是本地测试配置，不是生产保留承诺。原图上限沿用本轮客户端的 20 MiB；解码上限为 1 亿像素。

## 小程序

`miniprogram/config/backend.js` 是显式开发配置，默认指向上述地址和 `demo-owner-a`。适配器仅在 `wx.getAccountInfoSync().miniProgram.envVersion` 为 `develop` 时读取它；体验版、正式版及无法确认环境时关闭开发上传。

在微信开发者工具中联调 localhost 时，需使用本地开发的网络域名配置。模拟器编译、实际 `wx.request`、文件权限和各语言布局由原生检查验证；自动化 Node 测试不替代该检查。真机访问不能使用手机自己的 `127.0.0.1`，远程域名与正式身份接入属于后续部署工作。

单张图片确认并完成本机保存后，客户端自动执行：

1. 持久保存待提交快照，提交版本 1，其中 `assetId=null`。
2. 领取上传凭证，读取本机原图，通过 `wx.request` 把原始 `ArrayBuffer` 发送到动态 `uploadUrl`。该请求只使用凭证返回的方法和请求头。
3. 确认上传。后端检查字节数、内容散列、真实格式及完整像素解码，再保存资产关联。
4. 将资产绑定到版本 2，确认成功后显示“已上传”。原版本不被修改。

上传完成不创建任务，页面会明确说明尚未开始处理。重新打开记录仅读取已保存状态，不自动上传。上传失败保留原图、记录和请求 ID；后续中断恢复批次提供完整的主动重试入口。多图在该批次仍保持待上传状态。

`createWechatServices` 提供 `uploads.uploadRecord(recordId)`、`uploads.subscribe(listener)`、`uploads.getState(recordId)`。上传中的重复调用共享同一操作；已上传记录调用无网络副作用。`records.updateRecord` 是唯一记录写入边界。上传凭证、待提交快照和资产关联均保存到本机，失败不会被当成成功保存。

## 检查

```sh
npm run typecheck
npm test
```

HTTP 测试启动真实独立服务进程，使用外部临时 SQLite／文件目录与随机端口，并真实停止、重启服务验证关联。响应按 OpenAPI Schema 校验。客户端测试从原生请求和文件接口发送到实际 HTTP 服务，不替换成功响应。五语言状态的页面边界测试与模拟器目视检查分别记录。
