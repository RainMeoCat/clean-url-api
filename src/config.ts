/**
 * 與執行環境無關的常數。
 *
 * 這個模組刻意不 import 任何 node: 模組——它被 Worker 版的進入點一路引用到
 * url.cleaner，而 Workers 沒有檔案系統。需要磁碟路徑或 process.env 的設定請放
 * config.node.ts。
 */

/** 單一網址長度上限，避免對超長輸入套用整組 regex */
export const MAX_URL_LENGTH = 8192

/** 單次批次可處理的網址數量上限 */
export const MAX_BATCH_SIZE = 100

/** 巢狀轉址的展開層數上限，防止惡意構造的無限轉址 */
export const MAX_REDIRECTION_DEPTH = 5

export const RATE_LIMIT_WINDOW_MS = 60_000

export const RATE_LIMIT_MAX_REQUESTS = 120
