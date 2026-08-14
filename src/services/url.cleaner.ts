import { MAX_REDIRECTION_DEPTH } from '../config.js'
import type { CompiledProvider } from '../types/clearurls.js'

export class InvalidUrlError extends Error {
  constructor(message = '不是合法的 http/https 網址') {
    super(message)
    this.name = 'InvalidUrlError'
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

interface UrlParts {
  base: string
  query: string
  fragment: string
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url : null
  } catch {
    return null
  }
}

/**
 * 以字串切分網址，而非透過 URL / URLSearchParams 重建。
 * URLSearchParams 會重新編碼參數（例如把 %20 變成 +），那等於在「移除追蹤碼」之外
 * 擅自改動了使用者的網址。
 */
function splitUrl(url: string): UrlParts {
  const hashIndex = url.indexOf('#')
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const fragment = hashIndex === -1 ? '' : url.slice(hashIndex + 1)

  const queryIndex = beforeHash.indexOf('?')
  const base = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1)

  return { base, query, fragment }
}

function joinUrl({ base, query, fragment }: UrlParts): string {
  return `${base}${query === '' ? '' : `?${query}`}${fragment === '' ? '' : `#${fragment}`}`
}

/** 移除名稱命中規則的參數，其餘 key=value 連同原始編碼原封不動保留 */
function removeMatchingParams(segment: string, matchers: RegExp[]): string {
  if (segment === '') {
    return ''
  }

  return segment
    .split('&')
    .filter((pair) => {
      if (pair === '') {
        return false
      }
      const name = pair.split('=', 1)[0] ?? ''
      return !matchers.some((matcher) => matcher.test(name))
    })
    .join('&')
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // 轉址目標可能含有不合法的百分比編碼，此時沿用原始字串
    return value
  }
}

/** 將轉址目標正規化為可解析的 http(s) 網址；無法解析則回傳 null */
function normalizeRedirectTarget(rawTarget: string): string | null {
  const decoded = decodeSafely(rawTarget)
  // 部分規則（如 google amp）擷取到的目標不含 scheme
  const candidate = HAS_SCHEME.test(decoded) ? decoded : `https://${decoded}`
  return parseHttpUrl(candidate) === null ? null : candidate
}

function followRedirection(
  provider: CompiledProvider,
  url: string,
  providers: CompiledProvider[],
  depth: number
): string | null {
  for (const redirection of provider.redirections) {
    const target = redirection.exec(url)?.[1]
    if (target === undefined) {
      continue
    }

    const resolved = normalizeRedirectTarget(target)
    if (resolved === null) {
      continue
    }

    // 到達上限就直接回傳目標，不再往下展開
    return depth >= MAX_REDIRECTION_DEPTH ? resolved : cleanUrl(resolved, providers, depth + 1)
  }

  return null
}

/**
 * 依 ClearURLs 規則集移除網址中的追蹤參數。
 *
 * provider 的處理順序為：exceptions → redirections → completeProvider → rawRules → rules。
 * redirections 刻意排在 completeProvider 之前：廣告轉址網址本身雖屬追蹤網址，
 * 但使用者真正要的是它指向的乾淨目標。
 *
 * @throws {InvalidUrlError} 輸入不是合法的 http/https 網址
 * @returns 清理後的網址；若整個網址本身即追蹤網址（completeProvider）則為空字串
 */
export function cleanUrl(input: string, providers: CompiledProvider[], depth = 0): string {
  const trimmed = input.trim()

  if (parseHttpUrl(trimmed) === null) {
    throw new InvalidUrlError(`不是合法的 http/https 網址：${JSON.stringify(input.slice(0, 100))}`)
  }

  let current = trimmed

  for (const provider of providers) {
    if (!provider.urlPattern.test(current)) {
      continue
    }

    if (provider.exceptions.some((exception) => exception.test(current))) {
      continue
    }

    const redirected = followRedirection(provider, current, providers, depth)
    if (redirected !== null) {
      return redirected
    }

    if (provider.completeProvider) {
      return ''
    }

    for (const rawRule of provider.rawRules) {
      current = current.replace(rawRule, '')
    }

    if (provider.rules.length > 0) {
      const { base, query, fragment } = splitUrl(current)
      current = joinUrl({
        base,
        query: removeMatchingParams(query, provider.rules),
        fragment: removeMatchingParams(fragment, provider.rules),
      })
    }
  }

  return current
}
