# 免費版：150 份完整問卷容量驗證

使用者要求只用免費服務，並以收集 150 份完整問卷為目標。新部署使用 Workers Free、研究 D1 及另一個獨立抽獎 D1，沒有 R2 訂閱或方案升級操作。實際帳戶仍須保持 Free。

執行 `node standalone/tests/capacity-150.test.mjs`，以本機 SQLite 模擬兩個 D1 綁定及真實 Worker API：

- 成功配置並提交 150 份完整正式模式問卷。
- 每份包含 27 個主試次及 1 個注意力試次，合計 4,200 試次。
- 主試次使用三個已辨認類別，每次 9 項評分；合計 36,900 項評分。
- 150 次相同提交重試後，仍只有 150 份研究紀錄。
- 270 張主圖各被評估 15 次；參與代碼及 session hash 均不重複。
- 試測及正式命名空間分隔；抽獎資料庫沒有研究資料表或參與者紀錄。

這個高評分數測試樣本的研究 JSON 為 2,689,840 bytes，SQLite 資料庫為 3,112,960 bytes，約 2.69 MB／3.11 MB。這不是所有答案長度的硬上限。

按 2026-11-09 核對的官方文件，D1 Free 提供每日 5 百萬列讀取、10 萬列寫入及帳戶總共 5 GB 儲存；Workers Free 為每日 10 萬請求。由問卷資料量看，150 份屬合理的免費方案目標。

本機模擬沒有量測真實 D1 計費列數、Workers CPU 時間、並行壓力或香港網絡。因此仍須完成真實部署、香港無 VPN 全流程及後端持久化驗證後才招募。免費額度耗盡可能中止請求，程式不會自動升級付費。

來源：[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)。
