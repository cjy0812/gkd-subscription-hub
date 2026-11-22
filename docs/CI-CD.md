# CI/CD 与 Cloudflare Workers Builds

## 自动流程

本项目使用 Cloudflare 原生 Workers Builds + Worker Previews，不再由 GitHub Actions 创建、更新或清理 Preview Worker。

- 所有分支 push：GitHub Actions 执行格式检查、Lint、类型检查、测试和管理端构建。
- PR 创建或更新：GitHub Actions 执行 CI；Cloudflare Workers Builds 自动构建该分支的 Worker Preview，并在 PR 中评论预览地址。
- 同一分支后续 push：Cloudflare 更新该分支现有 Preview，PR 中的稳定预览地址继续指向最新提交。
- main push：GitHub Actions 执行 CI；Cloudflare Workers Builds 构建并部署生产 Worker。
- PR 关闭：Cloudflare 管理 Preview 生命周期，不需要仓库工作流删除 Worker。

## Cloudflare Workers Builds 设置

在 Cloudflare Dashboard 中对现有 Worker **gkd-subscription-hub** 连接仓库 **cjy0812/gkd-subscription-hub**：

1. Workers & Pages → gkd-subscription-hub → Settings → Builds → Connect。
2. 安装/授权 Cloudflare Workers & Pages GitHub App，并允许访问本仓库。
3. Production branch 选择 **main**。
4. 启用 **Preview Builds**。
5. 检查 Build configuration：

- Root directory：`/`
- Build command：

```bash
bun install --frozen-lockfile && bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build:admin
```

- Deploy command：`bunx wrangler deploy`
- Preview command：`bunx wrangler preview`

项目 package.json 固定 Bun 1.4.5；bun.lock 已提交。锁文件中的 Wrangler 版本满足 Worker Previews 所需的 Wrangler 4.135.0+。

## Preview 数据与凭据隔离

- 生产 Worker 继续绑定生产 KV：215fd3c9c2c74481bc521feadedd83e8。
- 所有分支 Preview 绑定专用 KV：fc091077968342c1b73b22a310412947（gkd-subscription-hub-preview），不会写入生产 KV。
- 不同分支 Preview 共享这一个 Preview KV，因此测试数据可能互相影响；它们与生产数据隔离，但不是 Preview 之间逐个隔离。
- Preview 不继承生产变量和 Secrets。首次启用前，需要在 Cloudflare Worker 的 **Settings → Variables and Secrets → Previews Base** 中单独设置 ADMIN_PASSWORD。
- 建议 Preview 的 ADMIN_PASSWORD 与生产密码不同。PR 代码可读取 Preview 自身的运行时 Secret；如复用生产密码，PR 中的代码变更可能暴露生产管理员凭据，属于明确接受的安全风险，不应视为环境隔离自动消除了该风险。
- GITHUB_TOKEN 和 NOTIFY_TOKEN 在代码中均为可选项，Preview 暂不配置；GitHub API 将使用匿名额度。
- Preview URL 默认公开。不要在 Preview 写入真实或敏感数据；如需限制访问，再单独配置 Cloudflare Access。
- Cron Triggers 不会在 Worker Preview 中执行，因此 Preview 不会自动运行每 6 小时的定时刷新；需要验证刷新逻辑时，应使用测试或手动请求路径。

管理端的订阅快捷入口会使用当前 Preview 请求的 workers.dev 主机名，因此在 Preview 中不会跳回生产域名。

## GitHub Actions 的职责

.github/workflows/ci.yml 只执行质量检查，不再持有 Cloudflare 部署 Token，也不执行生产部署或 Preview 生命周期操作。

.github/workflows/smoke-test.yml 保留为手动生产 Smoke Test。它不再监听 CI 完成事件，因为 GitHub Actions 的 CI 成功并不代表 Cloudflare 部署已经完成；Cloudflare Builds 是实际部署者。

## 本地开发与手动部署

本地开发继续使用 Wrangler：

```bash
bun install --frozen-lockfile
bun run dev:worker
bun run dev:admin
```

如需从本地手动部署生产 Worker，沿用项目原有的 bun run deploy 流程和本地 .secrets.json。日常自动部署不再依赖该流程。
