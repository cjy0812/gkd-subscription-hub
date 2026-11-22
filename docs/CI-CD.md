# CI/CD 与 Preview 环境

## 自动流程

| 事件 | 自动动作 | 是否部署 |
|---|---|---|
| 任意分支 push | 格式、Lint、类型检查、测试、管理端构建 | 否 |
| 同仓库 PR 创建/更新/重新打开 | 完整 CI，通过后创建或更新该 PR 的 Preview Worker，并执行 Smoke Test | 是，仅 Preview |
| Fork PR | 运行不需要 Secrets 的 CI | 否 |
| PR 关闭或合并 | 删除对应 Preview Worker | 清理 |
| main push | CI 通过后部署生产 Worker | 是，生产 |
| 手动 workflow_dispatch | 选择 verify、preview 或 release | 按选择执行 |

PR Preview 不会部署到生产 Worker，也不会修改生产 KV。Preview Worker 命名为 `gkd-subscription-hub-pr-<PR号>`，对应 URL 为：

`https://gkd-subscription-hub-pr-<PR号>.cjy081219.workers.dev`

## Preview 数据边界

- Preview Worker 使用专用 KV Namespace：`gkd-subscription-hub-preview`。
- 所有 PR Preview Worker 共用该 Preview KV；它与生产 KV 完全分离，但不同 PR 之间不隔离数据。
- PR 关闭时删除 Preview Worker，不删除共享 Preview KV。
- Preview 复用 GitHub Actions production Environment 中的 `ADMIN_PASSWORD` 和 `CLOUDFLARE_API_TOKEN`，不要求维护另一份管理员密码。
- 当前工作流不复制 Cloudflare 生产 Worker 中的 `GITHUB_TOKEN`：Cloudflare 不提供读取 Secret 明文的 API，而现有生产部署工作流也没有把它传给 GitHub Actions。Preview 的 GitHub API 请求因此使用未认证公开 API，额度会低于配置 Token 的生产环境。若以后确实需要同一个 Token，应通过受控的凭据同步方式处理，不要在仓库写入明文。

## 一次性配置要求

1. GitHub 仓库 Settings → Environments → production 必须存在，并包含现有的 `CLOUDFLARE_API_TOKEN`、`ADMIN_PASSWORD`。
2. Cloudflare API Token 需要允许 Wrangler 上传/删除 Worker、写入 Worker Secret，并访问目标账号。
3. Preview URL 使用 workers.dev。当前生产 Worker 的 workers.dev 域名是 `cjy081219.workers.dev`；若账号子域名变化，需要同步修改工作流中的域名。
4. 如果 production Environment 配置了 Required reviewers，Preview 和清理任务也会等待该 Environment 审批。当前是否启用了审批尚未通过 GitHub Environment API 核实。

## 手动运行

在 GitHub Actions 选择 CI → Run workflow：

- `verify`：只做质量检查和构建，不部署。
- `preview`：创建手动 Preview Worker，默认名称 `gkd-subscription-hub-manual`。
- `release`：仅当选择的分支为 `main` 时部署生产；其他分支不会部署生产。

## 验证范围

Preview Smoke Test 检查管理端 HTML、未认证管理 API 返回 401、根路径重定向返回 302。它不执行 Explorer 扫描、不创建订阅项目、不写入生产数据。
