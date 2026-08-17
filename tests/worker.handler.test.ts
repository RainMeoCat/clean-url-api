import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_BATCH_SIZE, MAX_URL_LENGTH } from '../src/config.js'
import { loadRules } from '../src/services/rules.loader.js'
import type { ShortLinkExpander } from '../src/services/shortlink.expander.js'
import { createFetchHandler, type WorkerEnv } from '../src/worker/handler.js'

const env: WorkerEnv = { MOUNT_PATH: '/api/clean-url' }

/** 這組測試只關心字串清理；短連結展開另有 worker.shortlink.test.ts */
const noExpansion: ShortLinkExpander = { matches: () => false, expand: () => Promise.resolve(null) }

let handle: (req: Request, env: WorkerEnv) => Promise<Response>

beforeAll(() => {
  handle = createFetchHandler(loadRules(), noExpansion)
})

/** 掛載路徑固定，測試只關心查詢字串；url 一律編碼以免與外層查詢字串混淆 */
function get(url: string): Request {
  return new Request(`https://example.com/api/clean-url?url=${encodeURIComponent(url)}`)
}

function post(body: unknown, contentType = 'application/json'): Request {
  return new Request('https://example.com/api/clean-url', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
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
})

describe('Worker POST', () => {
  it('批次回傳清理後的網址，順序與輸入一致', async () => {
    const res = await handle(
      post({
        urls: [
          'https://www.amazon.com/dp/B0123/ref=sr_1_1?qid=999&tag=aff-20',
          'https://www.google.com/url?q=https%3A%2F%2Fexample.org%2F%3Futm_medium%3Dcpc',
          'https://example.com/keep?page=2',
        ],
      }),
      env
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      urls: ['https://www.amazon.com/dp/B0123', 'https://example.org/', 'https://example.com/keep?page=2'],
    })
  })

  it('urls 不是陣列時回 400', async () => {
    const res = await handle(post({ urls: 'https://example.com' }), env)

    expect(res.status).toBe(400)
  })

  it('超過批次上限時回 400', async () => {
    const urls = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => 'https://example.com/')
    const res = await handle(post({ urls }), env)

    expect(res.status).toBe(400)
    expect(await errorMessage(res)).toContain(String(MAX_BATCH_SIZE))
  })

  it('批次中的無效項目回傳空字串，不影響其他項目', async () => {
    const res = await handle(post({ urls: ['https://example.com/a?utm_source=x', 'not a url', 42, null] }), env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ urls: ['https://example.com/a', '', '', ''] })
  })

  it('超長項目回傳空字串，不讓整批失敗', async () => {
    const res = await handle(post({ urls: [`https://example.com/?a=${'x'.repeat(MAX_URL_LENGTH)}`] }), env)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ urls: [''] })
  })

  it('請求主體不是合法 JSON 時回 400', async () => {
    const res = await handle(post('{ broken'), env)

    expect(res.status).toBe(400)
    expect(await errorMessage(res)).toContain('JSON')
  })
})
