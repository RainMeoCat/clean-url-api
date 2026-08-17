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

function get(url: string): Request {
  return new Request(`https://example.com/api/clean-url?url=${encodeURIComponent(url)}`)
}

describe('Worker GET — 短連結展開', () => {
  it('展開 threads 短連結並清掉展開後的追蹤參數', async () => {
    const { handle } = handlerFor({ [SHARE_URL]: TARGET_URL })
    const res = await handle(get(SHARE_URL), env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: CLEAN_URL })
  })

  it('展開失敗時回退成只做字串清理，仍回 200', async () => {
    const { handle } = handlerFor({})
    const res = await handle(get(SHARE_URL), env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: SHARE_URL })
  })

  it('一般網址不觸發任何對外請求', async () => {
    const { handle, requested } = handlerFor({})
    const res = await handle(get('https://example.com/p?utm_source=x'), env)

    expect(await res.json()).toEqual({ url: 'https://example.com/p' })
    expect(requested).toEqual([])
  })

  it('展開後的 igshid 一樣會被清掉', async () => {
    const { handle } = handlerFor({ [SHARE_URL]: 'https://www.threads.com/@b/post/Q?igshid=zzz' })
    const res = await handle(get(SHARE_URL), env)

    expect(await res.json()).toEqual({ url: 'https://www.threads.com/@b/post/Q' })
  })
})
