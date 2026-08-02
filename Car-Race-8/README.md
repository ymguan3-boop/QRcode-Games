# 8字型賽道 - 賽車著色競賽

QR Code 互動遊戲：玩家用手機掃碼，為頂視賽車著色，送出後賽車即駛入大螢幕的 8 字型賽道競速。

- 大螢幕：`index.html`（8 字型白天賽道場景 + GSAP MotionPath 競速）
- 手機：`mobile.html`（Canvas 著色 + 像素級車體遮罩裁切 + Ably 送車）
- 通訊：Ably Realtime（WSS 443，可穿透公司/5G 防火牆）

## 架構

```
┌──────────────────────┐   QR Code 含 ?room=race-xxxx   ┌──────────────────────┐
│ 大螢幕 index.html      │ ◀──────────────────────────▶ │ 手機 mobile.html      │
│ Ably host             │   channel: carrace-<room>     │ Ably player           │
│ 8字型賽道場景           │   message: car / ack          │ 6 款交通工具遮罩著色    │
│ GSAP MotionPath 競速   │                              │ 送出縮小版 Base64 PNG  │
└──────────────────────┘                              └──────────────────────┘
```

## 本機測試

```bash
npx serve . -l 3000
```

大螢幕：`http://localhost:3000/index.html`
手機（模擬掃碼）：`http://localhost:3000/mobile.html?room=<房號>`
房號以 `window.__roomId` 取得。

自動發車測試：`http://localhost:3000/index.html?demo=1`（每隔幾秒自動生成一台彩車）。

## 部署 GitHub Pages

本專案為 `QRcode-Games` 儲存庫的子遊戲（`Car-Race-8/`），推送 `main` 後由根目錄 workflow 自動部署：
`https://<帳號>.github.io/QRcode-Games/Car-Race-8/`

## 競賽規則

- 每台車隨機速度跑 1 圈，到達終點即淡出消失
- 不顯示排名
- 手機可選擇 6 款交通工具（機車 / 跑車1~5），分類影響行駛音效與大螢幕上的車身大小
- 每台車隨機分配一條橫向偏移車道，路線多樣化
- 起跑區為 F1 風格：交錯格位 P1~P5 + 五燈式發車燈 + 終點棋盤線
- 賽道同時最多 12 台車，超過時移除最舊車輛（防記憶體堆積）
- 完賽車輛淡出並 GC（`gsap.kill()` + 移除 DOM）
- 玩家離開繪畫頁時自動離線，大螢幕玩家數即時更新（每 3 秒同步）

## 自訂

| 項目 | 位置 |
|------|------|
| 交通工具輪廓遮罩 | `assets/mask-moto1.png`（機車）、`assets/mask-sport4.png` / `mask-sport5.png` / `mask-sport6.png` / `mask-sport7.png` / `mask-sport8.png`（跑車1~5） |
| 圈數 / 速度 / 上限 | `js/main-screen.js` 的 `RACE` 設定 |
| 賽道大小 | `js/main-screen.js` 的 `TRACK` 設定 |
| 車款尺寸 / 車道偏移 | `js/main-screen.js` 的 `CAR` / `ROUTES` |
| 行駛音效（3 種分類音色） | `js/main-screen.js` 的 `TIMBRE_BASE` |
| 手機調色盤 | `js/mobile.js` 的 `buildPalette()` |
| 手機車款清單 | `js/mobile.js` 的 `CAR_TYPES` |

Ably Key 位於 `js/main-screen.js` 與 `js/mobile.js` 的 `ABLY_KEY`（兩端需一致）。
