import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { RULES_HASH_PATH, RULES_PATH } from '../config.js'
import type { CompiledProvider, Provider, RuleSet } from '../types/clearurls.js'

export class RulesLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RulesLoadError'
  }
}

/**
 * 把規則字串編譯成 RegExp，失敗時附上足以定位問題的訊息。
 */
function compile(patterns: string[], flags: string, providerName: string, field: string): RegExp[] {
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern, flags)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new RulesLoadError(`provider "${providerName}" 的 ${field} 含有無法編譯的 regex：${pattern}（${reason}）`)
    }
  })
}

function compileProvider(name: string, provider: Provider): CompiledProvider {
  if (typeof provider.urlPattern !== 'string') {
    throw new RulesLoadError(`provider "${name}" 缺少 urlPattern`)
  }

  return {
    name,
    urlPattern: compile([provider.urlPattern], 'i', name, 'urlPattern')[0] as RegExp,
    completeProvider: provider.completeProvider === true,
    // 參數名稱需完整比對，否則 "id" 這種規則會誤傷 "video_id"。
    // referralMarketing 與 rules 一併移除——本 API 的目的就是產生乾淨網址，不保留聯盟參數。
    rules: compile(
      [...(provider.rules ?? []), ...(provider.referralMarketing ?? [])].map((rule) => `^(?:${rule})$`),
      'i',
      name,
      'rules'
    ),
    rawRules: compile(provider.rawRules ?? [], 'gi', name, 'rawRules'),
    exceptions: compile(provider.exceptions ?? [], 'i', name, 'exceptions'),
    redirections: compile(provider.redirections ?? [], 'i', name, 'redirections'),
  }
}

/** 將規則集編譯成可直接使用的 provider 陣列（純函式，方便測試） */
export function compileRuleSet(ruleSet: RuleSet): CompiledProvider[] {
  const { providers } = ruleSet
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) {
    throw new RulesLoadError('規則集的 providers 不是物件')
  }

  return Object.entries(providers).map(([name, provider]) => compileProvider(name, provider))
}

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
