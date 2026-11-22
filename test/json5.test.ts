import { describe, expect, it } from 'vitest'
import { parseJson5 } from '../src/services/json5'

describe('bounded JSON5 parser', () => {
  it('parses comments, unquoted keys, single quotes and trailing commas', () => {
    const result = parseJson5(`{
      // repository metadata
      id: 123,
      name: '订阅',
      nested: { enabled: true, },
      list: [1, 2,],
    }`)
    expect(result).toEqual({
      id: 123,
      name: '订阅',
      nested: { enabled: true },
      list: [1, 2],
    })
  })

  it('does not execute expressions', () => {
    expect(() => parseJson5('{ value: (() => 1)() }')).toThrow()
  })

  it('rejects oversized input', () => {
    expect(() => parseJson5(' '.repeat(2_000_001))).toThrow(/超过 2 MB/)
  })
})
