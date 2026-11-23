import type { Env, Project } from '../types'

const KEY = 'projects:index'
export async function ids(e: Env) {
  return (await e.STATE.get<number[]>(KEY, 'json')) || []
}
export async function get(e: Env, id: number) {
  return e.STATE.get<Project>(`project:${id}`, 'json')
}
export async function save(e: Env, p: Project) {
  await e.STATE.put(`project:${p.id}`, JSON.stringify(p))
  const a = await ids(e)
  if (!a.includes(p.id)) {
    a.push(p.id)
    a.sort((x, y) => x - y)
    await e.STATE.put(KEY, JSON.stringify(a))
  }
}
export async function all(e: Env) {
  const p = await Promise.all((await ids(e)).map((id) => get(e, id)))
  return p.filter((x): x is Project => !!x)
}
export async function remove(e: Env, id: number) {
  await e.STATE.delete(`project:${id}`)
  await e.STATE.put(KEY, JSON.stringify((await ids(e)).filter((x) => x !== id)))
}
