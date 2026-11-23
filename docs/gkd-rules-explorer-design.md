# GKD Rules Explorer — Technical Design

## Decisions

- Search scope: all searchable public GitHub repositories.
- Include only repositories containing at least one valid, complete GKD subscription artifact.
- Keep forks. Display the direct upstream repository as `Fork 自：owner/repo`; do not traverse the fork chain.
- Extract GitHub repository metadata and GKD subscription metadata. Preserve unknown top-level subscription JSON5 fields as custom metadata.
- Explorer is a discovery and filtering tool. It does not register discovered repositories as subscription-distribution projects.

## Existing architecture audit

- Worker: Cloudflare Workers + Hono; admin API is mounted under `/admin/api/*`.
- Frontend: Vue 3 + Naive UI + Vue Router under `apps/admin`.
- Storage: existing `STATE` KV namespace, currently holding `projects:index` and `project:<id>`.
- GitHub client: `src/services/github.ts`, uses optional `GITHUB_TOKEN`; the deployed Worker has that secret binding.
- Cron: `0 */6 * * *`; reserved for existing project refresh behavior.
- No D1, R2, Queue, or Durable Object binding exists. Explorer must not require a new paid service or alter the existing subscription data keys.

## Discovery strategy

Search multiple independent GitHub indexes, then verify candidates by content:

1. Repository search: `topic:gkd-subscription`, `topic:gkd-rules`, and `topic:gkd`, each with `fork:true`.
2. Repository search: `gkd-subscription in:name`, also with `fork:true`.
3. Code search: `defineGkdSubscription in:file` once for non-forks and once with `is:fork`, because GitHub excludes forks from search results by default.

Deduplicate by immutable GitHub repository ID, not `owner/repo`, so renames do not create duplicate records. Merge all discovery-source labels into the repository record. Search results are candidate discovery only, never proof that a repository is a GKD subscription.

For every candidate:

- Read the default-branch commit and recursive Git tree.
- Locate plausible JSON5 subscription artifacts, prioritizing `dist/gkd.json5`, `dist/*gkd*.json5`, then other JSON5 files under `dist/`.
- Fetch candidate artifacts from `raw.githubusercontent.com`, pinned to the commit SHA.
- Parse JSON5 and validate subscription identity and rule-bearing arrays.
- Include only repositories with at least one valid subscription artifact. Keep archived repositories but mark them archived.
- Keep fork repositories and store the direct parent only.

## Subscription validation and metadata

Required validation:

- positive numeric `id`;
- non-empty `name`;
- a usable `version`;
- at least one non-empty rule-bearing `apps` or `globalGroups` collection.

Extract standard metadata when present:

- `id`, `name`, `version`, `author`, `updateUrl`, `checkUpdateUrl`;
- `categories`, app count, group count, rule count;
- artifact path, blob SHA, artifact size, source commit SHA.

Preserve unknown top-level JSON5 properties in `customFields`; do not silently discard project-specific metadata. Do not duplicate large rule bodies in the catalog. GitHub repository custom properties are optional and are shown only when the public repository API returns them; the feature must not require organization-only permissions.

GitHub metadata should include, when returned:

- immutable repository ID, full name, URL, owner/login/avatar;
- description, homepage, topics, license, language, default branch;
- created/updated/pushed timestamps, size;
- stars, watchers, forks, open issues;
- archived, disabled, fork, direct parent full name;
- optional custom properties.

## API and job model

All Explorer API routes remain under the existing authenticated admin API:

- `GET /api/explorer/catalog`: cached, verified subscription repositories.
- `GET /api/explorer/status`: current discovery progress and last run summary.
- `GET /api/explorer/quota`: live `core`, `search`, and `code_search` quota buckets for the Worker's configured GitHub token, via GitHub's `GET /rate_limit` endpoint.
- `POST /api/explorer/discover`: start or resume a discovery job.
- `POST /api/explorer/discover/step`: process a bounded search/verification batch.

Discovery is resumable. Search pages and candidate validation are processed in small steps, with rate-limit-aware delays and explicit incomplete/error states. A failed or truncated search must never be reported as a complete scan.

## API efficiency

- Reuse the rich repository objects returned by Search API; avoid one repository metadata request per candidate.
- Use a small fixed query matrix; deduplicate by repository ID before verification.
- Use commit SHA and blob SHA as cache keys. If the commit/blob is unchanged, reuse prior parsed metadata.
- Cache parsed metadata by immutable repository ID and commit SHA. On repeat scans, perform one commit lookup and reuse parsed subscription data when the SHA is unchanged. ETag conditional requests for mutable metadata endpoints remain a later optimization.
- Fetch artifact bytes from raw GitHub URLs pinned to commit SHA; do not use the Contents API per file.
- Bound concurrency and process a small number of repositories per Worker invocation to stay below the Free plan's subrequest and CPU limits.
- Store one published catalog snapshot and a separate resumable job state in KV. Keep all Explorer keys under the `explorer:` prefix. Never write to existing project keys.
- Do not add D1, R2, Queues, Durable Objects, or extra Cron triggers for the first implementation.

## UI

Add an Explorer page under the existing admin SPA with:

- full-text search across repository name, owner, subscription name, author, ID, topics, and custom metadata;
- filters for Fork/non-Fork, archived status, topic, and author;
- sorting by last push/update, stars, forks, name, and rule count;
- pagination and clear-filter action;
- visible scan progress, last scan time, live GitHub core/search/code-search quota snapshot, and incomplete-result / rate-limit warnings;
- repository rows showing direct Fork source;
- detail drawer showing GitHub metadata, all subscription metadata, and arbitrary custom fields.

