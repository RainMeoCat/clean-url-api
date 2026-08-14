# clear-url-api

依 [ClearURLs](https://github.com/ClearURLs/Rules) 規則集移除網址追蹤碼的 Express API。

輸入一個網址，回傳去掉 `utm_*`、`fbclid`、`gclid`、聯盟行銷參數與各站台專屬追蹤片段後的乾淨網址；遇到廣告轉址網址則直接解出真正的目標。

## API

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
- 若整個網址本身即為追蹤／廣告網址（規則集的 `completeProvider`），回傳空字串——代表它沒有乾淨版本。

### 限制

| 項目             | 上限                |
| ---------------- | ------------------- |
| 單一網址長度     | 8192 字元           |
| 單次批次數量     | 100 筆              |
| 巢狀轉址展開層數 | 5 層                |
| 速率限制         | 每 IP 每分鐘 120 次 |

## 支援的清理能力

不只移除查詢字串裡的追蹤參數。規則集共 206 個 provider，涵蓋以下六類能力（「覆蓋」欄為實際套用該能力的 provider 數，已扣除規則集自帶的 7 個測試用 provider）：

| 能力                          | 覆蓋 | 作用                                               |
| ----------------------------- | ---- | -------------------------------------------------- |
| `rules` — 查詢參數移除        | 142  | 移除 `utm_*`、`fbclid`、`gclid`、`ref` 等追蹤參數  |
| `redirections` — 轉址解析     | 56   | 從轉址網址中解出真正的目標，並遞迴清理該目標       |
| `rawRules` — 網址片段移除     | 4    | 移除**路徑或 fragment** 中的追蹤片段，不限查詢字串 |
| `referralMarketing` — 聯盟碼  | 7    | 移除聯盟行銷參數                                   |
| `completeProvider` — 整體封鎖 | 8    | 整個網址本身即廣告／追蹤器，回傳空字串             |
| `exceptions` — 例外豁免       | 15   | 命中即略過該 provider，避免把功能性網址清壞        |

### 轉址解析

涵蓋 Google、Facebook、YouTube、Instagram、Messenger、Reddit、eBay、Steam、Tumblr、VK、DuckDuckGo、Pocket、Adjust 等平台，以及 AWIN、Admitad、Tradedoubler、Skimlinks、VigLink、digidip、href.li 等聯盟／短連結轉址服務。

```
https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fpage%3Futm_source%3Dserp&sa=U&ved=2ahUKEwj
→ https://example.org/page

https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2Fpost%3Ffbclid%3Dabc&h=AT1x
→ https://example.org/post

https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fdoc&rut=abcdef
→ https://example.org/doc

https://www.awin1.com/cread.php?awinmid=1&ued=https%3A%2F%2Fshop.example%2Fitem%3Futm_source%3Daff
→ https://shop.example/item
```

解出來的目標**會再被完整清理一次**——上面第一筆解開後的 `?utm_source=serp` 也一併移除了。巢狀轉址同樣能一路解到底（上限 5 層）：

```
https://href.li/?https://vk.com/away.php?to=https%3A%2F%2Fexample.org%2F%3Futm_source%3Ddeep
→ https://example.org/
```

### 其他能力

```
# rawRules：清掉路徑與 fragment 中的追蹤片段
https://www.amazon.com/dp/B0123/ref=sr_1_1?qid=999&tag=aff-20&ascsubtag=xyz
→ https://www.amazon.com/dp/B0123

https://pantip.com/topic/12345#lead_tracking
→ https://pantip.com/topic/12345

# completeProvider：整個網址即廣告請求，沒有乾淨版本
https://pagead2.googlesyndication.com/pagead/ads?client=ca-pub-1
→ ""

# exceptions：Amazon 的購物車／API 網址屬例外，只套用 globalRules，tag 保留
https://www.amazon.com/gp/redirector.html?tag=aff-20&utm_source=x
→ https://www.amazon.com/gp/redirector.html?tag=aff-20
```

最後一項容易被忽略但很重要：若沒有 `exceptions`，購物車 API、登入回呼這類網址會被清到壞掉。

以上全部由規則集驅動，**沒有寫死在程式碼裡**。每日更新的 PR 一合併，新增的轉址服務與追蹤參數就自動生效，不需要改動任何程式碼。

## 規則集

規則檔 `data/rules.min.json` 直接進版控，服務啟動時從磁碟載入，**執行期不對外連線**，因此可離線啟動、部署時也不需要任何額外步驟。

啟動時會以 `data/rules.hash` 驗證檔案的 sha256；不符即啟動失敗，避免用來源不明的 regex 處理使用者輸入。

### 更新機制

`.github/workflows/update-rules.yml` 每日排程執行：

1. 從 ClearURLs 官方 CDN 下載 `data.minify.json` 與官方 `rules.minify.hash`（`rules2` 為主、`rules1` 備援）。
2. 驗證 sha256 與規則集結構，任一項不符即失敗且不寫入任何檔案。
3. 有變更才建立分支 `chore/clearurls-rules-<hash8>` 並開 PR，交由人工審核合併。同一個上游版本只會開一次 PR。

也可在本機手動執行：

```bash
npm run update-rules
```

> **前置設定**：需在 repo 的 Settings → Actions → General → Workflow permissions 勾選 **Allow GitHub Actions to create and approve pull requests**，否則 workflow 中的 `gh pr create` 會被拒絕。

## 開發

```bash
npm install
npm run dev
```

| 指令                    | 說明                                   |
| ----------------------- | -------------------------------------- |
| `npm run dev`           | 以 tsx 啟動並監看檔案變更              |
| `npm run build`         | 編譯到 `dist/`                         |
| `npm start`             | 執行編譯後的服務                       |
| `npm test`              | 執行測試                               |
| `npm run test:coverage` | 測試並輸出覆蓋率（門檻 80%）           |
| `npm run lint`          | ESLint 檢查                            |
| `npm run format`        | Prettier 格式化                        |
| `npm run fix`           | 先 Prettier 格式化，再 ESLint 自動修正 |
| `npm run typecheck`     | 型別檢查                               |
| `npm run update-rules`  | 更新 ClearURLs 規則集                  |

### 環境變數

| 變數              | 預設值                      | 說明             |
| ----------------- | --------------------------- | ---------------- |
| `PORT`            | `3000`                      | 監聽埠號         |
| `RULES_PATH`      | `data/rules.min.json`       | 規則檔路徑       |
| `RULES_HASH_PATH` | 規則檔同目錄的 `rules.hash` | 規則 hash 檔路徑 |

### 編輯器設定

`.vscode/settings.json` 已設定為儲存時**先 Prettier 格式化、再 ESLint 自動修正**。

這裡使用 `editor.codeActionsOnSave` 的陣列形式而非物件形式，因為只有陣列語法保證依列出順序依序執行：

```jsonc
"editor.codeActionsOnSave": ["source.fixAll.prettier", "source.fixAll.eslint"]
```

兩點注意：

- `source.fixAll.prettier` 會遵循 `editor.defaultFormatter`，若把預設 formatter 換成其他套件，這個 code action 就不會執行。
- ESLint 設定最後套用 `eslint-config-prettier` 關閉所有格式類規則，因此第二步不會改動第一步的格式化結果。

需安裝 `esbenp.prettier-vscode` 與 `dbaeumer.vscode-eslint`（已列於 `.vscode/extensions.json`）。

## 實作細節

每個 provider 依序處理：`exceptions` → `redirections` → `completeProvider` → `rawRules` → `rules`。

- `redirections` 刻意排在 `completeProvider` 之前：廣告轉址網址本身雖屬追蹤網址，但使用者要的是它指向的乾淨目標。
- 參數名稱採**完整比對**（規則會被錨定成 `^(?:規則)$`），避免 `id` 這種規則誤傷 `video_id`。
- `referralMarketing` 與 `rules` 一併移除。
- 查詢字串以字串切分處理，不經 `URLSearchParams` 重建——後者會重新編碼參數（例如把 `%20` 變成 `+`），等於在移除追蹤碼之外擅自改動了使用者的網址。
- 規則集的 `forceRedirection` 供瀏覽器擴充套件強制跳轉用，本 API 只回傳字串，未使用該欄位。

## 授權

MIT。規則集本身版權屬 [ClearURLs/Rules](https://github.com/ClearURLs/Rules)（LGPL-3.0）。
