import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../src/middlewares/error.middleware.js'

function mockResponse() {
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  return { res: { status, json } as unknown as Response, status, json }
}

const noop = (() => undefined) as unknown as NextFunction

// 其餘的錯誤轉換（InvalidUrlError → 400、JSON 解析失敗 → 400、404）
// 已由 clean.route.test.ts 透過真實的 Express 流程驗證，此處不重複。
describe('errorHandler', () => {
  it('未預期的錯誤回 500，且不將內部細節洩漏給呼叫端', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { res, status, json } = mockResponse()

    errorHandler(new Error('連線字串 postgres://user:password@db'), {} as Request, res, noop)

    expect(status).toHaveBeenCalledWith(500)
    expect(json).toHaveBeenCalledWith({ error: '伺服器內部錯誤' })
    expect(JSON.stringify(json.mock.calls)).not.toContain('password')
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
