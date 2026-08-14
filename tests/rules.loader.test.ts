import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { RulesLoadError, compileRuleSet, loadRules } from '../src/services/rules.loader.js'
import { cleanUrl } from '../src/services/url.cleaner.js'

const workDir = mkdtempSync(path.join(tmpdir(), 'clear-url-api-'))

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

/** 產生一組規則檔與 hash 檔；不指定 hash 時自動算出正確值 */
function writeFixture(name: string, content: string, hash?: string) {
  const rulesPath = path.join(workDir, `${name}.json`)
  const hashPath = path.join(workDir, `${name}.hash`)
  writeFileSync(rulesPath, content)
  writeFileSync(hashPath, `${hash ?? createHash('sha256').update(content).digest('hex')}\n`)
  return { rulesPath, hashPath }
}

describe('loadRules', () => {
  it('載入版控中的規則集', () => {
    const providers = loadRules()
    expect(providers.length).toBeGreaterThan(100)
    expect(providers.map((provider) => provider.name)).toContain('globalRules')
  })

  it('sha256 不符時拋出 RulesLoadError', () => {
    const { rulesPath, hashPath } = writeFixture(
      'tampered',
      '{"providers":{"globalRules":{"urlPattern":".*"}}}',
      'f'.repeat(64)
    )
    expect(() => loadRules(rulesPath, hashPath)).toThrow(RulesLoadError)
    expect(() => loadRules(rulesPath, hashPath)).toThrow(/sha256/)
  })

  it('規則檔不存在時拋出 RulesLoadError', () => {
    expect(() => loadRules(path.join(workDir, 'missing.json'), path.join(workDir, 'missing.hash'))).toThrow(
      RulesLoadError
    )
  })

  it('hash 檔內容不是合法 sha256 時拋出 RulesLoadError', () => {
    const { rulesPath, hashPath } = writeFixture('bad-hash', '{"providers":{}}', 'not-a-hash')
    expect(() => loadRules(rulesPath, hashPath)).toThrow(/不是合法的 sha256/)
  })

  it('規則檔不是合法 JSON 時拋出 RulesLoadError', () => {
    const { rulesPath, hashPath } = writeFixture('broken', '{ this is not json')
    expect(() => loadRules(rulesPath, hashPath)).toThrow(/不是合法的 JSON/)
  })

  it('規則檔缺少 providers 時拋出 RulesLoadError', () => {
    const { rulesPath, hashPath } = writeFixture('no-providers', '{"rules":[]}')
    expect(() => loadRules(rulesPath, hashPath)).toThrow(/providers/)
  })
})

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
