/**
 * 把 ClearURLs 規則集編譯成可直接套用的 RegExp。
 *
 * 這個模組刻意不 import 任何 node: 模組，Node 與 Worker 兩種部署共用它；
 * 從磁碟讀取與 sha256 驗證屬於 Node 專屬，放在 rules.loader.ts。
 */

import type { CompiledProvider, Provider, RuleSet } from '../types/clearurls.js'

/** 規則集無法取得或無法編譯成可用 provider 時拋出 */
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
