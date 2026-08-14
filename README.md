# clear-url-api

依 [ClearURLs](https://github.com/ClearURLs/Rules) 規則集移除網址追蹤碼的 Express API。

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

規則由 `data/rules.min.json` 驅動，未寫死在程式碼中；每日排程會偵測上游更新並開 PR，合併後新規則即生效。詳見 [規則集與更新機制](https://github.com/RainMeoCat/clear-url-api/wiki/Rules-and-Updates)。

## API 使用方式

> 目前尚未部署，以下以本機 `http://localhost:3000` 為例。部署後把 base URL 換掉即可。

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
npm run dev
```

## 文件

- [規則集與更新機制](https://github.com/RainMeoCat/clear-url-api/wiki/Rules-and-Updates) — 規則來源、sha256 驗證、每日自動開 PR 的流程
- [開發指引](https://github.com/RainMeoCat/clear-url-api/wiki/Development) — 指令、環境變數、編輯器設定、測試
- [實作細節](https://github.com/RainMeoCat/clear-url-api/wiki/Implementation-Notes) — 清理演算法的處理順序與設計取捨

## 授權

MIT。規則集本身版權屬 [ClearURLs/Rules](https://github.com/ClearURLs/Rules)（LGPL-3.0）。
