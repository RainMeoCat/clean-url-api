/**
 * 請求驗證：「什麼算不合法」與「錯誤訊息長怎樣」都定義在這裡。
 *
 * 刻意與 transport 分開——handler 只負責把結果轉成 Response，驗證規則因此
 * 能被單獨測試，也不會散落在路由分派裡。要改訊息或上限就改這個檔案。
 * 這個模組不 import 任何 node: 模組（在 Worker 的 import graph 內）。
 */

import { MAX_URL_LENGTH } from '../config.js'

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
