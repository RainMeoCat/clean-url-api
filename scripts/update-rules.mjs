#!/usr/bin/env node
/**
 * 下載 ClearURLs 官方規則集並以 sha256 驗證後寫入 data/。
 *
 * 刻意不使用任何第三方套件，讓 CI 不必先 npm install 即可執行。
 * 驗證失敗一律非零退出且不寫入任何檔案——寧可沿用舊規則，也不要載入來源不明的 regex。
 *
 * 用法：node scripts/update-rules.mjs
 */
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 兩個來源內容與 hash 相同，互為備援 */
const SOURCES = [
  { name: 'rules2 (GitHub Pages)', origin: 'https://rules2.clearurls.xyz' },
  { name: 'rules1 (GitLab Pages)', origin: 'https://rules1.clearurls.xyz' },
]

const DATA_DIR = path.resolve(import.meta.dirname, '../data')
const RULES_FILE = path.join(DATA_DIR, 'rules.min.json')
const HASH_FILE = path.join(DATA_DIR, 'rules.hash')
const REQUEST_TIMEOUT_MS = 30_000

/**
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function fetchBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 檢查規則集結構是否符合預期，避免把一份合法 JSON 但內容不對的檔案寫進版控。
 * @param {Buffer} buffer
 * @returns {number} provider 數量
 */
function assertValidRules(buffer) {
  /** @type {unknown} */
  const parsed = JSON.parse(buffer.toString('utf8'))

  if (typeof parsed !== 'object' || parsed === null || !('providers' in parsed)) {
    throw new Error('規則集缺少 providers 欄位')
  }

  const { providers } = /** @type {{ providers: unknown }} */ (parsed)
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) {
    throw new Error('providers 不是物件')
  }

  const names = Object.keys(providers)
  if (names.length === 0) {
    throw new Error('providers 是空的')
  }
  if (!names.includes('globalRules')) {
    throw new Error('規則集缺少 globalRules provider')
  }

  return names.length
}

/**
 * @param {{ name: string, origin: string }} source
 */
async function fetchFromSource(source) {
  const [data, hashFile] = await Promise.all([
    fetchBuffer(`${source.origin}/data.minify.json`),
    fetchBuffer(`${source.origin}/rules.minify.hash`),
  ])

  const expected = hashFile.toString('utf8').trim().split(/\s+/)[0]?.toLowerCase()
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(`hash 檔內容不是合法的 sha256：${JSON.stringify(hashFile.toString('utf8').slice(0, 80))}`)
  }

  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== expected) {
    throw new Error(`sha256 不符\n  期望：${expected}\n  實際：${actual}`)
  }

  const providerCount = assertValidRules(data)
  return { data, hash: expected, providerCount }
}

async function main() {
  /** @type {Error[]} */
  const failures = []

  for (const source of SOURCES) {
    try {
      console.log(`→ 從 ${source.name} 下載規則集…`)
      const { data, hash, providerCount } = await fetchFromSource(source)

      // 寫入原始位元組，確保檔案 sha256 與 data/rules.hash 永遠一致
      await writeFile(RULES_FILE, data)
      await writeFile(HASH_FILE, `${hash}\n`, 'utf8')

      console.log(`✓ 已寫入 ${path.relative(process.cwd(), RULES_FILE)}`)
      console.log(`  provider 數量：${providerCount}`)
      console.log(`  sha256：${hash}`)
      return
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.error(`✗ ${source.name} 失敗：${err.message}`)
      failures.push(err)
    }
  }

  console.error(`\n所有來源皆失敗（${failures.length} 個），未寫入任何檔案。`)
  process.exitCode = 1
}

await main()
