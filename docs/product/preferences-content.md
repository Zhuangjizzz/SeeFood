# 饮食偏好选项与文案

本页记录 T04 使用的内容边界，供后续偏好检查接入复用。行为仍以[功能规格第 6 节](functional-spec.md#6-饮食偏好与提示更新)为准。

## 三类选项

| 分组 | 稳定选项值 | 页面含义 |
| --- | --- | --- |
| 过敏信息 | `peanuts`、`tree-nuts`、`milk`、`egg`、`fish`、`crustacean-shellfish`、`wheat`、`soy`、`sesame` | 花生、树坚果、乳、蛋、鱼、甲壳类、小麦、大豆、芝麻；甲壳类用虾、蟹举例，不扩大为全部贝类或海鲜 |
| 饮食限制 | `vegetarian`、`vegan`、`no-pork`、`no-alcohol`、`halal`、`kosher` | 素食、纯素、不吃猪肉、不摄入酒精、清真饮食要求、犹太洁食要求 |
| 口味偏好 | `mild`、`light`、`sweet` | 少辣、清淡、甜口；不喜欢的食材可在本组文字中补充 |

三组各有独立的自由文字补充。素食选项在本页面明确为不吃肉与鱼、可接受蛋奶；纯素不摄入动物来源食材。更细的限制、过敏食物种类与宗教要求由用户补充，不从简短标签推断完整规则。

`halal` 与 `kosher` 记录用户的饮食要求，不能证明某道菜、制作过程或餐厅已经获得认证。它们不等价于 `no-pork`。页面明确提醒向店员确认配料、制作条件与认证。

## 核验依据

本轮查阅了以下原始来源。来源用于核对选项含义，不把其适用地区的标签清单作为世界范围的完整过敏原清单。

- [FDA：What is a major food allergen?](https://www.fda.gov/industry/fda-basics-industry/what-major-food-allergen)列出上述九类食品；页面仍提供补充入口，并说明选项未涵盖所有过敏原。
- [FDA：Food Allergies](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies)说明其他食品也可能构成过敏风险，以及制作过程中交叉接触的含义。页面不将没有提示表述为安全保证。
- [Vegetarian Society：Eating veggie](https://vegsoc.org/eating-veggie/)及[素食说明](https://vegsoc.org/blog/become-a-vegetarian/)核对不吃肉、鱼与蛋奶的区别；[The Vegan Society：Definition of veganism](https://www.vegansociety.com/go-vegan/definition-veganism)核对纯素饮食不摄入动物来源食品。
- [IFANCA：What is halal?](https://ifanca.org/faqs/what-is-halal/)涉及来源、屠宰与受禁止材料污染等条件，不能只用是否含猪肉判断。
- [OU Kosher：Certification basics](https://oukosher.org/get-certified-application/)涉及配料、加工、设备和认证核验，不能从菜名或照片推断资质。

英文、日文、韩文、西班牙文与简体中文静态文案位于 `miniprogram/core/preferences-copy.js`。选项名称可随界面语言切换，用户补充文字保持原文。本轮完成来源核对和静态翻译；真实生成质量及专业人工语言审校不属于本轮固定模拟验收。

## 保存与请求映射

尚未设置时，请求使用空的版本 1 快照；首次成功保存为版本 2，之后每次成功统一保存递增。失败不会递增版本，也不会替换已保存内容。即使用户保存空表单，“我的”也只说明未填写具体偏好，不声称无过敏或无限制。

本机按三组保存选项与 `notes` 原文对象。请求快照只包含 OpenAPI 既有的 `version`、`allergies`、`restrictions`、`tastes`、`notes`；非空补充以 `[allergies]`、`[restrictions]`、`[tastes]` 分组，原文不改写。表单始终从本机分组字段恢复，不反解析请求文字。
