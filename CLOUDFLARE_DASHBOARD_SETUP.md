# Cloudflare 畫面逐格設定

適用於已在 Cloudflare **Create an app** 選擇 `christine485/psyc-thesis` 的情況。使用 Cloudflare 自動建立的部署 token，毋須經聊天傳送 token，亦毋須另外設定 GitHub Secrets。

本階段建立獨立試測網站，保留正式 GitHub Pages 的研究 API 設定。圖片及研究流程與正式版本一致；試測網站強制 pilot 模式，拒絕正式模式的答案。

## 畫面填寫內容

| 畫面欄位 | 填寫內容 |
| --- | --- |
| Project name | `psyc-thesis-hk-staging-api` |
| Build command | `npm run study:build` |
| Deploy command | `npm run study:deploy` |
| Enable Preview builds | 關閉 |
| Protect with Cloudflare Access | 關閉，讓測試者可匿名參與 |
| Advanced settings → Path | `/` |
| API token | `Create new token` |
| API token name | `psyc-thesis-staging-build` |
| Variable name / Variable value | 留空 |

Node.js 版本由程式庫的 `.nvmrc` 指定為 24。程式已放在 `main` 後，可使用初始畫面預設的主分支；日後在 Worker → Settings → Build → Branch control 核對。

展開 token 權限說明，確認至少包括 Account Settings Read、Workers Scripts Edit、D1 Storage Edit／D1 Edit，以及 Workers R2 Storage Edit。2026-11-07 使用者提供的建立畫面已顯示 D1 Storage（edit）及 R2（edit）；不能只憑舊版文件假定權限清單。

## 部署前的帳戶設定

新帳戶需完成 Workers & Pages 設定，具備 `workers.dev` 子網域；亦需啟用 R2 Object Storage。R2 可能要求付款方式，請按官方畫面的費用與條款決定；部署程式不會代為開通訂閱。

Cloudflare 的圖形介面會處理 token 授權。部署程式透過 Wrangler 的正常登入方式操作，不讀取或顯示 token、密碼、秘密檔案；只接受可明確識別的單一帳戶，或明確提供的 Account ID。若帳戶不明確，會停止而不猜選。

## 程式會做甚麼

1. 核對指定試測 Worker 名稱及目前授權的帳戶。
2. 建立或重用指定名稱的獨立 D1／R2，不刪除既有資源。
3. 核對 270 張刺激圖片 SHA-256，產生只供試測的網站副本。
4. 套用 schema、部署 Worker 與圖片，保留既有秘密值。
5. 只在尚未設定時建立試測用簽署及管理秘密值，經 stdin 傳入，避免寫入日誌或程式碼。
6. 使用 Wrangler 實際回傳的網址檢查研究版本與 D1／R2 健康狀態。

成功部署及健康檢查不等於香港無 VPN 驗收。仍須以香港手機、Wi-Fi 及流動數據完成整份試測，並核對答案已保存，才處理正式資料搬遷及切換。完整流程見 [MIGRATION_HK.md](MIGRATION_HK.md)。

若不使用 Cloudflare 的 GitHub 連接畫面，另一條進階途徑是 [GitHub Actions](CLOUDFLARE_GITHUB_SETUP.md)。兩條途徑選其一即可。
