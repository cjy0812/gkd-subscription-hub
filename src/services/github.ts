import type { Env } from '../types'

function rateLimitMessage(response: Response) {
  const retryAfter = response.headers.get('retry-after')
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  const remaining = response.headers.get('x-ratelimit-remaining')
  const resetAt = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null
  const wait = retryAfter
    ? `Retry-After: ${retryAfter}s`
    : resetAt
      ? `额度预计在 ${resetAt} 重置`
      : '请稍后重试'
  const kind =
    remaining === '0'
      ? 'GitHub API 主速率限制已耗尽'
      : 'GitHub API 返回 403/429，可能触发次级速率限制'
  return `${kind}（${wait}）。配置 Worker Secret GITHUB_TOKEN 可提高公开仓库 API 配额；若已配置，请检查令牌权限和限流重置时间。`
}
export async function gh<T>(env: Env, path: string): Promise<T> {
  const r = await fetch('https://api.github.com' + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'gkd-subscription-hub',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (r.status === 403 || r.status === 429) throw Error(rateLimitMessage(r))
  if (!r.ok) throw Error(`GitHub API 请求失败：HTTP ${r.status}`)
  return r.json() as Promise<T>
}
export function decode(file: { content: string; encoding: string }) {
  if (file.encoding !== 'base64') throw Error('GitHub 文件编码异常')
  const b = atob(file.content.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)))
}
