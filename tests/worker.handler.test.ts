import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_TEXT_LENGTH } from '../src/config.js'
import { loadAllRules } from '../src/services/rules.loader.js'
import type { ShortLinkExpander } from '../src/services/shortlink.expander.js'
import { createFetchHandler, type WorkerEnv } from '../src/worker/handler.js'

const env: WorkerEnv = { MOUNT_PATH: '/api/clean-url' }

/** 這組測試只關心字串清理；短連結展開另有 worker.shortlink.test.ts */
const noExpansion: ShortLinkExpander = { expandFirst: () => Promise.resolve(null) }

let handle: (req: Request, env: WorkerEnv) => Promise<Response>

beforeAll(() => {
  handle = createFetchHandler(loadAllRules(), noExpansion)
})

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/clean-url', { method: 'POST', body, headers })
}

/** stream body 不會自動帶 content-length，用來模擬 chunked 傳輸 */
function chunkedPost(body: string): Request {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })

  return new Request('https://example.com/api/clean-url', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  })
}

async function errorMessage(res: Response): Promise<string> {
  return ((await res.json()) as { error?: string }).error ?? ''
}

describe('Worker POST — 文字清理', () => {
  it('回傳清理後的整段文字（content-type 為 text/plain）', async () => {
    const res = await handle(post('先看 https://example.com/p?id=5&utm_source=newsletter 再看其他。'), env)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
    expect(await res.text()).toBe('先看 https://example.com/p?id=5 再看其他。')
  })

  it('解析轉址並清理解出的目標', async () => {
    const res = await handle(
      post('轉 https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fpage%3Futm_source%3Dserp&sa=U 結束。'),
      env
    )

    expect(await res.text()).toBe('轉 https://example.org/page 結束。')
  })

  // 舊契約下無效網址回 400、整個請求失敗；文字模式必須反過來
  it('單一 token 出問題不讓整個請求失敗：無效網址原樣保留、照樣回 200', async () => {
    const res = await handle(post('壞的 https://[ 好的 https://example.com/p?utm_source=x。'), env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('壞的 https://[ 好的 https://example.com/p。')
  })

  it('body 為空回 400', async () => {
    const res = await handle(post(''), env)

    expect(res.status).toBe(400)
    expect(await errorMessage(res)).toBe('缺少要清理的文字')
  })

  it('body 全空白回 400', async () => {
    const res = await handle(post(' \n\t　'), env)

    expect(res.status).toBe(400)
    expect(await errorMessage(res)).toBe('缺少要清理的文字')
  })

  it('content-length 超過預檢界時回 413，且不讀 body', async () => {
    // body 是一個永不結束的 stream：若 handler 讀了 body,req.text() 會 pending 到測試逾時；
    // 能立即回 413 才證明預先檢查在讀 body 之前就擋下了。
    // 預檢界是 MAX_TEXT_LENGTH * 3（UTF-8 對每個 code unit 最多 3 位元組），超過它才可能超長
    const never = new ReadableStream({ start() {} })
    const res = await handle(
      new Request('https://example.com/api/clean-url', {
        method: 'POST',
        body: never,
        duplex: 'half',
        headers: { 'content-length': String(MAX_TEXT_LENGTH * 3 + 1) },
      }),
      env
    )

    expect(res.status).toBe(413)
    expect(await errorMessage(res)).toContain('超過上限')
  })

  it('無 content-length（chunked）時，讀完後超過上限回 413', async () => {
    const res = await handle(chunkedPost('x'.repeat(MAX_TEXT_LENGTH + 1)), env)

    expect(res.status).toBe(413)
    expect(await errorMessage(res)).toContain('超過上限')
  })

  it('字元數恰好等於上限時不擋下（上限含邊界）', async () => {
    const res = await handle(post('x'.repeat(MAX_TEXT_LENGTH)), env)

    expect(res.status).toBe(200)
  })

  // Node 的 Request 對字串 body 不會自動帶 content-length，必須明確設定，才會走到預檢路徑。
  // 中文在 UTF-8 下每個字元 3 位元組，這組測試守著「預檢以位元組界擋，不以字元界擋」——
  // 之前直接拿位元組數比字元上限，把中文的有效上限無聲壓成了 32768 / 3 個字。
  it('中文 32768 字元（98304 bytes，恰好等於預檢界 MAX_TEXT_LENGTH * 3）不會被誤擋', async () => {
    const body = '中'.repeat(MAX_TEXT_LENGTH)
    const res = await handle(post(body, { 'content-length': String(Buffer.byteLength(body)) }), env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe(body)
  })

  it('中文 20000 字元（60000 bytes，位元組數遠超字元上限）照常清理', async () => {
    const body = '中'.repeat(20000)
    const res = await handle(post(body, { 'content-length': String(Buffer.byteLength(body)) }), env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe(body)
  })

  it('中文超過字元上限時回 413', async () => {
    const body = '中'.repeat(MAX_TEXT_LENGTH + 1)
    const res = await handle(post(body, { 'content-length': String(Buffer.byteLength(body)) }), env)

    expect(res.status).toBe(413)
    expect(await errorMessage(res)).toContain('超過上限')
  })
})
