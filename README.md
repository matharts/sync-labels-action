# 在多个 GitHub 仓库间同步标签

MathArts Sync Labels 让你用两份 YAML 文件统一多个 GitHub 仓库的标签。它默认只预览变更，只删除策略明确声明为组织所有的标签，并保留各仓库自己的标签。

## 先运行一次安全预览

首次运行需要一个令牌、两份配置文件和一个 GitHub Actions workflow。以下步骤会预览差异，不会修改任何标签。

### 1. 准备令牌

首次预览可以使用 fine-grained personal access token。把它保存为仓库 Secret `SYNC_LABELS_TOKEN`，并只授权需要同步的仓库。

生产环境建议使用 GitHub App。不要长期保存短期的安装令牌；请在 workflow 中通过 App ID 和私钥动态创建。仓库内的 [`sync-labels.yml`](.github/workflows/sync-labels.yml) 展示了完整配置。

预览只需读取 Issues，写入则需要修改 Issues。请按运行模式授予以下权限：

| 模式 | 仓库访问 | 权限 |
| --- | --- | --- |
| 预览，`dry_run: "true"` | 解析后的全部目标仓库 | Issues: read |
| 写入，`dry_run: "false"` | 解析后的全部目标仓库 | Issues: write |

调用仓库的 `GITHUB_TOKEN` 无法读取同一组织中的其他私有仓库。跨仓库同步时，请使用安装到目标仓库的 GitHub App，或明确授权这些仓库的 fine-grained token。

### 2. 定义标签

在调用 Action 的仓库中创建 `.github/labels.yml`。每个条目定义标签的名称、颜色、描述和旧名称：

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

`aliases` 用于重命名。仓库中存在 `bug` 时，Action 会把它重命名为 `type: bug`，保留关联的 Issue 和 Pull Request。

### 3. 定义同步策略

创建 `.github/label-policy.yml`。策略决定哪些标签归组织管理；省略仓库范围时，Action 默认同步令牌可见的全部合格组织仓库：

```yaml
version: 1

managed:
  prefixes:
    - "type:"
  exact_names:
    - "help wanted"
  legacy_names:
    - bug
```

这份策略允许 Action 管理所有 `type:*` 标签和 `help wanted`。`bug` 是迁移中的旧名称，因此也属于受管标签。

如果只想同步指定仓库，请添加 `repositories.include`：

```yaml
repositories:
  include:
    - example
    - docs
```

省略 `repositories`、省略 `include` 或设置 `include: []` 都表示同步全部合格仓库。默认全部模式会跳过 archived、disabled 和 fork 仓库；显式 Allowlist 遇到这些仓库时会停止并要求你更新策略。

### 4. 添加预览 workflow

创建 `.github/workflows/preview-labels.yml`。以下示例使用支持默认全部仓库的 `v1.1.0`：

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
      - uses: matharts/sync-labels-action@v1.1.0
        with:
          token: ${{ secrets.SYNC_LABELS_TOKEN }}
          owner: ${{ github.repository_owner }}
          dry_run: "true"
```

从 GitHub Actions 页面手动运行这个 workflow。Action 会在日志和 job summary 中列出每个仓库的创建、更新、重命名、删除和保留项目。

正式使用时，把 `v1.1.0` 替换为该版本经过审核的完整提交 SHA。完整 SHA 不会随版本标签移动。

## 确认后写入变更

确认预览结果后，把 `dry_run` 改为 `"false"`。写入令牌必须拥有目标仓库的 Issues: write 权限。

```yaml
with:
  token: ${{ secrets.SYNC_LABELS_TOKEN }}
  owner: ${{ github.repository_owner }}
  dry_run: "false"
