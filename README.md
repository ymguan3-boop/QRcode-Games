# QRcode 互動遊戲集（QRcode-Games）

QR Code 互動遊戲的集合，全部採用「大螢幕展示 + 手機掃碼互動」架構，免費部署於 GitHub Pages。

> 架構與建置流程見技能 [QR-code-GameSkill](https://github.com/ymguan3-boop/QR-code-GameSkill)。

## 遊戲列表

| 遊戲 | 說明 | 立即遊玩 |
|------|------|----------|
| [AI 猜猜看](AI-Pictionary/) | 手機畫畫 → Gemini AI 猜測並評分 | https://ymguan3-boop.github.io/QRcode-Games/AI-Pictionary/ |

## 架構共通點

- **通訊**：Ably Realtime（WSS 443），可穿透公司/5G 防火牆
- **進房**：QRCode.js，QR 內含 `mobile.html?room=<房號>`
- **手機端**：Canvas 觸控互動，`pagehide` 主動離線
- **大螢幕**：presence 玩家列表、即時結果、自動 GC
- **部署**：push `main` → GitHub Actions 自動部署到 GitHub Pages

## 新增遊戲

1. 依 [QR-code-GameSkill](https://github.com/ymguan3-boop/QR-code-GameSkill) 建立遊戲於新資料夾（如 `AI-Pictionary/`）。
2. 更新本表與根目錄 `index.html`。
3. push `main` 即自動部署。
