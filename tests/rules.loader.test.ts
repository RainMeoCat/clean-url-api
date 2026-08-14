import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { RulesLoadError } from '../src/services/rules.compiler.js'
import { loadRules } from '../src/services/rules.loader.js'

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
