# clean-url-api

依 [ClearURLs](https://github.com/ClearURLs/Rules) 規則集移除網址追蹤碼的 Cloudflare Worker。

丟一個網址進來，回傳乾淨的網址：拿掉追蹤參數、聯盟行銷碼與站台專屬的追蹤片段；若是廣告轉址網址，直接解出它真正指向的目標。

## 能做什麼

規則集共 206 個 provider，涵蓋六類能力（「覆蓋」欄為實際套用該能力的 provider 數，已扣除規則集自帶的 7 個測試用 provider）：

| 能力                          | 覆蓋 | 作用                                               |
| ----------------------------- | ---- | -------------------------------------------------- |
| `rules` — 查詢參數移除        | 142  | 移除 `utm_*`、`fbclid`、`gclid`、`ref` 等追蹤參數  |
| `redirections` — 轉址解析     | 56   | 從轉址網址中解出真正的目標，並遞迴清理該目標       |
| `rawRules` — 網址片段移除     | 4    | 移除**路徑或 fragment** 中的追蹤片段，不限查詢字串 |
| `referralMarketing` — 聯盟碼  | 7    | 移除聯盟行銷參數                                   |
| `completeProvider` — 整體封鎖 | 8    | 整個網址本身即廣告／追蹤器，回傳空字串             |
| `exceptions` — 例外豁免       | 15   | 命中即略過該 provider，避免把功能性網址清壞        |

實際效果：

```
追蹤參數    https://example.com/p?id=5&utm_source=newsletter&fbclid=abc
         →  https://example.com/p?id=5

Google      https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fpage%3Futm_source%3Dserp&sa=U
轉址      →  https://example.org/page

Amazon      https://www.amazon.com/dp/B0123/ref=sr_1_1?qid=999&tag=aff-20
         →  https://www.amazon.com/dp/B0123

廣告網址    https://pagead2.googlesyndication.com/pagead/ads?client=ca-pub-1
         →  ""（整個網址即追蹤器，沒有乾淨版本）
```

轉址解析涵蓋 Google、Facebook、YouTube、Instagram、Messenger、Reddit、eBay、Steam、Tumblr、VK、DuckDuckGo、Pocket、Adjust 等平台，以及 AWIN、Admitad、Tradedoubler、Skimlinks、VigLink、digidip、href.li 等聯盟／短連結服務。解出的目標**會再被完整清理一次**，巢狀轉址最多解 5 層。

規則由 `data/rules.min.json` 驅動，未寫死在程式碼中；要更新時執行 `npm run vendor` 重新抓取官方規則，確認 diff 與測試後 commit 即生效。詳見 [規則集與更新機制](https://github.com/RainMeoCat/clean-url-api/wiki/Rules-and-Updates)。

## API 使用方式

同一個端點以 method 區分單筆與批次。線上位址是 `https://rainmeocat.com/api/clean-url`；以下範例以本機 `wrangler dev`（`http://localhost:8787/api/clean-url`）為主，換成線上網域即可。

### `GET`

| 參數  | 說明                        |
| ----- | --------------------------- |
| `url` | 要清理的網址（需 URL 編碼） |

```bash
curl -s 'http://localhost:8787/api/clean-url?url=https%3A%2F%2Fexample.com%2Fp%3Fid%3D5%26utm_source%3Dnewsletter%26fbclid%3Dabc'
```

```json
{ "url": "https://example.com/p?id=5" }
```

### `POST`

一次處理多個網址，回傳順序與輸入一致。

```bash
curl -s -X POST http://localhost:8787/api/clean-url \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://www.amazon.com/dp/B0123/ref=sr_1_1?qid=999&tag=aff-20","https://www.google.com/url?q=https%3A%2F%2Fexample.org%2F%3Futm_medium%3Dcpc"]}'
```

```json
{ "urls": ["https://www.amazon.com/dp/B0123", "https://example.org/"] }
```

### 回應約定

- 成功一律 `200`，只回傳清理後的字串，不附帶比對細節。
- 錯誤一律 `4xx`，格式為 `{ "error": "訊息" }`。
- 批次中的無效項目回傳空字串，不會讓整批失敗。
- 整個網址本身即追蹤／廣告網址時回傳空字串，代表它沒有乾淨版本。
- 掛載路徑以外的子路徑回 `404`，`GET`／`POST` 以外的 method 回 `405`。

### 限制

| 項目             | 上限      |
| ---------------- | --------- |
| 單一網址長度     | 8192 字元 |
| 單次批次數量     | 100 筆    |
| 巢狀轉址展開層數 | 5 層      |

速率限制不在程式碼裡，由 Cloudflare WAF 負責——見下方「建議的節流設定」。

## 在本機跑起來

```bash
npm install
npm run dev
```

`wrangler dev` 會在本機的 workerd 跑起真正的 Worker runtime，行為與線上一致。

## 部署到 Cloudflare Workers

規則集會被 bundle 進 Worker（總計約 47 KB / gzip 11 KB）。Worker 可達的所有模組都不 import `node:` 內建模組——`node:fs`／`node:crypto` 只出現在 build 時的規則驗證，不會被 bundle 進去——因此不需要 `nodejs_compat`，執行期相依為零。

1. `wrangler.jsonc` 目前掛在 `rainmeocat.com/api/clean-url`（apex 與 `www` 各一筆 route——兩者是獨立主機，route 不會互相涵蓋）。換網域時改 `routes[].pattern` 與 `zone_name`；換掛載路徑時，`vars.MOUNT_PATH` 必須跟著改成相同路徑。
2. 確認該網域在 Cloudflare 上，且對應的 DNS 記錄是**代理狀態（橘雲）**——灰雲不會觸發 Worker 路由。若該網域沒有 origin 主機，建一筆代理狀態的 `AAAA` 指向 `100::` 即可。
3. 部署：

```bash
npm run deploy
```

`deploy` 會先跑 `verify:rules`；規則檔的 sha256 對不上就中止，不會把來源不明的 regex 部署上線。

### 從 GitHub Actions 部署

部署是**手動閘門**：推上 `main` 只會跑檢查，不會上線。要部署請到 repo 的 Actions → CI → **Run workflow**，分支選 `main`。`deploy` job 跑的是 `npm run deploy`——與本機同一條路徑、同一個 lockfile 鎖住的 wrangler 版本。

`Run workflow` 按鈕只在**預設分支上的 workflow 檔含有 `workflow_dispatch`** 時才出現；這個設定尚未進到 `main` 之前，Actions 頁面上看不到它。

從其他分支按 Run workflow 時，`deploy` job 會被跳過（顯示 skipped）——避免誤把功能分支推上線。

需要在 repo 的 Settings → Secrets and variables → Actions 建一個 `CLOUDFLARE_API_TOKEN`。Token 用 Cloudflare 的 **Edit Cloudflare Workers** 範本即可，但 zone 資源必須涵蓋本專案的網域——route 用了 `zone_name`，wrangler 得先讀到 zone 才能綁定：

| 範圍                      | 權限 |
| ------------------------- | ---- |
| Account → Workers Scripts | Edit |
| Zone → Workers Routes     | Edit |
| Zone → Zone               | Read |

若該 token 能存取多個 Cloudflare 帳號，還要一併設 `CLOUDFLARE_ACCOUNT_ID`，否則 wrangler 無從判斷要部署到哪個帳號。

### 建議的節流設定

Worker 本身不做速率限制——WAF 的 Rate Limiting Rules 跑在 Worker **之前**，被擋下的請求不計入 Worker 用量，成本與防護都更好。建議在 Cloudflare dashboard（Security → WAF → Rate limiting rules）設定：

| 條件                                                   | 上限         | 動作  |
| ------------------------------------------------------ | ------------ | ----- |
| `starts_with(http.request.uri.path, "/api/clean-url")` | 120 次／分鐘 | Block |
| 同上且 `http.request.method eq "POST"`                 | 20 次／分鐘  | Block |

POST 單次可帶 100 個網址，成本是 GET 的 100 倍，因此配額要獨立且更嚴。動作請選 **Block**，不要用 Managed Challenge——API 用戶端不會解 challenge。

`wrangler.jsonc` 不設 `limits.cpu_ms`——該欄位僅付費方案可調，免費方案沿用平台預設的 10 ms CPU 上限。升級付費方案後可加回去，讓惡意輸入最多只燒掉自己那一個請求的 CPU 預算。

## 文件

- [規則集與更新機制](https://github.com/RainMeoCat/clean-url-api/wiki/Rules-and-Updates) — 規則來源、為什麼在 build 時驗 sha256、手動更新流程
- [開發指引](https://github.com/RainMeoCat/clean-url-api/wiki/Development) — 專案結構、Worker 可達與 build-only 的模組分群、指令、環境變數、測試
- [實作細節](https://github.com/RainMeoCat/clean-url-api/wiki/Implementation-Notes) — 清理演算法的處理順序與設計取捨

## 授權

MIT。規則集本身版權屬 [ClearURLs/Rules](https://github.com/ClearURLs/Rules)（LGPL-3.0）。
