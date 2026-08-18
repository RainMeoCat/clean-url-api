# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概觀

依 [ClearURLs](https://github.com/ClearURLs/Rules) 規則集移除網址追蹤碼的 Cloudflare Worker。TypeScript ESM，執行期相依為零（`dependencies` 是空的），開發工具鏈需要 Node >= 22。

## 常用指令

```bash
npm run dev           # wrangler dev，本機 workerd
npm test              # vitest run
npm run test:coverage # 含 80% 門檻，CI 跑的是這個
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run fix           # prettier --write + eslint --fix
npm run verify:rules  # 驗證 data/ 規則檔的 sha256 與可編譯性
npm run build         # verify:rules + wrangler dry-run（不部署）
npm run deploy        # verify:rules + wrangler deploy
npm run vendor        # 重新抓取上游 ClearURLs 規則集
```

跑單一測試檔或單一案例：

```bash
npx vitest run tests/url.cleaner.test.ts -t "移除 utm_*"
```

CI（`.github/workflows/ci.yml`，每次 push）依序跑 `verify:rules` → `format:check` → `lint` → `typecheck` → `test:coverage` → `build`，任一失敗即紅燈。提交前請自己跑過同一串。

## 架構

### 規則以資料驅動，不寫死在程式碼

`data/rules.min.json` 是上游 ClearURLs 規則集的原始位元組副本，`data/rules.hash` 是它的 sha256。兩者一起進版控，且**必須同時更新**。

`data/rules.local.json` 是本地規則擴充，補上游沒收錄的網站或沒收錄的參數（目前是 threads 與 facebook；facebook 上游已有同名 provider，本地這筆是補參數而非取代，兩者都會套用）。它不驗 sha256（本來就是我們自己的檔），但一樣會進 bundle，所以 `verify:rules` 會驗它能不能編譯。編譯順序**排在上游之後**，這個順序在 `src/worker/index.ts` 與 `rules.loader.ts` 的 `loadAllRules()` 各寫了一次，改一邊就要改另一邊——否則測試看到的 provider 會與線上不同。上游哪天補上同名 provider，把本地那筆刪掉即可。

- **絕對不要手動編輯 `data/rules.min.json` 與 `data/rules.hash`**。整個 `data/` 都不讓 formatter 碰（已在 `.prettierignore` / eslint ignores 排除），因為任何重新格式化都會使 sha256 驗證失敗。
- 更新上游規則的唯一途徑是 `npm run vendor`（`scripts/vendor.sh`）：從 rules2/rules1 兩個來源擇一下載、驗 sha256、檢查結構（須含 `globalRules` provider），全部通過才寫檔。接著人工確認 `git diff --stat -- data/`、跑 `npm test`，再一起 commit。
- `data/rules.local.json` 相反，**只能手動編輯**——`vendor` 不會碰它，它也不驗 sha256。因為 formatter 被排除在外，縮排要自己對齊既有風格。改完跑 `npm run verify:rules` 確認仍可編譯，並在 `tests/rules.local.test.ts` 補上對應案例。

**驗證發生在 build 時，不是執行期**。Workers 沒有檔案系統，規則是 bundle 進去的，執行期再驗一次沒有意義（bundle 被竄改的話裡面的 hash 也一起被竄改）。`scripts/verify-rules.ts` 由 CI、`build` 與 `deploy` 呼叫，壞掉的規則會讓**部署失敗**而不是讓線上服務掛掉。

### 模組必須維持 Worker 可用

`src/worker/index.ts` 可達的所有模組**不得 import 任何 `node:` 內建模組**——Workers 沒有 `node:fs`，而 bundle 也刻意不開 `nodejs_compat`。

這條不變式由 `tests/worker.purity.test.ts` 守著：它靜態走訪 import graph，發現 `node:` 就失敗。該測試同時斷言 `rules.loader.ts`**確實**被驗出 `node:` 依賴，藉此證明偵測器沒有失效。

模組因此分成兩群：

```
Worker 可達      config.ts, types/, services/{url.cleaner, rules.compiler, clean.service,
                 shortlink.expander}, worker/
只在 build 時跑  config.node.ts, services/rules.loader.ts, scripts/verify-rules.ts
```

`shortlink.expander.ts` 用的是 Web 標準 `fetch` 與 `AbortSignal`，不是 `node:` 模組，因此仍在第一群。

第二群雖然用 `node:fs` / `node:crypto`，但只服務於 build 時的規則驗證，永遠不會被 bundle 進 Worker。要在第一群加東西時，先確認它不需要 Node API；需要磁碟路徑的設定放 `config.node.ts`，不要放回 `config.ts`。

### 組裝流程

```
data/rules.min.json + rules.local.json（bundle）→ compileRuleSet() → CompiledProvider[] ┐
                                                                                        ├→ createFetchHandler() → fetch
SHORT_LINK_PROVIDERS + fetch → createShortLinkExpander() → ShortLinkExpander ────────────┘
```

規則在模組載入時一次編譯成 `RegExp`（208 個 provider、1110 條 regex，實測約 2 ms），同一個 isolate 的所有請求共用。`createFetchHandler()` 接收 providers 與 expander 而非自己取得，測試才能塞自製規則集與假 fetch。新增依賴時沿用這個形式，不要在模組層級做額外 side effect。

### 清理演算法（`src/services/url.cleaner.ts`）

`cleanUrl()` 逐一走訪所有 provider，對 `urlPattern` 命中者依此順序處理：

```
exceptions → redirections → completeProvider → rawRules → rules
```

幾個不明顯但重要的設計，改動時別打破：

- **`redirections` 排在 `completeProvider` 之前**。廣告轉址網址本身雖屬追蹤網址，但使用者要的是它指向的乾淨目標。
- **不使用 `URL` / `URLSearchParams` 重建網址**。`splitUrl()` / `joinUrl()` 以字串切分，保留參數原始編碼；`URLSearchParams` 會把 `%20` 變成 `+`，那等於在「移除追蹤碼」之外擅自改動使用者的網址。有測試守著這件事。
- **`rules` 在編譯期被錨定成 `^(?:...)$`**（`rules.compiler.ts`），否則 `id` 這種規則會誤傷 `video_id`。
- **`referralMarketing` 與 `rules` 合併**一併移除，本 API 不保留聯盟參數。
- 轉址目標解出後會**遞迴呼叫 `cleanUrl()` 再清一次**，深度上限 `MAX_REDIRECTION_DEPTH`（5）。

### 短連結展開（`src/services/shortlink.expander.ts`）

ClearURLs 的 `redirections` 只能處理「目標已內嵌在網址裡」的轉址。`threads.com/share/<code>` 與 `facebook.com/share/<code>` 只有短碼，目標只有伺服器知道，所以這是**專案唯一會對外發請求的模組**。

`SHORT_LINK_PROVIDERS` 是一組 provider，每筆各自帶 `pattern` 與 `allowedHosts`。**白名單刻意不共用一份大的**：合併的話 threads 的短碼就能被轉去 facebook.com（反之亦然），而「短碼只能落在自己的網域」正是這道邊界要保證的事。新增網站是往這個陣列加一筆，不是放寬既有那筆的 regex。

安全邊界全集中在這個檔案，改動時別打破：

- **只有命中 `provider.pattern` 的網址才會被 fetch**。pattern 錨定且網域寫死，呼叫端無法藉此讓 Worker 去打任意位址——放寬成「看到網址就跟隨轉址」等於開一個 SSRF proxy。
- `redirect: 'manual'` 逐跳自驗，每一跳的目標都必須是 https 且落在 `allowedHosts`；跳數上限 `MAX_SHORTLINK_HOPS`（2，因為有些網域會先 301 到自己的正規網域、短碼原封不動：threads.net → threads.com、facebook.com → www.facebook.com）。
- **UA 不能省略也不能偽裝成瀏覽器**：不帶 UA 會被 Threads 導去 `facebook.com/unsupportedbrowser`，完整瀏覽器 UA 則拿到 200 + JS 跳轉頁（頁面裡讀不到目標）。一般的非瀏覽器 UA 才會拿到帶 `Location` 的 302。
- 用 `GET` 而非 `HEAD`：轉址回應 body 本來就 0 bytes，成本相同但相容性較好。
- **展開失敗一律回 `null` 而非拋錯**，呼叫端沿用原網址繼續清理。外部服務的狀態不該決定這個 API 的成敗。

一個請求最多展開一次（API 只接收一個網址），所以沒有展開數量的上限要管。目前也沒有做快取——Threads 回 `cache-control: private, no-cache`，要快取得自己用 Cache API，有量再說。

已知限制：`web.facebook.com` 的短連結不展開。它的第一跳會轉到 www 的**同一個短碼再加上 `?_rdc=1&_rdr`**，帶了 query 就不再命中樣式，逐跳迴圈會誤判成「已展開完成」而回傳一個仍是短連結的網址。要支援它就得讓樣式接受 query，那會同時放寬「夾帶查詢字串的假短連結不發請求」這條界線，不划算——FB App 產生的分享連結是 www／m／裸網域，都已涵蓋。

### 錯誤與回應約定

`src/services/clean.service.ts` 定義請求驗證——錯誤訊息與「什麼算不合法」都在這裡，`worker/handler.ts` 只負責轉成 `Response`。要改訊息或上限就改這個檔案。

**這個 API 只接收一個網址、回傳一個網址**，唯一的入口是 `GET ?url=`。批次（`POST { urls: [...] }`）已刻意移除：單一網址用查詢參數就夠，多一條入口就多一組驗證路徑與成本模型要維護。要重新加回批次前，先確認呼叫端真的無法自己發 N 個請求。

- 成功一律 200，只回清理後的字串（`{ url }`），不附比對細節。
- 錯誤一律 4xx，格式 `{ "error": "訊息" }`。
- `completeProvider` 命中回空字串，代表該網址沒有乾淨版本——這不是錯誤。
- 掛載路徑以外的子路徑回 404，非 GET 回 405（帶 `Allow: GET`）。

### 掛載路徑與節流

`wrangler.jsonc` 的 `routes[].pattern` 與 `vars.MOUNT_PATH` **必須一起改**。route 模式結尾的 `*` 會讓子路徑一併打進 Worker，`handler.ts` 用 `MOUNT_PATH` 把它收斂成單一端點（僅接受該路徑本身與尾斜線版本）。

`workers_dev` 刻意設為 `false`：WAF、Rate Limiting Rules、Cache Rules 都只作用在 zone 上，開著 `*.workers.dev` 等於留一個繞過所有防護的後門。

**速率限制不在程式碼裡**，由 Cloudflare WAF 的 Rate Limiting Rules 負責——它跑在 Worker 之前，被擋下的請求不計入 Worker 用量。不要為此在 handler 裡加計數邏輯（Worker isolate 是短命且分散的，記憶體計數沒有意義）。建議設定見 README。

### 設定

所有上限集中在 `src/config.ts`（`MAX_URL_LENGTH`、`MAX_REDIRECTION_DEPTH`、`SHORTLINK_TIMEOUT_MS`、`MAX_SHORTLINK_HOPS`、`SHORTLINK_USER_AGENT`）。`src/config.node.ts` 只有規則檔路徑（`RULES_PATH`、`RULES_HASH_PATH`，可用同名環境變數覆寫，測試以此指向 fixture）。

## 慣例

- **ESM + NodeNext**：相對 import 一律加 `.js` 副檔名（即使原始檔是 `.ts`），型別 import 用 `import type`（eslint `consistent-type-imports` 強制）。JSON import 需帶 `with { type: 'json' }`。
- **Prettier**：無分號、單引號、printWidth 120。程式碼註解、錯誤訊息、commit message、文件皆使用繁體中文。
- **註解只寫「為什麼」**，現有程式碼的註解都在解釋設計取捨而非複述程式碼，請延續這個密度與風格。
- 測試放 `tests/`，對應 `src/` 的模組命名。`worker.*.test.ts` 直接以 Web 標準 `Request` / `Response` 驅動 handler，不需要 workers 專用的測試 pool；所有測試都用版控中的真實規則集，不 mock。
- 覆蓋率門檻 80%（lines/functions/branches/statements），`src/worker/index.ts`（只做模組層級組裝）與 `src/types/` 已排除。
- 改完 handler 或路由行為後，除了單元測試也用 `npm run dev` 對真實 workerd 打一次——bundle 後的 JSON import 與模組層級初始化是單元測試涵蓋不到的路徑。

## 文件

README 只放使用者導向的內容，開發細節放在 GitHub wiki（規則集與更新機制、開發指引、實作細節）。改動涉及這些主題時，記得同步更新對應的 wiki 頁面。
