# AI 猜猜看（AI Pictionary）互動繪畫遊戲

> 大螢幕投影 + 手機掃碼畫畫，Google Gemini AI 即時猜測你的畫作並幽默點評、評分。
> 全靜態、免後端，透過 **Ably Realtime（WSS 443）** 中繼，可穿透公司網路與電信 5G 防火牆。

**▶ 立即遊玩**：https://ymguan3-boop.github.io/QRcode-Games/AI-Pictionary/

（本專案為「QRcode-Games 互動遊戲集」的一員，完整遊戲程式碼位於 `AI-Pictionary/` 資料夾內。）

---

## 遊玩方式

1. **打開大螢幕頁面**（上述網址）。
2. **輸入 Gemini API Key**：在左側「Gemini API 設定」貼上你的 Key 並按「儲存」（只存本機瀏覽器，每次開啟自動載入）。
   - 免費申請：https://aistudio.google.com/apikey
3. **手機掃描 QR Code**：大螢幕左側的 QR Code 內含房間代號，手機掃描後自動進入畫板並連線。
4. **畫出你的創意**：手機畫板支援畫筆、橡皮擦、復原、清除、8 色、筆刷粗細。
5. **送出畫作**：按「送出畫作給 AI 猜」，畫作即時傳到大螢幕。
6. **AI 主持人**：大螢幕收到畫作後呼叫 Gemini AI，猜測你畫的是什麼、評分（1~100），並幽默點評。

### 遊玩規則
- 每幅畫作顯示 **30 秒**後自動淡出消失。
- 大螢幕最多同時顯示 **6 幅**畫作，超過時自動移除最舊一幅。
- 畫作送出後 10 秒內需先設定 Gemini API Key，否則 AI 無法猜測（可設定後重送）。

---

## 系統架構

```
┌──────────────────────────────────┐        QR Code 內含           ┌────────────────────────────┐
│  大螢幕 index.html（Host）         │     ?room=pic-xxxxxx           │  手機 mobile.html（Player）  │
│  ┌────────────────────────────┐  │   ◄──────────────────────►   │  ┌────────────────────────┐  │
│  │ QRCode.js 產生進房 QR       │  │   Ably Realtime WSS:443       │  │ Canvas 觸控繪圖          │  │
│  │ Ably presence: host         │  │   channel: pictionary-<room> │  │ Ably presence: player    │  │
│  │ 訂閱 drawing / 回覆 ack      │  │                              │  │ 送出 Base64 PNG          │  │
│  │ Gemini AI 自動猜測 + 評分     │  │                              │  │ pagehide 主動離開        │  │
│  │ 畫廊 + 30 秒自動 GC           │  │                              │  └────────────────────────┘  │
│  └────────────────────────────┘  │                              │                            │
└──────────────────────────────────┘                              └────────────────────────────┘
```

### 模組清單

| 檔案 | 角色 | 技術 |
|------|------|------|
| `index.html` | 大螢幕展示 | QR 容器、玩家列表、Gemini 設定、畫廊、遊玩方式 |
| `mobile.html` | 手機畫板 | 觸控 Canvas、工具列、送出按鈕 |
| `js/main-screen.js` | Host 邏輯 | Ably 接收、Gemini 呼叫、畫作 GC（30s/6幅） |
| `js/mobile.js` | Player 邏輯 | Ably 發送、Canvas 繪圖、離開清理 |
| `css/main-screen.css` | 大螢幕樣式 | 深色科技風、響應式網格 |
| `css/mobile.css` | 手機樣式 | 觸控最佳化、safe-area |
| `vendor/ably.min.js` | 通訊庫 | WSS 443 中繼（穿透防火牆關鍵） |
| `vendor/qrcode.min.js` | QR 產生 | 內含進房網址與房號 |

### 通訊流程

