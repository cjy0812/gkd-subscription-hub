# Action 运行记录与日志

## 数据流

管理端和公共只读门户复用同一套 Provider Adapter：

1. 项目快照中的 `lastRuns` 提供最近 Run 列表，不在页面访问时重新扫描所有 Workflow。
2. 用户展开某个 Run 时，按需读取该 Run 的 Job 列表。
3. 用户展开 Step 时，按需读取该 Step 或 Job 的日志。
4. 日志只在当前页面状态中暂存，不写入 D1、R2 或 KV。

## Provider API

| Provider       | Run Jobs                                               | 日志                                                                                           |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| GitHub Actions | `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` | `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`；Step 使用 `.../steps/{step_number}/logs` |
| GitLab CI | `GET /projects/:id/pipelines/:pipeline_id/jobs` | `GET /projects/:id/jobs/:job_id/trace` |
| Gitea Actions | `GET /repos/{owner}/{repo}/actions/runs/{run}/jobs` | `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` |

## 展示粒度

- GitHub API 同时提供 Job 与 Step 元数据，展示 Run → Job → Step → Log。
- GitLab 的 Job Trace API 返回 Job 级完整 trace，不提供与 GitHub 等价的独立 Step 日志端点；因此将 Job Trace 作为单个“Job 日志”入口，不伪造 Step。
- Gitea Jobs API 可提供 Step 元数据；若某实例未返回步骤，则回退为 Job 日志入口。

## 接口与安全

- 管理端接口位于 `/admin/api/projects/:id/runs/:runId/jobs` 与 `/admin/api/projects/:id/runs/:runId/jobs/:jobId/logs`。
- 公共只读接口位于 `/api/public/subscriptions/:id/runs/:runId/jobs` 与 `/api/public/subscriptions/:id/runs/:runId/jobs/:jobId/logs`。
- 日志请求必须验证 Run 属于项目最近一次公开快照，并重新确认 Job 属于指定 Run，避免通过项目 ID 任意读取其他 Job。
- Provider URL 由固定 Provider Adapter 生成，不接受用户提交的 URL，避免 SSRF。
- 日志按纯文本显示，不解释为 HTML。
- 单份日志最大 2 MiB；读取时流式限制，超过上限即取消上游读取。
- 日志与 Job 接口使用 `Cache-Control: no-store`；不缓存临时下载 URL。
- Provider API 限流、权限或暂时不可用时，显示错误并保留托管平台 Run 链接作为 fallback。

## 缓存策略

目前只复用项目快照中的 Run 元数据；Job 与 Log 按需实时读取，不引入持久化缓存。后续是否增加短期缓存，需根据 Provider 限流、访问量、日志大小与 Cloudflare 成本单独评估。
