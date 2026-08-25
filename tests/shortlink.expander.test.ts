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
  return { expand: (url: string) => expander.expand(url), calls }
}

/**
 * 白名單樣式是本專案唯一的 SSRF 邊界，因此這裡驗的不只是「回 null」，
 * 而是「連請求都沒發出去」——calls 為空才能證明不合樣式的網址
 * 不可能被拿去打任何位址。
 */
describe('createShortLinkExpander — 只有命中樣式的網址會被 fetch', () => {
  it('認得 threads 的 /share/ 短連結（含無尾斜線與 threads.net）', async () => {
    const noSlash = 'https://www.threads.com/share/Fp3agZKiy'
    const netUrl = 'https://threads.net/share/Fp3agZKiy/'
    const { expand, calls } = expanderFor({ [SHARE_URL]: TARGET_URL, [noSlash]: TARGET_URL })

    expect(await expand(SHARE_URL)).toBe(TARGET_URL)
    expect(await expand(noSlash)).toBe(TARGET_URL)
    expect(await expand(netUrl)).toBe(TARGET_URL)
    // netUrl 在發請求前就被正規化成 www.threads.com 的同一個短碼，因此第三筆是 SHARE_URL
    expect(calls.map(({ url }) => url)).toEqual([SHARE_URL, noSlash, SHARE_URL])
  })

  it('一般 threads 貼文、其他網站、缺短碼的路徑都不發請求', async () => {
    const { expand, calls } = expanderFor({})

    expect(await expand(TARGET_URL)).toBeNull()
    expect(await expand('https://example.com/share/abc/')).toBeNull()
    expect(await expand('https://www.threads.com/share/')).toBeNull()
    expect(calls).toEqual([])
  })

  it('夾帶額外路徑、查詢字串或偽造網域的假短連結都不發請求', async () => {
    const { expand, calls } = expanderFor({})

    expect(await expand('https://www.threads.com/share/abc/../../evil')).toBeNull()
    expect(await expand('https://www.threads.com/share/abc?next=https://evil.example')).toBeNull()
    expect(await expand('https://www.threads.com.evil.example/share/abc/')).toBeNull()
    expect(calls).toEqual([])
  })
})

