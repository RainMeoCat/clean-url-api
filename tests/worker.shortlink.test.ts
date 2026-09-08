import { beforeAll, describe, expect, it } from 'vitest'
import { loadAllRules } from '../src/services/rules.loader.js'
import { SHORT_LINK_PROVIDERS, createShortLinkExpander } from '../src/services/shortlink.expander.js'
import { createFetchHandler, type WorkerEnv } from '../src/worker/handler.js'
import type { CompiledProvider } from '../src/types/clearurls.js'

const env: WorkerEnv = { MOUNT_PATH: '/api/clean-url' }

const SHARE_URL = 'https://www.threads.com/share/Fp3agZKiy/'
const TARGET_URL = 'https://www.threads.com/@amtb4818/post/DcIG72GFE5W?xmt=AQG0EWQe9UYergxsJyP8DyJWv4NY'
const CLEAN_URL = 'https://www.threads.com/@amtb4818/post/DcIG72GFE5W'

let providers: CompiledProvider[]

beforeAll(() => {
  providers = loadAllRules()
})

/** 以路由表驅動的假 fetch，並記錄實際發出的請求 */
function createFakeFetch(routes: Record<string, string>) {
  const requested: string[] = []

  const impl = ((input: unknown) => {
    const url = String(input)
    requested.push(url)
    const location = routes[url]

    return Promise.resolve(
      location === undefined
        ? new Response(null, { status: 200 })
        : new Response(null, { status: 302, headers: { location } })
    )
  }) as unknown as typeof fetch

  return { impl, requested }
}

function handlerFor(routes: Record<string, string>) {
  const { impl, requested } = createFakeFetch(routes)
  const handle = createFetchHandler(providers, createShortLinkExpander(SHORT_LINK_PROVIDERS, impl))
  return { handle, requested }
}

function post(body: string): Request {
  return new Request('https://example.com/api/clean-url', { method: 'POST', body })
}

describe('Worker POST — 短連結展開', () => {
  it('展開文字中的 threads 短連結並清掉展開後的追蹤參數', async () => {
    const { handle } = handlerFor({ [SHARE_URL]: TARGET_URL })
    const res = await handle(post(`分享 ${SHARE_URL} 請看。`), env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe(`分享 ${CLEAN_URL} 請看。`)
  })

  it('一個請求只展開第一個命中的短連結，第二個不觸發請求', async () => {
    const second = 'https://www.threads.com/share/ZZZ999xxx/'
    const { handle, requested } = handlerFor({ [SHARE_URL]: TARGET_URL, [second]: 'https://www.threads.com/@b/post/Q' })

    const res = await handle(post(`${SHARE_URL} 與 ${second}`), env)

    expect(await res.text()).toBe(`${CLEAN_URL} 與 ${second}`)
    expect(requested).toHaveLength(1)
  })

  /**
   * 「一請求最多一次展開」唯一的守門測試：第一個命中樣式的網址就用盡名額，
   * 即使展開失敗（查無短碼）也不往下找。若失敗時改試下一個，一篇貼滿
   * 查無短碼之分享連結的文章就能誘發 N 次展開，WAF 的 rate limit 擋不到。
   *
   * 這裡守的是展開次數，不是 fetch 次數：一次展開的逐跳迴圈最多
   * MAX_SHORTLINK_HOPS（2）次 fetch，對外請求次數因此恆 ≤ MAX_SHORTLINK_HOPS，
   * 而不是 ≤ 1。
   */
  it('第一個命中的短連結展開失敗時，不會往下找（展開次數 ≤ 1、fetch 次數 ≤ MAX_SHORTLINK_HOPS）', async () => {
    const second = 'https://www.threads.com/share/YYY888www/'
    const { handle, requested } = handlerFor({})

    await handle(post(`${SHARE_URL} 與 ${second}`), env)

    expect(requested.length).toBeLessThanOrEqual(1)
  })

  it('展開失敗時回退成只做字串清理，仍回 200', async () => {
    const { handle } = handlerFor({})
    const res = await handle(post(SHARE_URL), env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe(SHARE_URL)
  })

  it('一般網址不觸發任何對外請求', async () => {
    const { handle, requested } = handlerFor({})
    const res = await handle(post('https://example.com/p?utm_source=x'), env)

    expect(await res.text()).toBe('https://example.com/p')
    expect(requested).toEqual([])
  })

  it('展開後的 igshid 一樣會被清掉', async () => {
    const { handle } = handlerFor({ [SHARE_URL]: 'https://www.threads.com/@b/post/Q?igshid=zzz' })
    const res = await handle(post(SHARE_URL), env)

    expect(await res.text()).toBe('https://www.threads.com/@b/post/Q')
  })
})
