import { describe, expect, it } from 'vitest'
import { RulesLoadError, compileRuleSet } from '../src/services/rules.compiler.js'
import { cleanUrl } from '../src/services/url.cleaner.js'

describe('compileRuleSet', () => {
  it('providers 不是物件時拋出 RulesLoadError', () => {
    expect(() => compileRuleSet({ providers: [] as unknown as Record<string, never> })).toThrow(RulesLoadError)
  })

  it('provider 缺少 urlPattern 時拋出 RulesLoadError', () => {
    expect(() => compileRuleSet({ providers: { broken: {} as never } })).toThrow(/urlPattern/)
  })

  it('regex 無法編譯時指出是哪個 provider 的哪個欄位', () => {
    expect(() => compileRuleSet({ providers: { broken: { urlPattern: '.*', rawRules: ['([unclosed'] } } })).toThrow(
      /provider "broken" 的 rawRules/
    )
  })

  it('rules 錨定為完整比對，不會誤傷名稱相近的參數', () => {
    const providers = compileRuleSet({ providers: { t: { urlPattern: '^https?://t\\.test', rules: ['id'] } } })
    expect(cleanUrl('https://t.test/?id=1&video_id=2', providers)).toBe('https://t.test/?video_id=2')
  })

  it('referralMarketing 與 rules 一併被移除', () => {
    const providers = compileRuleSet({
      providers: { t: { urlPattern: '^https?://t\\.test', rules: ['a'], referralMarketing: ['ref'] } },
    })
    expect(cleanUrl('https://t.test/?a=1&ref=2&keep=3', providers)).toBe('https://t.test/?keep=3')
  })
})
