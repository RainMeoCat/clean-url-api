import type { Request, RequestHandler, Response } from 'express'
import { MAX_BATCH_SIZE, MAX_URL_LENGTH } from '../config.js'
import { InvalidUrlError, cleanUrl } from '../services/url.cleaner.js'
import type { CompiledProvider } from '../types/clearurls.js'

interface CleanController {
  cleanOne: RequestHandler
  cleanMany: RequestHandler
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message })
}

export function createCleanController(providers: CompiledProvider[]): CleanController {
  /** 批次項目逐一處理：單筆失敗只讓該筆回傳空字串，不影響其餘網址 */
  const cleanOrEmpty = (value: unknown): string => {
    if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
      return ''
    }
    try {
      return cleanUrl(value, providers)
    } catch (error) {
      if (error instanceof InvalidUrlError) {
        return ''
      }
      throw error
    }
  }

  return {
    cleanOne(req: Request, res: Response): void {
      const { url } = req.query

      if (typeof url !== 'string' || url.trim() === '') {
        badRequest(res, '缺少 url 查詢參數')
        return
      }

      if (url.length > MAX_URL_LENGTH) {
        badRequest(res, `網址長度超過上限 ${MAX_URL_LENGTH} 個字元`)
        return
      }

      // InvalidUrlError 交由 errorHandler 轉成 400
      res.json({ url: cleanUrl(url, providers) })
    },

    cleanMany(req: Request, res: Response): void {
      const urls: unknown = (req.body as { urls?: unknown } | undefined)?.urls

      if (!Array.isArray(urls)) {
        badRequest(res, '請求主體需為 { "urls": [...] } 格式')
        return
      }

      if (urls.length > MAX_BATCH_SIZE) {
        badRequest(res, `單次最多處理 ${MAX_BATCH_SIZE} 個網址，收到 ${urls.length} 個`)
        return
      }

      res.json({ urls: urls.map(cleanOrEmpty) })
    },
  }
}
