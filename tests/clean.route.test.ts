import type { Express } from 'express'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { MAX_BATCH_SIZE, MAX_URL_LENGTH } from '../src/config.js'
import { loadRules } from '../src/services/rules.loader.js'

let app: Express

beforeAll(() => {
  app = createApp(loadRules())
})

/** supertest 的 res.body 型別是 any，統一在此收斂 */
function errorMessage(body: unknown): string {
  return (body as { error?: string }).error ?? ''
}

describe('GET /clean', () => {
  it('回傳移除追蹤參數後的網址', async () => {
    const res = await request(app)
      .get('/clean')
      .query({ url: 'https://example.com/p?id=5&utm_source=newsletter&fbclid=abc' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ url: 'https://example.com/p?id=5' })
  })

  it('缺少 url 參數時回 400', async () => {
    const res = await request(app).get('/clean')

    expect(res.status).toBe(400)
    expect(errorMessage(res.body)).toContain('url')
  })

  it('url 為空字串時回 400', async () => {
    const res = await request(app).get('/clean').query({ url: '   ' })

    expect(res.status).toBe(400)
  })

  it('非 http/https 的網址回 400', async () => {
    const res = await request(app).get('/clean').query({ url: 'ftp://example.com/file' })

    expect(res.status).toBe(400)
  })

  it('超過長度上限的網址回 400', async () => {
    const res = await request(app)
      .get('/clean')
      .query({ url: `https://example.com/?a=${'x'.repeat(MAX_URL_LENGTH)}` })

    expect(res.status).toBe(400)
    expect(errorMessage(res.body)).toContain('長度')
  })
})

describe('POST /clean', () => {
  it('批次回傳清理後的網址，順序與輸入一致', async () => {
    const res = await request(app)
      .post('/clean')
      .send({
        urls: [
          'https://www.amazon.com/dp/B0123/ref=sr_1_1?qid=999&tag=aff-20',
          'https://www.google.com/url?q=https%3A%2F%2Fexample.org%2F%3Futm_medium%3Dcpc',
          'https://example.com/keep?page=2',
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      urls: ['https://www.amazon.com/dp/B0123', 'https://example.org/', 'https://example.com/keep?page=2'],
    })
  })

  it('urls 不是陣列時回 400', async () => {
    const res = await request(app).post('/clean').send({ urls: 'https://example.com' })

    expect(res.status).toBe(400)
  })

  it('缺少 urls 欄位時回 400', async () => {
    const res = await request(app).post('/clean').send({})

    expect(res.status).toBe(400)
  })

  it('超過批次上限時回 400', async () => {
    const urls = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => 'https://example.com/')
    const res = await request(app).post('/clean').send({ urls })

    expect(res.status).toBe(400)
    expect(errorMessage(res.body)).toContain(String(MAX_BATCH_SIZE))
  })

  it('批次中的無效項目回傳空字串，不影響其他項目', async () => {
    const res = await request(app)
      .post('/clean')
      .send({ urls: ['https://example.com/a?utm_source=x', 'not a url', 42, null, 'https://example.com/b'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ urls: ['https://example.com/a', '', '', '', 'https://example.com/b'] })
  })

  it('空陣列回傳空陣列', async () => {
    const res = await request(app).post('/clean').send({ urls: [] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ urls: [] })
  })

  it('請求主體不是合法 JSON 時回 400', async () => {
    const res = await request(app).post('/clean').set('Content-Type', 'application/json').send('{ broken')

    expect(res.status).toBe(400)
    expect(errorMessage(res.body)).toContain('JSON')
  })
})

describe('未定義的路由', () => {
  it('回 404', async () => {
    const res = await request(app).get('/does-not-exist')

    expect(res.status).toBe(404)
  })
})
