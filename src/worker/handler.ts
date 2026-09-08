import { MAX_TEXT_LENGTH } from '../config.js'
import { textTooLongError, validateText } from '../services/clean.service.js'
import { cleanText } from '../services/text.cleaner.js'
import type { ShortLinkExpander } from '../services/shortlink.expander.js'
import type { CompiledProvider } from '../types/clearurls.js'

export interface WorkerEnv {
  /** Worker route 掛載的路徑，例如 /api/clean-url */
  MOUNT_PATH: string
}

const BASE_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

function plainText(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * route 模式結尾的 * 會讓掛載路徑底下的子路徑一併打進 Worker，
 * 因此這裡要收斂成單一端點，否則 /api/clean-url/隨便什麼 也會被當成正常請求。
 */
function isMountPath(pathname: string, mountPath: string): boolean {
  return pathname === mountPath || pathname === `${mountPath}/`
}

/**
 * providers 與 expander 都由外部注入：規則集與對外請求的方式因此能在測試中替換，
 * 模組本身不做任何取得依賴的 side effect。
 */
export function createFetchHandler(providers: CompiledProvider[], expander: ShortLinkExpander) {
  async function cleanBody(req: Request): Promise<Response> {
    // content-length 是位元組數、MAX_TEXT_LENGTH 是字元數，單位不同，兩者不能直接比。
    // 這裡只擋「必定超長」的請求：UTF-8 對每個 UTF-16 code unit 最多 3 位元組
    // （BMP 是 3 bytes/1 unit，星光平面 4 bytes/2 units = 2），位元組數超過 MAX_TEXT_LENGTH * 3
    // 才可能字元數超標。權威檢查在 validateText（讀完 body 後）——預檢只是省下必死請求的讀取，
    // 收得比權威檢查寬是刻意的：直接拿位元組數比字元上限會誤擋中文
    // （中文 32768 字是 98304 bytes，恰等於 32768 * 3，必須放行）。
    const declared = req.headers.get('content-length')

    if (declared !== null && Number(declared) > MAX_TEXT_LENGTH * 3) {
      return json(413, { error: textTooLongError() })
    }

    const validation = validateText(await req.text())

    if (!validation.ok) {
      return json(validation.status, { error: validation.error })
    }

    // 單一 token 的所有失敗（InvalidUrlError、completeProvider、超長、展開失敗）
    // 都已在 cleanText 內降級成原樣保留，不會走到這裡
    return plainText(await cleanText(validation.value, providers, expander))
  }

  return async function handleRequest(req: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(req.url)

    if (!isMountPath(pathname, env.MOUNT_PATH)) {
      return json(404, { error: `找不到 ${req.method} ${pathname}` })
    }

    if (req.method === 'POST') {
      return cleanBody(req)
    }

    return json(405, { error: `不支援 ${req.method}` }, { allow: 'POST' })
  }
}
