/**
 * 文字模式的核心：接收整段文字，只清理其中的網址，其餘位元組原樣返回。
 *
 * 「原樣返回」與 url.cleaner 不用 URL / URLSearchParams 重建網址是同一個精神：
 * 這個 API 只該拿掉追蹤碼，不該擅自改動使用者的文字。
 */

import { MAX_URL_LENGTH } from '../config.js'
import type { CompiledProvider } from '../types/clearurls.js'
import type { ExpandedShortLink, ShortLinkExpander } from './shortlink.expander.js'
import { InvalidUrlError, cleanUrl } from './url.cleaner.js'
import { extractUrls } from './url.extractor.js'

/**
 * 逐 token 決定替換值。
 *
 * 文字模式的降級原則與單一網址模式相反：單一 token 出問題**絕不讓整個請求失敗**——
 * 一篇文章裡有一個怪東西，不該讓其餘三千字白跑，所以每一種失敗都原樣保留該 token。
 */
function replacementFor(
  url: string,
  index: number,
  expanded: ExpandedShortLink | null,
  providers: CompiledProvider[]
): string {
  const original = expanded !== null && expanded.index === index ? expanded.url : url

  // 超長 token 不套規則：MAX_URL_LENGTH 註解裡寫的理由正是「避免對超長輸入套用整組 regex」，
  // 文字模式下它是唯一還需要防 regex 回溯攻擊的地方
  if (original.length > MAX_URL_LENGTH) {
    return original
  }

  try {
    const cleaned = cleanUrl(original, providers)

    // completeProvider 命中時 cleanUrl 回空字串：原樣保留而非把文字挖出洞——
    // 誤判時「刪除」是靜默的資料遺失（貼出去才發現少東西），「保留」只是看得見的一個廣告網址
    return cleaned === '' ? original : cleaned
  } catch (error) {
    if (!(error instanceof InvalidUrlError)) {
      throw error
    }

    // extractor 抽到 https:// 後接垃圾：該 token 原樣保留，繼續處理其他
    return original
  }
}

/**
 * 清理整段文字中的所有網址。
 *
 * providers 與 expander 都由外部注入，與 createFetchHandler 是同一個形式，
 * 測試才能塞自製規則集與假 fetch。
 */
export async function cleanText(
  text: string,
  providers: CompiledProvider[],
  expander: ShortLinkExpander
): Promise<string> {
  const matches = extractUrls(text)

  if (matches.length === 0) {
    return text
  }

  // 對外請求的上限是「一個請求最多展開 1 個短連結」，由 expandFirst 內部守著：
  // 貼滿分享連結的文章否則能把這個 API 變成對短連結伺服器的請求放大器，
  // 而 WAF 的 rate limit 只算請求數，擋不到「一請求對多 fetch」。
  // 展開失敗回 null，沿用原網址繼續字串清理——外部服務的狀態不該決定這個 API 的成敗。
  const expanded = await expander.expandFirst(matches.map((match) => match.url))

  // 先逐 token 決定替換值，再由後往前套用：替換會改變字串長度，
  // 從尾端做就不必重算前面 token 的 offset。
  const replacements = matches
    .map((match, index) => ({ match, replacement: replacementFor(match.url, index, expanded, providers) }))
    // 全域慣例是不做原地變動，即使是 .map() 產生的臨時陣列也不用 .reverse()
    .toReversed()

  let result = text

  for (const { match, replacement } of replacements) {
    result = result.slice(0, match.start) + replacement + result.slice(match.end)
  }

  return result
}
