import { beforeAll, describe, expect, it } from 'vitest'
import { loadAllRules } from '../src/services/rules.loader.js'
import { cleanUrl } from '../src/services/url.cleaner.js'
import type { CompiledProvider } from '../src/types/clearurls.js'

/** 上游快照 + 本地擴充，與 Worker 進入點的組裝結果相同 */
let providers: CompiledProvider[]

beforeAll(() => {
  providers = loadAllRules()
})

describe('本地規則擴充', () => {
  it('包含上游的 provider', () => {
    expect(providers.map((provider) => provider.name)).toContain('globalRules')
  })

  it('排在上游規則之後，本地規則才能覆蓋既有結果', () => {
    const names = providers.map((provider) => provider.name)
    expect(names.lastIndexOf('threads')).toBeGreaterThan(names.indexOf('globalRules'))
  })
})

describe('本地規則 — threads', () => {
  it('移除分享連結展開後帶的 xmt', () => {
    const input = 'https://www.threads.com/@amtb4818/post/DcIG72GFE5W?xmt=AQG0EWQe9UYergxsJyP8DyJWv4NY'

    expect(cleanUrl(input, providers)).toBe('https://www.threads.com/@amtb4818/post/DcIG72GFE5W')
  })

  it('移除 igshid 與 igsh', () => {
    expect(cleanUrl('https://www.threads.com/@a/post/B?igshid=NTc4MTIwNjQ2YQ%3D%3D', providers)).toBe(
      'https://www.threads.com/@a/post/B'
    )
    expect(cleanUrl('https://www.threads.net/@a/post/B?igsh=MXYwbGZ1', providers)).toBe(
      'https://www.threads.net/@a/post/B'
    )
  })

  it('保留非追蹤參數', () => {
    const input = 'https://www.threads.com/@a/post/B?xmt=AQG0&hl=zh-tw'

    expect(cleanUrl(input, providers)).toBe('https://www.threads.com/@a/post/B?hl=zh-tw')
  })

  it('不影響其他網站同名的參數', () => {
    const input = 'https://example.com/p?xmt=keep-me'

    expect(cleanUrl(input, providers)).toBe(input)
  })
})
