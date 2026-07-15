# Issue 跟踪器：GitHub

本仓库的 Issue 和 PRD 均保存在 GitHub Issues 中。所有操作均使用 `gh` CLI。

## 约定

- **创建 Issue**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取 Issue**：运行 `gh issue view <number> --comments`，使用 `jq` 过滤评论，并同时获取标签。
- **列出 Issue**：运行 `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，并按需添加 `--label` 和 `--state` 过滤条件。
- **评论 Issue**：`gh issue comment <number> --body "..."`
- **添加或移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭 Issue**：`gh issue close <number> --comment "..."`

根据 `git remote -v` 推断仓库；在克隆仓库内运行时，`gh` 会自动完成此操作。

## 将 Pull Request 作为分诊入口

**PRs as a request surface: no.** _（如果本仓库将外部 Pull Request 视为功能请求，可改为 `yes`；`/triage` 会读取此标志。）_

设置为 `yes` 后，Pull Request 将使用与 Issue 相同的标签和状态，并通过对应的 `gh pr` 命令操作：

- **读取 Pull Request**：使用 `gh pr view <number> --comments` 查看内容和评论，使用 `gh pr diff <number>` 查看差异。
- **列出待分诊的外部 Pull Request**：运行 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的条目，排除 `OWNER`、`MEMBER` 和 `COLLABORATOR`。
- **评论、添加标签或关闭**：使用 `gh pr comment`、`gh pr edit --add-label` / `--remove-label`、`gh pr close`。

GitHub 的 Issue 和 Pull Request 共用同一编号空间，因此单独的 `#42` 可能指向任意一种对象。先运行 `gh pr view 42`，失败后再运行 `gh issue view 42`。

## 当技能要求“发布到 Issue 跟踪器”时

创建一个 GitHub Issue。

## 当技能要求“获取相关工单”时

运行 `gh issue view <number> --comments`。

## 路线规划操作

供 `/wayfinder` 使用。一个**路线图**由一个主 Issue 和多个子 Issue 组成。

- **路线图**：使用带有 `wayfinder:map` 标签的单个 Issue，正文包含“备注”“已有决策”和“待探索区域”。使用 `gh issue create --label wayfinder:map` 创建。
- **子工单**：通过 GitHub 子 Issue 关系将工单关联到路线图，使用 `gh api` 调用子 Issue 端点。如果未启用子 Issue，则在路线图正文中添加任务列表，并在子工单正文顶部写入 `Part of #<map>`。标签为 `wayfinder:<type>`，其中类型是 `research`、`prototype`、`grilling` 或 `task`。工单被认领后，将其分配给负责推进的开发者。
- **阻塞关系**：使用 GitHub 原生 Issue 依赖关系作为规范且在界面中可见的表示。通过 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加依赖边。其中 `<blocker-db-id>` 是阻塞 Issue 的数字型数据库 ID，通过 `gh api repos/<owner>/<repo>/issues/<n> --jq .id` 获取，不能使用 `#number` 或 `node_id`。GitHub 的 `issue_dependencies_summary.blocked_by` 仅统计未关闭的阻塞项，可作为实时门禁。如果依赖功能不可用，则在子工单正文顶部添加 `Blocked by: #<n>, #<n>`。所有阻塞工单关闭后，该工单才算解除阻塞。
- **查询可执行工单**：列出路线图中所有未关闭的子工单，使用 `gh issue list --state open` 并限定到路线图的子 Issue 或任务列表。排除存在未关闭阻塞项或已有负责人认领的工单，按路线图顺序选择第一个符合条件的工单。
- **认领**：运行 `gh issue edit <n> --add-assignee @me`。这是会话中的首次写操作。
- **解决**：先运行 `gh issue comment <n> --body "<answer>"`，再运行 `gh issue close <n>`，最后在路线图的“已有决策”中追加上下文指针（gist 及其链接）。
