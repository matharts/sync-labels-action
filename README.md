# 在多个 GitHub 仓库间同步标签

MathArts Sync Labels 用一份标签清单和一份所有权策略统一组织内的 GitHub 标签。Action 默认只预览变更，只删除策略明确声明为组织所有的标签，并保留各仓库自己的标签。

你需要维护三份文件：

| 文件 | 作用 |
| --- | --- |
| `.github/labels.yml` | 定义组织希望保留的标签 |
| `.github/label-policy.yml` | 定义 Action 可以管理的标签和仓库 |
| GitHub Actions workflow | 决定何时预览或写入变更 |

## 快速开始

以下步骤先运行一次 dry-run。dry-run 会读取仓库并生成完整计划，不会创建、更新、重命名或删除标签。

### 1. 准备令牌

创建仓库 Secret `SYNC_LABELS_TOKEN`。首次预览可以使用 fine-grained personal access token，生产环境建议使用 GitHub App。

按运行模式授予令牌权限：

| 模式 | 仓库访问 | 权限 |
| --- | --- | --- |
| `dry_run: "true"` | 全部目标仓库 | Issues: read |
| `dry_run: "false"` | 全部目标仓库 | Issues: write |

调用仓库的 `GITHUB_TOKEN` 无法读取同一组织中的其他私有仓库。跨仓库同步时，请使用安装到目标仓库的 GitHub App，或明确授权这些仓库的 fine-grained token。

### 2. 定义标签

创建 `.github/labels.yml`：

```yaml
- name: "type: bug"
  color: D73A4A
  description: "已有行为出现错误、缺陷或回归"
  aliases:
    - bug

- name: "help wanted"
  color: "008672"
  description: "维护者欢迎外部贡献"
  aliases: []
```

`aliases` 声明标签的旧名称。上例会把现有的 `bug` 重命名为 `type: bug`，并保留关联的 Issue 和 Pull Request。

### 3. 定义所有权策略

创建 `.github/label-policy.yml`：

```yaml
version: 1

managed:
  prefixes:
    - "type:"
  exact_names:
    - "help wanted"
  legacy_names:
    - bug

safety:
  deletions: allow
  max_deletions_per_repository: 5
  max_deletions_total: 20
```

这份策略允许 Action 管理所有 `type:*` 标签、`help wanted` 和旧名称 `bug`，并在单仓库删除超过 5 个或整次运行删除超过 20 个时阻止写入。其他标签属于仓库，Action 会保留它们。

### 4. 添加预览 workflow

创建 `.github/workflows/preview-labels.yml`。示例固定到当前代码的完整提交 SHA：

```yaml
name: Preview organization labels
on: workflow_dispatch

permissions:
  contents: read

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7
      - uses: matharts/sync-labels-action@353e6f87c38542b506e1dd21bfdf0696c0048d4b
        with:
          token: ${{ secrets.SYNC_LABELS_TOKEN }}
          owner: ${{ github.repository_owner }}
```

完整 SHA 不会随版本标签移动。升级 Action 时，请审核新版本对应的提交，再更新引用。

### 5. 检查预览结果

从 GitHub Actions 页面运行 workflow。日志和 job summary 会按仓库列出创建、更新、重命名、删除、未变化和保留的标签。

## 写入预览过的变更

确认预览结果后，把 `dry_run` 设为 `"false"`：

```yaml
with:
  token: ${{ secrets.SYNC_LABELS_TOKEN }}
  owner: ${{ github.repository_owner }}
  dry_run: "false"
```

写入 workflow 应只允许从 `main` 手动触发。生产环境建议使用 GitHub App 动态创建短期令牌，并通过 GitHub Environment 要求人工批准。仓库内的 [`sync-labels.yml`](.github/workflows/sync-labels.yml) 包含完整配置。

## 常见用法

以下配置覆盖单仓库运行、固定仓库范围和标签漂移检测。

### 只同步一个仓库

使用 `repository` 临时限制本次运行：

```yaml
with:
  token: ${{ secrets.SYNC_LABELS_TOKEN }}
  owner: ${{ github.repository_owner }}
  repository: example
```

如果策略配置了仓库 Allowlist，指定的仓库必须位于 `repositories.include` 中。

### 固定同步的仓库范围

在策略中添加 `repositories.include`：

```yaml
repositories:
  include:
    - example
    - docs
```

省略 `repositories` 或 `include` 时，Action 会同步令牌可见的全部合格组织仓库。显式 `include: []` 会报错，不会意外扩大同步范围。

### 在后续步骤中检测漂移

