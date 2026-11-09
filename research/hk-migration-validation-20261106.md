# 香港後端遷移準備驗證（2026-11-06）

此紀錄驗證程式與封裝，**不代表已部署、已搬移正式資料或已通過香港無 VPN 驗收**。正式 API 設定仍指向原服務；新部署需要研究者的 Cloudflare 帳戶及安全授權。

## 已通過

- 原網站取回的 270 張 PNG：全部 SHA-256 與既有刺激清單相同，尺寸均為 1024×1024。完整清單見 `stimuli-recovery-verification.json`。
- `node tests/protocol.test.mjs`：12 項，包括圖片、分配覆蓋、詞語分類、注意力驗證及本地圖片來源。
- `node tests/server.test.mjs`：5 項，包括真實 SQLite schema、提交冪等、資料分離、原平台權限及維護開關。
- `node tests/migration.test.mjs`：5 項，包括快照權限、維護要求、上限、SQL 還原、空白目標要求及只準備 R2 上傳計劃。
- `npm --prefix standalone test`：6 項，包括 D1／R2 健康檢查、來源限制、管理權限、完整試測提交、抽獎分離及維護模式。
- 根專案及獨立 Worker TypeScript 檢查。
- `node scripts/sync-web.mjs` 後原 Sites 正式編譯。
- 獨立 Worker `wrangler deploy --dry-run --config standalone/wrangler.example.jsonc` 封裝成功；沒有部署或建立遠端儲存資源。

所有資料庫及抽獎測試使用本機模擬資料；未下載、匯出或改動正式研究答案及電話。

## 尚未驗證

- 真實 Cloudflare 帳戶、D1／R2 綁定、秘密值及遠端持久化。
- 舊資料快照、密鑰安全移交及新舊資料核對。
- 新後端真實瀏覽器操作及香港 Wi-Fi／流動數據無 VPN 完整流程。
- GitHub Pages 正式切換。

正式驗收依照 [MIGRATION_HK.md](../MIGRATION_HK.md) 執行；不可只看首頁或健康檢查便判定已可招募。

## 免費方案及 150 份回覆目標（2026-11-09）

使用者明確拒絕 R2 用量訂閱，新部署已改用兩個不同 ID 的 D1，分別保存研究答案及抽獎電話。原 Sites 的歷史 R2 保持不變；遷移工具把原鍵值及 JSON 保存成獨立的 `contacts.sql`，不在新帳戶開通 R2。

53 項本機測試通過，包括原有研究流程、雙庫分隔、原始快照遷移、條件寫入、部署資源隔離，以及 150 份完整問卷的儲存及重試驗證。根專案及獨立 TypeScript 檢查通過。容量數據及限制見 [150 份回覆驗證](free-capacity-150-20261109.md)。

實際 Cloudflare 部署、持久化及香港無 VPN 全流程仍待完成，不能把本機模擬當成真人回覆或網絡驗收。

## 帳戶建立後的安全部署準備

新增 GitHub Actions 試測部署流程及 `STAGING_ONLY` 限制：試測網頁與 API 可使用同一 Worker 來源，但後端拒絕正式模式寫入；正式切換工具拒絕試測服務。

獨立 Worker 增至 7 項測試，另有 4 項模擬部署測試，合計 33 項本機測試通過。新增測試核對缺少授權時不發出請求、資源隔離、只經 stdin 傳入秘密值、重跑保留既有資源與秘密值，以及錯誤訊息不洩漏授權。Workflow YAML 及獨立 TypeScript 檢查通過。

這些新增測試仍使用模擬 Cloudflare 回應。實際部署需先把 API token 直接存入 GitHub Secret，以及設定指定 Account ID；此紀錄不宣稱已獲遠端授權或已完成部署。

## Cloudflare 原生 GitHub 建立畫面

使用者其後選用 Cloudflare 原生建立畫面；其自動 token 權限提示已確認含 D1 Storage Edit 與 R2 Edit。新增 `npm run study:build` 及 `npm run study:deploy`，透過 Wrangler 的正常認證操作，不要求部署腳本自行讀取 token。

新增 11 項原生部署模擬測試，核對帳戶識別、CLI 格式、固定試測名稱、資源建立後再確認、既有／部分秘密值保留、URL 來源及健康檢查失敗，全部通過。合計 44 項本機測試；`study:build` 已實際執行成功。命令與格式已對照固定 Wrangler 4.92.0 的實作審閱。

原生 Cloudflare 的真實授權、R2 啟用及新服務部署，仍需在建立畫面完成後驗證。GitHub 推送只驗證程式；進階 GitHub Actions 部署改為手動選用，避免與原生部署重複操作。
