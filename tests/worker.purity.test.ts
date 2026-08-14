import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = path.resolve(import.meta.dirname, '../src')

/**
 * 從進入點靜態走訪相對 import，收集沿路出現的 node: 內建模組。
 *
 * 這是保守的過度估計（type-only import 在編譯後其實會被抹除，這裡仍會計入），
 * 因此「回報乾淨」是可信的結論，正好符合守門測試需要的方向。
 */
function nodeBuiltinsReachableFrom(entryFile: string): string[] {
  const visited = new Set<string>()
  const builtins = new Set<string>()
  const queue = [path.join(srcRoot, entryFile)]

  while (queue.length > 0) {
    const file = queue.pop() as string
    if (visited.has(file)) {
      continue
    }
    visited.add(file)

    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1] as string

      if (specifier.startsWith('node:')) {
        builtins.add(specifier)
      } else if (specifier.startsWith('.') && specifier.endsWith('.js')) {
        // 原始碼依 ESM 規範寫 .js，磁碟上是 .ts
        queue.push(path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts')))
      }
    }
  }

  return [...builtins].sort()
}

describe('Worker 的 import graph', () => {
  it('完全不依賴 node: 內建模組', () => {
    expect(nodeBuiltinsReachableFrom('worker/index.ts')).toEqual([])
  })

  // 證明上面那條斷言不是因為偵測器失效才通過：
  // Express 進入點確實會讀檔與算 hash，必須被偵測到。
  it('偵測器有效——Express 進入點會被驗出 node: 依賴', () => {
    expect(nodeBuiltinsReachableFrom('index.ts')).toEqual(
      expect.arrayContaining(['node:crypto', 'node:fs', 'node:path'])
    )
  })
})
