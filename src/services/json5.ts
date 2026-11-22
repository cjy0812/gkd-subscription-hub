/** A bounded JSON5 parser for subscription metadata. Never evaluates source code. */
export function parseJson5(source: string): unknown {
  if (source.length > 2_000_000) throw new Error('订阅文件超过 2 MB，跳过解析')
  let i = 0
  const fail = (): never => { throw new Error(`JSON5 语法错误，位置 ${i}`) }
  const ws = () => {
    while (i < source.length) {
      if (/\s/.test(source[i])) { i++; continue }
      if (source[i] === '/' && source[i + 1] === '/') {
        i += 2
        while (i < source.length && source[i] !== '\n') i++
        continue
      }
      if (source[i] === '/' && source[i + 1] === '*') {
        i += 2
        const end = source.indexOf('*/', i)
        if (end < 0) fail()
        i = end + 2
        continue
      }
      break
    }
  }
  const string = (): string => {
    const quote = source[i++]
    let out = ''
    while (i < source.length) {
      const c = source[i++]
      if (c === quote) return out
      if (c === '\\') {
        if (i >= source.length) fail()
        const e = source[i++]
        if (e === '\n') continue
        if (e === '\r') { if (source[i] === '\n') i++; continue }
        const simple: Record<string, string> = { "'": "'", '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '0': '\0' }
        if (e === 'u') {
          const hex = source.slice(i, i + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail()
          out += String.fromCharCode(parseInt(hex, 16)); i += 4
        } else if (e === 'x') {
          const hex = source.slice(i, i + 2)
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail()
          out += String.fromCharCode(parseInt(hex, 16)); i += 2
        } else out += simple[e] ?? e
      } else {
        if (c === '\n' || c === '\r') fail()
        out += c
      }
    }
    return fail()
  }
  const identifier = (): string => {
    const start = i
    if (!/[A-Za-z_$]/.test(source[i] || '')) fail()
    i++
    while (/[\w$]/.test(source[i] || '')) i++
    return source.slice(start, i)
  }
  const value = (depth: number): unknown => {
    if (depth > 64) fail()
    ws()
    const c = source[i]
    if (c === '{') {
      i++; ws()
      const obj: Record<string, unknown> = Object.create(null)
      if (source[i] === '}') { i++; return obj }
      while (i < source.length) {
        ws()
        const key = source[i] === '"' || source[i] === "'" ? string() : identifier()
        ws()
        if (source[i++] !== ':') fail()
        obj[key] = value(depth + 1)
        ws()
        if (source[i] === '}') { i++; return obj }
        if (source[i++] !== ',') fail()
        ws()
        if (source[i] === '}') { i++; return obj }
      }
      return fail()
    }
    if (c === '[') {
      i++; ws()
      const arr: unknown[] = []
      if (source[i] === ']') { i++; return arr }
      while (i < source.length) {
        arr.push(value(depth + 1)); ws()
        if (source[i] === ']') { i++; return arr }
        if (source[i++] !== ',') fail()
        ws()
        if (source[i] === ']') { i++; return arr }
      }
      return fail()
    }
    if (c === '"' || c === "'") return string()
    if (source.startsWith('true', i)) { i += 4; return true }
    if (source.startsWith('false', i)) { i += 5; return false }
    if (source.startsWith('null', i)) { i += 4; return null }
    if (source.startsWith('Infinity', i)) { i += 8; return Infinity }
    if (source.startsWith('NaN', i)) { i += 3; return NaN }
    const match = source.slice(i).match(/^[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/)
    if (!match) return fail()
    i += match[0].length
    return /^[-+]?0[xX]/.test(match[0]) ? parseInt(match[0], 16) : Number(match[0])
  }
  const result = value(0)
  ws()
  if (i !== source.length) fail()
  return result
}