给 Action 步骤设置 `id`，再读取 `changed` output：

```yaml
- id: labels
  uses: matharts/sync-labels-action@353e6f87c38542b506e1dd21bfdf0696c0048d4b
  with:
    token: ${{ secrets.SYNC_LABELS_TOKEN }}
    owner: ${{ github.repository_owner }}

- if: ${{ steps.labels.outputs.changed == 'true' }}
  run: echo "检测到标签漂移"
```

## Action 如何同步标签

Action 先读取并规划所有目标仓库，生成不可变的整次运行计划；写入模式随后检查删除策略，通过后才开始执行。dry-run 和真实写入使用相同的计划逻辑，但 dry-run 不会被删除上限阻止，因此始终能够显示完整预览。

整次运行按以下顺序处理：

1. 读取所有目标仓库的现有标签
2. 为每个仓库生成并校验 `SyncPlan`
3. 汇总为不可变 `RunPlan`
4. 写入模式检查禁止删除、单仓库删除上限和总删除上限
5. 依次执行成功计划，并记录规划、安全检查和执行失败

计划按以下规则处理标签：

| 仓库状态 | 结果 |
| --- | --- |
| 配置中的标签不存在 | 创建标签 |
| 名称相同，但颜色或描述不同 | 更新标签 |
| 只存在配置声明的一个 alias | 重命名旧标签 |
| 正式标签和 alias 同时存在 | 保留正式标签并删除 alias |
| 受管标签不再出现在配置中 | 删除标签 |
| 标签不属于受管前缀、正式名称或历史名称 | 保留仓库标签 |

默认全部仓库模式会跳过 archived、disabled 和 fork 仓库。如果显式 Allowlist 包含这些仓库，Action 会停止并要求你更新策略。

### 失败时会发生什么

Action 区分规划失败、安全检查失败和写入失败：

- 多个 alias 同时匹配一个正式标签时，该仓库不会产生任何写入
- 所有仓库规划完成前不会发出写请求
- 删除策略不满足时，整次运行不会发出任何写请求
- GitHub API 在写入中途失败时，已完成的操作不会回滚
- 单个仓库失败后，Action 会继续处理其他仓库，并在最后返回失败状态
- job summary 和 outputs 会保留已经完成的操作计数

重新运行会读取仓库的最新状态并生成新计划。如果目标状态没有变化，已经完成的标签会显示为未变化。

## Inputs

Action 的 `with` 配置只需设置 `token` 和 `owner`。其他 inputs 用于覆盖默认路径、运行模式和仓库范围。

| Input | 必需 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `token` | 是 | 无 | 读取目标仓库，并在写入模式管理标签 |
| `owner` | 是 | 无 | 目标 GitHub 组织名称 |
| `config_file` | 否 | `.github/labels.yml` | 标签配置文件路径 |
| `policy_file` | 否 | `.github/label-policy.yml` | 所有权策略文件路径 |
| `dry_run` | 否 | `true` | 只预览变更，不修改标签 |
| `repository` | 否 | 空 | 只处理一个仓库 |
| `api_url` | 否 | `https://api.github.com` | GitHub REST API 或 GitHub Enterprise Server 地址 |

`dry_run` 接受 `true/false`、`1/0`、`yes/no` 和 `on/off`，并忽略大小写与首尾空格。其他值会在访问 GitHub API 前报错。

`api_url` 必须是有效的 HTTPS URL，且不能包含凭据、查询参数或片段。只把令牌发送到你信任的地址。

Action 使用 GitHub 原生 Node.js 24 运行时。调用方不需要安装 Node.js、pnpm 或其他依赖。

## Outputs

Outputs 是本次运行中所有仓库的合计。GitHub Actions 表达式会把所有 output 值作为字符串处理。

| Output | 含义 |
| --- | --- |
| `changed` | 是否存在新建、更新、重命名或删除 |
| `repositories` | 处理的仓库数量，包括失败仓库 |
| `created` | 新建标签总数 |
| `updated` | 更新标签总数 |
| `renamed` | 重命名标签总数 |
| `deleted` | 删除标签总数 |
| `unchanged` | 无需变更的受管标签总数 |
| `preserved` | 保留的仓库扩展标签总数 |
| `failures` | 同步失败的仓库数量 |

dry-run 模式统计完整计划，写入模式只统计已完成的操作。

## 配置校验

Action 在读取任何仓库标签前校验两份配置。无效配置不会触发标签读写。

`labels.yml` 必须满足以下规则：

