import path from 'node:path'

/** src/config.ts 與編譯後的 dist/config.js 相對於專案根目錄的層級相同，故同一路徑兩種情境皆適用 */
const defaultRulesPath = path.resolve(import.meta.dirname, '../data/rules.min.json')

export const PORT = Number(process.env.PORT ?? 3000)

export const RULES_PATH = process.env.RULES_PATH ?? defaultRulesPath

export const RULES_HASH_PATH = process.env.RULES_HASH_PATH ?? path.join(path.dirname(RULES_PATH), 'rules.hash')

/** 單一網址長度上限，避免對超長輸入套用整組 regex */
export const MAX_URL_LENGTH = 8192

/** POST /clean 單次可處理的網址數量上限 */
export const MAX_BATCH_SIZE = 100

/** 巢狀轉址的展開層數上限，防止惡意構造的無限轉址 */
export const MAX_REDIRECTION_DEPTH = 5

export const RATE_LIMIT_WINDOW_MS = 60_000

export const RATE_LIMIT_MAX_REQUESTS = 120
