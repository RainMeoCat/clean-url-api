import type { Request, RequestHandler, Response } from 'express'
import { createBatchCleaner, validateBatch, validateSingleUrl } from '../services/clean.service.js'
import { cleanUrl } from '../services/url.cleaner.js'
import type { CompiledProvider } from '../types/clearurls.js'

interface CleanController {
  cleanOne: RequestHandler
  cleanMany: RequestHandler
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message })
}

export function createCleanController(providers: CompiledProvider[]): CleanController {
  const cleanOrEmpty = createBatchCleaner(providers)

  return {
    cleanOne(req: Request, res: Response): void {
      const validation = validateSingleUrl(req.query.url)

      if (!validation.ok) {
        badRequest(res, validation.error)
        return
      }

      // InvalidUrlError 交由 errorHandler 轉成 400
      res.json({ url: cleanUrl(validation.value, providers) })
    },

    cleanMany(req: Request, res: Response): void {
      const validation = validateBatch((req.body as { urls?: unknown } | undefined)?.urls)

      if (!validation.ok) {
        badRequest(res, validation.error)
        return
      }

      res.json({ urls: validation.value.map(cleanOrEmpty) })
    },
  }
}
