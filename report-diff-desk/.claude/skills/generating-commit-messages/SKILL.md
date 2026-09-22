---
name: generating-commit-messages
description: 当用户要求提交代码、执行 git commit、或生成 commit message 时使用。也适用于用户说「提交一下」「帮我 commit」这类已暂存改动、需要按 Conventional Commits 规范生成中文提交信息的场景。
trigger: ["提交代码", "git commit", "生成commit"]
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [git, commit]
---

# 生成规范化的 commit message

## 概述

把暂存区的改动翻译成一条符合 Conventional Commits 的中文提交信息，**给用户确认后**才提交。

核心原则：commit message 写的是**为什么**，不是改了什么——「改了什么」代码本身和 diff 已经说清楚了。类型判断错了比措辞差更致命。

## 工作流

### 步骤 1：摸清现状

并行跑这三条，不要只看 diff：

```bash
git status --short          # 有哪些改动、哪些已暂存
git diff --staged           # 暂存区的具体内容
git log -5 --format='%s'    # 本仓库既有的 message 风格
```

看 `git log` 不是走过场：不同仓库的 scope 习惯差别很大，跟着既有风格写才不会突兀。

**发现以下情况先停下来问用户，不要自己决定：**

- 暂存区里有看着像密钥的文件（`.env`、`credentials.json`、`*.pem`、`id_rsa`）——即使文件名无害也要打开确认内容
- 暂存区的改动横跨多个不相关的模块（一次提交应该只做一件事）
- `git status` 里有大量未跟踪文件，用户可能想把它们一起提交
- 暂存区是空的

不要用 `git add -A` 或 `git add .` 补文件——按文件名逐个加，避免夹带不该提交的东西。

### 步骤 2：判断变更类型

| 类型 | 用于 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复缺陷 |
| `refactor` | 重构（不改变外部行为） |
| `style` | 样式/格式调整 |
| `docs` | 文档 |
| `test` | 测试 |
| `chore` | 构建、依赖、工具链 |

`perf`、`ci`、`revert` 等其余类型见 chinese-commit-conventions。

拿不准时问自己：**用户的体验变了没有？** 变了是 `feat`/`fix`，没变就是 `refactor`/`chore`。

### 步骤 3：生成 message

```
<type>(<scope>): <中文描述>

<body>
```

- **type**：步骤 2 选出的类型，小写
- **scope**：改动的主要模块/组件名，跟仓库既有风格走（如 `export`、`template`、`BookmarkCard`）；跨模块或无法归类时整个括号省略
- **描述**：动宾短语（「添加」「修复」「优化」），不加句号，中文与英文/数字之间留一个空格
- **body**：**先说为什么**（背景、动机、约束），再列关键改动点。不写「修改了 xx 文件」这种 diff 里一眼能看到的流水账

### 步骤 4：确认后提交

把完整 message 展示给用户，**等确认**再执行。

用 HEREDOC 传多行 message，避免引号被 shell 吃掉：

```bash
git commit -m "$(cat <<'EOF'
feat(export): 变动格紫色标记改写本格样式对象

exceljs 的 Cell.model setter 按引用接管 style，701 个非空格只对应
27 个 style 对象，直接写 cell.fill 会把整块同风格区域一起染紫。
- markHits 先脱离共享再写 fill
- 补一条多格共用样式的回归用例
EOF
)"
```

提交后用 `git status` 确认成功。

## 示例

暂存区改了 `src/main/export/excel.ts` 里的染色逻辑：

```
fix(export): 变动格紫色标记不再连带整块同风格区域

exceljs 的 Cell.model setter 按引用接管 style（实测 701 个非空格只对应
27 个 style 对象），直接写 cell.fill 会改到共享对象上。
- markHits 先换成本格自己的 style 再写 fill
- 新增多格共用样式的回归用例
```

## 红线

- **绝不 `git push`**——提交是本地动作，推送要单独征得同意
- **绝不 `--no-verify`** / `--no-gpg-sign`——钩子失败就去修根因
- **绝不 `git add -A` / `git add .`**——逐个文件加
- **绝不 amend 已推送的提交**
- 拿不准 message 该怎么写时，把选项摆给用户选，不要替用户拍板语义

## 常见错误

| 问题 | 修法 |
|---|---|
| 类型选错（把行为变更写成 `refactor`） | 行为变了就是 `feat`/`fix`；`refactor` 的判据是外部行为不变 |
| body 变成文件清单 | 删掉「修改了 x.ts」这类；改成说清动机和取舍 |
| 描述写「更新代码」「改了点东西」 | 无信息量。写清动了什么、为什么 |
| 一次提交混了多件事 | 拆成多条提交，或问用户要不要拆 |
| scope 自造新词 | 看 `git log` 里已有的 scope，跟着用 |
