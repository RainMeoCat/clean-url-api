/**
 * 驗證版控中的規則集：sha256 相符、是合法 JSON、且每條 regex 都能編譯。
 *
 * Worker 版沒有檔案系統，規則是在 build 時 bundle 進去的，執行期再驗一次沒有意義
 * （bundle 被竄改的話裡面的 hash 也一起被竄改）。因此驗證前移到這裡，由 CI 與
 * build 流程呼叫——壞掉的規則會讓部署失敗，而不是讓線上服務啟動失敗。
 *
 * 規則檔路徑可用 RULES_PATH / RULES_HASH_PATH 覆寫，方便測試。
 */

import { RULES_PATH } from '../src/config.node.js'
import { loadRules } from '../src/services/rules.loader.js'

try {
  const providers = loadRules()
  console.log(`✓ 規則檔驗證通過：${providers.length} 個 provider`)
} catch (error) {
  console.error(`✗ 規則檔驗證失敗（${RULES_PATH}）`)
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
