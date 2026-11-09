# Cloudflare 帳戶已建立：安全授權與獨立試測

如果已在 Cloudflare 的 Create an app 畫面連接 GitHub，請使用較直接的 [Cloudflare 畫面指引](CLOUDFLARE_DASHBOARD_SETUP.md)。以下是另一條進階途徑。

註冊帳戶並不會自動授權部署。這份設定把 Cloudflare API token 直接放入 GitHub 的加密 Secrets，不經聊天或公開程式碼。GitHub Actions 會部署獨立試測網站；正式 GitHub Pages 網址、原 Sites 服務及正式研究資料繼續保留。

## 1. Cloudflare 一次性設定

在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 選擇你的新帳戶：

- 在 **Workers & Pages** 確認已有 **Your subdomain**，例如你選擇的名稱加 `.workers.dev`。如有首次設定畫面，先完成設定；毋須購買網域。
- 帳戶維持 **Workers Free**。新版本只使用兩個獨立 D1，毋須啟用 R2 或選擇付費方案。
- 複製此帳戶的 **Account ID**。它是 32 位字元，不是電郵、密碼或 API token。[官方尋找方法](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)。

## 2. 建立限於這個帳戶的 API token

到 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 選擇 **Create Token → Create Custom Token**，命名 `psyc-thesis-staging-deploy`。新增以下 Account 權限：

| 範圍 | 權限 | 存取 |
| --- | --- | --- |
| Account | Account Settings | Read |
| Account | Workers Scripts | Edit |
| Account | D1 | Edit |

Account Resources 選 **Include → Specific account → 你的新帳戶**。這個流程不需要 Zone／DNS 權限。若介面使用 Write 而非 Edit 字眼，對應所需的寫入權限。權限名稱參考 [Cloudflare 官方清單](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)。

建立後把 token 直接存入下一步 GitHub Secret。不要貼入聊天、issue、PR、公開檔案或 workflow input；亦不要使用 Global API Key。

## 3. 在 GitHub 儲存兩項設定

開啟 `christine485/psyc-thesis` 的 **Settings → Secrets and variables → Actions**：

| 設定位置 | 名稱（需完全相同） | 內容 |
| --- | --- | --- |
| [Secrets → New repository secret](https://github.com/christine485/psyc-thesis/settings/secrets/actions/new) | `CLOUDFLARE_API_TOKEN` | 剛建立的 token |
| [Variables → New repository variable](https://github.com/christine485/psyc-thesis/settings/variables/actions/new) | `CLOUDFLARE_ACCOUNT_ID` | 新帳戶的 Account ID |

兩項儲存完成後，在 GitHub Actions 選擇 **Deploy Hong Kong staging → Run workflow**，執行 `main` 分支。不要在對話提供秘密值。

## 4. 部署結果及後續驗收

工作名稱是 **Deploy Hong Kong staging**。推送至主分支或準備分支只執行程式驗證；只有手動執行且已設定 Account ID 時才進行部署，並以固定名稱建立／重用：

- Worker：`psyc-thesis-hk-staging-api`
- 研究 D1：`psyc-thesis-hk-staging-research`
- 抽獎 D1：`psyc-thesis-hk-staging-draw`

它先通過程式測試，再建立隔離儲存、套用 schema、部署 Worker 和 270 張已核對的圖片。試測網頁固定使用 pilot 模式，後端拒絕正式模式寫入；正式切換工具亦拒絕此試測服務。

首次部署會自動生成試測用 `DRAW_SECRET` 及 `ADMIN_TOKEN`，只存入 Cloudflare Worker Secrets；重跑不會更換既有值。管理 token 不會展示在工作日誌，亦不會公開下載。日後如需研究者直接下載試測結果，須先在 Cloudflare 將試測 `ADMIN_TOKEN` 安全設成研究者保管的隨機秘密值；不要改動抽獎密鑰。此設定不涉及正式資料的原有密鑰。

成功後 [GitHub Actions](https://github.com/christine485/psyc-thesis/actions) 的工作摘要會提供實際試測網址。健康檢查通過只表示設定與儲存可讀，仍須進行香港無 VPN 完整試測及確認答案持久化。免費額度有上限；程式不會開通訂閱或升級方案，實際帳戶方案需維持 Free。原資料搬遷及正式切換依 [MIGRATION_HK.md](MIGRATION_HK.md) 執行。

官方部署說明：[Cloudflare 與 GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。
