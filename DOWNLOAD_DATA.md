# 下載研究資料（研究者操作）

目前新服務是試測版本，請選「試測資料（pilot）」。原 GitHub Pages 的正式後端尚未切換；不要把試測紀錄當作正式招募資料。

## 第一次登入

1. 開啟 [研究資料下載頁](https://psyc-thesis-hk-staging-api.christine040805.workers.dev/researcher)。請在研究後端的網址使用管理頁。
2. 展開「第一次使用？設定管理密碼」，按「產生管理密碼」。複製並存到自己的密碼管理器。
3. 在另一個分頁開啟 [Cloudflare](https://dash.cloudflare.com/)，選 **Workers & Pages → psyc-thesis-hk-staging-api → Settings → Variables and Secrets**。
4. 找到已有的 **ADMIN_TOKEN**，按 **Edit／鉛筆圖示**。類型選 **Secret**，貼上新管理密碼，再儲存並按 **Deploy**（如有顯示）。只編輯 ADMIN_TOKEN，保留 DRAW_SECRET 原值。
5. 返回研究下載頁，以同一個管理密碼登入。

最初的 ADMIN_TOKEN 是部署程式自動產生的秘密值，Cloudflare 不會再次顯示原值，所以第一次需要在自己的帳戶重設。它是研究後台密碼，與 Cloudflare 帳戶登入密碼分開。請勿貼到聊天、GitHub 或網址。之後的網站更新會保留已有秘密值。

## 每次下載

1. 在研究下載頁登入。
2. 選「試測資料（pilot）」；正式收集啟用後才選「正式研究資料（live）」。
3. 按「下載研究答案 CSV」。頁面顯示下載進度，最後合成一個檔案。未完成時不會產生部分答案的檔案，請重試。
4. 如要安排抽獎，另外按「下載抽獎電話 CSV」。
5. iPad 在「檔案」App 的「下載項目」尋找檔案。如瀏覽器沒有自動下載，按頁面顯示的下載連結。

| 檔案 | 內容 |
| --- | --- |
| `pilot-research.csv` | 試測研究答案 |
| `pilot-draw.csv` | 試測抽獎電話 |
| `live-research.csv` | 正式研究答案 |
| `live-draw.csv` | 正式抽獎電話 |

研究與抽獎資料分開保管。下載是唯讀操作，不會刪除或修改伺服器紀錄。用完請登出；管理密碼不會存到瀏覽器的 localStorage、sessionStorage 或網址。

## 做分析前

- CSV 是 UTF-8 編碼，可用 Excel、SPSS 或 R 開啟。
- 每行對應一個試次的一個評分詞，同一參加者有多行。樣本人數按不同 `participant_code` 計算。
- `type=main` 是主要圖像試次；`type=attention` 是注意力試次。
- `valid_questionnaire` 表示完整提交及注意力測試結果；未通過的問卷亦保留，按預先訂定的分析規則處理。
- 空白 `rating` 代表該詞沒有被顯示作評分，保留為缺失值。
- 找到「系統測試勿分析」後，記下該行的 `participant_code`，排除該代碼的全部行。新系統的驗證問卷只在一個主試次放標記。
- 抽獎檔案只有電話，沒有可與研究答案合併的參與代碼。

## 資料存放位置

Cloudflare → Storage & databases → D1：

- `psyc-thesis-hk-staging-research`：研究答案與圖片分配，資料表 `slots`。
- `psyc-thesis-hk-staging-draw`：獨立抽獎聯絡資料，資料表 `contact_objects`。

日常分析使用研究下載頁的 CSV。Cloudflare 的資料庫備份與分析 CSV 用途不同；完整還原另見 MIGRATION_HK.md。
