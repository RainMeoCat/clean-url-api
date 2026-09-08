import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_URL_LENGTH } from '../src/config.js'
import { loadAllRules } from '../src/services/rules.loader.js'
import {
  SHORT_LINK_PROVIDERS,
  createShortLinkExpander,
  type ShortLinkExpander,
} from '../src/services/shortlink.expander.js'
import { cleanText } from '../src/services/text.cleaner.js'
import type { CompiledProvider } from '../src/types/clearurls.js'

let providers: CompiledProvider[]

/** 文字模式的字串清理不碰短連結；展開行為的整合測試在 worker.shortlink.test.ts */
const noExpansion: ShortLinkExpander = { expandFirst: () => Promise.resolve(null) }

const SHARE_URL = 'https://www.threads.com/share/Fp3agZKiy/'
const TARGET_URL = 'https://www.threads.com/@amtb4818/post/DcIG72GFE5W?xmt=AQG0EWQe9UYergxsJyP8DyJWv4NY'
const CLEAN_URL = 'https://www.threads.com/@amtb4818/post/DcIG72GFE5W'

/** 以路由表驅動的假 fetch，並記錄實際發出的請求 */
function createFakeFetch(routes: Record<string, string | number>) {
  const requested: string[] = []

  const impl = ((input: unknown) => {
    const url = String(input)
    requested.push(url)
    const route = routes[url]

    return Promise.resolve(
      typeof route === 'number'
        ? new Response(null, { status: route })
        : route === undefined
          ? new Response(null, { status: 200 })
          : new Response(null, { status: 302, headers: { location: route } })
    )
  }) as unknown as typeof fetch

  return { impl, requested }
}

function expanderFor(routes: Record<string, string | number>) {
  const { impl, requested } = createFakeFetch(routes)
  return { expander: createShortLinkExpander(SHORT_LINK_PROVIDERS, impl), requested }
}

beforeAll(() => {
  providers = loadAllRules()
})

describe('cleanText — 基本替換', () => {
  it('沒有網址時原文原樣回傳', async () => {
    const text = '這裡沒有網址，只有一段文字。\n\n第二段。'

    expect(await cleanText(text, providers, noExpansion)).toBe(text)
  })

  it('多個網址各自清理，前後文字原樣保留', async () => {
    const text =
      '先看 https://example.com/p?id=5&utm_source=newsletter 再看 https://www.amazon.com/dp/B0123/ref=sr_1_1?tag=aff-20 收尾。'

    expect(await cleanText(text, providers, noExpansion)).toBe(
      '先看 https://example.com/p?id=5 再看 https://www.amazon.com/dp/B0123 收尾。'
    )
  })

  it('非網址的位元組完全不變：中文、emoji、多重換行', async () => {
    // 網址夾在多重換行與 emoji 之間；斷言除了網址本身，其餘位元組與輸入完全一致
    const text = '第一行\n🎉✨ 中文與 emoji 混排\n\n\nhttps://example.com/p?utm_source=x\n最後一行 🚀'
    const cleaned = await cleanText(text, providers, noExpansion)

    expect(cleaned).toBe('第一行\n🎉✨ 中文與 emoji 混排\n\n\nhttps://example.com/p\n最後一行 🚀')
    expect(cleaned.replace('https://example.com/p', '')).toBe(text.replace('https://example.com/p?utm_source=x', ''))
  })

  it('巢狀轉址網址整段交給 cleanUrl 的遞迴處理', async () => {
    const text = '轉 https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fpage%3Futm_source%3Dserp&sa=U 結束。'

    expect(await cleanText(text, providers, noExpansion)).toBe('轉 https://example.org/page 結束。')
  })

  it('expandFirst 命中中間位置的 token 時，替換仍落在正確的 offset', async () => {
    const { expander } = expanderFor({ [SHARE_URL]: TARGET_URL })
    const text = `前 https://example.com/p?utm_source=x 中 ${SHARE_URL} 後。`

    expect(await cleanText(text, providers, expander)).toBe(`前 https://example.com/p 中 ${CLEAN_URL} 後。`)
  })
})

describe('cleanText — 錯誤處理的降級（單一 token 出問題絕不讓整個請求失敗）', () => {
  // https://[ 的主機是無法解析的，URL 建構子會丟錯——正是 extractor 抽到垃圾 token 的形狀
  it('cleanUrl 丟 InvalidUrlError 時該 token 原樣保留，其他網址照常清理', async () => {
    const text = '壞的 https://[ 好的 https://example.com/p?utm_source=x。'

    expect(await cleanText(text, providers, noExpansion)).toBe('壞的 https://[ 好的 https://example.com/p。')
  })

  it('completeProvider 命中（清理結果為空字串）時原樣保留，不把文字挖出洞', async () => {
    const text = '連到 https://pagead2.googlesyndication.com/pagead/ads?client=ca-pub-1 之後就沒了。'

    expect(await cleanText(text, providers, noExpansion)).toBe(text)
  })

  it('超過 MAX_URL_LENGTH 的 token 原樣保留，不套規則', async () => {
    // utm_source 若真的被套規則就會被移除；原樣出現即證明根本沒套規則
    const token = `https://example.com/p?utm_source=x&pad=${'x'.repeat(MAX_URL_LENGTH)}`
    const text = `前 ${token} 後。`

    expect(await cleanText(text, providers, noExpansion)).toBe(text)
  })

  it('短連結展開失敗時沿用原網址繼續字串清理，不拋錯', async () => {
    // 路由未定義 → 假 fetch 回 200（查無短碼），與真實的「短碼不存在」同形
    const { expander } = expanderFor({})
    const text = `分享 ${SHARE_URL} 請看。`

    expect(await cleanText(text, providers, expander)).toBe(text)
  })

  it('展開成功後的目標也會再被字串清理一次', async () => {
    const { expander } = expanderFor({ [SHARE_URL]: TARGET_URL })
    const text = `分享 ${SHARE_URL} 請看。`

    expect(await cleanText(text, providers, expander)).toBe(`分享 ${CLEAN_URL} 請看。`)
  })
})
