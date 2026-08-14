import { beforeAll, describe, expect, it } from 'vitest'
import { loadRules } from '../src/services/rules.loader.js'
import { createFetchHandler, type WorkerEnv } from '../src/worker/handler.js'

const env: WorkerEnv = { MOUNT_PATH: '/api/clean-url' }

let handle: (req: Request, env: WorkerEnv) => Promise<Response>

beforeAll(() => {
  handle = createFetchHandler(loadRules())
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
    expect(res.headers.get('allow')).toBe('GET, POST')
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
