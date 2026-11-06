# 香港無 VPN 後端遷移指引

目標入口保持：<https://christine485.github.io/psyc-thesis/>。

目前程式已準備獨立 Cloudflare Workers 後端，但**未部署、未遷移正式資料、未完成香港無 VPN 實測，正式入口未切換**。不能將本機測試或海外雲端成功連線當成香港驗收結果。

## 1. 先建立你的 Cloudflare 帳戶

1. 在官方頁面 <https://dash.cloudflare.com/sign-up> 註冊，完成電郵驗證，並啟用雙重認證。
2. 在 Dashboard 的 Workers & Pages、D1、R2 頁面確認可建立服務。使用 `workers.dev` 網址通常毋須購買網域；香港可否使用仍須實測。
3. R2 需要啟用訂閱，可能要求付款方式；啟用前查看帳戶畫面及 [R2 收費](https://developers.cloudflare.com/r2/pricing/)。Workers、D1 也有用量限制，不能承諾永久免費。
4. 帳戶準備好後，以官方 OAuth 授權 Wrangler。在有此程式碼的受信任電腦上執行 `npx wrangler login`，只在 Cloudflare 官方登入頁完成授權。若協作者使用的遠端環境未能接收 OAuth，須另行使用該環境支援的安全秘密值設定渠道；不能把瀏覽器登入狀態視為遠端已獲授權。

不要將 Cloudflare 密碼、API token、`DRAW_SECRET` 或 `ADMIN_TOKEN` 貼入對話、GitHub 檔案、issue、PR、前端設定或網址。若日後使用 CI 部署，token 只放 GitHub Actions 的秘密值設定，並限制至指定帳戶及所需資源。

官方文件：[Wrangler 登入](https://developers.cloudflare.com/workers/wrangler/commands/#login)、[D1 入門](https://developers.cloudflare.com/d1/get-started/)、[R2 入門](https://developers.cloudflare.com/r2/get-started/)。

## 2. 新後端部署準備

此部分由部署人員操作。先建獨立試測服務及儲存資源，再建立正式服務；兩者不要共用 D1 或 R2。`?mode=pilot` 與正式資料另有邏輯分隔，但並不能取代部署環境隔離。

在 `standalone/`：

本機驗證工具使用 Node.js 24 或以上。先確認 `node --version`。

```sh
npm ci
npm test
npm run typecheck
cp wrangler.example.jsonc wrangler.jsonc
```

範例採用 `psyc-thesis-api`、D1 `psyc-thesis-research` 及 R2 `psyc-thesis-draw` 名稱。試測請改為另一些名稱，避免覆蓋正式資源。

建立資源後，把**工具實際回傳**的 D1 ID 填入 `wrangler.jsonc`，確認 `DB`、`BUCKET` 綁定及帳戶正確。範例 ID 不能直接部署。按實際資源名稱操作，例如：

```sh
npx wrangler d1 create psyc-thesis-research
npx wrangler r2 bucket create psyc-thesis-draw
npx wrangler d1 migrations apply psyc-thesis-research --remote
npx wrangler secret put DRAW_SECRET
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

秘密值由 Wrangler 隱藏輸入提示讀取。`ADMIN_TOKEN` 使用密碼管理器產生、至少 32 字元的獨立隨機秘密；它能下載研究及抽獎資料，只交予有權研究人員。`DRAW_SECRET` 是抽獎資格簽署密鑰，與管理 token 分開。全新試測可用新密鑰；正式遷移的密鑰要求見下一節。

不要將新帳戶的資源 ID 寫回原 Sites 的 `.openai/hosting.json`。獨立部署使用 `standalone/wrangler.jsonc`；原 Sites 保留原有資源與設定。

取得真正部署網址後，檢查 `GET /api/health` 是否成功。此檢查涵蓋資料庫結構及必要設定，仍不代表提交與抽獎全流程已通過。

## 3. 正式資料遷移：必須先取得完整、安全的快照

舊系統把研究記錄放 D1，把抽獎聯絡資料放 R2。研究 CSV 及電話 CSV 適合研究者下載與核對，**不足以還原整個系統**。

正式切換前，需要由有權擁有者取得及核對：

- D1 `slots` 完整內容及結構：`mode`、`id`、`token_hash`、`expires`、`plan`、`submitted`、`payload`，包括已提交及進行中分配。不可只匯入已完成答案，也不可重新編排名額 ID。
- R2 全部 `pilot/`、`live/` 下的 `phones/` 及 `permits/` 物件，保留 key、內容及原有區隔。只搬電話 CSV 會遺失抽獎資格去重記錄。
- 原正式 `DRAW_SECRET`。既有簽署資格需要同一密鑰；不能隨意換密鑰後宣稱舊參加者可繼續登記。

程式新增了原 Sites 擁有者專用的 `GET /api/admin/migration` 快照端點，以及 `STUDY_MAINTENANCE=1` 寫入維護開關，但**必須先透過 Sites 部署這項更新才可使用，目前未部署**。快照端點要求維護開關已啟用，否則回傳 409；它匯出全部 D1 名額及 R2 物件原始位元組、metadata 和核對雜湊，不包含秘密值。只容許已登入且符合原 `ADMIN_EMAIL` 的研究者存取，不能把此網址當成匿名下載連結。序列化快照上限為 16 MiB；超出會回傳 413，屆時須改用經確認的供應商備份途徑，不能宣稱工具支援任意資料量。

本機匯入準備工具：

```sh
node tests/migration.test.mjs
node scripts/import-study-snapshot.mjs --snapshot /private/snapshot.json --out /private/new-import
node scripts/prepare-study-r2-upload.mjs --manifest /private/new-import/r2-manifest.json --bucket 實際目標桶名稱 --wrangler /絕對路徑/node_modules/wrangler/bin/wrangler.js --config /絕對路徑/standalone/wrangler.jsonc
```

第一個準備工具輸出 `slots.sql`、`objects/`、`r2-manifest.json` 及摘要，不會複製上傳程式。第二個工具產生私人的 `r2-upload-plan.json`，內容是供審查的命令參數陣列；**兩個工具都不會執行遠端匯入或上傳**。命令內的路徑及桶名稱須換成實際值。

只可在確認目標是專用、全新、空白的 D1／R2，並且新舊服務皆處於維護狀態、沒有其他管理寫入之後，另行審查和執行匯入命令。SQL 有拒絕非空目標的檢查；R2 CLI 上傳沒有條件寫入保護，不能在既有或並行使用的桶執行。若匯入失敗或只完成一部分，放棄該目標資源並在新空白資源重試，不要當成可安全重跑覆寫。原 `DRAW_SECRET` 必須另外安全移交。

仍須確定擁有者可以安全匯出、匯入和核對，才可正式切換。不得猜測資料庫 ID、取得其他帳戶的資源，或把敏感快照提交至公開 GitHub。若無法取得完整快照或原密鑰，維持舊服務及歷史資料，先解決存取途徑；這不是已完成遷移。

正式切換的操作次序：

1. 暫停招募，記錄切換時間；在維護開關啟用之前，處理正在作答及待抽獎的參加者。
2. 先部署包含維護開關與快照端點的程式。在新舊服務設定 `STUDY_MAINTENANCE=1`，實際確認開始、提交、抽獎三個 POST 都被拒絕，並確保沒有其他管理寫入。待已在執行的請求完成後才取一致快照；不能只靠發通知或改前端便假定舊後端已停止寫入。維護期間應保留參加者頁面，不要叫人重新整理而丟失答案。
3. 將快照放在受保護位置，備份並記錄檔案雜湊；匯入尚未對公眾開放的新正式資源，使用原抽獎密鑰。
4. 比較遷移前後每個 `mode` 的名額總數、已提交數、有效問卷數、最大 ID、進行中名額，以及 R2 兩類物件的數量及內容雜湊。檢查抽獎電話去重與已使用資格仍有效。
5. 核對研究 CSV 與電話 CSV 可安全下載、內容相符。研究匯出不含電話；電話匯出只有電話，沒有研究分配或答案。
6. 獨立試測環境先完成下方香港實測，再更新 GitHub Pages 的正式後端設定，按切換安排解除新正式服務的維護狀態並完成確認；舊服務繼續維持 `STUDY_MAINTENANCE=1` 封存，防止舊快取頁面繼續寫入。

不能讓新舊服務同時接受正式寫入後再任意合併：名額、簽署資格與去重狀態可能衝突。

## 4. 圖片及 GitHub Pages 切換

原 GitHub 前端的 API 與圖片皆依賴 `chatgpt.site`。遷移必須同時移除兩個依賴。

完整 270 張刺激圖片應在 `docs/stimuli/` 保存為原始 PNG，與 `docs/modules/stimuli.mjs` 的 SHA-256 全部一致。GitHub Pages 直接提供這些圖片，毋須參加者另連原網站。`docs/app.js` 的副檔名必須與實際 PNG 一致，不可仍將 `.png` 改寫成不存在的 `.svg`。

圖片改用同來源 PNG；API 暫時保留原服務，直到真正的新服務通過驗收。切換工具：

```sh
node scripts/set-study-backend.mjs --api-base https://實際部署網址 --dry-run
node scripts/set-study-backend.mjs --api-base https://實際部署網址
```

工具會先檢查新服務健康狀態及研究版本，再準備 `docs/config.js` 與模組快取版本的修改。這不能取代香港實測；先在分支及獨立試測環境檢查，再於正式切換時合併發布。正式網址保留不變。不要在新服務未部署時填入猜測網址或發布空白設定。

## 5. 香港無 VPN 驗收

請真人在香港關閉 VPN、代理及任何會改變地區的連線工具，使用普通瀏覽器完成。雲端測試、`preview=1`、只開首頁或只看健康檢查，都不算通過。`preview=1` 不會提交資料。

先用獨立試測服務及 `?mode=pilot`；測試紀錄需清楚標記，從研究分析排除。抽獎測試只使用測試者有權使用的電話，不能把任意號碼當成真實聯絡人。

| 測試環境 | 必須完成的項目 | 通過證據 |
| --- | --- | --- |
| 香港手機＋家居／校園 Wi-Fi，無 VPN | 同意書 → 隨機分配 → 27 張主圖＋1 次注意力試次 → 詞語評分 → 背景資料 → 最後提交 | 全部圖片載入；畫面確認問卷提交；伺服器回應 `submitted:true`；受保護匯出找到該測試記錄 |
| 香港手機＋流動數據，無 VPN | 同上完整流程，建議另一電訊網絡 | 同上，記錄網絡、裝置、瀏覽器、時間及結果 |
| 有效問卷＋自願抽獎 | 注意力條件正確，完成獨立電話提交 | 畫面確認登記；R2／受保護電話匯出確認成功；研究資料不含電話 |
| 中途短暫斷線 | 保留頁面，恢復網絡並重試提交 | 答案只存一次；抽獎只登記一次；不要求重新整理或重新作答 |
| 無權限訪客 | 不帶管理秘密值請求資料匯出 | 下載被拒；公開前端未包含任何管理秘密值 |
| 所有刺激材料 | 使用核對程式檢查 270 張，不只某位參加者的 28 張 | 雜湊及 1024×1024 尺寸全部通過；抽查 GitHub Pages 圖片可達 |

管理匯出端點為 `GET /api/admin/export?mode=pilot|live&kind=research|draw`，使用 `Authorization: Bearer …`；不要把 token 放 query string，也不要在參加者前端儲存它。新獨立後端不再使用 ChatGPT 登入下載資料。

正式切換後，用普通入口在香港再確認新 API 和本地圖片的實際網域，確保瀏覽器網絡紀錄沒有必需的 `chatgpt.site` 請求。仍須按研究倫理要求決定是否開放正式招募。

## 6. 回復及目前待辦

若尚未接收新正式資料，可恢復舊前端設定，並按原有寫入控制重新開放舊服務；先確認已恢復的頁面與服務配對。

若新服務已接收正式資料，先暫停新舊寫入、備份兩邊，核對新增記錄、名額及抽獎去重後再決定去向。不能直接把網址切回舊資料庫，否則新答案可能漏出分析，電話亦可能重複登記。舊服務受香港限制時，回復舊服務只屬資料保全措施，並沒有解決無 VPN 目標。

目前仍需：Cloudflare 帳戶及安全部署授權、實際資源建立、部署並啟用及驗證維護開關／快照端點、舊資料與密鑰安全搬移、香港 Wi-Fi／流動數據全流程實測、正式切換。以上每項都要以實際結果記錄，完成前不應對參加者宣稱已保證無 VPN 可用。
