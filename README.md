# Sync Labels Action

一个用于同步 GitHub 组织受管标签的 composite action。它只修改策略声明为组织所有的标签，并保留每个仓库自行维护的扩展标签。

## 功能

- 从 YAML 文件读取期望标签及其旧名称
- 仅处理策略 Allowlist 中的仓库
- 创建、更新、重命名和删除组织受管标签
- 保留不在组织受管范围内的仓库标签
- 默认使用 dry-run，仅预览而不修改
- 对 GitHub 限流、瞬时服务错误和网络错误进行有限重试
- 只允许通过 HTTPS 连接 GitHub API
- 将每个仓库的同步结果写入 GitHub Actions job summary

运行环境只需要 GitHub-hosted runner 自带的 Ruby，无第三方运行时依赖。

## MathArts 生产自动化

本仓库同时承载 MathArts 当前使用的完整标签治理链路：

- [`.github/labels.yml`](.github/labels.yml)：组织标签的权威定义
- [`.github/label-policy.yml`](.github/label-policy.yml)：受管命名空间、旧标签和仓库 Allowlist
- [`preview-labels.yml`](.github/workflows/preview-labels.yml)：Pull Request、`main` 推送及每周定时的只读漂移检查
- [`sync-labels.yml`](.github/workflows/sync-labels.yml)：受 Environment 保护的手动生产同步
- [`docs/label-governance.md`](docs/label-governance.md)：标签使用、变更和生命周期规则

预览工作流使用仓库 `GITHUB_TOKEN` 和只读权限。生产同步通过 GitHub App 短时效令牌执行，要求 `APP_CLIENT_ID` variable、`APP_PRIVATE_KEY` secret 和 `label-governance-production` Environment。

## 使用

为降低供应链风险，请把 `COMMIT_SHA` 替换为经过审核的完整提交 SHA。

```yaml
- name: Sync organization labels
  uses: matharts/sync-labels-action@COMMIT_SHA
  with:
    token: ${{ steps.app-token.outputs.token }}
    owner: ${{ github.repository_owner }}
    config_file: .github/labels.yml
    policy_file: .github/label-policy.yml
    dry_run: "false"
```

令牌需要读取 Allowlist 仓库；实际同步时还需要管理这些仓库 Issue 标签的权限。建议先以默认的 dry-run 模式运行。

## Inputs

| Input | 必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `token` | 是 | — | 可读取目标仓库并在非 dry-run 模式下管理标签的令牌 |
| `owner` | 是 | — | GitHub 组织名称 |
| `config_file` | 否 | `.github/labels.yml` | 权威标签配置路径 |
| `policy_file` | 否 | `.github/label-policy.yml` | 标签所有权与仓库 Allowlist 策略路径 |
| `dry_run` | 否 | `true` | 仅预览变更 |
| `repository` | 否 | 空 | 只处理 Allowlist 中的一个仓库；可用仓库名或 `owner/repository` |
| `api_url` | 否 | `https://api.github.com` | 可信 GitHub 或 GitHub Enterprise Server 的 HTTPS REST API 地址 |

## 标签配置

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

## 同步策略

```yaml
version: 1

managed:
  prefixes:
    - "type:"
  exact_names:
    - "help wanted"
  legacy_names:
    - bug

repositories:
  include:
    - example
    - docs
```

`prefixes` 中的值必须以冒号结尾。配置中的每个正式标签必须匹配 `prefixes` 或 `exact_names`；每个 alias 也必须出现在 `legacy_names` 中。同步会删除过期的受管标签，但不会删除仓库自有标签。

## 开发

核心代码位于 `src/`，按深模块组织：

- `GovernanceConfig.load(...)` 隐藏 YAML、标签/策略校验和仓库选择
- `RepositorySynchronizer#sync(...)` 负责单仓库差异计算与变更
- `Application#run` 负责多仓库容错和结果聚合
- `SummaryWriter#write(...)` 负责 GitHub Actions summary
- `sync-labels.rb` 仅把环境变量适配到上述接口

```bash
ruby test_sync_labels.rb
ruby script/validate-action-pins.rb
```

CI 会在 Ruby 3.1、3.3 和 3.4 上运行测试，并使用 Actionlint 校验所有工作流。生产调用建议固定到完整提交 SHA；版本标签用于发布说明和人工发现，不替代不可变 SHA 校验。

## License

[MIT](LICENSE)
