import { beforeAll, describe, expect, it } from 'vitest'
import { compileRuleSet, loadRules } from '../src/services/rules.loader.js'
import { InvalidUrlError, cleanUrl } from '../src/services/url.cleaner.js'
import type { CompiledProvider } from '../src/types/clearurls.js'

/** 版控中的真實 ClearURLs 規則集 */
let providers: CompiledProvider[]

beforeAll(() => {
  providers = loadRules()
})

describe('cleanUrl — 輸入驗證', () => {
  it.each(['not a url', '', '   ', 'example.com/no-scheme', 'ftp://example.com/file', 'javascript:alert(1)'])(
    '對不合法的輸入 %j 拋出 InvalidUrlError',
    (input) => {
      expect(() => cleanUrl(input, providers)).toThrow(InvalidUrlError)
    }
  )

  it('接受 http 與 https', () => {
    expect(cleanUrl('http://example.com/', providers)).toBe('http://example.com/')
    expect(cleanUrl('https://example.com/', providers)).toBe('https://example.com/')
  })
})

describe('cleanUrl — globalRules', () => {
  it('移除 utm_* 與 fbclid，保留其他參數', () => {
    const input = 'https://example.com/p?id=5&utm_source=newsletter&utm_medium=email&fbclid=abc&page=2'
    expect(cleanUrl(input, providers)).toBe('https://example.com/p?id=5&page=2')
  })

  it('所有參數都被移除時連問號一起去掉', () => {
    expect(cleanUrl('https://example.com/p?utm_source=x', providers)).toBe('https://example.com/p')
  })

  it('沒有查詢字串的網址原樣回傳', () => {
    expect(cleanUrl('https://example.com/a/b/c', providers)).toBe('https://example.com/a/b/c')
  })

  it('保留被保留參數的原始編碼（不經 URLSearchParams 重新編碼）', () => {
    const input = 'https://example.com/p?a=b%20c&q=%E4%B8%AD%E6%96%87&utm_source=x'
    expect(cleanUrl(input, providers)).toBe('https://example.com/p?a=b%20c&q=%E4%B8%AD%E6%96%87')
  })

  it('移除 fragment 中的追蹤參數', () => {
    const input = 'https://example.com/page?a=1#utm_source=x&section=2'
    expect(cleanUrl(input, providers)).toBe('https://example.com/page?a=1#section=2')
  })

  it('不影響非參數形式的 fragment', () => {
    expect(cleanUrl('https://example.com/doc#installation', providers)).toBe('https://example.com/doc#installation')
  })
})

describe('cleanUrl — provider 專屬規則', () => {
  it('套用 amazon 的 rawRules、rules 與 referralMarketing', () => {
    const input = 'https://www.amazon.com/dp/B0123/ref=sr_1_1?qid=999&tag=aff-20'
    expect(cleanUrl(input, providers)).toBe('https://www.amazon.com/dp/B0123')
  })

  it('命中 exceptions 時略過該 provider，但 globalRules 仍生效', () => {
    // /gp/redirector.html 屬於 amazon 的例外，故 referralMarketing 的 tag 會被保留
    const input = 'https://www.amazon.com/gp/redirector.html?tag=aff-20&utm_source=x'
    expect(cleanUrl(input, providers)).toBe('https://www.amazon.com/gp/redirector.html?tag=aff-20')
  })
})

describe('cleanUrl — 轉址', () => {
  it('取出 google /url?q= 的真實目標並遞迴清理', () => {
    const input = 'https://www.google.com/url?q=https%3A%2F%2Fexample.org%2F%3Futm_medium%3Dcpc'
    expect(cleanUrl(input, providers)).toBe('https://example.org/')
  })
})

describe('cleanUrl — 以自訂規則驗證邊界情境', () => {
  const fixture = compileRuleSet({
    providers: {
      blocker: {
        urlPattern: '^https?://ads\\.test',
        completeProvider: true,
      },
      redirector: {
        urlPattern: '^https?://redir\\.test',
        redirections: ['^https?://redir\\.test/\\?to=(.+)$'],
      },
      schemeless: {
        urlPattern: '^https?://amp\\.test',
        redirections: ['^https?://amp\\.test/s/(.+)$'],
      },
      broken: {
        urlPattern: '^https?://broken\\.test',
        redirections: ['^https?://broken\\.test/\\?to=(.+)$'],
        rules: ['track'],
      },
    },
  })

  const nest = (depth: number): string =>
    depth === 0 ? 'https://example.com/final' : `https://redir.test/?to=${encodeURIComponent(nest(depth - 1))}`

  it('completeProvider 命中時回傳空字串', () => {
    expect(cleanUrl('https://ads.test/banner?id=1', fixture)).toBe('')
  })

  it('在深度上限內完整解開巢狀轉址', () => {
    expect(cleanUrl(nest(3), fixture)).toBe('https://example.com/final')
  })

  it('超過深度上限時停止遞迴而非無限展開', () => {
    const result = cleanUrl(nest(12), fixture)
    expect(result.startsWith('https://redir.test/')).toBe(true)
  })

  it('為缺少 scheme 的轉址目標補上 https', () => {
    expect(cleanUrl('https://amp.test/s/example.com/article', fixture)).toBe('https://example.com/article')
  })

  it('轉址目標無法解析時退回一般清理流程', () => {
    expect(cleanUrl('https://broken.test/?to=%%%', fixture)).toBe('https://broken.test/?to=%%%')
    expect(cleanUrl('https://broken.test/x?track=1&keep=2', fixture)).toBe('https://broken.test/x?keep=2')
  })
})
