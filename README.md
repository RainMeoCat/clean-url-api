# clean-url-api

依 [ClearURLs](https://github.com/ClearURLs/Rules) 規則集移除網址追蹤碼的 Cloudflare Worker。

丟一個網址進來，回傳乾淨的網址：拿掉追蹤參數、聯盟行銷碼與站台專屬的追蹤片段；若是廣告轉址網址，直接解出它真正指向的目標；若是 Threads 的分享短連結，先向它問出真正的網址再清理。

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

Threads      https://www.threads.com/share/Fp3agZKiy/
分享短連結 →  https://www.threads.com/@amtb4818/post/DcIG72GFE5W
```

轉址解析涵蓋 Google、Facebook、YouTube、Instagram、Messenger、Reddit、eBay、Steam、Tumblr、VK、DuckDuckGo、Pocket、Adjust 等平台，以及 AWIN、Admitad、Tradedoubler、Skimlinks、VigLink、digidip、href.li 等聯盟／短連結服務。解出的目標**會再被完整清理一次**，巢狀轉址最多解 5 層。

規則由 `data/rules.min.json` 驅動，未寫死在程式碼中；要更新時執行 `npm run vendor` 重新抓取官方規則，確認 diff 與測試後 commit 即生效。上游尚未收錄的網站則以 `data/rules.local.json` 補上（目前只有 Threads 的 `xmt`、`igshid`、`igsh`）。

### 短連結展開

多數轉址網址把目標內嵌在網址裡（如 `google.com/url?q=...`），純字串處理就能解出。但 Threads 的分享短連結 `threads.com/share/<code>` 只有一組短碼，目標只存在伺服器端，因此這類網址會**實際發出一次請求**取得 `Location` 再清理。

- 只有明確命中白名單樣式的網址會觸發外部請求，其餘網址一律純字串處理、不連外。
- 展開失敗（查無短碼、逾時、目標跳出白名單）不算錯誤，會回退成只做字串清理並照樣回 `200`。

## API 使用方式

一次接收一個網址、回傳一個網址，只支援 `GET`。線上位址是 `https://rainmeocat.com/api/clean-url`；以下範例以本機 `wrangler dev`（`http://localhost:8787/api/clean-url`）為主，換成線上網域即可。

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

### 回應約定

- 成功一律 `200`，只回傳清理後的字串，不附帶比對細節。
- 錯誤一律 `4xx`，格式為 `{ "error": "訊息" }`。
- 整個網址本身即追蹤／廣告網址時回傳空字串，代表它沒有乾淨版本。
- 掛載路徑以外的子路徑回 `404`，`GET` 以外的 method 回 `405`（帶 `Allow: GET`）。

### 限制

| 項目             | 上限      |
| ---------------- | --------- |
| 單一網址長度     | 8192 字元 |
| 巢狀轉址展開層數 | 5 層      |
| 短連結展開逾時   | 3 秒      |

速率限制不在程式碼裡，由 Cloudflare WAF 負責。

## 在本機跑起來

```bash
npm install
npm run dev
```

`wrangler dev` 會在本機的 workerd 跑起真正的 Worker runtime，行為與線上一致。

## 授權

MIT。規則集本身版權屬 [ClearURLs/Rules](https://github.com/ClearURLs/Rules)（LGPL-3.0）。
