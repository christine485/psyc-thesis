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
