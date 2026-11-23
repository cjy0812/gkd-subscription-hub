# 贡献指南

## 开始前

1. 阅读 README、AGENTS.md 和相关设计文档。
2. 确认当前分支、工作区状态和目标 PR base。
3. 多文件或跨模块改动先明确目标、非目标、验收和风险。
4. 不确定的运行时行为先从源码、测试或官方文档核实。

## 开发流程

1. 优先小范围、单一目的改动。
2. 新行为补测试；Bug 先建立可复现用例。
3. API 改动同时检查 Worker 路由、Admin 调用、类型、错误处理和文档。
4. 环境变量、Secrets、KV schema、部署行为变更必须检查安全和迁移影响。
5. 不因整理目录进行无收益的大规模搬迁。

## 本地验证

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build:admin
```

以当前 package scripts 为准。命令失败时判断代码、环境或脚本问题；不得把未执行说成通过。

## Pull Request

说明解决的问题、用户影响、主要改动、设计选择、非目标、实际测试结果、未验证项、风险和回滚方式。检查 README、工程文档、AGENTS/CLAUDE 是否需同步。

UI 改动提供桌面/移动截图或手动验收记录。部署、Secrets、生产数据操作必须明确授权，不属于普通 PR 默认步骤。
