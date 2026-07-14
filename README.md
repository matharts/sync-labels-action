# Sync Labels Action

一个用于同步 GitHub 组织受管标签的 composite action。它只修改策略声明为组织所有的标签，并保留每个仓库自行维护的扩展标签。

## 功能

- 从 YAML 文件读取期望标签及其旧名称
- 仅处理策略 Allowlist 中的仓库
- 创建、更新、重命名和删除组织受管标签
- 保留不在组织受管范围内的仓库标签
- 默认使用 dry-run，仅预览而不修改
- 将每个仓库的同步结果写入 GitHub Actions job summary

运行环境只需要 GitHub-hosted runner 自带的 Ruby，无第三方运行时依赖。

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
| `api_url` | 否 | `https://api.github.com` | GitHub REST API 地址 |

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

```bash
ruby test_sync_labels.rb
```
