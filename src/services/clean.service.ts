/**
 * 請求驗證：「什麼算不合法」與「錯誤訊息長怎樣」都定義在這裡。
 *
 * 刻意與 transport 分開——handler 只負責把結果轉成 Response，驗證規則因此
 * 能被單獨測試，也不會散落在路由分派裡。要改訊息或上限就改這個檔案。
 * 這個模組不 import 任何 node: 模組（在 Worker 的 import graph 內）。
 */

import { MAX_TEXT_LENGTH } from '../config.js'

/** 驗證通過時一併回傳收窄後的值，呼叫端就不需要再做型別斷言 */
export type Validation<T> =
  | { ok: true; value: T }
  /** 驗證失敗時一併回傳該用的 HTTP 狀態碼：空 body 是 400、超長是 413 */
  | { ok: false; status: 400 | 413; error: string }

/**
 * 413 的錯誤訊息由 content-length 預先檢查（handler）與讀完後檢查共用，
 * 兩條路徑才會回同一份錯。
 */
export function textTooLongError(): string {
  return `文字長度超過上限 ${MAX_TEXT_LENGTH} 個字元`
}

/**
 * 驗證整段文字的外形。
 *
 * 單一網址 token 的長度上限（MAX_URL_LENGTH）不在這裡檢查——
 * 超長 token 在文字模式下是原樣保留、不套規則的降級，不是請求錯誤，由 text.cleaner 處理。
 */
export function validateText(body: string): Validation<string> {
  if (body.trim() === '') {
    return { ok: false, status: 400, error: '缺少要清理的文字' }
  }

  if (body.length > MAX_TEXT_LENGTH) {
    return { ok: false, status: 413, error: textTooLongError() }
  }

  return { ok: true, value: body }
}
