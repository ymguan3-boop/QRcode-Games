# 🏁 Flower 1 世界賽（8 字型賽道賽車著色競賽）

QR Code 互動遊戲：玩家用手機掃碼，為頂視賽車著色，送出後賽車即駛入大螢幕的 8 字型賽道競速。

## ▶️ 立即遊玩

| 端點 | 網址 |
|------|------|
| 大螢幕 | https://ymguan3-boop.github.io/QRcode-Games/Car-Race-8/ |
| 大螢幕自動發車（Demo） | https://ymguan3-boop.github.io/QRcode-Games/Car-Race-8/?demo=1 |
| 手機繪圖板（掃 QR 後自動帶入房號） | `mobile.html?room=<房號>`（由大螢幕 QR 產生） |

玩法：大螢幕開啟後會顯示 QR Code → 手機掃碼進入繪圖板 → 選車款、著色 → 送出 → 賽車立刻在大螢幕起跑線就位並奔馳 1 圈。

## 系統總覽

- 大螢幕：`index.html`（8 字型白天賽道場景 + GSAP MotionPath 競速）
- 手機：`mobile.html`（Canvas 著色 + 像素級車體遮罩裁切 + Ably 送車）
- 通訊：Ably Realtime（WSS 443，可穿透公司/5G 防火牆）
- 動畫：GSAP + MotionPathPlugin（頂視車沿路徑法向量偏移行駛）
- 音效：Web Audio API 即時合成引擎聲（無音檔，3 種分類音色）

## 架構

```
┌──────────────────────┐   QR Code 含 ?room=race-xxxx   ┌──────────────────────┐
│ 大螢幕 index.html      │ ◀──────────────────────────▶ │ 手機 mobile.html      │
│ Ably host             │   channel: carrace-<room>     │ Ably player           │
│ 8字型賽道場景           │   message: car / ack          │ 6 款交通工具遮罩著色    │
│ GSAP MotionPath 競速   │   presence: screen / player    │ 送出縮小版 Base64 PNG  │
└──────────────────────┘                              └──────────────────────┘
```

### 通訊流程

1. 大螢幕開啟 `index.html` → 隨機產生房間代號 `room` → 加入 `carrace-<room>` channel 的 presence（`screen`）
2. 大螢幕用 QRCode.js 產生 QR（內容為 `mobile.html?room=<房號>`）
3. 手機掃碼 → 用 `clientId: player-xxxxxx` 連線 → presence 進入（`player`）
4. 手機畫完車 → publish `car`（含 Base64 PNG + 車款 `carType`）
5. 大螢幕收到 → `spawnCar()` → 回覆 `ack` 讓手機顯示「賽車已上賽道」
6. 大螢幕關閉/重整 → 立即 leave presence → 手機偵測到大螢幕離線並跳出提示

### 資料流細節

- 房號：`location.search.get('room')`；無參數時隨機 `Math.random().toString(36).slice(2,7)`
- Channel：`carrace-<room>`
- 手機送出圖片：drawCanvas → 縮小至 240×OUT_H → 遮罩裁切 → 疊線稿 → `toDataURL('image/png')` → publish
- 大螢幕收到圖片 → 直接作為 SVG `<image>` 內容（不需再載入遮罩）
- Demo 模式（`?demo=1`）不傳圖，直接用內建遮罩 PNG 生成車輛

## 競賽規則

- 每台車隨機速度跑 1 圈，到達終點即淡出消失（不顯示排名）
- 手機可選擇 6 款交通工具（機車 / 跑車1~5），分類影響行駛音效與大螢幕上的車身大小
- 每台車隨機分配一條橫向偏移車道（3 種路線 × 多車道），路線多樣化
- 起跑區為 F1 風格：交錯格位 P1~P5 + 五燈式發車燈 + 終點棋盤線
- 賽道同時最多 12 台車，超過時優先移除 demo 車（全為玩家車時移除最舊者）
- 完賽車輛 `gsap.kill()` + 移除 DOM，防記憶體堆積
- 玩家離開繪畫頁時自動離線，大螢幕玩家數即時更新
- 連線規則：關閉或離開手機頁面即斷線；閒置 10 分鐘自動斷線；同時最多 10 位玩家

## 檔案結構

```
Car-Race-8/
├── index.html              大螢幕（SVG 場景 + 工具列 + QR）
├── mobile.html             手機繪圖板
├── 賽道2.png               賽道底圖（1502×1047，全畫面拉伸至 viewBox 1300×800）
├── css/
│   ├── main-screen.css      大螢幕工具列 / HUD / 音效全螢幕按鈕 / QR 樣式
│   └── mobile.css           手機深色主題 / 畫布 / 車庫 / 車款 / 色盤 / 工具列 / Modal
├── js/
│   ├── main-screen.js       大螢幕主程式（賽道 / 競速 / 音效 / Ably / QR / 全螢幕）
│   ├── mobile.js            手機主程式（著色 / 遮罩 / 送出 / 車庫 / 閒置斷線）
│   └── track-path.js        賽道中心點座標（1300×800 viewBox 座標）
├── vendor/                  gsap / MotionPathPlugin / ably / qrcode（CDN 備援）
└── assets/                  交通工具輪廓遮罩 PNG（619×1189）
```

## 大螢幕美術排版（index.html / main-screen.css）

