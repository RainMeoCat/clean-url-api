import { Router } from 'express'
import { createCleanController } from '../controllers/clean.controller.js'
import type { CompiledProvider } from '../types/clearurls.js'

export function createCleanRouter(providers: CompiledProvider[]): Router {
  const controller = createCleanController(providers)
  const router = Router()

  router.get('/', controller.cleanOne)
  router.post('/', controller.cleanMany)

  return router
}