The catalog is read once and filtered locally in the browser. Changing filters must not call GitHub or repeatedly call the Worker.

## Quota and execution budget

GitHub documented defaults used for planning (the actual remaining quota of the Worker's secret token is not readable during this repository review):

- Authenticated REST core: typically 5,000 requests/hour.
- Repository search: 30 requests/minute for authenticated requests.
- Code search: 10 requests/minute.
- Search endpoint result ceiling: 1,000 results per query.
- Code search is limited to indexed default-branch files and has additional indexing/size constraints.

Cloudflare Worker execution limits depend on the account plan. The Free-plan reference values are 10 ms CPU time and 50 outgoing subrequests per invocation; KV Free-plan reference values are 100,000 reads/day and 1,000 writes/day. The deployed script reports the `standard` usage model, but that is not proof of the account's billing plan. Account plan and current usage were not independently verified in this audit.

The implementation therefore uses a bounded step:

- at most one search request per step;
- at most four candidate repositories per verification step;
- per candidate: commit lookup, tree lookup, at most one parent metadata lookup for a fork, and at most two raw artifact fetches;
- no clone, no Actions workflow enumeration, and no per-row GitHub API calls.

This bounds the expected request count well below 50 per step. CPU time still needs measurement against production traffic; if it approaches the account's limit, reduce the candidate batch size. KV job/catalog writes are batched at step boundaries, not written once per individual metadata field.

Actual token quota headers and Cloudflare account usage are surfaced as an operational verification item; no claim is made that the live quota is currently unused or sufficient.

## Known coverage limits

GitHub Search is not a perfect global index. Search results are capped at 1,000 per query, may be marked incomplete, and Code Search indexes only the default branch and files below GitHub's documented size threshold. The UI must expose query totals, pages scanned, incomplete flags, and last scan time. No absolute zero-miss guarantee is claimed.

## Acceptance criteria

- No changes to subscription distribution routing or existing project KV keys.
- Only verified full GKD subscriptions appear in the catalog.
- Fork records show the direct upstream repository.
- Unknown subscription metadata survives parsing and is visible in the UI.
- Search/filter/sort/pagination work locally without GitHub API requests.
- Discovery resumes after interruption and reports partial scans honestly.
- Rate-limit responses pause the job and expose retry timing.
- Tests cover JSON5 parsing, subscription validation, repository deduplication, Fork metadata, filters, and partial-search handling.
- Existing CI checks remain green.


## 维护者反馈：扫描分页、筛选与 ID 冲突（2026-11-23）

### 当前实现行为（源码确认）

- `stepExplorer()` 每次调用最多请求一个 GitHub Search 页面（Repository Search 每页 100 条，最多 10 页；Code Search 每个查询只读取第一页）。
- 读取该页后，当前实现立即去重并把该页候选写入 Job，再在同一 step 内最多验证 4 个候选；候选处理完后才继续下一页。
- 所以当前执行顺序是“搜索一页 → 验证本页候选 → 搜索下一页”，不是“先收集全部候选 → 再统一验证”。
- UI 的结果表格另有每页 20 条的展示分页；它与 Worker 的 GitHub Search 扫描分页是两件不同的事。
- 当前搜索候选按 GitHub repository immutable ID 去重；订阅文件内的 subscription ID 没有跨仓库唯一性冲突检测。
- UI 全文搜索把仓库字段与订阅字段拼接后做子串匹配；没有精确 ID 模式，也不显示命中字段。

### 方案评估

维护者提出的“先全拉，再逐级过筛”可实现为**有界两阶段流水线**，但不能理解为不受限制地一次性下载全网数据：

1. **候选收集阶段**：按查询与分页游标分批请求，保存紧凑候选元数据（repository ID、full_name、default_branch、source query 等），全局去重；本阶段不下载仓库 Tree/订阅文件。
2. **候选验证阶段**：按小批次读取 Commit/Tree/订阅文件，检查 JSON5 与规则集合，生成已验证目录项。
3. **目录发布阶段**：只有完整任务结束或明确策略允许部分发布时才更新已发布快照；中断、限流或失败必须保留上一个完整快照，并准确标记当前任务不完整。

约束与取舍：

- GitHub Search 每个查询最多 1,000 条结果；Code Search 的索引、分页与配额更严格，不能保证覆盖所有仓库。
- Worker 单次执行有 CPU/subrequest 预算；因此两个阶段仍需按 step 继续，不是一次请求拉完。
- 候选队列需要评估 KV 单值大小和写入成本；必要时按分片 Key 存储，而不是把全部候选无限塞进一个 KV 值。
- 去重必须使用 GitHub repository ID；订阅 ID 是 GKD 业务标识，需单独检测冲突，不能用它替代仓库去重。
- UI 需要分别显示“候选收集进度”和“内容验证进度”，并解释 GitHub 搜索上限/不完整标记。

### ID 233 排查与修正方向

不能仅凭“结果里很多 ID 233”认定扫描分页错误。需要区分：

- 多个不同仓库是否确实都声明了 subscription.id = 233；
- 查询是否是子串搜索，是否把 ID 与仓库文本混合匹配；
- 同一仓库是否被不同查询重复发现但未正确合并来源；
- 缓存目录是否残留旧数据；
- UI 展示的 ID 是否来自正确的 subscription 对象。

后续实现应增加精确订阅 ID 筛选、命中字段说明、重复 ID 冲突报告，并用固定 fixture 覆盖同 ID 多仓库、同仓库多查询、分页交界和无效订阅样本。未复现前不把它标记为已确认 Bug。
