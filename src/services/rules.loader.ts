import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { RULES_HASH_PATH, RULES_PATH } from '../config.node.js'
import type { CompiledProvider, RuleSet } from '../types/clearurls.js'
import { RulesLoadError, compileRuleSet } from './rules.compiler.js'

function readRequiredFile(filePath: string, label: string): Buffer {
  try {
    return readFileSync(filePath)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new RulesLoadError(`無法讀取${label}（${filePath}）：${reason}`)
  }
}

/**
 * 從磁碟載入規則集，以 sha256 驗證完整性後編譯。
 * 驗證失敗一律拋錯——寧可啟動失敗，也不要用來源不明的 regex 處理使用者輸入。
 *
 * Worker 版沒有檔案系統，規則是 bundle 進去的，改在 build 時驗證（scripts/verify-rules.js）。
 */
export function loadRules(rulesPath: string = RULES_PATH, hashPath: string = RULES_HASH_PATH): CompiledProvider[] {
  const data = readRequiredFile(rulesPath, '規則檔')
  const expected = readRequiredFile(hashPath, '規則 hash 檔').toString('utf8').trim().split(/\s+/)[0]?.toLowerCase()

  if (expected === undefined || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new RulesLoadError(`${hashPath} 的內容不是合法的 sha256`)
  }

  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== expected) {
    throw new RulesLoadError(
      `規則檔 sha256 與 ${hashPath} 不符，可能已損毀或遭竄改。\n  期望：${expected}\n  實際：${actual}\n` +
        '  可執行 `npm run vendor` 重新取得官方規則。'
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(data.toString('utf8'))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new RulesLoadError(`規則檔不是合法的 JSON：${reason}`)
  }

  if (typeof parsed !== 'object' || parsed === null || !('providers' in parsed)) {
    throw new RulesLoadError('規則檔缺少 providers 欄位')
  }

  return compileRuleSet(parsed as RuleSet)
}
