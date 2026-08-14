import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler, notFoundHandler } from '../src/middlewares/error.middleware.js'
import { InvalidUrlError } from '../src/services/url.cleaner.js'

function mockResponse() {
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  return { res: { status, json } as unknown as Response, status, json }
}

const noop = (() => undefined) as unknown as NextFunction

describe('notFoundHandler', () => {
  it('回 404 並帶上方法與路徑', () => {
    const { res, status, json } = mockResponse()
    notFoundHandler({ method: 'GET', path: '/nope' } as Request, res)

    expect(status).toHaveBeenCalledWith(404)
    expect(json).toHaveBeenCalledWith({ error: '找不到 GET /nope' })
  })
})

describe('errorHandler', () => {
  it('InvalidUrlError 轉成 400', () => {
    const { res, status, json } = mockResponse()
    errorHandler(new InvalidUrlError('壞網址'), {} as Request, res, noop)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith({ error: '壞網址' })
  })

  it('請求主體 JSON 解析失敗轉成 400', () => {
    const { res, status, json } = mockResponse()
    const error = Object.assign(new SyntaxError('Unexpected token'), { body: '{ broken' })
    errorHandler(error, {} as Request, res, noop)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith({ error: '請求主體不是合法的 JSON' })
  })

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
