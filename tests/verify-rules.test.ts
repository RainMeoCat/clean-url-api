import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')
const scriptPath = path.join(projectRoot, 'scripts/verify-rules.ts')
const tsxPath = path.join(projectRoot, 'node_modules/.bin/tsx')

const workDir = mkdtempSync(path.join(tmpdir(), 'clear-url-api-verify-'))

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

/** 以指定的規則檔／hash 檔執行驗證腳本，回傳退出碼與輸出 */
function runVerify(env: Record<string, string> = {}) {
  const result = spawnSync(tsxPath, [scriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function writeFixture(name: string, content: string, hash?: string) {
  const rulesPath = path.join(workDir, `${name}.json`)
  const hashPath = path.join(workDir, `${name}.hash`)
  writeFileSync(rulesPath, content)
  writeFileSync(hashPath, `${hash ?? createHash('sha256').update(content).digest('hex')}\n`)
  return { RULES_PATH: rulesPath, RULES_HASH_PATH: hashPath }
}

describe('scripts/verify-rules.ts', () => {
  it('版控中的規則檔驗證通過，退出碼為 0', () => {
    const { status, output } = runVerify()

    expect(status).toBe(0)
    expect(output).toMatch(/provider/)
  })

  it('sha256 不符時以非零退出碼失敗，讓 build 中斷', () => {
    const { status, output } = runVerify(
      writeFixture('tampered', '{"providers":{"globalRules":{"urlPattern":".*"}}}', 'f'.repeat(64))
    )

    expect(status).not.toBe(0)
    expect(output).toMatch(/sha256/)
  })

  it('規則檔含有無法編譯的 regex 時以非零退出碼失敗', () => {
    const { status, output } = runVerify(writeFixture('bad-regex', '{"providers":{"b":{"urlPattern":"([unclosed"}}}'))

    expect(status).not.toBe(0)
    expect(output).toMatch(/urlPattern/)
  })
})
