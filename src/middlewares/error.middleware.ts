import type { NextFunction, Request, Response } from 'express'
import { InvalidUrlError } from '../services/url.cleaner.js'

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `找不到 ${req.method} ${req.path}` })
}

/** Express 以參數個數辨識錯誤處理中介層，因此四個參數都必須保留 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof InvalidUrlError) {
    res.status(400).json({ error: error.message })
    return
  }

  // express.json() 對格式錯誤的請求主體會拋出帶 body 欄位的 SyntaxError
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: '請求主體不是合法的 JSON' })
    return
  }

  console.error('未預期的錯誤：', error)
  res.status(500).json({ error: '伺服器內部錯誤' })
}