```

真实同步会修改标签。建议把写入 workflow 设为仅允许从 `main` 手动触发，并使用 GitHub Environment 要求人工批准。仓库内的 [`sync-labels.yml`](.github/workflows/sync-labels.yml) 展示了 GitHub App 短期令牌、Environment 和并发保护的完整配置。

## 了解 Action 会修改什么

Action 会比较配置和每个目标仓库的现有标签。它只删除策略声明为组织所有的标签，并按以下规则处理差异：

| 仓库状态 | 结果 |
| --- | --- |
| 配置中的标签不存在 | 创建标签 |
| 名称相同，但颜色或描述不同 | 更新标签 |
| 只存在配置声明的一个 alias | 重命名旧标签 |
| 正式标签和 alias 同时存在 | 保留正式标签并删除 alias |
| 受管标签不再出现在配置中 | 删除标签 |
| 标签不属于受管前缀、正式名称或历史名称 | 保留仓库标签 |

默认全部模式会跳过归档、禁用和 fork 仓库；显式 Allowlist 会拒绝这些仓库。单个仓库同步失败时，Action 会继续处理其他仓库，并在最后返回失败状态。

## 遵守配置规则

Action 在读取任何仓库标签前校验配置。配置必须满足以下规则：

- `labels.yml` 必须包含至少一个标签
- 标签名称忽略大小写后不能重复
- `color` 必须是六位十六进制颜色值
- 每个正式标签必须匹配 `prefixes` 或 `exact_names`
- 每个 alias 必须同时出现在 `legacy_names`
- alias 不能与正式标签同名，也不能映射到多个正式标签
- `prefixes` 中的值必须以冒号结尾
- `exact_names` 与 `legacy_names` 不能重叠
- `repositories.include` 可省略；非空时，仓库名称不能重复

省略 `repositories.include` 时，新建的合格组织仓库会自动进入同步范围。需要固定同步范围时，请使用显式 Allowlist。

## 配置 Action inputs

设置 `token` 和 `owner` 后，Action 会使用默认配置路径并运行 dry-run。你可以用以下输入覆盖默认行为：

| Input | 必需 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `token` | 是 | 无 | 读取目标仓库，并在写入模式管理标签 |
| `owner` | 是 | 无 | 目标 GitHub 组织名称 |
| `config_file` | 否 | `.github/labels.yml` | 标签配置文件路径 |
| `policy_file` | 否 | `.github/label-policy.yml` | 同步策略文件路径 |
| `dry_run` | 否 | `true` | 只预览变更，不调用写入接口 |
| `repository` | 否 | 空 | 只处理一个仓库；显式 Allowlist 模式下，该仓库必须位于 `include` 中 |
| `api_url` | 否 | `https://api.github.com` | GitHub REST API 或可信 GitHub Enterprise Server 的 HTTPS 地址 |

运行环境需要 Ruby 3.1 或更高版本。GitHub-hosted runner 已包含可用的 Ruby，不需要安装 Gem。

## 排查常见失败

先在 workflow 日志中找到第一个错误。再按下面的列表检查对应配置或权限：

- **`401` 或 `403`**: 确认令牌可以访问每个目标仓库，并具有当前模式需要的 Issues 权限
- **仓库不在 Allowlist**: 把仓库名加入 `repositories.include`，或修正 `repository` 输入
- **正式标签不受管理**: 把标签加入 `exact_names`，或让它匹配一个受管前缀
- **alias 未登记**: 同时把旧名称加入标签的 `aliases` 和策略的 `legacy_names`
- **仓库状态不支持**: 从显式 Allowlist 移除 archived、disabled 或 fork 仓库
- **只看到预览结果**: 确认写入 workflow 显式设置 `dry_run: "false"`

错误详情会出现在 workflow 日志中。已开始处理仓库后，汇总结果也会写入 GitHub Actions job summary。

## 参考 MathArts 的生产配置

本仓库包含一套正在使用的生产配置。你可以分别参考标签定义、策略、workflow 和治理规则：

- [标签定义](.github/labels.yml)
- [同步策略](.github/label-policy.yml)
- [只读预览 workflow](.github/workflows/preview-labels.yml)
- [受保护的写入 workflow](.github/workflows/sync-labels.yml)
- [标签治理规则](docs/label-governance.md)

## 开发和测试

核心代码位于 `src/`。运行以下命令检查行为和外部 Action 固定引用：

```bash
ruby test_sync_labels.rb
ruby script/validate-action-pins.rb
```

持续集成会在 Ruby 3.1、3.3 和 3.4 上运行测试。Actionlint 会同时检查所有 workflow。

## 许可证

[MIT](LICENSE)
