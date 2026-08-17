/**
 * 請求驗證與批次語意：「什麼算不合法」與「錯誤訊息長怎樣」都定義在這裡。
 *
 * 刻意與 transport 分開——handler 只負責把結果轉成 Response，驗證規則因此
 * 能被單獨測試，也不會散落在路由分派裡。要改訊息或上限就改這個檔案。
 * 這個模組不 import 任何 node: 模組（在 Worker 的 import graph 內）。
 */

import { MAX_BATCH_EXPANSIONS, MAX_BATCH_SIZE, MAX_URL_LENGTH } from '../config.js'
import { InvalidUrlError, cleanUrl } from './url.cleaner.js'
import type { ShortLinkExpander } from './shortlink.expander.js'
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

/**
 * 先把批次中的短連結換成展開後的網址，再交給字串清理。
 *
 * 只展開前 MAX_BATCH_EXPANSIONS 個：每次展開都是一個 subrequest 也是一次外部往返，
 * 超出的項目原樣往下走——沒展開不是錯誤，使用者至少還是拿到清理過的網址。
 */
export function createBatchExpander(expander: ShortLinkExpander): (values: readonly unknown[]) => Promise<unknown[]> {
  return async (values) => {
    const targets = values
      .map((value, index) => ({ value, index }))
      .filter((entry): entry is { value: string; index: number } => typeof entry.value === 'string')
      .filter(({ value }) => expander.matches(value))
      .slice(0, MAX_BATCH_EXPANSIONS)

    if (targets.length === 0) {
      return [...values]
    }

    const expanded = await Promise.all(targets.map(({ value }) => expander.expand(value)))
    const byIndex = new Map(targets.map(({ index }, position) => [index, expanded[position]]))

    // 展開失敗（null）沿用原值，語意與單筆請求一致
    return values.map((value, index) => byIndex.get(index) ?? value)
  }
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
