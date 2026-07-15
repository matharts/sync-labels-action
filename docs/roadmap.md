# MathArts Sync Labels 路线图

更新日期：2026-07-16

本路线图定义项目必须保持的兼容性、当前版本的交付范围、条件版本的启动信号和共同发布门槛。GitHub Milestones 跟踪版本，GitHub Issues 保存实现范围、依赖关系和验收证据。

## 版本状态

项目一次只交付一个次版本。条件版本的 Milestone 保留预期顺序，但不承诺发布日期或最终范围。

| 版本                                                                   | 状态     | 主要结果                             | 启动条件                       |
| ---------------------------------------------------------------------- | -------- | ------------------------------------ | ------------------------------ |
| [`v1.4.0`](https://github.com/matharts/sync-labels-action/milestone/1) | 已发布   | Node.js 24 与整次运行删除保护        | 已完成生产验证                 |
| [`v1.5.0`](https://github.com/matharts/sync-labels-action/milestone/2) | 已发布   | 限定仓库范围，并离线校验配置         | 已完成生产验证                 |
| [`v1.6.0`](https://github.com/matharts/sync-labels-action/milestone/3) | 条件版本 | 提供稳定、可自动处理的故障诊断       | 真实故障样本证明现有报告不足   |
| [`v1.7.0`](https://github.com/matharts/sync-labels-action/milestone/4) | 条件版本 | 输出可长期归档和比较的运行计划       | 实际使用方提出审计或审批需求   |
| [`v1.8.0`](https://github.com/matharts/sync-labels-action/milestone/5) | 条件版本 | 根据代表性运行数据降低多仓库同步时间 | 测量证明串行网络等待是主要瓶颈 |

条件版本只有在启动信号满足后才确定范围和日期。安全修复、GitHub 应用程序编程接口（API）不兼容和当前版本回归可以直接进入补丁版本。

## 跟踪器如何决定工作顺序

路线图、Milestone 和 Issue 分别管理版本边界、版本任务和具体交付。发生冲突时，按以下规则判断：

- 路线图定义版本结果、兼容边界和启动信号
- GitHub Milestone 收集已经分配给该版本的 Issue
- GitHub Issue 定义实现范围和验收条件
- GitHub 原生 Issue 依赖关系决定工单是否可以执行
- 状态标签只用于检索，不覆盖原生依赖关系

若状态标签与依赖摘要不一致，应在分诊时修正标签。不要为绕过依赖而修改路线图。

## 兼容基线：v1.4.0

`v1.4.0` 建立以下兼容契约。后续版本必须保持这些契约，除非单独完成兼容性决策：

- 默认使用 dry-run（预览），并区分组织受管标签和仓库扩展标签
- 规划创建、更新、重命名、删除、未变化和保留操作
- 所有仓库在首个写请求前完成规划和整次运行安全检查
- 读取请求可以重试，写入请求不重试
- 单仓库失败不阻止后续安全计划，并保留准确的部分完成计数
- GitHub Actions 任务摘要和 Action 输出使用同一运行结果
- 未配置 `safety` 的 v1.3 合法配置保持原有计划和最终状态

完整交付内容和生产验证证据由 [`v1.4.0` Release](https://github.com/matharts/sync-labels-action/releases/tag/v1.4.0)和已关闭的 [`v1.4.0` Milestone](https://github.com/matharts/sync-labels-action/milestone/1?closed=1)保存。

## 当前稳定版本：v1.5.0

[`v1.5.0`](https://github.com/matharts/sync-labels-action/releases/tag/v1.5.0) 已在仓库范围、离线校验和现有 workflow 兼容性演练通过后发布；对应 [Milestone](https://github.com/matharts/sync-labels-action/milestone/2?closed=1) 已关闭。该版本让维护者排除不应同步的仓库，并在不提供 GitHub 凭据、不访问网络的情况下验证标签和仓库策略。

### 已交付功能

当前代码在 `v1.4.0` 兼容基线上增加以下能力：

- `RepositoryScope` 统一处理全部仓库、`include`、`exclude`、可选 `repository` input 和仓库状态规则；选择顺序固定为全部仓库或 `include` → `exclude` → 可选 `repository` input
- 配置解析会拒绝重叠、重复或无效的仓库名称；显式选择被排除或不在 allowlist 中的仓库会在访问 GitHub API 前失败
- 全部仓库模式会跳过 archived、disabled 和 fork 仓库；显式选择或 allowlist 命中这些状态时会失败，避免静默扩大或改变范围
- `validate_only` 只加载并交叉校验标签与策略文件，不要求 token 或 owner，不创建 GitHub 客户端，成功时所有同步输出为零
- `pnpm validate:config` 与 Action 复用 `GovernanceConfig`，并支持通过 `--config-file` 和 `--policy-file` 覆盖默认路径
- `changed` 的描述已在实现、Action metadata、README、任务摘要和契约测试中统一

`changed` 的现有运行语义不变：

- 预览模式表示完整计划是否包含变更
- 写入模式表示是否实际完成变更
- 安全检查在首个写请求前阻止运行时为 `false`

### 版本任务

`v1.5.0` 的功能、生产演练和正式发布任务均已完成。

| Issue                                                                                  | 代码状态 | 证据或下一步                                                          |
| -------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| [#28 `repositories.exclude`](https://github.com/matharts/sync-labels-action/issues/28) | 已实现   | `RepositoryScope`、配置交叉校验和接口测试已由 PR #46 交付             |
| [#29 `validate_only`](https://github.com/matharts/sync-labels-action/issues/29)        | 已实现   | Action 调用的校验模式、零 GitHub 客户端路径和零值输出已由 PR #47 交付 |
| [#43 `changed` 输出契约](https://github.com/matharts/sync-labels-action/issues/43)     | 已完成   | 预览与写入语义、Action metadata、摘要和契约测试已由 PR #48 统一       |
| [#30 本地配置校验命令](https://github.com/matharts/sync-labels-action/issues/30)       | 已实现   | 复用 `GovernanceConfig` 的 `pnpm validate:config` 已由 PR #49 交付    |
| [#31 准备候选版本](https://github.com/matharts/sync-labels-action/issues/31)           | 已完成   | PR #57 准备 `v1.5.0-rc.1`，PR #58 将 README 固定到候选提交            |
| [#32 完成生产演练](https://github.com/matharts/sync-labels-action/issues/32)           | 已完成   | 候选提交通过组织预览、离线校验和现有 workflow 兼容性演练              |
| [#33 发布正式版本](https://github.com/matharts/sync-labels-action/issues/33)           | 已完成   | 发布 `v1.5.0`，更新固定引用，并通过发布后主分支测试和组织预览         |

### 架构与质量结果

架构深化与质量加固已随功能落地，不增加独立功能范围：

| 模块或门槛                 | 当前结果                                                                                                                    | 交付证据                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `RepositoryScope`          | 集中仓库范围解析、选择顺序、显式仓库限制和仓库资格规则；测试通过 `create` 与 `select` 接口验证可观察行为                    | [PR #46](https://github.com/matharts/sync-labels-action/pull/46)                                                                   |
| Action 调用                | `runAction` interface 集中模式前置要求、配置加载、仓库选择、整次规划、执行和 Action 报告发布；校验模式不创建 GitHub adapter | [PR #52](https://github.com/matharts/sync-labels-action/pull/52)                                                                   |
| `GovernanceConfig`         | Action 与本地命令共享同一配置加载、规范化和交叉校验实现                                                                     | [PR #49](https://github.com/matharts/sync-labels-action/pull/49)                                                                   |
| `OperationCounts`          | 集中六类同步操作的字段映射、零值、聚合和 `changed`，计划、执行与报告消费同一计数事实                                        | [PR #53](https://github.com/matharts/sync-labels-action/pull/53)                                                                   |
| `RunResult` 与 Action 报告 | 通过不可变运行统计派生摘要、计数、失败状态和 `changed`；不提前引入 v1.6 的稳定故障分类                                      | [PR #51](https://github.com/matharts/sync-labels-action/pull/51)、[PR #53](https://github.com/matharts/sync-labels-action/pull/53) |
| 自动验证                   | Vitest 对 `src/**/*.ts` 强制逐文件语句、分支、函数和行覆盖率均为 100%，任何回退都会使 `pnpm check` 失败                     | [PR #54](https://github.com/matharts/sync-labels-action/pull/54)                                                                   |

### 发布门槛与维护状态

从当前代码和契约测试可验证的门槛已经满足：

- 全部仓库、仅 `include`、仅 `exclude`、组合规则和显式单仓库都有接口测试
- archived、disabled、fork 和 `exclude` 的组合不会扩大同步范围
- `validate_only` 不要求 token 或 owner，且不会创建 GitHub 客户端
- 本地命令与 Action 使用同一个 `GovernanceConfig` 校验入口
- 未设置新 input 的运行保持 Ruby `v1.3` 与 `v1.4.0` 兼容基线
- `changed`、操作计数和失败状态的语义在公开描述和契约测试中一致
- `src/**/*.ts` 的语句、分支、函数和行覆盖率均按文件达到 100%

生产演练、稳定 Release、固定引用及发布后主分支测试和组织预览均已完成。项目继续维护 `v1.5.x`；后续条件版本仅在各自启动信号满足后进入交付。

### 不属于 v1.5.0

以下能力需要独立的启动证据和版本边界：

- 改变 `changed` 的现有运行语义
- 引入稳定的错误原因分类或新的故障输出
- 输出计划文件、计划摘要或审批门禁
- 并发、缓存或批处理优化

## 条件版本

条件版本只有在启动信号满足后才进入实现。启动前必须创建或更新调查 Issue，记录证据、使用方、兼容边界和暂缓条件。

### v1.6.0：稳定故障诊断

本版本的目标是让维护者和自动化稳定判断失败阶段、原因类别和处理方式。启动条件和候选边界如下：

- **启动信号**：`v1.5.0` 发布后，至少一个脱敏的真实故障样本证明当前日志与任务摘要不足
- **启动调查**：使用 [#34 真实故障样本调查](https://github.com/matharts/sync-labels-action/issues/34)验证阶段和原因是否稳定、正交且可处理
- **候选范围**：失败阶段、经过筛选的原因类别、`failed_repositories` 输出和任务摘要处置建议
- **安全边界**：不得输出令牌、响应正文或敏感响应头

没有足够样本时，项目继续维护 `v1.5.x`，不启动诊断分类框架。

### v1.7.0：可归档运行计划

本版本的目标是让实际使用方长期留档并稳定比较同步计划。启动条件和候选边界如下：

- **启动信号**：至少一个使用方需要跨运行比较、审计或审批，并证明现有任务摘要不足
- **启动决策**：先确定计划使用者、保留周期、兼容性和敏感字段边界
- **候选范围**：带版本的规范化 JavaScript Object Notation（JSON）计划、稳定摘要和 GitHub Actions 制品上传示例
- **版本边界**：首个版本只生成计划，不增加写入审批门禁

`expected_plan_digest` 等审批输入只能在计划格式经过实际使用后单独评估。

### v1.8.0：多仓库性能优化

本版本的目标是在不削弱安全和确定性的前提下降低多仓库同步时间。启动条件和候选边界如下：

- **启动信号**：至少两次代表性运行记录仓库数、请求数、阶段耗时、重试和限流，并证明串行网络等待是主要瓶颈
- **启动决策**：固定工作负载、测量方法、改善目标和允许的并发上限
- **候选范围**：优先评估保序、有上限的只读规划并发
- **安全边界**：跨仓库写入并发不是默认方案

所有仓库仍须在首个写请求前完成规划和整次运行安全检查。同一仓库内的写入继续串行，结果、计数、任务摘要、Action 输出和日志顺序保持确定。

## 发布与维护规则

每个版本使用相同的范围和质量规则：

- 每个次版本只交付一个主要结果
- 每个实现 Issue 由一个聚焦的 Pull Request 完成
- 候选版本先完成真实演练，再发布正式版本
- 发布演练、文档同步和正式发布分别跟踪
- 补丁版本只处理回归、安全修复和 GitHub API 兼容问题
- 补丁版本不改变同步范围、删除语义、配置格式或 Action 输出含义
- 只有默认删除行为、配置主版本或既有输出语义必须改变时，才规划 `v2.0.0`

每个版本还必须满足以下共同门槛：

- Node.js 24 类型检查、行为测试、可复现单文件打包产物和工作流静态检查全部通过
- 第三方 Action 固定到完整提交哈希或容器 digest
- 配置、仓库选择、规划、执行、报告和主入口都有接口级行为测试
- README、Action metadata、路线图和版本元数据保持一致
- 写入行为发生变化时，完成全组织预览、单仓库写入和失败恢复演练
- 日志、计划、任务摘要和 Action 输出不暴露令牌或敏感响应字段

## 路线图外

以下能力不进入当前路线图：

- 同步 Milestone、Project 字段、Issue 内容或负责人
- 自动创建或分发 GitHub App 凭据
- 自动重试结果未知的创建、更新、重命名或删除请求
- 没有真实使用方或测量证据的新策略字段、并发、缓存或批处理优化
