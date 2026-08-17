/**
 * 與執行環境無關的常數。
 *
 * 這個模組刻意不 import 任何 node: 模組——它被 Worker 進入點一路引用到 url.cleaner，
 * 而 Workers 沒有檔案系統。需要磁碟路徑的設定請放 config.node.ts。
 *
 * 速率限制不在這裡：那是 Cloudflare WAF 的 Rate Limiting Rules 負責的，
 * 它跑在 Worker 之前，被擋下的請求不會進到這份程式碼，也不計入 Worker 用量。
 */

/** 單一網址長度上限，避免對超長輸入套用整組 regex */
export const MAX_URL_LENGTH = 8192

/** 巢狀轉址的展開層數上限，防止惡意構造的無限轉址 */
export const MAX_REDIRECTION_DEPTH = 5

/** 短連結展開的單次請求逾時；外部服務再慢也不該拖垮這個 API */
export const SHORTLINK_TIMEOUT_MS = 3000

/**
 * 短連結展開最多跟隨的轉址次數。
 * 需要 2 是因為 threads.net 會先 301 到 threads.com 的同一個短碼，第二跳才是真正的目標。
 */
export const MAX_SHORTLINK_HOPS = 2

/**
 * 展開短連結時送出的 User-Agent。
 *
 * 不能省略：Threads 對「完全不帶 UA」的請求會轉到 facebook.com/unsupportedbrowser，
 * 對完整瀏覽器 UA 則改回 200 + JS 跳轉頁（頁面裡讀不到目標網址）。
 * 一般的非瀏覽器 UA 才會拿到帶 Location 的 302。
 */
export const SHORTLINK_USER_AGENT = 'clean-url-api/1.0 (+https://github.com/lemiocat/clean-url-api)'
