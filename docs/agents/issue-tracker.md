# 问题跟踪：GitHub

本仓库的问题和需求说明统一存放在 `Zhuangjizzz/SeeFood` 的 GitHub Issues 中。使用 `gh` 命令行工具进行操作。

## 操作约定

- **创建工单**：`gh issue create --title "..." --body-file <body-file>`。将多行正文保存为 UTF-8 文件，并通过 `--body-file` 传入文件路径。
- **读取工单**：`gh issue view <number> --comments`。需要结构化输出时，使用 `gh issue view <number> --json number,title,body,state,labels,comments,author,assignees,createdAt,updatedAt`；需要筛选时，再添加 `--jq`。
- **列出工单**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，并根据需要设置 `--label` 和 `--state` 筛选条件。
- **添加工单评论**：`gh issue comment <number> --body-file <body-file>`
- **添加或移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭工单**：`gh issue close <number> --comment "..."`

在本地克隆的 SeeFood 仓库目录中运行这些命令，让 `gh` 根据 Git 远程地址识别仓库。在该目录之外运行时，需为工单和拉取请求（PR）命令添加 `--repo Zhuangjizzz/SeeFood`。多行评论和 PR 描述也应保存为 UTF-8 正文文件，并通过 `--body-file` 传入。

## 是否将拉取请求作为需求分流入口

**PRs as a request surface: no.**（是否将 PR 作为需求入口：否。若本仓库将外部 PR 作为功能请求处理，则将标记中的 `no` 改为 `yes`；`/triage` 会读取此标记。）

GitHub 的工单和 PR 共用一套编号，因此单独出现的 `#42` 可能指其中任意一种。先用 `gh pr view 42` 查询；如果无法按 PR 读取，再用 `gh issue view 42` 查询。

## 技能要求“发布到问题跟踪系统”时

对应的英文指令为 "publish to the issue tracker"。此时创建一个 GitHub 工单。

## 技能要求“获取相关工单”时

对应的英文指令为 "fetch the relevant ticket"。此时运行 `gh issue view <number> --comments`。

## 项目探索与推进（Wayfinding）操作

本节供 `/wayfinder` 使用。**路线图（map）**是一个汇总工单，各项工作以**子工单（child）**的形式关联到路线图。

- **路线图（Map）**：一个带有 `wayfinder:map` 标签的汇总工单，正文包含 Notes（笔记）、Decisions-so-far（已作出的决策）和 Fog（尚未明确的问题）三个部分。创建命令：`gh issue create --label wayfinder:map`。
- **子工单（Child ticket）**：通过 GitHub 子工单关联到路线图，使用 `gh api` 调用子工单接口。若未启用子工单功能，则将子工单加入路线图正文的任务列表，并在子工单正文顶部写入 `Part of #<map>`。使用 `wayfinder:<type>` 标签，其中类型为 `research`（调研）、`prototype`（原型）、`grilling`（深入追问）或 `task`（任务）。认领后，将工单指派给负责推进的开发者。
- **阻塞关系（Blocking）**：以 GitHub 的**原生工单依赖关系**为准，依赖关系可直接在界面中查看。使用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加依赖。其中，`<blocker-db-id>` 是前置工单的数字型**数据库 ID**，通过 `gh api repos/<owner>/<repo>/issues/<n> --jq .id` 获取，不能使用 `#number` 或 `node_id`。GitHub 返回的 `issue_dependencies_summary.blocked_by` 仅统计尚未关闭的前置工单，用于实时判断阻塞状态。若无法使用原生依赖关系，则在子工单正文顶部写入 `Blocked by: #<n>, #<n>`。所有前置工单关闭后，该工单才解除阻塞。
- **查询下一项可推进的工作（Frontier query）**：列出路线图中尚未关闭的子工单，使用 `gh issue list --state open`，并将范围限定为该路线图的子工单或任务列表。排除仍有未关闭前置工单的条目（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中存在尚未关闭的工单），同时排除已指派负责人的条目。按照路线图中的顺序，选择第一个符合条件的工单。
- **认领（Claim）**：运行 `gh issue edit <n> --add-assignee @me`。这是本次会话的第一次写操作。
- **完成（Resolve）**：先运行 `gh issue comment <n> --body-file <answer-file>`，再运行 `gh issue close <n>`，最后在路线图的 Decisions-so-far 部分追加上下文指引，包含要点摘要和链接。
