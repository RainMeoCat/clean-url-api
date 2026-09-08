import { beforeAll, describe, expect, it } from 'vitest'
import { loadAllRules } from '../src/services/rules.loader.js'
import type { ShortLinkExpander } from '../src/services/shortlink.expander.js'
import { createFetchHandler, type WorkerEnv } from '../src/worker/handler.js'

const env: WorkerEnv = { MOUNT_PATH: '/api/clean-url' }

/** 這組測試只關心路由分派，不涉及短連結展開 */
const noExpansion: ShortLinkExpander = { expandFirst: () => Promise.resolve(null) }

let handle: (req: Request, env: WorkerEnv) => Promise<Response>

beforeAll(() => {
  handle = createFetchHandler(loadAllRules(), noExpansion)
})

function post(path: string, body: string): Request {
  return new Request(`https://example.com${path}`, { method: 'POST', body })
}

describe('Worker 路徑收斂', () => {
  it('掛載路徑本身會被處理', async () => {
    const res = await handle(post('/api/clean-url', 'https://example.com/p?utm_source=x'), env)

    expect(res.status).toBe(200)
  })

  it('掛載路徑加尾斜線也會被處理', async () => {
    const res = await handle(post('/api/clean-url/', 'https://example.com/p?utm_source=x'), env)

    expect(res.status).toBe(200)
  })

  // route 模式結尾的 * 會讓子路徑一併打進 Worker，必須自己擋掉
  it('掛載路徑底下的子路徑回 404', async () => {
    const res = await handle(post('/api/clean-url/anything', ''), env)

    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toContain('/api/clean-url/anything')
  })

  it('僅為前綴相符的路徑回 404', async () => {
    const res = await handle(post('/api/clean-url-other', ''), env)

    expect(res.status).toBe(404)
  })
})

describe('Worker method 分派', () => {
  it('不支援的 method 回 405 並帶 Allow: POST', async () => {
    const res = await handle(new Request('https://example.com/api/clean-url', { method: 'DELETE' }), env)

    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  // 入口只留一條：中文經 URL 編碼後一個字變 9 個字元，GET 的長度限制裝不下整段文字
  it('GET（含舊的 ?url= 形狀）回 405 並帶 Allow: POST', async () => {
    const res = await handle(new Request('https://example.com/api/clean-url?url=https%3A%2F%2Fexample.com'), env)

    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  it('成功回應為 text/plain', async () => {
    const res = await handle(post('/api/clean-url', 'https://example.com/'), env)

    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
  })

  it('帶上不洩漏資訊的安全性標頭', async () => {
    const res = await handle(post('/api/clean-url', 'https://example.com/'), env)

    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })
})
