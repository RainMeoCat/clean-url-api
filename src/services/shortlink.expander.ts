/**
 * 短連結展開：把伺服器端才知道目標的短碼網址還原成真正的網址。
 *
 * 這是整個專案唯一會對外發出請求的模組——ClearURLs 的 redirections 規則只能處理
 * 「目標已內嵌在網址裡」的轉址，而 threads.com/share/<code>、facebook.com/share/<code>
 * 這類短碼不含任何目標資訊，純字串處理無解，只能問伺服器。
 *
 * 因此安全邊界全部集中在這裡：
 *   1. 只有命中 provider.pattern（錨定、網域寫死）的網址才會被 fetch，
 *      呼叫端無法藉此讓 Worker 去打任意位址——否則這就成了開放式 SSRF proxy。
 *   2. redirect: 'manual'，逐跳自行驗證，每一跳的目標都必須是 https 且落在白名單網域。
 *   3. 有逾時、有跳數上限、不轉發呼叫端的任何標頭。
 *
 * 展開失敗一律回 null 而非拋錯：外部服務的狀態不該決定這個 API 的成敗，
 * 呼叫端沿用原網址繼續做字串清理即可。
 */

import { MAX_SHORTLINK_HOPS, SHORTLINK_TIMEOUT_MS, SHORTLINK_USER_AGENT } from '../config.js'

export interface ShortLinkProvider {
  readonly name: string
  /** 決定「這個網址要不要發請求」，必須錨定 */
  readonly pattern: RegExp
  /** 每一跳的目標都必須落在其中，跳出白名單即視為展開失敗 */
  readonly allowedHosts: ReadonlySet<string>
}

const THREADS_HOSTS: ReadonlySet<string> = new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'])

const FACEBOOK_HOSTS: ReadonlySet<string> = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com'])

/**
 * 每個 provider 各自帶一份 allowedHosts，不共用一份大白名單——
 * 合併的話，threads 的短連結就能被轉去 facebook.com（反之亦然），
 * 而「這個短碼只能落在自己的網域」正是這道邊界要保證的事。
 */
export const SHORT_LINK_PROVIDERS: readonly ShortLinkProvider[] = [
  {
    name: 'threads',
    pattern: /^https:\/\/(?:www\.)?threads\.(?:com|net)\/share\/[A-Za-z0-9_-]+\/?$/i,
    allowedHosts: THREADS_HOSTS,
  },
  {
    // 路徑中間可能多一段單字母類型（/share/p/、/share/v/、/share/r/、/share/g/），
    // 實測同一個短碼在各類型下都能解出同一則貼文，該段只是分享來源的標記。
    //
    // web.facebook.com 刻意不收：它的第一跳會轉到 www 的**同一個短碼加上 ?_rdc=1&_rdr**，
    // 帶了 query 就不再命中本樣式，逐跳迴圈會誤判成「已展開完成」而回傳一個仍是短連結的網址。
    // 裸網域 facebook.com 則沒這個問題（301 到 www 的同一個短碼，乾淨無 query），故收。
    name: 'facebook',
    pattern: /^https:\/\/(?:www\.|m\.)?facebook\.com\/share\/(?:[a-z]\/)?[A-Za-z0-9_-]+\/?$/i,
    allowedHosts: FACEBOOK_HOSTS,
  },
]

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * 驗證轉址目標並解析成絕對網址。
 *
 * 絕對網址原樣回傳、不經 URL 重建——與 url.cleaner 同樣的理由：
 * URL 正規化會改動使用者網址的原始樣貌，而這裡只需要驗證，不需要改寫。
 */
function resolveTarget(location: string, current: string, provider: ShortLinkProvider): string | null {
  let target: URL

  try {
    target = new URL(location, current)
  } catch {
    return null
  }

  if (target.protocol !== 'https:' || !provider.allowedHosts.has(target.hostname)) {
    return null
  }

  return HAS_SCHEME.test(location) ? location : target.href
}

export interface ShortLinkExpander {
  /**
   * 展開後的網址；不是短連結或展開失敗時為 null。
   *
   * 「是不是短連結」刻意不另外開一個 matches()：呼叫端一律無條件呼叫 expand()，
   * 由這裡的 provider 判斷決定要不要發請求。少一個公開判斷式，就少一個
   * 「先問過再展開」與「直接展開」判斷不一致的機會。
   */
  expand(url: string): Promise<string | null>
}

/**
 * 建立展開器。fetch 由外部注入，測試才不必打真實網路——
 * 與 createFetchHandler 接收 providers 是同一個形式。
 */
export function createShortLinkExpander(
  providers: readonly ShortLinkProvider[],
  fetchImpl: typeof fetch
): ShortLinkExpander {
  const providerFor = (url: string): ShortLinkProvider | undefined =>
    providers.find((candidate) => candidate.pattern.test(url))

  const expand = async (url: string): Promise<string | null> => {
    const provider = providerFor(url)

    if (provider === undefined) {
      return null
    }

    let current = url

    for (let hop = 0; hop < MAX_SHORTLINK_HOPS; hop += 1) {
      let response: Response

      try {
        // 用 GET 而非 HEAD：轉址回應的 body 本來就是 0 bytes，成本相同，
        // 但部分服務對 HEAD 回 405。redirect: 'manual' 確保不會自動跟到白名單外。
        response = await fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': SHORTLINK_USER_AGENT },
          signal: AbortSignal.timeout(SHORTLINK_TIMEOUT_MS),
        })
      } catch {
        // 逾時或網路錯誤：外部服務的問題不該讓請求失敗
        return null
      }

      if (!REDIRECT_STATUSES.has(response.status)) {
        // 短碼不存在時 Threads 回 200 而非轉址，這條路徑就是「查無此短連結」
        return null
      }

      const location = response.headers.get('location')

      if (location === null) {
        return null
      }

      const target = resolveTarget(location, current, provider)

      if (target === null) {
        return null
      }

      // 目標不再是短連結就代表展開完成；仍是短連結則繼續跟（threads.net → threads.com）
      if (!provider.pattern.test(target)) {
        return target
      }

      current = target
    }

    return null
  }

  return { expand }
}
