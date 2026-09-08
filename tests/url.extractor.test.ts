import { describe, expect, it } from 'vitest'
import { extractUrls } from '../src/services/url.extractor.js'

/** 只取清理用的網址字串，測試讀起來較接近 spec 的行為表 */
function urls(text: string): string[] {
  return extractUrls(text).map((m) => m.url)
}

/**
 * spec「方案 A：網址邊界偵測」的預期行為表，每一列一個案例。
 * 邊界偵測的職責只有「網址從哪裡開始、到哪裡結束」；
 * token 是否為合法網址、要不要套規則，由 text.cleaner 與 cleanUrl 負責。
 */
describe('extractUrls — 邊界終止', () => {
  it('換行終止：文字與網址各占一行', () => {
    expect(urls('文字\nhttps://www.threads.com/share/ABC123')).toEqual(['https://www.threads.com/share/ABC123'])
  })

  it('空白終止：後面接著一般文字', () => {
    expect(urls('看這個 https://example.com/p?id=5 很有趣')).toEqual(['https://example.com/p?id=5'])
  })

  it('全形標點終止：句號之後的文字不會被誤收', () => {
    expect(urls('詳見 https://example.com/p。然後…')).toEqual(['https://example.com/p'])
  })

  it('全形括號終止：整個網址包在全形括號中', () => {
    expect(urls('（https://example.com/p）')).toEqual(['https://example.com/p'])
  })

  it('CJK 文字本身不終止：維基百科中文路徑保得住', () => {
    expect(urls('https://zh.wikipedia.org/wiki/臺灣')).toEqual(['https://zh.wikipedia.org/wiki/臺灣'])
  })

  it('全形空白也終止', () => {
    expect(urls('看這個　https://example.com/p　很有趣')).toEqual(['https://example.com/p'])
  })

  it('ASCII 引號、角括號與反引號都終止', () => {
    expect(urls('<https://example.com/a>')).toEqual(['https://example.com/a'])
    expect(urls('"https://example.com/b"')).toEqual(['https://example.com/b'])
    expect(urls("'https://example.com/c'")).toEqual(['https://example.com/c'])
    expect(urls('`https://example.com/d`')).toEqual(['https://example.com/d'])
  })

  it('scheme 不分大小寫，且抽出的網址保留原始大小寫', () => {
    expect(urls('HTTP://Example.COM/P')).toEqual(['HTTP://Example.COM/P'])
  })

  it('http 與 https 都認', () => {
    expect(urls('http://example.com/p')).toEqual(['http://example.com/p'])
  })
})

describe('extractUrls — scheme 後無主體', () => {
  // 「https:// 後面緊接終止字元或字串結尾」不算網址：
  // 連 scheme 都還沒有主機，拿去 cleanUrl 只會換來一個降級，不如一開始就不抽
  it('https:// 後緊接終止字元或字串結尾時不產生 token', () => {
    expect(urls('https://')).toEqual([])
    expect(urls('https://。')).toEqual([])
    expect(urls('https://,')).toEqual([])
  })

  it('scheme 後接著任何非終止字元就抽出，合法性交給下游', () => {
    expect(urls('https://http://')).toEqual(['https://http://'])
  })
})

describe('extractUrls — 尾端標點剝除', () => {
  it('剝除尾端句點', () => {
    expect(urls('詳見 https://example.com/p.')).toEqual(['https://example.com/p'])
  })

  it('括號配對時不剝尾端右括號', () => {
    expect(urls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  })

  it('markdown 連結的右括號不配對，剝除', () => {
    // token 從 https:// 起，[文字]( 的 ( 不在 token 內，右括號因此多於左括號
    expect(urls('[文字](https://example.com/p)')).toEqual(['https://example.com/p'])
  })

  it('混合標點一路剝到穩定：配對括號之前的尾端符號全剝', () => {
    expect(urls('參考 https://example.com/p),')).toEqual(['https://example.com/p'])
  })

  it('剝除不會越過配對的右括號', () => {
    // ) 數量不多於 ( → 不剝，尾端迭代在此停止
    expect(urls('https://example.com/p?a=(b),')).toEqual(['https://example.com/p?a=(b)'])
  })

  it('方括號與花括號同樣依配對決定剝除', () => {
    // token 從 https:// 起，query 裡的方括號配對 → 不剝
    expect(urls('[註](https://example.com/p?a=[b]')).toEqual(['https://example.com/p?a=[b]'])
    // 尾端 ] 與 } 的數量多於對應開括號 → 剝；花括號配對 → 不剝，但逗號照剝
    expect(urls('https://example.com/p?a=x]]')).toEqual(['https://example.com/p?a=x'])
    expect(urls('https://example.com/p?a={b},')).toEqual(['https://example.com/p?a={b}'])
    expect(urls('https://example.com/p?a=x}}')).toEqual(['https://example.com/p?a=x'])
  })
})

describe('extractUrls — 定位與範圍', () => {
  // 下一次搜尋從上一個網址的 end 繼續：巢狀轉址目標若被抽出成兩個 token，
  // 內層目標會繞過外層轉址規則的遞迴清理，所以必須是一個 token、交給 cleanUrl 插手
  it('巢狀轉址網址是一個 token，內層 http:// 不重抽', () => {
    expect(urls('https://a.com/r?u=http://b.com')).toEqual(['https://a.com/r?u=http://b.com'])
  })

  it('多個網址各自抽出，offset 能原樣重建每個 token', () => {
    const text = '先看 https://a.com/p 再看 https://b.com/p?q=1。'
    const matches = extractUrls(text)

    expect(matches.map((m) => m.url)).toEqual(['https://a.com/p', 'https://b.com/p?q=1'])
    for (const match of matches) {
      expect(text.slice(match.start, match.end)).toBe(match.url)
    }
  })

  it('完全沒有網址時回空陣列', () => {
    expect(extractUrls('這裡沒有網址，只有文字。')).toEqual([])
  })
})

describe('extractUrls — 已知限制', () => {
  /**
   * 這一列描述的是**限制**而非期望：網址與 CJK 文字之間完全沒有空白或標點分隔時，
   * 任何不引入斷詞的方案都無解（見 spec 已知限制）。若這個測試開始失敗，
   * 先確認那真的是設計決策的改變，不要順手把它當 bug 修掉。
   */
  it('網址直接接著 CJK 文字時誤收尾端文字', () => {
    expect(urls('看這個https://example.com/p很有趣')).toEqual(['https://example.com/p很有趣'])
  })
})
