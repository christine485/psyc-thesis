# A Lexicon Without Objects
繁體中文抽象圖像與情緒詞語研究。

網站入口：[開始正式實驗](https://cloud-flow-emotion-study.christine040805.chatgpt.site/?mode=live)。
研究人員：[查看試測資料](https://cloud-flow-emotion-study.christine040805.chatgpt.site/researcher?mode=pilot)，需以網站擁有者帳戶登入。

## 狀態
已獲公開刺激材料授權，網站預設為正式研究模式；裝置與香港網絡仍需實測。請先使用試測模式，勿將「15分鐘目標」或圖片覆蓋數當作已驗證的統計檢定力。

## 參加流程
同意書 → 27張主圖與1次注意力測試 → 背景資料 → 研究解說 → 提交及自願抽獎。

- 使用 cloud-flow-stimuli-2026-10-20 的270張原始1024×1024灰階PNG，逐檔SHA-256核對。
- 每個主試次先輸入1–3個情緒詞，再為已辨認類別的固定三詞作五點配合評分。
- 以2026年11月4日pilot的100份完整回覆，按平均使用頻率選每組前三詞；所有完整問卷均保留。更新分析及30詞清單見 [pilot分析](research/pilot-20261104.md)。
- 未能可靠分類的輸入原文照存，不補猜類別。
- 注意力測試要求輸入2，並在全部評分選2。失敗答案仍保存，只標記分析。
- 抽獎資格：完整提交及通過注意力測試。20名得獎者各獲HK$200。每電話號碼只登記一次。
- 研究答案儲存於D1；抽獎電話獨立儲存於R2。GitHub repository不接收參加者答案或電話。

## 執行與部署
`docs/` 是可直接由GitHub Pages發佈的靜態前端。將Pages來源設定為main分支的/docs。
後端為Vinext/Cloudflare Worker，使用Sites提供的D1、R2及研究人員登入。
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
