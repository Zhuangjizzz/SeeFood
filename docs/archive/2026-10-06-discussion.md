# 2026-10-06 需求与技术讨论索引

本文件保留 Q1–Q21 的主题、确认状态及现行规则位置，用于追溯决定来源。实际开发从[文档入口](../README.md)按功能阅读；PRD 的范围变化继续记录在其[修订记录](../product/prd.md#10-修订记录)中。

| 讨论项 | 确认状态 | 现行位置 |
| --- | --- | --- |
| Q1 本轮交付标准 | 已确认 | [本轮交付](../product/functional-spec.md#1-本轮交付与范围)、[实施与验证](../technical/design.md#validation) |
| Q2 离开结果页后的处理 | 已确认 | [离开与恢复](../product/functional-spec.md#83-离开页面与退出恢复)；PRD A18 |
| Q3 离线回看 | 已确认 | [离线回看](../product/functional-spec.md#82-历史与离线回看)；PRD A19 |
| Q4 偏好修改后的有效性 | 已确认 | [偏好与提示更新](../product/functional-spec.md#6-饮食偏好与提示更新)；PRD A20 |
| Q5 算价歧义与追问 | 留待后续 AI／Prompt 阶段 | [后续 AI 边界](../product/functional-spec.md#53-后续-ai-阶段的边界)；PRD F11／A17 |
| Q6 退出后恢复 | 已确认 | [退出恢复](../product/functional-spec.md#83-离开页面与退出恢复)；PRD A21 |
| Q7 界面语言切换 | 已确认 | [语言切换](../product/functional-spec.md#22-语言切换与内容保留)；PRD A22 |
| Q8 主导航 | 已确认 | [首次进入与主导航](../product/functional-spec.md#21-首次进入与主导航)；PRD A23 |
| Q9 结果页与聊天入口 | 已确认 | [结果页结构](../design/pages.md#images)；PRD A24 |
| Q10 拍照页默认画面 | 已确认 | [输入入口](../product/functional-spec.md#31-输入入口与记录归属)；PRD A25 |
| Q11 多图、长图与关联卡片 | 已确认 | [图片与卡片浏览](../product/functional-spec.md#41-图片与卡片浏览)；PRD A26 |
| Q12 菜单／菜品模式 | 已确认 | [输入模式与记录归属](../product/functional-spec.md#31-输入入口与记录归属)；PRD A27 |
| Q13 多图预览与提交 | 已确认 | [提交前预览](../product/functional-spec.md#32-提交前预览)；PRD A28 |
| Q14 图片失败与断网重试 | 已确认 | [上传、处理与失败](../product/functional-spec.md#33-上传处理与失败)；PRD A29 |
| Q15 菜名编辑 | 已取消 | [首版范围边界](../product/functional-spec.md#1-本轮交付与范围)；PRD A33 |
| Q16 自动保存与空间不足 | 已确认 | [自动保存与容量不足](../product/functional-spec.md#81-自动保存与容量不足)；PRD A30 |
| Q17 删除与独立收藏 | 已确认 | [删除与清空](../product/functional-spec.md#84-删除与清空)、[个人沟通卡](../product/functional-spec.md#7-个人沟通卡与双向文字翻译)；PRD A31 |
| Q18 聊天离开、失败与重试 | 已确认 | [回复状态与重试](../product/functional-spec.md#52-回复状态与重试)；PRD A32 |
| Q19 前后端保存边界 | 已确认 | [ADR 0001：保存边界](../adr/0001-local-history-temporary-processing.md) |
| Q20 前后端技术路线 | 已确认 | [ADR 0002：实现路线](../adr/0002-native-miniprogram-node-service.md) |
| Q21 正式访问身份 | 方案已确认，真实接入待验证 | [ADR 0003：访问身份](../adr/0003-wechat-session-business-token.md) |
