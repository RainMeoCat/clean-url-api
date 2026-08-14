# clear-url-api

依 [ClearURLs](https://github.com/ClearURLs/Rules) 規則集移除網址追蹤碼的 API，可部署為 Express 伺服器或 Cloudflare Worker。

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

規則由 `data/rules.min.json` 驅動，未寫死在程式碼中；要更新時執行 `npm run vendor` 重新抓取官方規則，確認 diff 與測試後 commit 即生效。詳見 [規則集與更新機制](https://github.com/RainMeoCat/clear-url-api/wiki/Rules-and-Updates)。

## API 使用方式

> 以下以 Express 版本機 `http://localhost:3000` 為例。部署到 Cloudflare 後把 base URL 換成實際掛載路徑（例如 `https://example.com/api/clean-url`）即可，兩者的請求與回應格式相同。

### `GET /clean`

| 參數  | 說明                        |
| ----- | --------------------------- |
| `url` | 要清理的網址（需 URL 編碼） |

```bash
curl -s 'http://localhost:3000/clean?url=https%3A%2F%2Fexample.com%2Fp%3Fid%3D5%26utm_source%3Dnewsletter%26fbclid%3Dabc'
```

```json
{ "url": "https://example.com/p?id=5" }
```

### `POST /clean`

一次處理多個網址，回傳順序與輸入一致。

```bash
curl -s -X POST http://localhost:3000/clean \
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

### 限制

| 項目             | 上限                |
| ---------------- | ------------------- |
| 單一網址長度     | 8192 字元           |
| 單次批次數量     | 100 筆              |
| 巢狀轉址展開層數 | 5 層                |
| 速率限制         | 每 IP 每分鐘 120 次 |

## 在本機跑起來

```bash
npm install
```

Express 版（`http://localhost:3000`）：

```bash
npm run dev
```

Cloudflare Worker 版（本機 workerd，`http://localhost:8787`）：

```bash
npm run worker:dev
```

兩者共用同一份清理邏輯與規則集，回應約定完全相同。

## 部署到 Cloudflare Workers

規則集會被 bundle 進 Worker（總計約 47 KB / gzip 11 KB），不需要 `nodejs_compat`。

1. 編輯 `wrangler.jsonc`，把 `routes[].pattern` 與 `zone_name` 的 `example.com` 換成實際網域。若同時要調整掛載路徑，`vars.MOUNT_PATH` 必須跟著改成相同路徑。
2. 確認該網域在 Cloudflare 上，且對應的 DNS 記錄是**代理狀態（橘雲）**——灰雲不會觸發 Worker 路由。若該網域沒有 origin 主機，建一筆代理狀態的 `AAAA` 指向 `100::` 即可。
3. 部署：

```bash
npm run worker:deploy
```

`worker:deploy` 會先跑 `verify:rules`；規則檔的 sha256 對不上就中止，不會把來源不明的 regex 部署上線。

### 建議的節流設定

Worker 本身不做速率限制——WAF 的 Rate Limiting Rules 跑在 Worker **之前**，被擋下的請求不計入 Worker 用量，成本與防護都更好。建議在 Cloudflare dashboard（Security → WAF → Rate limiting rules）設定：

| 條件                                                   | 上限         | 動作  |
| ------------------------------------------------------ | ------------ | ----- |
| `starts_with(http.request.uri.path, "/api/clean-url")` | 120 次／分鐘 | Block |
| 同上且 `http.request.method eq "POST"`                 | 20 次／分鐘  | Block |

POST 單次可帶 100 個網址，成本是 GET 的 100 倍，因此配額要獨立且更嚴。動作請選 **Block**，不要用 Managed Challenge——API 用戶端不會解 challenge。

`wrangler.jsonc` 另外設了 `limits.cpu_ms`，讓惡意輸入最多只燒掉自己那一個請求的 CPU 預算（付費方案適用，免費方案請移除該段）。

## 文件

- [規則集與更新機制](https://github.com/RainMeoCat/clear-url-api/wiki/Rules-and-Updates) — 規則來源、sha256 驗證、手動更新流程
- [開發指引](https://github.com/RainMeoCat/clear-url-api/wiki/Development) — 指令、環境變數、編輯器設定、測試
- [實作細節](https://github.com/RainMeoCat/clear-url-api/wiki/Implementation-Notes) — 清理演算法的處理順序與設計取捨

## 授權

MIT。規則集本身版權屬 [ClearURLs/Rules](https://github.com/ClearURLs/Rules)（LGPL-3.0）。