1. **建房**：大螢幕隨機產生 `roomId = 'pic-'+6位亂數` → QR Code 內容 `mobile.html?room=pic-xxxxxx`。
2. **連線**：大螢幕 `new Ably.Realtime({ key, clientId:'host-xxx' })` → `presence.enter('host')` → 狀態「等待玩家加入」。
3. **進房**：手機掃 QR → 同樣建立 Ably 連線 → `presence.enter('player')` → 大螢幕列表即時更新為「1 位玩家連線中」。
4. **送出**：手機 `canvas.toDataURL('image/png')` → `channel.publish('drawing', base64)`。
5. **接收**：大螢幕訂閱 `drawing` → 建卡片進畫廊 → 回 `publish('ack',{id})` → 呼叫 Gemini。
6. **AI 猜測**：Gemini 多模態模型（`gemini-3.5-flash`）看圖猜測，回應解析出答案/評分/點評後顯示。
7. **離開**：手機 `pagehide`/`beforeunload` → `presence.leave()` + `ably.close()` → 大螢幕列表即時清空。

---

## 技術細節

### 通訊層選型（成功關鍵）
| 方案 | 結果 | 原因 |
|------|------|------|
| PeerJS (WebRTC P2P) | ❌ | signaling / ICE 被公司與 5G 防火牆阻擋，卡「連線中」 |
| 公共 MQTT broker | ❌ | 非 443 埠被封，逾時/403 |
| **Ably Realtime（WSS 443）** | ✅ | 與 HTTPS 同埠，實測穿透 |

### Gemini AI 整合
- 模型：`gemini-3.5-flash`（2026 年 5 月 Google I/O 後免費預設，支援圖片，60 RPM）。
- 呼叫：`POST /v1beta/models/gemini-3.5-flash:generateContent?key=<KEY>`，body 含圖片 Base64。
- 提示詞要求：猜答案 + 相似度評分（1~100）+ 100 字內幽默點評，以「答案：/評分：」格式回傳。
- 大螢幕用正規式解析回應，並 `escapeHtml` 後渲染，防止注入。

### 記憶體管理
- 每幅畫作 30 秒後淡出（opacity 0 + scale 0.8，500ms 後移除 DOM）。
- 超過 6 幅自動移除最舊卡片。
- 手機復原歷史上限 20 步。

### 部署
- `.github/workflows/deploy.yml`：push `main` → GitHub Actions 自動部署。
- 部署網址：`https://ymguan3-boop.github.io/QRcode-Games/AI-Pictionary/`。
- 資源帶 `?v=N` 版本號防 CDN 快取舊碼。

---

## 本機測試

```bash
# 於 AI-Pictionary 資料夾內
npx serve . -l 3000
# 或
python -m http.server 3000
```
開啟 `http://localhost:3000`，手機掃 QR 即可測試。

---

## 金鑰設定

### Gemini API Key（大螢幕 AI 主持）
1. 前往 https://aistudio.google.com/apikey 免費申請。
2. 大螢幕左側輸入 Key → 儲存（存 localStorage）。

### Ably API Key（通訊中繼，開發者設定）
1. 前往 https://ably.com/signup 免費註冊（每月 75 萬則訊息）。
2. 建立 App → API Keys 頁籤複製 Key。
3. 填入 `js/main-screen.js` 與 `js/mobile.js` 的 `ABLY_KEY` 常數。

---

## 常見問題

| 症狀 | 解法 |
|------|------|
| 手機一直「連線中」 | 確認 Ably Key 已填入；確認網路可連 `wss://realtime.ably.io` |
| 畫廊顯示「請設定 Gemini API Key」 | 大螢幕左側輸入 API Key 並儲存 |
| 改版後手機跑舊碼 | 遞增所有資源 `?v=N` 版本號 |
| 玩家離開列表沒清空 | 確認手機端 pagehide/beforeunload handler 有 `presence.leave()` |

---

## 授權
MIT License — 自由使用、修改、商用。