- 至少包含一个标签
- 标签名称忽略大小写后不能重复，且不能超过 50 个字符
- `color` 必须是六位十六进制颜色值
- 标签描述不能超过 100 个字符
- alias 不能为空，也不能在同一标签中重复
- 每个正式标签必须匹配 `prefixes` 或 `exact_names`
- 每个 alias 必须同时出现在 `legacy_names`
- alias 不能与正式标签同名，也不能映射到多个正式标签

`label-policy.yml` 必须满足以下规则：

- `version` 必须是 `1`
- `prefixes` 必须至少包含一个值，且每个值必须以冒号结尾
- `exact_names` 与 `legacy_names` 不能重叠
- `repositories.include` 配置后必须非空，且仓库名称不能重复
- `safety.deletions` 只能是 `allow` 或 `deny`，未配置时默认为 `allow`
- `max_deletions_per_repository` 和 `max_deletions_total` 必须是非负整数
- 未知字段会直接报错

## 排查问题

先在 workflow 日志中找到第一个错误，再检查对应配置或权限：

- **`401` 或 `403`**：确认令牌可以访问每个目标仓库，并具有当前模式需要的 Issues 权限
- **仓库不在 Allowlist**：把仓库加入 `repositories.include`，或修正 `repository` input
- **正式标签不受管理**：把标签加入 `exact_names`，或让它匹配一个受管前缀
- **alias 未登记**：同时把旧名称加入标签的 `aliases` 和策略的 `legacy_names`
- **仓库状态不支持**：从 Allowlist 移除 archived、disabled 或 fork 仓库
- **一个正式标签匹配多个 alias**：删除多余旧标签，或修正 `aliases` 映射
- **只看到预览结果**：确认 workflow 显式设置 `dry_run: "false"`

### 网络错误和重试

Action 只自动重试读取请求，避免重复创建或修改标签。读取请求遇到网络错误、`429`、`5xx` 或明确的限流 `403` 时，最多重试三次，单次等待不超过 60 秒。

创建、更新和删除请求不会自动重试。写入失败后，请先检查 job summary 和目标仓库，再重新运行同步。

## 参考生产配置

本仓库使用以下文件同步 MathArts 组织的标签：

- [标签定义](.github/labels.yml)
- [同步策略](.github/label-policy.yml)
- [只读预览 workflow](.github/workflows/preview-labels.yml)
- [受保护的写入 workflow](.github/workflows/sync-labels.yml)
- [标签治理规则](docs/label-governance.md)
- [项目路线图](docs/roadmap.md)

MathArts 的策略省略 `repositories.include`，因此预览和写入会覆盖令牌可见的全部合格组织仓库。

## 开发和测试

核心代码按 Plan / Apply 分层：

- [`Application`](src/application.ts) 先规划整次运行、执行安全检查，再隔离执行失败
- [`RunPlan`](src/run-plan.ts) 冻结每仓库计划和规划失败，并执行整次运行删除检查
- [`SyncPlanner`](src/sync-planner.ts) 根据现有标签和配置生成计划
- [`SyncPlan`](src/sync-plan.ts) 校验并冻结计划
- [`SyncExecutor`](src/sync-executor.ts) 预览或执行计划
- [`GitHubClient`](src/github-client.ts) 封装路径、分页、响应和重试
- [`RepositorySelector`](src/repository-selector.ts) 独占仓库范围和状态规则
- [`RunResult`](src/run-result.ts) 用判别联合保存唯一结果，并派生失败和汇总计数

开发环境使用 Node.js 24、项目级 [Nub](https://nubjs.com/)，并通过项目级 `mise.toml` 安装 `package.json` 固定的 pnpm 版本：

```bash
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm check
mise exec -- pnpm build
```

Nub 仅用于直接执行 `script/**/*.ts`；pnpm 仍负责依赖管理，Action bundle 仍在 GitHub 原生 Node.js 24 运行时执行。Nub 在执行 TypeScript 时只负责转译、不执行类型检查，`pnpm check` 会继续使用 `tsc --noEmit` 检查脚本和应用代码的类型。

`dist/index.js` 是提交给 GitHub Actions 执行的单文件 bundle。持续集成会运行严格类型检查、行为测试、固定引用检查，重新构建并验证 `dist/` 没有差异，同时使用 Actionlint 检查 workflow。

迁移等价性由 [`test/fixtures/ruby-v1.3-behavior.json`](test/fixtures/ruby-v1.3-behavior.json) 固定；parity 测试会对照 Ruby v1.3 基线检查配置、仓库选择、读取重试、计划与请求顺序、dry-run、部分失败计数、summary、outputs 和 Unicode 行为。

## 许可证

[MIT](LICENSE)
