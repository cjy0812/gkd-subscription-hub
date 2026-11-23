import type { DistFile } from './types'

export type ProjectFileRow = DistFile

export function buildProjectFileUrl(
  domain: string,
  projectId: number,
  path: string,
  mode: 'raw' | 'view',
): string | null {
  const host = domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  if (!host || !Number.isSafeInteger(projectId) || projectId < 1) return null
  if (
    path
      .split('/')
      .some(
        (segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'),
      ) ||
    path.includes('\\') ||
    !/^[A-Za-z0-9_@.+/-]+$/.test(path)
  ) {
    return null
  }

  const url = new URL(`https://${host}/`)
  if (url.host.toLowerCase() !== host.toLowerCase() || url.pathname !== '/' || url.search || url.hash) return null
  url.pathname = `/${projectId}/${path.split('/').map(encodeURIComponent).join('/')}`
  url.searchParams.set(mode, '1')
  return url.toString()
}
