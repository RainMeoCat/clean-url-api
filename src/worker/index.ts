/**
 * Cloudflare Worker 進入點。
 *
 * 規則集是 bundle 進去的（37 KB / gzip 8 KB），不是執行期讀檔——Workers 沒有檔案系統。
 * sha256 驗證因此前移到 build 時（scripts/verify-rules.ts）。
 */

import rules from '../../data/rules.min.json' with { type: 'json' }
import { compileRuleSet } from '../services/rules.compiler.js'
import type { RuleSet } from '../types/clearurls.js'
import { createFetchHandler, type WorkerEnv } from './handler.js'

// 模組層級只執行一次，之後同一個 isolate 的所有請求共用。
// 實測編譯 206 個 provider（1095 條 regex）約 2 ms，遠低於 Workers 的 startup CPU 上限。
const handleRequest = createFetchHandler(compileRuleSet(rules satisfies RuleSet))

export default {
  fetch(req: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(req, env)
  },
}