describe('createShortLinkExpander — expand', () => {
  it('把 threads /share/ 短連結展開成 Location 指向的目標', async () => {
    const { expand } = expanderFor({ [SHARE_URL]: TARGET_URL })

    expect(await expand(SHARE_URL)).toBe(TARGET_URL)
  })

  it('轉址目標仍是短連結時繼續往下跟', async () => {
    const hop = 'https://www.threads.com/share/bbbbbbbbb/'
    const { expand, calls } = expanderFor({ [SHARE_URL]: hop, [hop]: TARGET_URL })

    expect(await expand(SHARE_URL)).toBe(TARGET_URL)
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

/**
 * facebook 與 threads 走同一個展開器，差別只在 pattern 與 allowedHosts。
 * 這組測試同時守著兩件事：facebook 短連結能展開，以及兩個 provider 的
 * 白名單沒有互通——後者是 allowedHosts 分開放的唯一理由。
 */
const FB_SHARE = 'https://www.facebook.com/share/1976XaXjie/'
const FB_TARGET =
  'https://www.facebook.com/100063463526923/posts/1686328943492540/?rdid=sEZBQz6DRj83mFco&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F1976XaXjie%2F'

describe('createShortLinkExpander — facebook', () => {
  it('認得 /share/ 短連結：含單字母類型片段、m. 子網域、無尾斜線', async () => {
    const typed = 'https://www.facebook.com/share/p/1976XaXjie/'
    const mobile = 'https://m.facebook.com/share/1976XaXjie/'
    const noSlash = 'https://www.facebook.com/share/v/1976XaXjie'
    const routes = { [typed]: FB_TARGET, [mobile]: FB_TARGET, [noSlash]: FB_TARGET }
    const { expand, calls } = expanderFor(routes)

    expect(await expand(typed)).toBe(FB_TARGET)
    expect(await expand(mobile)).toBe(FB_TARGET)
    expect(await expand(noSlash)).toBe(FB_TARGET)
    expect(calls.map(({ url }) => url)).toEqual([typed, mobile, noSlash])
  })

  it('裸網域 facebook.com 在發請求前就被正規化成 www 的同一個短碼', async () => {
    const bare = 'https://facebook.com/share/1976XaXjie/'
    const { expand, calls } = expanderFor({ [FB_SHARE]: FB_TARGET })

    expect(await expand(bare)).toBe(FB_TARGET)
    expect(calls.map(({ url }) => url)).toEqual([FB_SHARE])
  })

  it('web.facebook.com 不在樣式內，連請求都不發', async () => {
    const { expand, calls } = expanderFor({})

    expect(await expand('https://web.facebook.com/share/1976XaXjie/')).toBeNull()
    expect(calls).toEqual([])
  })

  it('一般 facebook 貼文與缺短碼的路徑都不發請求', async () => {
    const { expand, calls } = expanderFor({})

    expect(await expand('https://www.facebook.com/Taipeiinfohub/posts/1686328943492540/')).toBeNull()
    expect(await expand('https://www.facebook.com/share/')).toBeNull()
    expect(await expand('https://www.facebook.com.evil.example/share/abc/')).toBeNull()
    expect(calls).toEqual([])
  })

  it('facebook 短連結被轉去 threads 網域時視為展開失敗', async () => {
    const { expand } = expanderFor({ [FB_SHARE]: 'https://www.threads.com/@a/post/B' })

    expect(await expand(FB_SHARE)).toBeNull()
  })
})

/**
 * 主機名正規化：實測所有非正規主機都是 301 到「www 的同一個短碼」，
 * 目標既然能純字串推導出來，就不必花一整個來回去問伺服器。
 */
describe('createShortLinkExpander — 主機名正規化', () => {
  it('threads 的非正規主機直接改打 www.threads.com，不浪費第一跳', async () => {
    const { expand, calls } = expanderFor({ [SHARE_URL]: TARGET_URL })

    expect(await expand('https://threads.net/share/Fp3agZKiy/')).toBe(TARGET_URL)
    expect(await expand('https://www.threads.net/share/Fp3agZKiy/')).toBe(TARGET_URL)
    expect(await expand('https://threads.com/share/Fp3agZKiy/')).toBe(TARGET_URL)
    expect(calls.map(({ url }) => url)).toEqual([SHARE_URL, SHARE_URL, SHARE_URL])
  })

  it('m.facebook.com 不改寫——它自己就回目標，改寫等於偷換使用者拿到的網域', async () => {
    const mobile = 'https://m.facebook.com/share/1976XaXjie/'
    const mobileTarget = 'https://m.facebook.com/100063463526923/posts/1686328943492540/'
    const { expand, calls } = expanderFor({ [mobile]: mobileTarget })

    expect(await expand(mobile)).toBe(mobileTarget)
    expect(calls.map(({ url }) => url)).toEqual([mobile])
  })

  it('已經是正規主機的網址原樣送出', async () => {
    const { expand, calls } = expanderFor({ [SHARE_URL]: TARGET_URL, [FB_SHARE]: FB_TARGET })

    await expand(SHARE_URL)
    await expand(FB_SHARE)
    expect(calls.map(({ url }) => url)).toEqual([SHARE_URL, FB_SHARE])
  })

  it('主機名大小寫不影響正規化', async () => {
    const { expand, calls } = expanderFor({ [SHARE_URL]: TARGET_URL })

    expect(await expand('https://THREADS.NET/share/Fp3agZKiy/')).toBe(TARGET_URL)
    expect(calls.map(({ url }) => url)).toEqual([SHARE_URL])
  })

  /**
   * 正規化是在 SSRF 邊界「之前」改寫請求目標，因此別名的落點必須仍在白名單內，
   * 否則「短碼只能落在自己的網域」這條保證會被自己的最佳化繞過。
   */
  it('每個別名的落點都仍在該 provider 的白名單內', () => {
    for (const provider of SHORT_LINK_PROVIDERS) {
      for (const canonical of provider.hostAliases.values()) {
        expect(provider.allowedHosts.has(canonical)).toBe(true)
      }
    }
  })
})

describe('createShortLinkExpander — 逾時預算', () => {
  /**
   * 每跳各給一份逾時的話，最壞情況是「上限 × 跳數」；整趟共用同一個 signal，
   * SHORTLINK_TIMEOUT_MS 才真的是「這次展開最多花多久」。
   */
  it('整趟展開共用同一個 AbortSignal，而不是每跳各給一份', async () => {
    const hop = 'https://www.threads.com/share/bbbbbbbbb/'
    const { expand, calls } = expanderFor({ [SHARE_URL]: hop, [hop]: TARGET_URL })

    expect(await expand(SHARE_URL)).toBe(TARGET_URL)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.init?.signal).toBe(calls[1]?.init?.signal)
  })
})
