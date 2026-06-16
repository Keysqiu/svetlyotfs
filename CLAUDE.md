# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

一个 VSCode 扩展，通过调用本地 `tf.exe` CLI 实现对 **Team Foundation Server (TFS/TFVC)** 版本控制的集成。支持挂起更改视图、文件批注(blame)、工作区切换、文件比较等。

## 构建与开发命令

源码位于 `vscode-tfs/` 子目录，所有命令需在该目录下执行：

```bash
cd vscode-tfs

# 安装依赖
yarn install

# 编译 (tsc)
yarn compile

# 监听模式编译
yarn watch

# 运行测试 (mocha + ts-node)
yarn test

# 单独运行某个测试文件
yarn test -- --grep "test name pattern"

# Lint (eslint)
yarn lint

# 格式化 (prettier)
yarn fix

# 打包发布 (vsce)
yarn vscode:prepublish
```

VSCode 引擎要求 `^1.86.0`。

## 架构概览

```
vscode-tfs/src/
├── extension.ts              # 入口：activate() 检查 TFS 工作区，注册 providers
├── TFS/
│   ├── Commands.ts           # TFSCommandExecutor — 所有 tf.exe 命令的封装
│   ├── Spawn.ts              # 底层 child_process 调用 tf.exe
│   ├── Types.ts              # 数据类型：TfStatus、PendingChange、BlameResult、Changeset 等
│   ├── OperationQueue.ts     # TFSOperationQueue — 串行化 TFS 操作，防止并发冲突
│   └── BlameManager.ts       # BlameManager — blame 信息缓存与获取
├── vscode/
│   ├── PendingChangesTreeView.ts      # 挂起更改树视图 (TreeDataProvider)
│   ├── FileHistoryTreeView.ts         # 文件变更历史树视图
│   ├── PendingChangesViewDecoration.ts # 文件装饰器（颜色标记不同 TfStatus）
│   ├── WorkspaceStatusBarItem.ts      # 状态栏工作区切换
│   ├── ActionHandlers.ts              # 各个 VSCode 命令的处理器注册
│   └── BlameDecorationsProvider.ts    # Blame 内联装饰（行尾显示 blame 信息）
├── common/
│   ├── Settings.ts           # 配置管理：工作区缓存、ActiveWorkspace 持久化
│   ├── Utilities.ts          # 工具函数：路径处理、tf 输出解析
│   └── LocalCache.ts         # HighPerformanceLRUCache + TFSStatusCache（文件监听自动失效）
└── test/                     # 测试文件
    ├── annotateTest.ts
    ├── blameTest.ts
    ├── blameTest.spec.ts
    └── blameIntegrationTest.ts
```

## 核心设计模式

### 启动流程

1. `activate()` 被调用 → `Settings.setContext()` 初始化缓存
2. `Settings.setWorkspaceInfo()` 调用 `tf workspaces` 获取可用工作区列表
3. `TFSCommandExecutor.isWorkspaceUnderTFS()` 检查当前目录是否在 TFS 管控下
4. 若非 TFS 工作区 → 显示警告并退出
5. 若是 → 注册 TreeView providers、命令 handlers、状态栏

### tf.exe 调用链

所有 TFS 操作归根结底都通过 `Spawn.ts` 的 `tf()` 函数调用 `tf.exe`：

```
VSCode Command → ActionHandlers → TFSCommandExecutor.xxx() → tf([args]) → child_process.spawn(tf.exe)
```

`TFSCommandExecutor` 是单例，封装了所有命令：`add`, `delete`, `checkin`, `checkout`, `undo`, `rename`, `status`, `history`, `workspaces`, `annotate`, `diff`。

### 单例模式

项目大量使用单例，统一通过 `getInstance()` 获取：
- `TFSCommandExecutor` — 命令执行
- `TFSOperationQueue` — 操作队列
- `BlameManager` — Blame 管理
- `Settings` — 配置
- `TFSStatusCache` — 状态缓存
- `PendingChangesTreeView` / `FileHistoryTreeView` — 视图
- `WorkspacesStatusBarItem` — 状态栏

### 缓存策略

- **TFSStatusCache**: 基于 LRU (max 500) 缓存 `tf status` 结果，默认 TTL 30s。通过 `vscode.FileSystemWatcher` 监听文件变更自动失效对应缓存。
- **BlameManager**: 基于 Map 缓存 blame 结果，基于文件 mtime 判断有效性，容量上限可配置（默认 50）。
- **LocalCache**: 基于 `vscode.ExtensionContext.globalState` 的键值持久化，用于保存 ActiveWorkspace。

### 操作队列

`TFSOperationQueue` 串行化所有 TFS 操作，防止多个 `tf.exe` 进程同时运行导致冲突。支持取消所有待处理操作。

### 文件监听与自动签出

`PendingChangesViewDecoration` 监听文件保存事件，若文件为 TFS 管控且未签出，根据 `tfs.promptToCheckOut` 配置决定自动签出或弹窗询问。

## 配置项

在 VSCode `settings.json` 中可配置：

| 配置键 | 说明 | 默认值 |
|--------|------|--------|
| `tfs.location` | tf.exe 路径 | — |
| `tfs.tfptLocation` | tfpt.exe 路径 (Power Tools) | — |
| `tfs.promptToCheckOut` | 编辑前是否弹窗确认签出 | — |
| `tfs.blame.enabled` | 启用/禁用 blame | `true` |
| `tfs.blame.cacheSize` | blame 缓存文件数上限 | `50` |
| `tfs.statusCache.ttl` | 状态缓存 TTL (ms) | `30000` |

## 开发注意事项

- 修改 `extension.ts` 的 `activate()` 或注册逻辑后，需要重新加载 VSCode 扩展窗口(F5 或 `Developer: Reload Window`)
- 所有 `tf.exe` 调用前会拼接 active workspace 参数 (`/workspace:<name>`)，workspace 存储在 `globalState` 中
- `PendingChangesTreeView.refresh()` 有 200ms 防抖，紧急刷新用 `refreshImmediate()`
- TFS 输出解析在 `Utilities.parseTfStatusOutput()` 和 `parseTfHistoryOutput()` 中，这些是字符串解析，不是结构化 API
- 依赖项中 `xml2js` 用于解析某些 tf.exe 输出，`fs-extra` 和 `jsonfile` 用于文件操作
