# 正式網站：Cloudflare 一次設定

原參加者網址保留：<https://christine485.github.io/psyc-thesis/>。正式接駁後，同網站的「研究團隊登入」連結會開啟受密碼保護的資料後台。

只使用 Workers Free 和兩個新的 D1 Free。保留已有試測 Worker、試測資料庫與原 Sites；不開通 R2、不選付費方案、不購買網域。

## 在 Cloudflare 建立正式項目

1. 返回 **Workers & Pages**，按 **Create application／Create an app**。
2. 選連接 GitHub，使用已授權的 **christine485/psyc-thesis**。
3. 在設定頁填寫以下三格，注意項目名稱要完全相同：

| 欄位 | 填寫內容 |
| --- | --- |
| Project name | `psyc-thesis-api` |
| Build command | `npm run build-study` |
| Deploy command | `npm run deploy-formal` |

4. Root directory／Path 保持 `/`，Preview builds 關閉。使用 Cloudflare 自動建立的部署 token；名稱可用 `psyc-thesis-formal-build`。不用複製或傳送 token。
5. 按 **Deploy**。程式會自動建立或核對 `psyc-thesis-research` 和 `psyc-thesis-draw` 兩個獨立資料庫、套用結構、保留既有秘密值，並驗證正式狀態。
6. 如成功後 Overview 顯示 **No URLs enabled**，到 **Domains**，開啟 **Production** 的 workers.dev 開關；Preview 保持關閉。
7. 複製 Cloudflare 實際顯示的公開 Worker 網址，交由部署人員核對；這是公開網址，可以分享。不要傳送 ADMIN_TOKEN、DRAW_SECRET 或部署 token。

現有試測項目的建置身份被 Cloudflare 鎖定，所以不能在試測項目改用 `deploy-formal`。錯誤項目會在任何資料操作前被拒絕，不能移除此保護。

## 接駁正式參加者入口

部署人員先以實際回傳的正式網址，核對 `stagingOnly=false`、版本、270張原圖、兩個資料庫及 GitHub 的參加者／研究後台連線。

然後執行 `scripts/set-study-backend.mjs` 的 dry run，再準備實際前端設定與快取版本更新。這些由部署人員處理，研究者不用自行改程式。正式後台的 GitHub 登入，會在該正式 API 通過核對並接駁後才啟用。

原入口需再用 `?mode=pilot` 完成一次香港無 VPN 試測，核對提交及匯出後才開始招募。試測不混入正式資料。

## 正式後台

- 網站入口：`https://christine485.github.io/psyc-thesis/researcher.html`，或原網站頁尾「研究團隊登入」。
- 使用正式 Worker `psyc-thesis-api` 的 ADMIN_TOKEN，與試測 Worker 的管理密碼分開。
- 首次使用在後台產生及私下保存新密碼，再於正式 Worker 的 **Settings → Variables and Secrets → ADMIN_TOKEN** 設為 Secret，儲存／Deploy；保留 DRAW_SECRET。
- 選「正式研究資料（live）」查看提交數、圖片評估次數與下載 CSV。試測資料選「pilot」。
- 後台顯示全部270張主圖的完成評估數、有效問卷評估數及實際詞語評分數，並可另外下載圖片覆蓋 CSV。

## 隨機與平衡

保留原本隨機區組分配：每人27張主圖，每個參數組合隨機取一張，個人展示次序亦隨機；每10個完整名額，全部270張主圖各覆蓋一次。另加1次獨立注意力測試，圖片不與該人主圖重複。

沒有未完成空缺時，137份完整問卷對應每圖13–14次評估，150份每圖15次，163份每圖16–17次；150不是固定上限。有中途退出或仍未完成的名額時，已完成評估數會暫時較不均，過期空缺會優先補回。有效問卷篩選與每次自由命名亦會影響實際詞語評分數，不能強制這些數字相同。詳見 `research/allocation-balance-20261109.md`。
