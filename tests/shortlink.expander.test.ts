import { describe, expect, it } from 'vitest'
import { SHORT_LINK_PROVIDERS, createShortLinkExpander } from '../src/services/shortlink.expander.js'

const SHARE_URL = 'https://www.threads.com/share/Fp3agZKiy/'
const TARGET_URL = 'https://www.threads.com/@amtb4818/post/DcIG72GFE5W?xmt=AQG0EWQe9UYergxsJyP8DyJWv4NY'

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

/**
 * 以路由表驅動的假 fetch：值為字串代表回 302 並指向該處，值為數字代表回該狀態碼。
 * 測試不打真實網路，但仍走完整的逐跳驗證邏輯。
 */
function createFakeFetch(routes: Record<string, string | number>) {
  const calls: FetchCall[] = []

  const impl = ((input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })

    const route = routes[url]

    if (route === undefined) {
      return Promise.reject(new Error(`假 fetch 未定義的路由：${url}`))
    }

    return Promise.resolve(
      typeof route === 'number'
        ? new Response(null, { status: route })
        : new Response(null, { status: 302, headers: { location: route } })
    )
  }) as unknown as typeof fetch

  return { impl, calls }
}

function expanderFor(routes: Record<string, string | number>) {
  const { impl, calls } = createFakeFetch(routes)
  const expander = createShortLinkExpander(SHORT_LINK_PROVIDERS, impl)
  return { expand: (url: string) => expander.expand(url), matches: (url: string) => expander.matches(url), calls }
}

describe('createShortLinkExpander — matches', () => {
  it('認得 threads 的 /share/ 短連結', () => {
    const { matches } = expanderFor({})

    expect(matches(SHARE_URL)).toBe(true)
    expect(matches('https://www.threads.com/share/Fp3agZKiy')).toBe(true)
    expect(matches('https://threads.net/share/Fp3agZKiy/')).toBe(true)
  })

  it('不把一般 threads 貼文或其他網站當成短連結', () => {
    const { matches } = expanderFor({})

    expect(matches(TARGET_URL)).toBe(false)
    expect(matches('https://example.com/share/abc/')).toBe(false)
    expect(matches('https://www.threads.com/share/')).toBe(false)
  })

  it('不接受夾帶額外路徑或查詢字串的偽短連結', () => {
    const { matches } = expanderFor({})

    expect(matches('https://www.threads.com/share/abc/../../evil')).toBe(false)
    expect(matches('https://www.threads.com/share/abc?next=https://evil.example')).toBe(false)
    expect(matches('https://www.threads.com.evil.example/share/abc/')).toBe(false)
  })
})

describe('createShortLinkExpander — expand', () => {
  it('把 threads /share/ 短連結展開成 Location 指向的目標', async () => {
    const { expand } = expanderFor({ [SHARE_URL]: TARGET_URL })

    expect(await expand(SHARE_URL)).toBe(TARGET_URL)
  })

  it('展開 threads.net 的短連結（先跳 threads.com 再跳目標）', async () => {
    const netUrl = 'https://www.threads.net/share/Fp3agZKiy/'
    const { expand, calls } = expanderFor({ [netUrl]: SHARE_URL, [SHARE_URL]: TARGET_URL })

    expect(await expand(netUrl)).toBe(TARGET_URL)
    expect(calls).toHaveLength(2)
  })

  it('非短連結的網址不展開，也完全不發出請求', async () => {
    const { expand, calls } = expanderFor({})

    expect(await expand('https://example.com/a?utm_source=x')).toBeNull()
    expect(await expand(TARGET_URL)).toBeNull()
    expect(calls).toEqual([])
  })

  it('轉址目標不在白名單網域時視為展開失敗', async () => {
    const { expand } = expanderFor({ [SHARE_URL]: 'https://www.facebook.com/unsupportedbrowser' })

    expect(await expand(SHARE_URL)).toBeNull()
  })

  it('轉址目標不是 https 時視為展開失敗', async () => {
    const { expand } = expanderFor({ [SHARE_URL]: 'http://www.threads.com/@a/post/B' })

    expect(await expand(SHARE_URL)).toBeNull()
  })

  it('轉址回應缺少 Location 標頭時視為展開失敗', async () => {
    const impl = (() => Promise.resolve(new Response(null, { status: 302 }))) as unknown as typeof fetch

    expect(await createShortLinkExpander(SHORT_LINK_PROVIDERS, impl).expand(SHARE_URL)).toBeNull()
  })

  it('Location 無法解析成網址時視為展開失敗', async () => {
    const { expand } = expanderFor({ [SHARE_URL]: 'http://[not-a-valid-url' })

    expect(await expand(SHARE_URL)).toBeNull()
  })

  it('短碼不存在（回 200 而非轉址）時視為展開失敗', async () => {
    const missing = 'https://www.threads.com/share/ZZZnotexist999/'
    const { expand } = expanderFor({ [missing]: 200 })

    expect(await expand(missing)).toBeNull()
  })

  it('轉址次數超過上限時視為展開失敗', async () => {
    const a = 'https://www.threads.com/share/aaaaaaaaa/'
    const b = 'https://www.threads.com/share/bbbbbbbbb/'
    const c = 'https://www.threads.com/share/ccccccccc/'
    const { expand } = expanderFor({ [a]: b, [b]: c, [c]: TARGET_URL })

    expect(await expand(a)).toBeNull()
  })

  it('fetch 失敗（逾時或網路錯誤）時視為展開失敗，不往外拋', async () => {
    const impl = (() =>
      Promise.reject(new DOMException('The operation was aborted', 'TimeoutError'))) as unknown as typeof fetch

    expect(await createShortLinkExpander(SHORT_LINK_PROVIDERS, impl).expand(SHARE_URL)).toBeNull()
  })

  it('以相對路徑回應的 Location 會依當前網址解析', async () => {
    const { expand } = expanderFor({ [SHARE_URL]: '/@amtb4818/post/DcIG72GFE5W' })

    expect(await expand(SHARE_URL)).toBe('https://www.threads.com/@amtb4818/post/DcIG72GFE5W')
  })

  it('請求帶自訂 UA 並停用自動轉址', async () => {
    const { expand, calls } = expanderFor({ [SHARE_URL]: TARGET_URL })
    await expand(SHARE_URL)

    const { init } = calls[0] ?? {}
    expect(init?.redirect).toBe('manual')
    expect((init?.headers as Record<string, string>)['user-agent']).toBeTruthy()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('不轉發呼叫端的 cookie 或其他標頭', async () => {
    const { expand, calls } = expanderFor({ [SHARE_URL]: TARGET_URL })
    await expand(SHARE_URL)

    expect(Object.keys((calls[0]?.init?.headers as Record<string, string>) ?? {})).toEqual(['user-agent'])
  })
})
