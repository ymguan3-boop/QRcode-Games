(function () {
  'use strict';

  const CANVAS_W = 619;
  const CANVAS_H = 1189;

  const CAR_TYPES = {
    bike1:  { label: '腳踏車', cat: 'bicycle',    src: 'assets/mask-bike1.png'  },
    moto1:  { label: '機車1',   cat: 'motorcycle', src: 'assets/mask-moto1.png'  },
    moto2:  { label: '機車2',   cat: 'motorcycle', src: 'assets/mask-moto2.png'  },
    sport4: { label: '跑車4',   cat: 'sports',     src: 'assets/mask-sport4.png' },
    sport5: { label: '跑車5',   cat: 'sports',     src: 'assets/mask-sport5.png' },
    sport6: { label: '跑車6',   cat: 'sports',     src: 'assets/mask-sport6.png' }
  };

  const ABLY_KEY = 'XGHDcg.6rIvFg:As3RE8ShoT67QAg1O2GoyRSN50RosUlk5Yfwo4eJkBc';
  const channelName = function (room) { return 'carrace-' + room; };

  const IDLE_LIMIT_MS = 10 * 60 * 1000;   // 閒置 10 分鐘強制斷線
  const MAX_PLAYERS = 10;                 // 同時最大連線玩家數
  const GARAGE_KEY = 'carrace-garage';    // 車庫 localStorage key
  const GARAGE_MAX = 3;                   // 車庫最多 3 台，新車取代最舊

  const guideCanvas = document.getElementById('guideCanvas');
  const drawCanvas = document.getElementById('drawCanvas');
  const lineCanvas = document.getElementById('lineCanvas');
  const canvasBox = document.getElementById('canvasBox');
  const guideCtx = guideCanvas.getContext('2d');
  const drawCtx = drawCanvas.getContext('2d');
  const lineCtx = lineCanvas.getContext('2d');

  guideCanvas.width = CANVAS_W;
  guideCanvas.height = CANVAS_H;
  drawCanvas.width = CANVAS_W;
  drawCanvas.height = CANVAS_H;
  lineCanvas.width = CANVAS_W;
  lineCanvas.height = CANVAS_H;

  const el = {
    connBadge: document.getElementById('connBadge'),
    carSelect: document.getElementById('carSelect'),
    palette: document.getElementById('palette'),
    undoBtn: document.getElementById('undoBtn'),
    clearBtn: document.getElementById('clearBtn'),
    eraserBtn: document.getElementById('eraserBtn'),
    sizeSlider: document.getElementById('sizeSlider'),
    sizeDisplay: document.getElementById('sizeDisplay'),
    submitBtn: document.getElementById('submitBtn'),
    statusMsg: document.getElementById('statusMsg'),
    successModal: document.getElementById('successModal'),
    againBtn: document.getElementById('againBtn'),
    garageToggle: document.getElementById('garageToggle'),
    garageSection: document.getElementById('garageSection'),
    garageList: document.getElementById('garageList'),
    disconnectModal: document.getElementById('disconnectModal'),
    discTitle: document.getElementById('discTitle'),
    discText: document.getElementById('discText'),
    discOkBtn: document.getElementById('discOkBtn')
  };

  let ably = null;
  let channel = null;
  let isConnected = false;
  let roomId = '';
  let myClientId = 'player-' + Math.random().toString(36).substring(2, 8);
  let screenOnline = false;
  let wasScreenOnline = false;
  let roomFull = false;
  let enteredPresence = false;
  let ackSubscribed = false;
  let lastSentId = null;
  let idleTimer = null;
  let garage = [];

  let maskImageData = null;
  let maskColorable = null;
  let maskLoaded = false;
  let maskLoadToken = 0;
  let currentCarType = 'bike1';
  let isDrawing = false;
  let lastPoint = null;
  let tool = 'brush';
  let color = '#00e5ff';
  let brushSize = 12;
  let history = [];
  let hasDrawing = false;

  /* ═══════════ 閒置計時（10 分鐘無操作強制斷線） ═══════════ */
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(forceIdleDisconnect, IDLE_LIMIT_MS);
  }
  function stopIdle() { clearTimeout(idleTimer); idleTimer = null; }
  function forceIdleDisconnect() {
    stopIdle();
    try { if (channel && channel.presence) channel.presence.leave(); } catch (_) {}
    try { if (ably) ably.close(); } catch (_) {}
    isConnected = false;
    enteredPresence = false;
    channel = null;
    setConnected(false);
    updateSubmitBtn();
    showDisconnectModal('連線已中斷', '連線閒置超過 10 分鐘，已自動斷線。請重新整理頁面即可重新連線，繼續送出你的賽車。');
  }
  function bindIdleReset() {
    ['pointerdown', 'pointermove', 'pointerup', 'click', 'input'].forEach(function (evt) {
      document.addEventListener(evt, function () { if (isConnected) resetIdle(); }, true);
    });
  }

  /* ═══════════ 遮罩載入（頂視車輪廓） ═══════════ */
  function maskSrc() {
    return (CAR_TYPES[currentCarType] || CAR_TYPES.bike1).src;
  }

  function loadMask(type) {
    currentCarType = type || currentCarType;
    const token = ++maskLoadToken;
    maskLoaded = false;
    const maskImg = new Image();
    maskImg.onload = function () {
      if (token !== maskLoadToken) return;
      const offscreen = document.createElement('canvas');
      offscreen.width = CANVAS_W;
      offscreen.height = CANVAS_H;
      const offCtx = offscreen.getContext('2d');
      offCtx.drawImage(maskImg, 0, 0, CANVAS_W, CANVAS_H);
      maskImageData = offCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      computeColorable(maskImageData);
      drawLineArt();
      maskLoaded = true;

      drawGuide();
      drawCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      history = [];
      saveState();
      hasDrawing = false;
      updateSubmitBtn();
      setMsg('開始幫賽車上色吧！', 'ok');
    };
    maskImg.onerror = function () {
      if (token !== maskLoadToken) return;
      setMsg('讀取賽車模型失敗，請重新整理', 'err');
    };
    maskImg.src = maskSrc();
  }

  /* 計算可著色區（白色車體內部），其餘為線條/外框不可著色 */
  function computeColorable(imgData) {
    const data = imgData.data;
    maskColorable = new Uint8Array(CANVAS_W * CANVAS_H);
    for (let i = 0, p = 0; p < data.length; p += 4, i++) {
      const a = data[p + 3];
      const r = data[p], g = data[p + 1], b = data[p + 2];
      if (a >= 128 && r >= 200 && g >= 200 && b >= 200) {
        maskColorable[i] = 1;
      }
    }
  }

  /* 黑白線稿最上層：保留外框輪廓與內部黑線 */
  function drawLineArt() {
    if (!maskImageData) return;
    lineCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const data = maskImageData.data;
    const out = lineCtx.createImageData(CANVAS_W, CANVAS_H);
    const od = out.data;
    for (let p = 0; p < data.length; p += 4) {
      const a = data[p + 3];
      if (a < 128) continue;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const lum = (r + g + b) / 3;
      if (lum < 160) {
        od[p] = 0; od[p + 1] = 0; od[p + 2] = 0; od[p + 3] = 255;
      }
    }
    lineCtx.putImageData(out, 0, 0);
  }

  function drawGuide() {
    guideCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawCheckeredBackground(guideCtx);

    const maskImg = new Image();
    maskImg.onload = function () {
      guideCtx.save();
      guideCtx.globalAlpha = 0.32;
      guideCtx.drawImage(maskImg, 0, 0, CANVAS_W, CANVAS_H);
      guideCtx.restore();
    };
    maskImg.src = maskSrc();
  }

  function drawCheckeredBackground(ctx) {
    const size = 14;
    ctx.save();
    for (let y = 0; y < CANVAS_H; y += size) {
      for (let x = 0; x < CANVAS_W; x += size) {
        ctx.fillStyle = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0 ? '#d7dbe6' : '#f2f4f8';
        ctx.fillRect(x, y, size, size);
      }
    }
    ctx.restore();
  }

  /* ═══════════ 畫布縮放 ═══════════ */
  function fitCanvas() {
    const wrap = document.querySelector('.canvas-wrap');
    const availW = wrap.clientWidth - 16;
    const availH = wrap.clientHeight - 16;
    const scale = Math.min(availW / CANVAS_W, availH / CANVAS_H);
    canvasBox.style.width = (CANVAS_W * scale) + 'px';
    canvasBox.style.height = (CANVAS_H * scale) + 'px';
  }

  /* ═══════════ 繪圖 ═══════════ */
  function getPos(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (CANVAS_W / rect.width),
      y: (clientY - rect.top) * (CANVAS_H / rect.height)
    };
  }

  function startDraw(e) {
    e.preventDefault();
    if (!maskLoaded) return;
    try { drawCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    isDrawing = true;
    lastPoint = getPos(e);
    saveState();
    drawCtx.save();
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.lineWidth = brushSize;
    drawCtx.strokeStyle = tool === 'eraser' ? '#000000' : color;
    drawCtx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    drawCtx.beginPath();
    drawCtx.arc(lastPoint.x, lastPoint.y, brushSize / 2, 0, Math.PI * 2);
    drawCtx.fill();
  }

  function moveDraw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pt = getPos(e);
    drawCtx.beginPath();
    drawCtx.moveTo(lastPoint.x, lastPoint.y);
    drawCtx.lineTo(pt.x, pt.y);
    drawCtx.stroke();
    lastPoint = pt;
  }

  function endDraw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    isDrawing = false;
    lastPoint = null;
    drawCtx.restore();
    applyMaskInPlace();
    hasDrawing = hasRealDrawing();
    saveState();
    updateSubmitBtn();
  }

  /* 像素級遮罩裁切：只保留白色車體區域內的筆觸 */
  function applyMaskInPlace() {
    if (!maskColorable) return;
    const imageData = drawCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const pixels = imageData.data;
    for (let i = 0, p = 3; i < CANVAS_W * CANVAS_H; i++, p += 4) {
      if (!maskColorable[i]) pixels[p] = 0;
    }
    drawCtx.putImageData(imageData, 0, 0);
  }

  function hasRealDrawing() {
    if (!maskLoaded) return false;
    const d = drawCtx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] !== 0) return true;
    }
    return false;
  }

  /* ═══════════ 復原 / 清空 ═══════════ */
  function saveState() {
    history.push(drawCtx.getImageData(0, 0, CANVAS_W, CANVAS_H));
    if (history.length > 20) history.shift();
    el.undoBtn.disabled = history.length <= 1;
  }

  function undo() {
    if (history.length <= 1) return;
    history.pop();
    drawCtx.putImageData(history[history.length - 1], 0, 0);
    hasDrawing = hasRealDrawing();
    el.undoBtn.disabled = history.length <= 1;
    updateSubmitBtn();
  }

  function clearCanvas() {
    drawCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    history = [];
    hasDrawing = false;
    saveState();
    updateSubmitBtn();
    setMsg('畫布已清空');
  }

  /* ═══════════ UI 狀態 ═══════════ */
  function updateSubmitBtn() {
    const canSend = isConnected && hasDrawing && screenOnline && !roomFull && maskLoaded;
    el.submitBtn.disabled = !canSend;
    el.submitBtn.innerHTML = '&#128663; 送出賽車去比賽';
  }

  function setMsg(text, type) {
    el.statusMsg.textContent = text;
    el.statusMsg.className = 'status-msg' + (type ? ' ' + type : '');
  }

  function setConnected(online) {
    isConnected = online;
    if (!online) {
      el.connBadge.textContent = '連線中';
      el.connBadge.className = 'conn-badge offline';
    } else {
      updateScreenBadge();
    }
    updateSubmitBtn();
  }

  function updateScreenBadge() {
    if (!isConnected) return;
    if (roomFull) {
      el.connBadge.textContent = '已滿(' + MAX_PLAYERS + ')';
      el.connBadge.className = 'conn-badge offline';
    } else if (screenOnline) {
      el.connBadge.textContent = '已連線';
      el.connBadge.className = 'conn-badge online';
    } else {
      el.connBadge.textContent = '大螢幕離線';
      el.connBadge.className = 'conn-badge offline';
    }
  }

  function showDisconnectModal(title, text) {
    if (el.discTitle) el.discTitle.textContent = title;
    if (el.discText) el.discText.textContent = text;
    el.disconnectModal.classList.remove('hidden');
  }

  function hideDisconnectModal() {
    el.disconnectModal.classList.add('hidden');
  }

  /* ═══════════ Ably 連線 ═══════════ */
  function connectAbly(room) {
    roomId = room;

    if (!ABLY_KEY || ABLY_KEY.indexOf('PASTE_') === 0) {
      setMsg('連線服務未設定，請聯絡主辦單位', 'err');
      setConnected(false);
      return;
    }

    try {
      ably = new Ably.Realtime({
        key: ABLY_KEY,
        clientId: myClientId,
        transportParams: { maxMessageSize: 500000 }
      });
    } catch (err) {
      setMsg('連線模組載入失敗，請重新整理', 'err');
      setConnected(false);
      console.error('[ably] init error:', err);
      return;
    }

    ably.connection.on('connected', function () {
      isConnected = true;
      if (!channel) channel = ably.channels.get(channelName(room));
      if (!ackSubscribed) {
        ackSubscribed = true;
        channel.subscribe('ack', function (msg) {
          if (msg.data && msg.data.id && msg.data.id === lastSentId) {
            setMsg('賽車已上賽道，準備出發！', 'ok');
          }
        });
      }
      channel.presence.subscribe(function () { updateScreenState(); });
      enteredPresence = false;
      tryEnterPresence();
      updateScreenState();
      resetIdle();
      updateSubmitBtn();
      setMsg(maskLoaded ? '已連線，開始上色吧！' : '連線中，載入賽車模型...', 'ok');
    });

    ably.connection.on('failed', function (err) {
      setConnected(false);
      setMsg('連線失敗，請確認大螢幕已開啟後重新整理', 'err');
      console.error('[ably] connection failed:', err);
    });

    ably.connection.on('suspended', function () {
      setConnected(false);
      setMsg('連線不穩，嘗試重新連線中...', 'err');
    });

    ably.connection.on('disconnected', function () {
      setConnected(false);
      screenOnline = false;
      // Ably 會自動重連，不需關閉
      setMsg('連線中斷，嘗試重新連線中...', 'err');
    });

    // 僅在真正關閉頁面時中斷（不再於切換背景/鎖屏時斷線）
    window.addEventListener('beforeunload', function () { leavePresence(); });
  }

  function tryEnterPresence() {
    if (!channel || enteredPresence || !isConnected) return;
    channel.presence.get(function (err, members) {
      if (err) return;
      const others = (members || []).filter(function (m) {
        return m.clientId && m.clientId.startsWith('player-') && m.clientId !== myClientId;
      });
      if (others.length >= MAX_PLAYERS) {
        roomFull = true;
        updateScreenBadge();
        setMsg('連線玩家已滿（' + MAX_PLAYERS + '人），請稍後再試', 'err');
        setTimeout(tryEnterPresence, 5000);
        updateSubmitBtn();
        return;
      }
      roomFull = false;
      channel.presence.enter('player');
      enteredPresence = true;
      updateScreenBadge();
      updateSubmitBtn();
    });
  }

  function updateScreenState() {
    if (!channel) return;
    channel.presence.get(function (err, members) {
      if (err) return;
      const screen = (members || []).filter(function (m) {
        return m.clientId && m.clientId.startsWith('screen-');
      });
      screenOnline = screen.length > 0;
      if (wasScreenOnline && !screenOnline) {
        // 大螢幕離線提示（僅轉態時提醒一次）
        showDisconnectModal('大螢幕已離線', '已無法確認大螢幕在線，此時送出可能無法顯示。請確認大螢幕已開啟，再重新送出。');
      } else if (!wasScreenOnline && screenOnline) {
        // 大螢幕恢復在線時自動關閉提示
        hideDisconnectModal();
      }
      wasScreenOnline = screenOnline;
      updateScreenBadge();
      updateSubmitBtn();
    });
  }

  function leavePresence() {
    stopIdle();
    try { if (channel && channel.presence) channel.presence.leave(); } catch (_) {}
    try { if (ably) ably.close(); } catch (_) {}
  }

  /* ═══════════ 送出賽車 ═══════════ */
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  }

  function submitCar() {
    if (!isConnected || !hasDrawing || !maskLoaded) {
      setMsg('尚未連線或無繪圖內容', 'err');
      return;
    }
    if (!channel) return;
    if (!screenOnline) {
      setMsg('大螢幕未連線，請確認大螢幕已開啟', 'err');
      return;
    }
    if (roomFull) {
      setMsg('連線玩家已滿（' + MAX_PLAYERS + '人），請稍後再試', 'err');
      return;
    }
    el.submitBtn.disabled = true;
    el.submitBtn.innerHTML = '傳送中...';

    try {
      const OUT_W = 240;
      const OUT_H = Math.round(CANVAS_H * OUT_W / CANVAS_W);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = OUT_W;
      tempCanvas.height = OUT_H;
      const tCtx = tempCanvas.getContext('2d');
      tCtx.drawImage(drawCanvas, 0, 0, OUT_W, OUT_H);
      applyMaskToScaled(tCtx, OUT_W, OUT_H);
      tCtx.drawImage(lineCanvas, 0, 0, OUT_W, OUT_H);

      const base64 = tempCanvas.toDataURL('image/png');
      const msgId = genId();
      lastSentId = msgId;
      channel.publish('car', { id: msgId, imageData: base64, carType: currentCarType }, function (err) {
        if (err) {
          setMsg('傳送失敗，請重試', 'err');
          console.error('[submit] publish error:', err);
          updateSubmitBtn();
          return;
        }
        addToGarage(base64, currentCarType);
        showSuccess();
        clearCanvas();
        updateSubmitBtn();
      });
    } catch (err) {
      console.error('[submit] error:', err);
      setMsg('傳送失敗，請重試', 'err');
      updateSubmitBtn();
    }
  }

  function applyMaskToScaled(ctx, w, h) {
    if (!maskImageData) return;
    const sW = CANVAS_W / w;
    const sH = CANVAS_H / h;
    const imageData = ctx.getImageData(0, 0, w, h);
    const pixels = imageData.data;
    const mask = maskImageData.data;
    const mW = CANVAS_W;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(CANVAS_H - 1, Math.floor(y * sH));
      const rowBase = sy * mW * 4;
      for (let x = 0; x < w; x++) {
        const sx = Math.min(mW - 1, Math.floor(x * sW));
        const idx = (y * w + x) * 4;
        if (mask[rowBase + sx * 4 + 3] < 128) pixels[idx + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /* ═══════════ 車庫（最多 3 台，新車取代最舊） ═══════════ */
  function loadGarage() {
    try {
      const raw = localStorage.getItem(GARAGE_KEY);
      garage = raw ? JSON.parse(raw) : [];
    } catch (_) { garage = []; }
    if (!Array.isArray(garage)) garage = [];
    renderGarage();
  }

  function saveGarage() {
    try { localStorage.setItem(GARAGE_KEY, JSON.stringify(garage)); } catch (_) {}
  }

  function addToGarage(imageData, carType) {
    garage.push({ imageData: imageData, carType: carType, ts: Date.now() });
    while (garage.length > GARAGE_MAX) garage.shift();
    saveGarage();
    renderGarage();
  }

  function sendGarageCar(item) {
    if (!isConnected || !channel) { setMsg('尚未連線，無法送出', 'err'); return; }
    if (!screenOnline) { setMsg('大螢幕未連線，請確認大螢幕已開啟', 'err'); return; }
    if (roomFull) { setMsg('連線玩家已滿（' + MAX_PLAYERS + '人），請稍後再試', 'err'); return; }

    const msgId = genId();
    lastSentId = msgId;
    channel.publish('car', { id: msgId, imageData: item.imageData, carType: item.carType }, function (err) {
      if (err) {
        setMsg('傳送失敗，請重試', 'err');
        console.error('[garage] publish error:', err);
        return;
      }
      setMsg('車庫賽車已送出！', 'ok');
    });
    showSuccess();
  }

  function toggleGarage() {
    const open = el.garageSection.classList.toggle('open');
    el.garageToggle.classList.toggle('active', open);
    if (open) renderGarage();
  }

  function renderGarage() {
    if (!el.garageList) return;
    el.garageList.innerHTML = '';
    if (!garage.length) {
      const empty = document.createElement('div');
      empty.className = 'garage-empty';
      empty.textContent = '尚無畫作，送出後自動存入車庫（最多 3 台）';
      el.garageList.appendChild(empty);
      return;
    }
    garage.forEach(function (item, i) {
      const card = document.createElement('div');
      card.className = 'garage-card';

      const img = document.createElement('img');
      img.src = item.imageData;
      img.alt = '車庫' + (i + 1);
      card.appendChild(img);

      const meta = document.createElement('div');
      meta.className = 'garage-meta';
      meta.textContent = (CAR_TYPES[item.carType] || { label: '賽車' }).label + ' · ' + (i + 1);
      card.appendChild(meta);

      const sendBtn = document.createElement('button');
      sendBtn.className = 'garage-send';
      sendBtn.textContent = '直接送出';
      sendBtn.addEventListener('click', function () {
        sendGarageCar(item);
        resetIdle();
      });
      card.appendChild(sendBtn);

      el.garageList.appendChild(card);
    });
  }

  function showSuccess() {
    el.successModal.classList.remove('hidden');
  }

  function hideSuccess() {
    el.successModal.classList.add('hidden');
    setMsg('再畫一台新賽車吧！');
  }

  /* ═══════════ 車款選擇 ═══════════ */
  function buildCarSelect() {
    Object.keys(CAR_TYPES).forEach(function (key, i) {
      const btn = document.createElement('button');
      btn.className = 'car-type-btn' + (key === currentCarType ? ' active' : '');
      btn.textContent = CAR_TYPES[key].label;
      btn.addEventListener('click', function () {
        selectCar(key);
        resetIdle();
      });
      el.carSelect.appendChild(btn);
    });
  }

  function selectCar(key) {
    if (!CAR_TYPES[key]) return;
    currentCarType = key;
    el.carSelect.querySelectorAll('.car-type-btn').forEach(function (b, i) {
      b.classList.toggle('active', Object.keys(CAR_TYPES)[i] === key);
    });
    loadMask(key);
    setMsg('已選擇 ' + CAR_TYPES[key].label + '，開始上色吧！', 'ok');
  }

  /* ═══════════ 事件綁定 ═══════════ */
  function bindEvents() {
    const canvas = drawCanvas;
    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', moveDraw);
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);

    el.palette.addEventListener('click', function (e) {
      const swatch = e.target.closest('.swatch');
      if (!swatch) return;
      el.palette.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('active'); });
      swatch.classList.add('active');
      color = swatch.dataset.color;
      tool = 'brush';
      el.eraserBtn.classList.remove('active');
      resetIdle();
    });

    el.eraserBtn.addEventListener('click', function () {
      tool = tool === 'eraser' ? 'brush' : 'eraser';
      el.eraserBtn.classList.toggle('active', tool === 'eraser');
      resetIdle();
    });

    el.garageToggle.addEventListener('click', function () { toggleGarage(); resetIdle(); });
    el.undoBtn.addEventListener('click', function () { undo(); resetIdle(); });
    el.clearBtn.addEventListener('click', function () { clearCanvas(); resetIdle(); });
    el.submitBtn.addEventListener('click', function () { submitCar(); resetIdle(); });
    el.againBtn.addEventListener('click', hideSuccess);
    el.discOkBtn.addEventListener('click', hideDisconnectModal);

    el.sizeSlider.addEventListener('input', function () {
      brushSize = parseInt(el.sizeSlider.value, 10);
      el.sizeDisplay.textContent = brushSize;
      resetIdle();
    });
  }

  function buildPalette() {
    const colors = [
      '#ff0000', '#ff4444', '#ff8800', '#ffcc00',
      '#ffe600', '#88cc00', '#00cc44', '#00e5ff',
      '#00aaff', '#0066ff', '#4444ff', '#8800ff',
      '#cc00ff', '#ff00aa', '#ff3366', '#ffffff',
      '#444444', '#888888', '#222222', '#000000'
    ];
    colors.forEach(function (c) {
      const swatch = document.createElement('div');
      swatch.className = 'swatch' + (c === color ? ' active' : '');
      swatch.style.setProperty('--c', c);
      swatch.dataset.color = c;
      el.palette.appendChild(swatch);
    });
  }

  function init() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (!room) {
      setMsg('缺少房間代號，請掃 QR Code 進入', 'err');
    } else {
      connectAbly(room);
    }

    buildPalette();
    buildCarSelect();
    bindEvents();
    bindIdleReset();
    loadGarage();
    loadMask('bike1');
    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    window.addEventListener('orientationchange', function () {
      setTimeout(fitCanvas, 200);
    });
  }

  init();
})();