- **場景**：`.stage` 全螢幕、`max-width:1600px`，SVG `viewBox="0 0 1300 800"` `preserveAspectRatio="xMidYMid meet"`
- **圖層順序**（由下而上）：天空漸層 → `賽道2.png`（`preserveAspectRatio="none"` 全畫面拉伸）→ 半透明路面疊加（`#c9a86a` 45%）→ 起跑棋盤線 → 賽車層
- **車體輪廓**：SVG filter `#carOutline`，三層 `feMorphology dilate`（0.19/0.13/0.06）疊黑色外框，讓玩家彩繪車在大螢幕上清楚可見
- **左側工具列**：`.toolbar` 浮動於左上（`position:absolute; top:14px; left:14px`），寬 128px、半透明毛玻璃（`backdrop-filter:blur(8px)`），含：標題、連線狀態徽章、賽道車輛數、玩家連線數、音效開關、QR 碼、全螢幕按鈕
- **配色**：天空藍背景、白色半透明卡片、漸層標題（藍→粉）、青/粉/黃/綠四色 HUD 點綴
- **字體**：Orbitron（數字/HUD）+ Noto Sans TC（中文），由 Google Fonts 載入
- **響應式**：`@media (max-width:1100px)` 縮小工具列與 QR

## 手機美術排版（mobile.html / mobile.css）

- **整體**：深色主題（`#070b1a` 底、`#131827` 卡片、青/粉/黃霓虹點綴），`max-width:520px` 居中，`100dvh` 直式
- **版面由上而下**：頂欄（標題 + 連線徽章）→ 畫布區（含車庫按鈕）→ 車款選擇 → 色盤 → 工具列（復原/清空/橡皮擦）→ 筆刷大小 → 送出按鈕 → 狀態訊息
- **畫布**：`619×1189`（長直式），三層 Canvas 堆疊：`guideCanvas`（灰白棋盤底 + 半透明車影導引）→ `drawCanvas`（著色層，crosshair 游標）→ `lineCanvas`（黑白輪廓線稿，置頂不攔觸控）
- **車庫**：左上角圓角按鈕，點開左側直立面板（132px 寬），最多存 3 台畫作（localStorage），可「直接送出」
- **車款選擇**：`.car-select` flex-wrap，每顆按鈕 `flex:1 1 calc(33.333% - 6px)` 三欄排列（6 款成兩排）；選中為黃→橙漸層 + 上浮
- **色盤**：20 色圓形色票（30px），選中放大 + 外圈發光
- **送出按鈕**：粉→紫→青三色漸層全寬大按鈕，未就緒時半透明禁用
- **Modal**：成功（再畫一台）與斷線（大螢幕離線/連線中斷/已滿）兩種，spring 彈出動畫
- **響應式**：`@media (max-height:700px)` 縮小色票與按鈕

## 車款與音色

| 車款 key | 顯示名稱 | 分類 cat | 大螢幕尺寸 (w×h) | 遮罩檔 |
|----------|----------|----------|-----------------|--------|
| `moto1`  | 機車     | motorcycle | 39×76  | `assets/mask-moto1.png`  |
| `sport4` | 跑車1    | sports    | 62×114 | `assets/mask-sport4.png` |
| `sport5` | 跑車2    | sports    | 64×116 | `assets/mask-sport5.png` |
| `sport6` | 跑車3    | sports    | 53×94  | `assets/mask-sport6.png` |
| `sport7` | 跑車4    | sports    | 62×114 | `assets/mask-sport7.png` |
| `sport8` | 跑車5    | sports    | 64×116 | `assets/mask-sport8.png` |

音效由 Web Audio 即時合成（`js/main-screen.js` 的 `TIMBRE_BASE`）：

| 分類 | 波形 | 基頻 | 低通 | 增益 | 脈衝 | 第二泛音 |
|------|------|------|------|------|------|----------|
| motorcycle | square  | 105 Hz | 1600 | 0.05 | 6    | ×1.5 |
| sports     | sawtooth | 68 Hz | 1000 | 0.06 | 4    | ×2 |

音高隨行駛進度(0→1)提升約 1.4 倍，營造加速感；多車同時發聲時以 DynamicsCompressor 防爆音。

## 自訂

| 項目 | 位置 |
|------|------|
| 交通工具輪廓遮罩 | `assets/mask-*.png`（619×1189，白底=可著色區、黑線=線稿） |
| 圈數 / 速度 / 上限 | `js/main-screen.js` 的 `RACE` 設定 |
| 賽道大小 | `js/main-screen.js` 的 `TRACK` 設定 |
| 車款尺寸 / 車道偏移 | `js/main-screen.js` 的 `CAR` / `ROUTES` |
| 行駛音效（3 種分類音色） | `js/main-screen.js` 的 `TIMBRE_BASE` |
| 賽道中心點座標 | `js/track-path.js` 的 `TRACK_PATH`（1300×800 viewBox 座標） |
| 手機調色盤 | `js/mobile.js` 的 `buildPalette()` |
| 手機車款清單 | `js/mobile.js` 的 `CAR_TYPES` |

Ably Key 位於 `js/main-screen.js` 與 `js/mobile.js` 的 `ABLY_KEY`（兩端需一致）。

## 本機測試

```bash
npx serve . -l 3000
```

- 大螢幕：`http://localhost:3000/index.html`
- 手機（模擬掃碼）：`http://localhost:3000/mobile.html?room=<房號>`
- 房號以大螢幕網址列 `?room=` 或 `window.__roomId` 取得
- 自動發車測試：`http://localhost:3000/index.html?demo=1`

## 部署 GitHub Pages

本專案為 `QRcode-Games` 儲存庫的子遊戲（`Car-Race-8/`），推送 `main` 後由根目錄 workflow 自動部署（GitHub Actions → actions/deploy-pages@v4）。

- 部署網址：https://ymguan3-boop.github.io/QRcode-Games/Car-Race-8/
- 修改任何 JS/CSS/HTML 後請同步更新各檔的 cache-bust 參數（如 `?v=16`），避免瀏覽器使用舊版快取。
