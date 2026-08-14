#!/usr/bin/env bash
#
# 下載 ClearURLs 官方規則集並以 sha256 驗證後寫入 data/。
#
# 更新時機由人決定：想更新規則時手動執行，看過 diff、跑過測試再 commit。
#
#     npm run vendor          # 或直接 ./scripts/vendor.sh
#
# 驗證失敗一律非零退出且不寫入任何檔案——寧可沿用舊規則，
# 也不要載入來源不明的 regex。
#
# 只用 curl 與系統內建工具（node 僅用於結構檢查），不需要先 npm install。

set -euo pipefail

# 兩個來源的內容與 hash 相同，互為備援。格式為「顯示名稱|origin」。
SOURCES=(
  'rules2 (GitHub Pages)|https://rules2.clearurls.xyz'
  'rules1 (GitLab Pages)|https://rules1.clearurls.xyz'
)

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT_DIR
readonly DATA_DIR="$ROOT_DIR/data"
readonly RULES_FILE="$DATA_DIR/rules.min.json"
readonly HASH_FILE="$DATA_DIR/rules.hash"
readonly TIMEOUT_SECONDS=30

# EXIT trap 在 main 回傳後才觸發，屆時函式內的 local 變數已不存在，
# 因此暫存目錄必須是腳本層級變數；先給空值以免 trap 早於賦值時撞上 set -u。
TMP_DIR=''

# macOS 是 shasum、Linux 是 sha256sum，兩者擇一。
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

fetch() {
  curl --fail --silent --show-error --location \
    --max-time "$TIMEOUT_SECONDS" --output "$2" -- "$1"
}

# 檢查規則集結構是否符合預期，避免把一份合法 JSON 但內容不對的檔案寫進版控。
# 成功時印出 provider 數量，失敗時把原因印到 stderr 並非零退出。
provider_count_of() {
  node -e '
    const { readFileSync } = require("node:fs")
    try {
      const parsed = JSON.parse(readFileSync(process.argv[1], "utf8"))
      const providers = parsed === null ? undefined : parsed.providers
      if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
        throw new Error("規則集的 providers 不是物件")
      }
      const names = Object.keys(providers)
      if (names.length === 0) throw new Error("providers 是空的")
      if (!names.includes("globalRules")) throw new Error("規則集缺少 globalRules provider")
      console.log(names.length)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  ' "$1"
}

# 從 origin 取得規則集與 hash，全部驗證通過才寫入 data/。
try_source() {
  local name="$1" origin="$2" tmp_dir="$3"
  local expected actual provider_count previous

  printf '→ 從 %s 下載規則集…\n' "$name"

  if ! fetch "$origin/data.minify.json" "$tmp_dir/rules.min.json" ||
    ! fetch "$origin/rules.minify.hash" "$tmp_dir/rules.hash"; then
    printf '✗ %s：下載失敗\n' "$name" >&2
    return 1
  fi

  # hash 檔可能是「<hash>  <檔名>」格式，只取第一個欄位
  expected="$(awk 'NR == 1 { print tolower($1) }' "$tmp_dir/rules.hash")"
  if ! [[ "$expected" =~ ^[0-9a-f]{64}$ ]]; then
    printf '✗ %s：hash 檔內容不是合法的 sha256：%.80s\n' "$name" "$expected" >&2
    return 1
  fi

  actual="$(sha256_of "$tmp_dir/rules.min.json")"
  if [ "$actual" != "$expected" ]; then
    printf '✗ %s：sha256 不符\n    期望：%s\n    實際：%s\n' "$name" "$expected" "$actual" >&2
    return 1
  fi

  if ! provider_count="$(provider_count_of "$tmp_dir/rules.min.json")"; then
    printf '✗ %s：規則集結構檢查未通過\n' "$name" >&2
    return 1
  fi

  previous=''
  if [ -f "$HASH_FILE" ]; then
    previous="$(awk 'NR == 1 { print tolower($1) }' "$HASH_FILE")"
  fi

  # 寫入原始位元組，確保檔案 sha256 與 data/rules.hash 永遠一致
  mkdir -p "$DATA_DIR"
  mv "$tmp_dir/rules.min.json" "$RULES_FILE"
  printf '%s\n' "$expected" >"$HASH_FILE"

  printf '✓ 已寫入 %s\n' "${RULES_FILE#"$ROOT_DIR"/}"
  printf '  provider 數量：%s\n' "$provider_count"
  printf '  sha256：%s\n' "$expected"

  if [ "$expected" = "$previous" ]; then
    printf '\n規則集已是最新版本，內容沒有變動。\n'
  else
    printf '\n規則集有更新，接著請確認變更並跑測試：\n'
    printf '  git diff --stat -- data/\n'
    printf '  npm test\n'
  fi
}

main() {
  local source name origin

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  for source in "${SOURCES[@]}"; do
    name="${source%%|*}"
    origin="${source##*|}"

    if try_source "$name" "$origin" "$TMP_DIR"; then
      return 0
    fi
  done

  printf '\n所有來源皆失敗，未寫入任何檔案。\n' >&2
  return 1
}

main "$@"
