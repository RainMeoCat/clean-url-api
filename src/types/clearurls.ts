/**
 * ClearURLs 規則集的型別定義。
 * 對應上游 https://github.com/ClearURLs/Rules 發佈的 data.minify.json。
 */

/** 單一 provider 的原始定義（欄位除 urlPattern 外皆為選填） */
export interface Provider {
  /** 判斷此 provider 是否適用於該網址的 regex */
  urlPattern: string
  /** 整個網址本身即為追蹤／廣告網址，無乾淨版本 */
  completeProvider?: boolean
  /** 供瀏覽器擴充套件強制跳轉用；本 API 只回傳字串，不使用此欄位 */
  forceRedirection?: boolean
  /** 要移除的查詢參數名稱 regex */
  rules?: string[]
  /** 直接套用於整個網址字串的移除 regex */
  rawRules?: string[]
  /** 聯盟行銷參數名稱 regex */
  referralMarketing?: string[]
  /** 命中即略過此 provider 的網址 regex */
  exceptions?: string[]
  /** 從轉址網址中取出真實目標的 regex，目標須置於第 1 個捕獲群組 */
  redirections?: string[]
}

/** data.minify.json 的頂層結構 */
export interface RuleSet {
  providers: Record<string, Provider>
}

/** 啟動時預先編譯好的 provider，避免每次請求重新建構 RegExp */
export interface CompiledProvider {
  name: string
  urlPattern: RegExp
  completeProvider: boolean
  /** 已錨定為完整比對參數名稱的 regex */
  rules: RegExp[]
  rawRules: RegExp[]
  exceptions: RegExp[]
  redirections: RegExp[]
}
