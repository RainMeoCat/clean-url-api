/**
 * 網址邊界偵測（方案 A）：掃描 + 字元類別終止 + 尾端標點剝除。
 *
 * 純字串處理、零相依——純 regex 全文 replace() 做不到括號配對（無法平衡括號），
 * 引入 linkifyjs 又破壞「執行期相依為零」，因此每條邊界規則都在這裡手寫、可獨立測試。
 *
 * 職責只有「網址從哪裡開始、到哪裡結束」；token 是否為合法網址、要不要套規則，
 * 由 text.cleaner 與 cleanUrl 負責。已知限制：網址與 CJK 文字之間完全沒有
 * 空白或標點分隔時會誤收（如「看這個https://example.com/p很有趣」），
 * 沒有分隔就沒有邊界，除非引入斷詞。
 */

export interface UrlMatch {
  /** 網址在原文中的起始 offset（inclusive） */
  readonly start: number
  /** 網址在原文中的結束 offset（exclusive），已扣除被剝除的尾端標點 */
  readonly end: number
  readonly url: string
}

/**
 * 終止字元：任何空白（JavaScript 的 \s 已涵蓋全形空白 U+3000）、
 * 全形／CJK 標點，以及 ASCII 的 < > " ' 反引號。
 *
 * CJK 文字本身不是終止符（否則會截斷 zh.wikipedia.org/wiki/臺灣），
 * 但全形標點是（否則「https://example.com/p。然後…」會被誤收）——
 * 這兩件事必須分開，混在同一個字元集裡的話改一個 case 就會靜默弄壞另一個。
 */
const TERMINATOR = /[\s。、「」『』〈〉《》【】〔〕…—～·，；：！？（）<>"'`]/

/** 無條件剝除的尾端半形標點；' 與 " 不列入：它們已是終止字元，不可能出現在尾端 */
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}'])

/** 終止字元本身不納入網址 */
const SCHEME_PATTERN = /https?:\/\//gi

/**
 * 掃描全文抽出所有網址 token。
 *
 * 找到一個網址後，下一次搜尋從該網址的 end 繼續——巢狀轉址網址
 * （https://a.com/r?u=http://b.com）若被拆成兩個 token，內層目標會繞過
 * 外層轉址規則的遞迴清理，那是 cleanUrl 的職責，extractor 不插手。
 */
export function extractUrls(text: string): readonly UrlMatch[] {
  const matches: UrlMatch[] = []
  const pattern = new RegExp(SCHEME_PATTERN.source, SCHEME_PATTERN.flags)

  for (let m = pattern.exec(text); m !== null;) {
    const start = m.index
    const schemeEnd = start + m[0].length

    // 從 scheme 結束處往後讀到終止字元；終止字元本身不納入網址
    let end = schemeEnd
    while (end < text.length && !TERMINATOR.test(text.charAt(end))) {
      end += 1
    }

    // https:// 後緊接終止字元或字串結尾（沒有任何主機字元）→ 不視為網址
    if (end === schemeEnd) {
      pattern.lastIndex = schemeEnd
    } else {
      const trimmedEnd = stripTrailingPunctuation(text, start, end)

      if (trimmedEnd === schemeEnd) {
        // 主體全是半形標點、被尾端剝除剝光（如 https://,）：與無主機字元同樣處理
        pattern.lastIndex = schemeEnd
      } else {
        matches.push({ start, end: trimmedEnd, url: text.slice(start, trimmedEnd) })
        pattern.lastIndex = trimmedEnd
      }
    }

    m = pattern.exec(text)
  }

  return matches
}

/**
 * 迭代剝除尾端的半形標點，直到穩定。
 *
 * ) ] } 只在不配對時剝除——從網址起點算起，關閉的數量**多於**開啟的才剝。
 * 這一條同時處理兩個相反的形狀：維基百科 Foo_(bar) 的右括號屬於網址本身，
 * markdown [文字](https://…) 的右括號則屬於標記語法。
 *
 * 括號數量先一次掃描統計、剝除時只遞減：若每剝一個就重掃整個 token，
 * 尾端全是 ) 的最長 token（32768 字元）會退化成 O(n²)。
 */
function stripTrailingPunctuation(text: string, start: number, end: number): number {
  let openParens = 0
  let closeParens = 0
  let openBrackets = 0
  let closeBrackets = 0
  let openBraces = 0
  let closeBraces = 0

  for (let i = start; i < end; i += 1) {
    switch (text.charAt(i)) {
      case '(':
        openParens += 1
        break
      case ')':
        closeParens += 1
        break
      case '[':
        openBrackets += 1
        break
      case ']':
        closeBrackets += 1
        break
      case '{':
        openBraces += 1
        break
      case '}':
        closeBraces += 1
        break
    }
  }

  let current = end

  while (current > start) {
    const last = text.charAt(current - 1)

    if (!TRAILING_PUNCTUATION.has(last)) {
      break
    }

    if (
      (last === ')' && closeParens <= openParens) ||
      (last === ']' && closeBrackets <= openBrackets) ||
      (last === '}' && closeBraces <= openBraces)
    ) {
      break
    }

    // 只有 ) ] } 會被剝掉（開括號不在剝除集，遇不到），遞減對應的計數
    switch (last) {
      case ')':
        closeParens -= 1
        break
      case ']':
        closeBrackets -= 1
        break
      case '}':
        closeBraces -= 1
        break
    }

    current -= 1
  }

  return current
}
