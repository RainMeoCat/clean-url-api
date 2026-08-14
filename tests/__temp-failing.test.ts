import { describe, expect, it } from 'vitest'
import { loadRules } from '../src/services/rules.loader.js'
import { cleanUrl } from '../src/services/url.cleaner.js'

// 刻意失敗，模擬「上游規則變動導致既有預期不再成立」
describe('模擬上游規則變動造成的回歸', () => {
  it('amazon 的 tag 參數應被保留（錯誤的預期）', () => {
    const providers = loadRules()
    expect(cleanUrl('https://www.amazon.com/dp/B01?tag=aff-20', providers)).toBe(
      'https://www.amazon.com/dp/B01?tag=aff-20'
    )
  })
})
