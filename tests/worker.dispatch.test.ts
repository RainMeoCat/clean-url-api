import { beforeAll, describe, expect, it } from 'vitest'
import { loadRules } from '../src/services/rules.loader.js'
import type { ShortLinkExpander } from '../src/services/shortlink.expander.js'
import { createFetchHandler, type WorkerEnv } from '../src/worker/handler.js'

const env: WorkerEnv = { MOUNT_PATH: '/api/clean-url' }

/** 這組測試只關心路由分派，不涉及短連結展開 */
const noExpansion: ShortLinkExpander = { expand: () => Promise.resolve(null) }

let handle: (req: Request, env: WorkerEnv) => Promise<Response>

beforeAll(() => {
  handle = createFetchHandler(loadRules(), noExpansion)
})

function get(pathAndQuery: string): Request {
  return new Request(`https://example.com${pathAndQuery}`)
}

describe('Worker 路徑收斂', () => {
  it('掛載路徑本身會被處理', async () => {
    const res = await handle(get('/api/clean-url?url=https://example.com/p?utm_source=x'), env)

    expect(res.status).toBe(200)
  })

  it('掛載路徑加尾斜線也會被處理', async () => {
    const res = await handle(get('/api/clean-url/?url=https://example.com/p?utm_source=x'), env)

    expect(res.status).toBe(200)
  })

  // route 模式結尾的 * 會讓子路徑一併打進 Worker，必須自己擋掉
  it('掛載路徑底下的子路徑回 404', async () => {
    const res = await handle(get('/api/clean-url/anything?url=https://example.com/'), env)

    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toContain('/api/clean-url/anything')
  })

  it('僅為前綴相符的路徑回 404', async () => {
    const res = await handle(get('/api/clean-url-other?url=https://example.com/'), env)

    expect(res.status).toBe(404)
  })
})

describe('Worker method 分派', () => {
  it('不支援的 method 回 405 並帶 Allow 標頭', async () => {
    const res = await handle(new Request('https://example.com/api/clean-url', { method: 'DELETE' }), env)

    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET')
  })

  // 這個 API 只接收一個網址、回傳一個網址，查詢參數就夠了，POST 沒有存在的理由
  it('POST 回 405', async () => {
    const res = await handle(
      new Request('https://example.com/api/clean-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/p?utm_source=x' }),
      }),
      env
    )

    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET')
  })

  it('回應為 application/json', async () => {
    const res = await handle(get('/api/clean-url?url=https://example.com/'), env)

    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('帶上不洩漏資訊的安全性標頭', async () => {
    const res = await handle(get('/api/clean-url?url=https://example.com/'), env)

    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })
})
