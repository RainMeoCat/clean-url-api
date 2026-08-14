/**
 * 只有 Node（Express）版會用到的設定。Worker 版不會 import 這個模組。
 */

import path from 'node:path'

/** src/config.node.ts 與編譯後的 dist/config.node.js 相對於專案根目錄的層級相同，故同一路徑兩種情境皆適用 */
const defaultRulesPath = path.resolve(import.meta.dirname, '../data/rules.min.json')

export const PORT = Number(process.env.PORT ?? 3000)

export const RULES_PATH = process.env.RULES_PATH ?? defaultRulesPath

export const RULES_HASH_PATH = process.env.RULES_HASH_PATH ?? path.join(path.dirname(RULES_PATH), 'rules.hash')
