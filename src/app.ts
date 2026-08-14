import cors from 'cors'
import express, { type Express } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from './config.js'
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js'
import { createCleanRouter } from './routes/clean.route.js'
import type { CompiledProvider } from './types/clearurls.js'

/**
 * 以注入的方式接收規則，讓測試可以直接組出 app 而不必碰磁碟。
 */
export function createApp(providers: CompiledProvider[]): Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))
  app.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: '請求過於頻繁，請稍後再試' },
    })
  )

  app.use('/clean', createCleanRouter(providers))

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
