/**
 * Express 與 Worker 共用的請求驗證與批次語意。
 *
 * 兩個 transport 的錯誤回應方式不同（Express 走 middleware、Worker 直接組 Response），
 * 但「什麼算不合法」與「錯誤訊息長怎樣」必須一致，所以放在這裡而不是各自實作。
 * 這個模組不 import 任何 node: 模組。
 */

import { MAX_BATCH_SIZE, MAX_URL_LENGTH } from '../config.js'
import { InvalidUrlError, cleanUrl } from './url.cleaner.js'
import type { CompiledProvider } from '../types/clearurls.js'

/** 驗證通過時一併回傳收窄後的值，呼叫端就不需要再做型別斷言 */
export type Validation<T> = { ok: true; value: T } | { ok: false; error: string }

/** 驗證單筆網址的外形；是否為合法 http/https 由 cleanUrl 判斷 */
export function validateSingleUrl(url: unknown): Validation<string> {
  if (typeof url !== 'string' || url.trim() === '') {
    return { ok: false, error: '缺少 url 查詢參數' }
  }

  if (url.length > MAX_URL_LENGTH) {
    return { ok: false, error: `網址長度超過上限 ${MAX_URL_LENGTH} 個字元` }
  }

  return { ok: true, value: url }
}

/** 驗證批次請求主體中的 urls 欄位 */
export function validateBatch(urls: unknown): Validation<unknown[]> {
  if (!Array.isArray(urls)) {
    return { ok: false, error: '請求主體需為 { "urls": [...] } 格式' }
  }

  if (urls.length > MAX_BATCH_SIZE) {
    return { ok: false, error: `單次最多處理 ${MAX_BATCH_SIZE} 個網址，收到 ${urls.length} 個` }
  }

  return { ok: true, value: urls }
}

/** 批次項目逐一處理：單筆失敗只讓該筆回傳空字串，不影響其餘網址 */
export function createBatchCleaner(providers: CompiledProvider[]): (value: unknown) => string {
  return (value) => {
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
}
