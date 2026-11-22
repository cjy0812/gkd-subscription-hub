/** A bounded JSON5 parser for subscription metadata. Never evaluates source code. */
export function parseJson5(source: string): unknown {
  if (source.length > 2_000_000) {
    throw new Error('订阅文件超过 2 MB，跳过解析')
  }

  let i = 0
  const fail = (): never => {
    throw new Error('JSON5 语法错误，位置 ' + i)
  }

  const whitespace = () => {
    while (i < source.length) {
      if (/\s/.test(source[i])) {
        i++
        continue
      }
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

  const readString = (): string => {
    const quote = source[i++]
    let output = ''
    while (i < source.length) {
      const character = source[i++]
      if (character === quote) return output
      if (character === '\\') {
        if (i >= source.length) fail()
        const escaped = source[i++]
        if (escaped === '\n') continue
        if (escaped === '\r') {
          if (source[i] === '\n') i++
          continue
        }
        const simple: Record<string, string> = {
          "'": "'",
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
          v: '\v',
          '0': '\0',
        }
        if (escaped === 'u') {
          const hex = source.slice(i, i + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail()
          output += String.fromCharCode(parseInt(hex, 16))
          i += 4
        } else if (escaped === 'x') {
          const hex = source.slice(i, i + 2)
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail()
          output += String.fromCharCode(parseInt(hex, 16))
          i += 2
        } else {
          output += simple[escaped] ?? escaped
        }
      } else {
        if (character === '\n' || character === '\r') fail()
        output += character
      }
    }
    return fail()
  }

  const readIdentifier = (): string => {
    const start = i
    if (!/[$_\p{ID_Start}]/u.test(source[i] || '')) fail()
    i++
    while (
      /[$_\p{ID_Continue}]/u.test(source[i] || '') ||
      source[i] === '\u200C' ||
      source[i] === '\u200D'
    ) {
      i++
    }
    return source.slice(start, i)
  }

  const readValue = (depth: number): unknown => {
    if (depth > 64) fail()
    whitespace()
    const character = source[i]

    if (character === '{') {
      i++
      whitespace()
      const object: Record<string, unknown> = Object.create(null)
      if (source[i] === '}') {
        i++
        return object
      }
      while (i < source.length) {
        whitespace()
        const property = source[i] === '"' || source[i] === "'" ? readString() : readIdentifier()
        whitespace()
        if (source[i++] !== ':') fail()
        object[property] = readValue(depth + 1)
        whitespace()
        if (source[i] === '}') {
          i++
          return object
        }
        if (source[i++] !== ',') fail()
        whitespace()
        if (source[i] === '}') {
          i++
          return object
        }
      }
      return fail()
    }

    if (character === '[') {
      i++
      whitespace()
      const array: unknown[] = []
      if (source[i] === ']') {
        i++
        return array
      }
      while (i < source.length) {
        array.push(readValue(depth + 1))
        whitespace()
        if (source[i] === ']') {
          i++
          return array
        }
        if (source[i++] !== ',') fail()
        whitespace()
        if (source[i] === ']') {
          i++
          return array
        }
      }
      return fail()
    }

    if (character === '"' || character === "'") return readString()
    if (source.startsWith('true', i)) {
      i += 4
      return true
    }
    if (source.startsWith('false', i)) {
      i += 5
      return false
    }
    if (source.startsWith('null', i)) {
      i += 4
      return null
    }
    if (source.startsWith('Infinity', i)) {
      i += 8
      return Infinity
    }
    if (source.startsWith('NaN', i)) {
      i += 3
      return NaN
    }

    const match = source
      .slice(i)
      .match(/^[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/)
    if (!match) return fail()
    i += match[0].length
    return /^[-+]?0[xX]/.test(match[0]) ? parseInt(match[0], 16) : Number(match[0])
  }

  const result = readValue(0)
  whitespace()
  if (i !== source.length) fail()
  return result
}
