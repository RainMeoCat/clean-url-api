import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_URL_LENGTH } from '../src/config.js'
import { loadRules } from '../src/services/rules.loader.js'
import type { ShortLinkExpander } from '../src/services/shortlink.expander.js'
import { createFetchHandler, type WorkerEnv } from '../src/worker/handler.js'

const env: WorkerEnv = { MOUNT_PATH: '/api/clean-url' }

/** 這組測試只關心字串清理；短連結展開另有 worker.shortlink.test.ts */
const noExpansion: ShortLinkExpander = { expand: () => Promise.resolve(null) }

let handle: (req: Request, env: WorkerEnv) => Promise<Response>

beforeAll(() => {
  handle = createFetchHandler(loadRules(), noExpansion)
})

/** 掛載路徑固定，測試只關心查詢字串；url 一律編碼以免與外層查詢字串混淆 */
function get(url: string): Request {
  return new Request(`https://example.com/api/clean-url?url=${encodeURIComponent(url)}`)
}

async function errorMessage(res: Response): Promise<string> {
  return ((await res.json()) as { error?: string }).error ?? ''
}

describe('Worker GET', () => {
  it('回傳移除追蹤參數後的網址', async () => {
    const res = await handle(get('https://example.com/p?id=5&utm_source=newsletter&fbclid=abc'), env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://example.com/p?id=5' })
  })

  it('解析轉址並清理解出的目標', async () => {
    const res = await handle(
      get('https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fpage%3Futm_source%3Dserp&sa=U'),
      env
    )

    expect(await res.json()).toEqual({ url: 'https://example.org/page' })
  })

  it('整個網址即追蹤器時回傳空字串', async () => {
    const res = await handle(get('https://pagead2.googlesyndication.com/pagead/ads?client=ca-pub-1'), env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: '' })
  })

  it('缺少 url 參數時回 400', async () => {
    const res = await handle(new Request('https://example.com/api/clean-url'), env)

    expect(res.status).toBe(400)
    expect(await errorMessage(res)).toContain('url')
  })

  it('url 為空白時回 400', async () => {
    const res = await handle(get('   '), env)

    expect(res.status).toBe(400)
  })

  it('非 http/https 的網址回 400', async () => {
    const res = await handle(get('ftp://example.com/file'), env)

    expect(res.status).toBe(400)
  })

  it('超過長度上限的網址回 400', async () => {
    const res = await handle(get(`https://example.com/?a=${'x'.repeat(MAX_URL_LENGTH)}`), env)

    expect(res.status).toBe(400)
    expect(await errorMessage(res)).toContain('長度')
  })

  it('保留被保留參數的原始編碼', async () => {
    const res = await handle(get('https://example.com/p?a=b%20c&utm_source=x'), env)

    expect(await res.json()).toEqual({ url: 'https://example.com/p?a=b%20c' })
  })

  it('清理聯盟參數，不保留 referralMarketing', async () => {
    const res = await handle(get('https://www.amazon.com/dp/B0123/ref=sr_1_1?qid=999&tag=aff-20'), env)

    expect(await res.json()).toEqual({ url: 'https://www.amazon.com/dp/B0123' })
  })
})
