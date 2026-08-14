import { createBatchCleaner, validateBatch, validateSingleUrl } from '../services/clean.service.js'
import { InvalidUrlError, cleanUrl } from '../services/url.cleaner.js'
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

export function createFetchHandler(providers: CompiledProvider[]) {
  const cleanOrEmpty = createBatchCleaner(providers)

  function cleanOne(req: Request): Response {
    const validation = validateSingleUrl(new URL(req.url).searchParams.get('url'))

    if (!validation.ok) {
      return json(400, { error: validation.error })
    }

    try {
      return json(200, { url: cleanUrl(validation.value, providers) })
    } catch (error) {
      // Express 版是丟給 errorHandler 轉 400，Worker 沒有 middleware，就地轉換
      if (error instanceof InvalidUrlError) {
        return json(400, { error: error.message })
      }
      throw error
    }
  }

  async function cleanMany(req: Request): Promise<Response> {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return json(400, { error: '請求主體不是合法的 JSON' })
    }

    const validation = validateBatch((body as { urls?: unknown } | null)?.urls)

    if (!validation.ok) {
      return json(400, { error: validation.error })
    }

    return json(200, { urls: validation.value.map(cleanOrEmpty) })
  }

  return async function handleRequest(req: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(req.url)

    if (!isMountPath(pathname, env.MOUNT_PATH)) {
      return json(404, { error: `找不到 ${req.method} ${pathname}` })
    }

    if (req.method === 'GET') {
      return cleanOne(req)
    }

    if (req.method === 'POST') {
      return cleanMany(req)
    }

    return json(405, { error: `不支援 ${req.method}` }, { allow: 'GET, POST' })
  }
}
