# MathArts 标签治理

本文件定义 MathArts 组织级标签的用途、权限、扩展边界和变更流程。完整标签清单以 [`.github/labels.yml`](../.github/labels.yml) 为唯一权威来源。

## 1. 目标

组织级标签只解决跨仓库协作问题：

- 识别工作类型、处理状态和维护优先级
- 标记兼容性、安全、数据完整性等重要影响
- 连接 RFC、ADR、Specification、发布和治理流程
- 为贡献者提供一致的筛选入口

标签不代替 Issue 内容、负责人、Project 字段、Milestone 或发布计划。

## 2. 权威来源

| 文件                                                      | 职责                                   |
| --------------------------------------------------------- | -------------------------------------- |
| [`.github/labels.yml`](../.github/labels.yml)             | 正式标签、颜色、描述和当前迁移别名     |
| [`.github/label-policy.yml`](../.github/label-policy.yml) | 组织拥有的命名空间、历史名称和仓库范围 |
| 本文件                                                    | 使用规则、权限和生命周期               |

同一事实不得在多个文件重复维护。标签名称和颜色只在 `labels.yml` 中修改。

## 3. 标签系列

| 系列            | 用途                              | 数量规则       | 设置者                 |
| --------------- | --------------------------------- | -------------- | ---------------------- |
| `type:*`        | 主要工作类型                      | 通常恰好一个   | 分流人员或维护者       |
| `status:*`      | 当前需要发生什么                  | 最多一个       | 分流人员或维护者       |
| `priority:*`    | 已确认的处理优先级                | 最多一个       | 维护者                 |
| `impact:*`      | 质量、兼容性或风险影响            | 可以多个       | 贡献者建议，维护者确认 |
| `process:*`     | 与正式流程的关系                  | 可以多个       | 维护者                 |
| `resolution:*`  | 未按普通完成方式关闭的原因        | 关闭时最多一个 | 维护者                 |
| GitHub 约定标签 | `good first issue`、`help wanted` | 按需           | 维护者                 |

未设置某一系列表示“尚未确认”或“不适用”，不应为了填满字段而添加标签。

## 4. 类型与状态

`type:*` 回答“这项工作的主要性质是什么”。当一个事项同时包含多种工作时，选择决定主要验收标准的类型；次要影响写在正文或使用 `impact:*`。

`status:*` 回答“下一步需要什么”。状态变化时应移除旧状态，不持续叠加。

推荐流转：

```text
needs triage
  ├─ needs information / needs reproduction
  ├─ needs decision
  ├─ ready
  └─ closed with resolution:*

ready
  ├─ blocked / waiting upstream
  └─ completed
```

不设置 `status: in progress`。正在处理由 Assignee、Pull Request 或 Project 状态表达，避免维护两套进度事实。

## 5. 优先级

优先级表示维护者确认后的处理顺序，而不是报告者对问题重要性的主张。

- `critical`：正在造成严重或广泛影响，需要立即关注
- `high`：重要且应优先安排
- `medium`：已经排序的正常工作
- `low`：影响有限，可在资源允许时处理

没有优先级表示尚未排序，不等于默认 `medium`。

## 6. 影响与流程

`impact:*` 可以组合，用于提醒审查者检查 Breaking Change、安全、性能、数据完整性、兼容性或弃用影响。

未公开的安全漏洞不得通过标签暴露细节。`impact: security` 只用于公开安全加固或已经协调披露的事项。

`process:*` 只在事项直接参与正式流程时使用：

- `rfc`：提案、评审或 RFC 实施
- `adr`：记录或落实架构决定
- `specification`：规范定义或兼容性约束
- `release`：版本准备、迁移或发布后工作
- `governance`：组织政策、角色、权限或社区治理

普通功能讨论不因为“需要决定”就自动成为 RFC 或治理事项。

## 7. 关闭原因

`resolution:*` 只用于未按普通完成方式关闭的事项，例如重复、不计划处理、无法复现或已被替代。

关闭时应留下简短理由，并在适用时链接替代事项。完成并合并的工作不需要 `resolution:*`。

## 8. 贡献入口

`good first issue` 只用于范围清晰、风险较低、验收条件明确且维护者能够提供评审的事项。

`help wanted` 表示维护者明确欢迎外部贡献并能够评审，不应只因为缺少维护资源而批量添加。

## 9. 仓库级扩展

项目仓库可以维护自己的扩展标签，例如：

- `area:*`：项目内部模块或领域区域
- `package:*`：Monorepo 包或发布单元
- `platform:*`：运行平台或环境
- `upstream:*`：与具体上游依赖的关系

扩展标签不得改变组织级标签的名称或含义。只在一个仓库使用的维度不应加入组织清单。

标签同步器只删除 [`.github/label-policy.yml`](../.github/label-policy.yml) 明确声明为组织所有的标签，其他仓库级标签会被保留。

## 10. 权限

所有贡献者都可以建议标签调整。分流人员和维护者可以根据证据修改类型、状态和影响标签。

只有项目维护者或组织明确授权的角色可以：

- 设置优先级和关闭原因
- 声明 `good first issue` 或 `help wanted`
- 新增项目级标签

只有组织维护者可以修改组织级标签定义、受管命名空间和仓库范围。

## 11. 新增或修改标签

组织级标签变更必须通过本仓库的 Pull Request 提交，并说明：

- 要解决的跨仓库筛选或自动化问题
- 为什么现有标签和 GitHub 原生字段不能表达
- 适用仓库和使用示例
- 与现有标签的重叠
- 迁移、同步和恢复方式

修改颜色或描述时直接更新 `labels.yml`。重命名时，在新标签的 `aliases` 中暂时保留旧名称，并将旧名称加入 `label-policy.yml` 的 `legacy_names`。

所有合格组织仓库完成迁移后，可以移除 `aliases`；`legacy_names` 应继续保留到确认旧标签已经清理完成。

删除标签前应先确认没有自动化、Issue Form、文档或常用查询依赖该标签。

## 12. 跨仓库同步

MathArts 的生产配置省略 `repositories.include`，同步令牌可见的全部合格组织仓库。新建的非 archived、非 disabled、非 fork 仓库会自动进入同步范围。

- [`preview-labels.yml`](../.github/workflows/preview-labels.yml) 使用只读权限预览差异
- [`sync-labels.yml`](../.github/workflows/sync-labels.yml) 只能从 `main` 手动触发真实修改
- 同步实现由独立的 [`matharts/sync-labels-action`](https://github.com/matharts/sync-labels-action) 仓库维护，并固定到经过审核的提交 SHA
- 真实同步受 `label-governance-production` Environment 和 GitHub App 最小权限保护

新增、归档、转移或删除仓库时，必须检查 GitHub App 安装范围和仓库状态。先运行预览并审查创建、重命名、更新、删除和保留项，再批准真实同步。

## 13. 定期审查

至少每六个月检查一次：

- 标签是否仍有实际筛选或自动化用途
- 描述是否与当前用法一致
- 是否存在含义重叠或长期误用
- GitHub App 可见范围是否覆盖全部合格组织仓库
- 迁移别名和历史名称是否可以清理

低使用频率不自动意味着应删除；正式流程或严重影响标签可能使用较少，但仍具有必要价值。
