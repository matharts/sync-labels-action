# 领域文档

本文件规定工程技能在探索代码库时应如何读取和使用本仓库的领域文档。

## 开始探索前读取以下内容

- 仓库根目录下的 **`CONTEXT.md`**；或者
- 如果仓库根目录存在 **`CONTEXT-MAP.md`**，则读取它指向的、与当前主题相关的各个 `CONTEXT.md`。
- **`docs/adr/`** 中涉及即将修改区域的 ADR。在多上下文仓库中，还应检查 `src/<context>/docs/adr/` 中的上下文专属决策。

如果上述文件不存在，直接继续，不要报告缺失，也不要预先建议创建。`/domain-modeling` 技能会在术语或决策真正确定时按需创建这些文件；该技能可通过 `/grill-with-docs` 和 `/improve-codebase-architecture` 使用。

## 文件结构

单上下文仓库（适用于大多数仓库）：

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文专属决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表中的词汇

当输出中需要命名领域概念时，例如 Issue 标题、重构提案、假设或测试名称，应使用 `CONTEXT.md` 中定义的术语。不要改用术语表明确排除的同义词。

如果术语表尚未包含所需概念，这通常说明你正在创造项目并未使用的语言，应重新考虑；或者项目确实存在术语缺口，应将其记录并交由 `/domain-modeling` 处理。

## 标明与 ADR 的冲突

如果输出与现有 ADR 冲突，应明确指出，不要静默覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重新讨论，因为……_
