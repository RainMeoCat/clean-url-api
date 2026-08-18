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

  // slof / hwta 無任何公開文件，也不在 Threads 前端 bundle 與 permalink 路由承認的參數清單裡，
  // 是分享端貼上去、只供 Meta 伺服器側記錄的惰性標記。實測帶與不帶，
  // og:url / canonical / al:ios:url 逐字相同，移除不影響貼文顯示。
  it('移除分享面板附加的 slof 與 hwta', () => {
    const input = 'https://www.threads.com/@a/post/B?slof=1&hwta=1'

    expect(cleanUrl(input, providers)).toBe('https://www.threads.com/@a/post/B')
  })

  // 這批相反地「會」被路由解析，但都是登入／導流流程的一次性狀態，不帶貼文身分——
  // Threads 自己也在 stripParams 裡列出它們，讀完就從網址列抹掉。分享出去的連結不該留著。
  it('移除登入與導流流程殘留的參數', () => {
    const input =
      'https://www.threads.com/@a/post/B?appclip=1&handoff=1&login_success=true&onboarding_complete=true&show_app_header=true&tifu_login=true'

    expect(cleanUrl(input, providers)).toBe('https://www.threads.com/@a/post/B')
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
