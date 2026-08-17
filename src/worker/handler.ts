import { validateSingleUrl } from '../services/clean.service.js'
import { InvalidUrlError, cleanUrl } from '../services/url.cleaner.js'
import type { ShortLinkExpander } from '../services/shortlink.expander.js'
import type { CompiledProvider } from '../types/clearurls.js'

export interface WorkerEnv {
  /** Worker route 掛載的路徑，例如 /api/clean-url */
  MOUNT_PATH: string
}

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } })
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
  async function cleanOne(req: Request): Promise<Response> {
    const validation = validateSingleUrl(new URL(req.url).searchParams.get('url'))

    if (!validation.ok) {
      return json(400, { error: validation.error })
    }

    // 展開失敗（含逾時、查無短碼）回 null，沿用原網址繼續清理——
    // Threads 的狀態不該決定這個 API 的成敗。非短連結不會發出任何請求。
    const target = (await expander.expand(validation.value)) ?? validation.value

    try {
      return json(200, { url: cleanUrl(target, providers) })
    } catch (error) {
      // 沒有 middleware 可以攔截，就地把領域錯誤轉成 400；其餘往外拋交給 runtime
      if (error instanceof InvalidUrlError) {
        return json(400, { error: error.message })
      }
      throw error
    }
  }

  return async function handleRequest(req: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(req.url)

    if (!isMountPath(pathname, env.MOUNT_PATH)) {
      return json(404, { error: `找不到 ${req.method} ${pathname}` })
    }

    if (req.method === 'GET') {
      return cleanOne(req)
    }

    return json(405, { error: `不支援 ${req.method}` }, { allow: 'GET' })
  }
}
