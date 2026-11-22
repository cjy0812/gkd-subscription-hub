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

1. Repository search: `topic:gkd-subscription`.
2. Repository search: `topic:gkd`.
3. Repository search: GKD subscription terms in repository name, description, or README.
4. Code search: `defineGkdSubscription`.
5. Optional targeted code search for generated subscription filenames when the first four channels do not provide enough recall.

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
- filters for Fork/non-Fork, archived status, topic, author, and subscription count;
- sorting by last push/update, stars, forks, name, and rule count;
- pagination and clear-filter action;
- visible scan progress, last scan time, and incomplete-result / rate-limit warnings;
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
