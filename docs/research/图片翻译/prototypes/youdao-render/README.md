# 有道图片翻译原型

这是抛弃式 API 原型，验证“有道 REST 能否直接返回译图，以及菜单价格和长图排版是否可用”。没有接入小程序。代码与实测保存在 `codex/prototype-youdao-render` 分支，不作为生产实现。

## 结论与查看

2026-10-06 已完成 32 次真实调用，使用用户授权的应用。`render=1` 确实返回 `render_image`（Base64 JPEG），同时返回原文、译文和坐标。能成图，菜单展示质量尚未通过。[实测结论](results/结论.md)

双击 [demo.html](demo.html) 即可查看。此文件包含所有测试图片和真实响应记录，支持原图／译图、目标语言、传统／Pro 和整图／分段切换。它只回放结果，没有密钥、网络请求或付费调用。[逐项对照](results/对照.md)

浏览器已检查文字模式不显示译图、中文模式直接显示原图、Pro 英文价格对照，以及分段模式的累计耗时和全图坐标。生成脚本语法、结果图片解码和凭证落盘检查均通过。[演示截图](results/demo-screenshot.jpg)

## 需要提供什么

- 有道应用 ID 和应用密钥，应用需绑定“图片翻译”实例，并有可用余额或体验金。本次调用已成功，无需再提供凭证。
- 下一阶段需要真实中文菜单照片、电子菜单截图和长截图，提供可读取的本地路径或在聊天中附图即可；避免带入个人信息。最好有单列、多列、带菜品照片，以及实际使用设备和网络的样本。
- 需要能审阅英语、日语、韩语、西班牙语的人员检查译文。当前合成测试不证明真实菜单或四种语言的翻译质量达标。

## 运行

Python 3.10+ 和 Pillow。可在此目录创建隔离环境；本次使用 Codex 自带 Python 3.12.14 / Pillow 12.3.0。

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py --sample single --languages en
```

程序会隐藏输入应用 ID 和密钥，也支持 `YOUDAO_APP_KEY`、`YOUDAO_APP_SECRET` 环境变量。凭证不写入图片、HTML、源码或响应日志。本次临时凭证通过关闭终端回显的标准输入注入，未落盘。不要把密钥放进启动命令或提交文件。

```bash
# 重新生成合成样本（macOS 使用系统中文字体；其他系统可设置 PROTOTYPE_FONT）
.venv/bin/python run.py --generate-samples
# 六类样本、四个目标语言，串行调用
.venv/bin/python run.py --sample all --languages en,ja,ko,es --output new-smoke
# 同一张图的文字响应与 Pro 对照
.venv/bin/python run.py --sample single --languages en --render 0 --output new-render0
.venv/bin/python run.py --sample single --languages en,ja --model 1 --output new-pro
# 按合成样本的已知行间空隙切片；真实菜单不使用这些固定切点
.venv/bin/python run.py --sample long-tile-0,long-tile-1,long-tile-2,long-tile-3 --languages en --output new-tiles
# 自选图片的输出默认放在 Git 忽略的 local-* 目录
.venv/bin/python run.py --image /absolute/path/menu.jpg --languages en
# 用已保存的 2026-10-06 响应重新构建离线查看文件，无 API 调用
.venv/bin/python build_demo.py
```

调用默认传统 NMT：`from=zh-CHS`、`render=1`、`translateOption=0`。`--model 1` 为 Pro，2 为 Lite；Lite 本轮未测。程序每次调用后等待 1.2 秒，遇到账户/授权错误停止后续调用，不自动重试。默认采用 Base64 小于 5,000,000 字节的保守输入上限。

`samples/manifest.json` 保存样本来源、尺寸与预期菜名/价格位置；暗光斜拍样本的标注仍在旋转前坐标，仅用于说明生成内容。插图是几何图形，不是食物照片。本轮不测试真实拍摄、真实纹理修复、任意长图上限、同时多用户、精确账单或小程序端到端耗时。

## 实测产物与来源

- `results/2026-10-06-smoke/`：25 次传统整图调用（6 张 × 4 语言，加首次英文验证）。
- `results/2026-10-06-render0/`：1 次无回填文字对照。
- `results/2026-10-06-long-tiles/`：4 次英文切片调用及分段合成图。
- `results/2026-10-06-model-pro/`：2 次单列 Pro 对照。
- 每组 `requests.jsonl` 记录全部调用、参数、耗时、尺寸、状态、原文和译文；`.response.json` 保存响应，图片 Base64 替换成字节数及尺寸，图片另存。调用秘密及签名不记录。

接口和签名依据：[有道图片翻译 API](https://ai.youdao.com/DOCSIRMA/html/trans/api/tpfy/index.html)。费用估算依据：[官方定价](https://ai.youdao.com/DOCSIRMA/html/trans/price/tpfy/index.html)。历史资料与未知项见[调研报告](../../调研报告.md)。
