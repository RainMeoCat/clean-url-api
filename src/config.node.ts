/**
 * 規則檔在磁碟上的位置。
 *
 * 只有 build 時的驗證（scripts/verify-rules.ts → rules.loader.ts）會用到；
 * Worker 執行期沒有檔案系統，規則是 bundle 進去的。
 * 路徑可用環境變數覆寫，方便測試指向 fixture。
 */

import path from 'node:path'

const defaultRulesPath = path.resolve(import.meta.dirname, '../data/rules.min.json')

export const RULES_PATH = process.env.RULES_PATH ?? defaultRulesPath

export const RULES_HASH_PATH = process.env.RULES_HASH_PATH ?? path.join(path.dirname(RULES_PATH), 'rules.hash')
