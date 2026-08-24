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

// 上游已有 facebook provider，但不含分享短連結展開後帶的這兩個參數；
// 本地這筆是補充而非取代，兩者都會套用。上游哪天收錄了就把本地這筆刪掉。
describe('本地規則 — facebook', () => {
  it('移除分享短連結展開後帶的 rdid 與 share_url', () => {
    const input =
      'https://www.facebook.com/100063463526923/posts/1686328943492540/?rdid=sEZBQz6DRj83mFco&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F1976XaXjie%2F'

    expect(cleanUrl(input, providers)).toBe('https://www.facebook.com/100063463526923/posts/1686328943492540/')
  })

  it('與上游 facebook 規則並存，兩邊的參數一起移除', () => {
    const input = 'https://www.facebook.com/p/1?rdid=abc&mibextid=xyz&fbclid=zzz'

    expect(cleanUrl(input, providers)).toBe('https://www.facebook.com/p/1')
  })

  it('保留非追蹤參數', () => {
    const input = 'https://www.facebook.com/p/1?rdid=abc&locale=zh_TW'

    expect(cleanUrl(input, providers)).toBe('https://www.facebook.com/p/1?locale=zh_TW')
  })
})

// 上游 instagram provider 只收了 igshid、igsh，不含分享連結另外帶的 igsi；
// 本地這筆同樣是補充而非取代。igsi 的語意沒有公開文件可查，但 IG 貼文與 reel 的
// permalink 不靠任何查詢參數解析，移除不影響連結指向。上游哪天收錄了就把本地這筆刪掉。
describe('本地規則 — instagram', () => {
  it('移除分享連結帶的 igsi', () => {
    const input = 'https://www.instagram.com/p/ABC123/?igsi=1YmZlNzAwMDAwMA%3D%3D'

    expect(cleanUrl(input, providers)).toBe('https://www.instagram.com/p/ABC123/')
  })

  it('與上游 instagram 規則並存，兩邊的參數一起移除', () => {
    const input = 'https://www.instagram.com/reel/XYZ/?igsi=abc&igshid=def&utm_source=ig_web'

    expect(cleanUrl(input, providers)).toBe('https://www.instagram.com/reel/XYZ/')
  })

  it('保留非追蹤參數', () => {
    const input = 'https://www.instagram.com/p/ABC123/?igsi=abc&hl=zh-tw'

    expect(cleanUrl(input, providers)).toBe('https://www.instagram.com/p/ABC123/?hl=zh-tw')
  })

  it('不影響其他網站同名的參數', () => {
    const input = 'https://example.com/p?igsi=keep-me'

    expect(cleanUrl(input, providers)).toBe(input)
  })
})
