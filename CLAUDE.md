# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概觀

依 [ClearURLs](https://github.com/ClearURLs/Rules) 規則集移除網址追蹤碼的 API。TypeScript ESM，Node >= 22。

**有兩個部署目標，共用同一份核心邏輯**：Express 5 伺服器（`src/index.ts`）與 Cloudflare Worker（`src/worker/index.ts`）。改動清理邏輯或請求驗證時，兩邊都會受影響。

## 常用指令

```bash
npm run dev           # tsx watch，Express 版開發用
npm run worker:dev    # wrangler dev，Worker 版開發用（本機 workerd）
npm test              # vitest run
npm run test:coverage # 含 80% 門檻，CI 跑的是這個
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run fix           # prettier --write + eslint --fix
npm run verify:rules  # 驗證 data/ 規則檔的 sha256 與可編譯性
npm run build         # Express 版：verify:rules + tsc
npm run worker:build  # Worker 版：verify:rules + wrangler dry-run
npm run worker:deploy # 部署到 Cloudflare
npm run vendor        # 重新抓取上游 ClearURLs 規則集
```

跑單一測試檔或單一案例：

```bash
npx vitest run tests/url.cleaner.test.ts -t "移除 utm_*"
```

CI（`.github/workflows/ci.yml`，每次 push）依序跑 `verify:rules` → `format:check` → `lint` → `typecheck` → `test:coverage` → wrangler dry-run，任一失敗即紅燈。提交前請自己跑過同一串。

## 架構

### 規則以資料驅動，不寫死在程式碼

`data/rules.min.json` 是上游 ClearURLs 規則集的原始位元組副本，`data/rules.hash` 是它的 sha256。兩者一起進版控，且**必須同時更新**。

- **絕對不要手動編輯 `data/` 底下任何檔案**，也不要讓 formatter 碰它（已在 `.prettierignore` / eslint ignores 排除）。任何重新格式化都會使 sha256 驗證失敗。
- 更新規則的唯一途徑是 `npm run vendor`（`scripts/vendor.sh`）：從 rules2/rules1 兩個來源擇一下載、驗 sha256、檢查結構（須含 `globalRules` provider），全部通過才寫檔。接著人工確認 `git diff --stat -- data/`、跑 `npm test`，再一起 commit。

**兩種部署的驗證時機不同**：

|         | 驗證時機                           | 失敗後果                   |
| ------- | ---------------------------------- | -------------------------- |
| Express | 啟動時 `loadRules()` 讀檔比對      | 程序 `process.exit(1)`     |
| Worker  | build 時 `scripts/verify-rules.ts` | 部署失敗，線上服務不受影響 |

Worker 沒有檔案系統，規則是 bundle 進去的，執行期再驗一次沒有意義（bundle 被竄改的話裡面的 hash 也一起被竄改）。驗證因此前移到 build 時。兩者共用同一套 `loadRules()` 邏輯，`verify-rules.ts` 只是它的 CLI 包裝。

### 模組必須維持 Worker 可用

`src/worker/index.ts` 可達的所有模組**不得 import 任何 `node:` 內建模組**——Workers 沒有 `node:fs`，而目前的 bundle 也刻意不開 `nodejs_compat`。

這條不變式由 `tests/worker.purity.test.ts` 守著：它靜態走訪 import graph，發現 `node:` 就失敗。該測試同時斷言 Express 進入點**確實**被驗出 `node:` 依賴，藉此證明偵測器沒有失效。

因此模組分成三層：

```
純邏輯（兩邊共用）    config.ts, types/, services/{url.cleaner, rules.compiler, clean.service}
Node 專屬            config.node.ts, services/rules.loader.ts, app.ts, routes/, controllers/, middlewares/
Worker 專屬          worker/handler.ts, worker/index.ts
```

要在純邏輯層加東西時，先確認它不需要 Node API。需要磁碟路徑或 `process.env` 的設定放 `config.node.ts`，不要放回 `config.ts`。

### 依賴注入的組裝流程

```
Express:  loadRules()                    → CompiledProvider[] → createApp()           → router → controller
Worker:   compileRuleSet(bundled JSON)   → CompiledProvider[] → createFetchHandler()
```

規則在啟動／模組載入時一次編譯成 `RegExp`（206 個 provider、1095 條 regex，實測約 2 ms），之後每個請求都重用。兩個進入點都接收 providers 而非自己讀磁碟，測試才能直接組裝或塞自製規則集。新增依賴時沿用這個形式，不要在模組層級做 side effect。

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

### 錯誤與回應約定（兩邊一致）

`src/services/clean.service.ts` 是兩個 transport 共用的驗證與批次語意——錯誤訊息與「什麼算不合法」都定義在這裡，各 transport 只負責把結果轉成自己的回應形式。要改訊息或上限就改這個檔案，不要在 controller 或 handler 裡各自寫。

- 成功一律 200，只回清理後的字串（`{ url }` / `{ urls }`），不附比對細節。
- 錯誤一律 4xx，格式 `{ "error": "訊息" }`。
- `completeProvider` 命中回空字串，代表該網址沒有乾淨版本——這不是錯誤。
- 批次中的無效項目回空字串，不讓整批失敗。
- 單筆 GET 的 `InvalidUrlError`：Express 讓它冒泡給 `errorHandler` 轉 400；Worker 沒有 middleware，在 `handler.ts` 就地轉換。

### Worker 掛載路徑

`wrangler.jsonc` 的 `routes[].pattern` 與 `vars.MOUNT_PATH` **必須一起改**。route 模式結尾的 `*` 會讓子路徑一併打進 Worker，`handler.ts` 用 `MOUNT_PATH` 把它收斂成單一端點（僅接受該路徑本身與尾斜線版本，其餘回 404）。

`workers_dev` 刻意設為 `false`：WAF、Rate Limiting Rules、Cache Rules 都只作用在 zone 上，開著 `*.workers.dev` 等於留一個繞過所有防護的後門。

### 設定

所有上限與可調參數集中在 `src/config.ts`（`MAX_URL_LENGTH`、`MAX_BATCH_SIZE`、`MAX_REDIRECTION_DEPTH`、rate limit）。Node 專屬的環境變數在 `src/config.node.ts`：`PORT`、`RULES_PATH`、`RULES_HASH_PATH`。`config.node.ts` 用 `import.meta.dirname` 解析 `../data/`，這依賴 `src/config.node.ts` 與編譯後 `dist/config.node.js` 相對根目錄層級相同——移動檔案時要留意。

## 慣例

- **ESM + NodeNext**：相對 import 一律加 `.js` 副檔名（即使原始檔是 `.ts`），型別 import 用 `import type`（eslint `consistent-type-imports` 強制）。JSON import 需帶 `with { type: 'json' }`。
- **Prettier**：無分號、單引號、printWidth 120。程式碼註解、錯誤訊息、commit message、文件皆使用繁體中文。
- **註解只寫「為什麼」**，現有程式碼的註解都在解釋設計取捨而非複述程式碼，請延續這個密度與風格。
- 測試放 `tests/`，對應 `src/` 的模組命名。`clean.route.test.ts`（supertest）與 `worker.*.test.ts` 是端對端層級，其他為單元測試；兩者都直接用版控中的真實規則集，不 mock。
- 覆蓋率門檻 80%（lines/functions/branches/statements），兩個進入點（`src/index.ts`、`src/worker/index.ts`）與 `src/types/` 已排除。

## 文件

README 只放使用者導向的內容，開發細節放在 GitHub wiki（規則集與更新機制、開發指引、實作細節）。改動涉及這些主題時，記得同步更新對應的 wiki 頁面。
