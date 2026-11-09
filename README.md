# A Lexicon Without Objects
繁體中文抽象圖像與情緒詞語研究。

網站入口：[GitHub Pages 實驗](https://christine485.github.io/psyc-thesis/)。
研究人員：[查看試測資料](https://cloud-flow-emotion-study.christine040805.chatgpt.site/researcher?mode=pilot)，需以網站擁有者帳戶登入。

## 狀態
香港無 VPN 遷移準備：新增 `standalone/` 獨立 Cloudflare Workers 後端，以兩個分開的 D1 資料庫儲存研究答案及抽獎聯絡資料，並提供資料備份／匯入準備工具及 GitHub Pages 同來源 PNG 圖片。**新後端尚未部署、舊資料尚未搬移、香港網絡尚未驗收，API 設定仍保留舊服務。** 註冊 Cloudflare、部署、凍結寫入、資料核對及切換步驟見 [香港遷移指引](MIGRATION_HK.md)。

獨立版本使用 Workers Free 及 D1 免費額度，毋須啟用 R2、訂閱付費服務或為這個部署加入信用卡。帳戶必須保持 Workers Free；免費額度有上限，超額可能令 API 或資料庫查詢暫停，並非永久無限量服務。部署成功仍須由香港使用者在關閉 VPN 後完成整個實驗及核實答案已儲存。

Cloudflare 的 GitHub 建立畫面逐格填寫內容見 [畫面設定指引](CLOUDFLARE_DASHBOARD_SETUP.md)。

已獲公開刺激材料授權，網站預設為正式研究模式；裝置與香港網絡仍需實測。請先使用試測模式，勿將「15分鐘目標」或圖片覆蓋數當作已驗證的統計檢定力。

## 參加流程
同意書 → 27張主圖與1次注意力測試 → 背景資料 → 研究解說 → 提交及自願抽獎。

- 使用 cloud-flow-stimuli-2026-10-20 的270張原始1024×1024灰階PNG，逐檔SHA-256核對。
- 每個主試次先輸入1–3個情緒詞，再為已辨認類別的固定三詞作五點配合評分。
- 以2026年11月4日pilot的100份完整回覆，按平均使用頻率選每組前三詞；所有完整問卷均保留。更新分析及30詞清單見 [pilot分析](research/pilot-20261104.md)。
- 未能可靠分類的輸入原文照存，不補猜類別。
- 注意力測試要求輸入2，並在全部評分選2。失敗答案仍保存，只標記分析。
- 抽獎資格：完整提交及通過注意力測試。20名得獎者各獲HK$200。每電話號碼只登記一次。
- 原 Sites 服務以 D1 儲存研究答案、以 R2 獨立儲存抽獎電話；新獨立版本改用兩個分開的 D1，維持答案與電話分離。GitHub repository 不接收參加者答案或電話。

## 執行與部署
`docs/` 是可直接由GitHub Pages發佈的靜態前端。將Pages來源設定為main分支的/docs。
原後端為 Vinext/Cloudflare Worker，使用 Sites 提供的 D1、R2 及研究人員登入；這些原有儲存與歷史資料維持原樣。
獨立遷移版本在 `standalone/`，共用同一研究邏輯，以 `DB` 儲存研究答案、以另一個 `CONTACTS_DB` 儲存抽獎聯絡資料，使用管理秘密值授權；它不依賴 ChatGPT 登入或 Sites 平台，也不使用 R2。舊 R2 物件須經遷移工具轉成 `contacts.sql`，匯入聯絡資料專用 D1，不能與研究答案的 SQL 匯入同一資料庫。參加者流程、隨機分配、詞語評分、抽獎資格及同意書均不因儲存方式改動而改變。部署與驗收前不要直接切換正式 API。
前端API位置由 `docs/config.js` 設定；後端僅允許同源及指定的GitHub Pages來源。
正式研究頁不要求參加者登入。

```
npm ci
node scripts/sync-web.mjs
npm run db:generate
npm run build
node --test tests/protocol.test.mjs tests/server.test.mjs
```

現有遷移不可重複生成或改寫；修改資料結構時才執行db:generate新增遷移。
本機預覽：`node scripts/serve-static.mjs`，再開啟 `http://127.0.0.1:4173/?preview=1`。
預覽模式不提交資料；`?mode=pilot` 使用獨立試測資料集。

完整研究安排、限制及資料欄位見 [RESEARCHER_GUIDE.md](./RESEARCHER_GUIDE.md)。
