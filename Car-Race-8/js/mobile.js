(function () {
  'use strict';

  const CANVAS_W = 619;
  const CANVAS_H = 1189;

  const CAR_TYPES = {
    sedan:   { label: '房車', src: 'assets/car-mask.png' },
    sports:  { label: '跑車', src: 'assets/mask-sports.svg' },
    offroad: { label: '越野', src: 'assets/mask-offroad.svg' },
    muscle:  { label: '肌肉', src: 'assets/mask-muscle.svg' }
  };

  const ABLY_KEY = 'XGHDcg.6rIvFg:As3RE8ShoT67QAg1O2GoyRSN50RosUlk5Yfwo4eJkBc';
  const channelName = function (room) { return 'carrace-' + room; };

  const guideCanvas = document.getElementById('guideCanvas');
  const drawCanvas = document.getElementById('drawCanvas');
  const canvasBox = document.getElementById('canvasBox');
  const guideCtx = guideCanvas.getContext('2d');
  const drawCtx = drawCanvas.getContext('2d');

  guideCanvas.width = CANVAS_W;
  guideCanvas.height = CANVAS_H;
  drawCanvas.width = CANVAS_W;
  drawCanvas.height = CANVAS_H;

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
    againBtn: document.getElementById('againBtn')
  };

  let ably = null;
  let channel = null;
  let isConnected = false;
  let roomId = '';

  let maskImageData = null;
  let maskLoaded = false;
  let maskLoadToken = 0;
  let currentCarType = 'sedan';
  let isDrawing = false;
  let lastPoint = null;
  let tool = 'brush';
  let color = '#00e5ff';
  let brushSize = 12;
  let history = [];
  let hasDrawing = false;

  /* ═══════════ 遮罩載入（頂視車輪廓） ═══════════ */
  function maskSrc() {
    return (CAR_TYPES[currentCarType] || CAR_TYPES.sedan).src;
  }

  function loadMask(type) {
    currentCarType = type || currentCarType;
    const token = ++maskLoadToken;
    maskLoaded = false;
    const maskImg = new Image();
    maskImg.onload = function () {
      if (token !== maskLoadToken) return; // 已切換車款，丟棄舊結果
      const offscreen = document.createElement('canvas');
      offscreen.width = CANVAS_W;
      offscreen.height = CANVAS_H;
      const offCtx = offscreen.getContext('2d');
      offCtx.drawImage(maskImg, 0, 0, CANVAS_W, CANVAS_H);
      maskImageData = offCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      maskLoaded = true;

      // 引導圖：淡色輪廓 + 棋盤底
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

  /* ═══════════ 畫布縮放（維持 619:1189 比例） ═══════════ */
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
    drawCanvas.setPointerCapture(e.pointerId);
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

  /* 像素級遮罩裁切：只保留車體輪廓內的筆觸 */
  function applyMaskInPlace() {
    if (!maskImageData) return;
    const imageData = drawCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const pixels = imageData.data;
    const mask = maskImageData.data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (mask[i] < 128) pixels[i] = 0;
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
    el.submitBtn.disabled = !(isConnected && hasDrawing);
    el.submitBtn.innerHTML = '&#128663; 送出賽車去比賽';
  }

  function setMsg(text, type) {
    el.statusMsg.textContent = text;
    el.statusMsg.className = 'status-msg' + (type ? ' ' + type : '');
  }

  function setConnected(online) {
    isConnected = online;
    el.connBadge.textContent = online ? '已連線' : '連線中';
    el.connBadge.className = 'conn-badge ' + (online ? 'online' : 'offline');
    updateSubmitBtn();
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
        clientId: 'player-' + Math.random().toString(36).substring(2, 8),
        transportParams: { maxMessageSize: 500000 }
      });
    } catch (err) {
      setMsg('連線模組載入失敗，請重新整理', 'err');
      setConnected(false);
      console.error('[ably] init error:', err);
      return;
    }

    ably.connection.on('connected', function () {
      setConnected(true);
      channel = ably.channels.get(channelName(room));
      channel.subscribe('ack', function () {
        setMsg('賽車已送出，準備出發！', 'ok');
      });
      channel.presence.enter('player');
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
    });

    window.addEventListener('pagehide', function () {
      leavePresence();
    });
    window.addEventListener('beforeunload', function () {
      leavePresence();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        leavePresence();
      }
    });
  }

  function leavePresence() {
    try {
      if (channel && channel.presence) channel.presence.leave();
      if (ably) ably.close();
    } catch (_) {}
  }

  /* ═══════════ 送出賽車 ═══════════ */
  function submitCar() {
    if (!isConnected || !hasDrawing || !maskLoaded) {
      setMsg('尚未連線或無繪圖內容', 'err');
      return;
    }
    if (!channel) return;
    el.submitBtn.disabled = true;
    el.submitBtn.innerHTML = '傳送中...';

    try {
      // 縮小輸出圖，加速傳輸與大螢幕即時載入
      const OUT_W = 240;
      const OUT_H = Math.round(CANVAS_H * OUT_W / CANVAS_W); // 保留 619:1189 比例
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = OUT_W;
      tempCanvas.height = OUT_H;
      const tCtx = tempCanvas.getContext('2d');
      tCtx.drawImage(drawCanvas, 0, 0, OUT_W, OUT_H);
      applyMaskToScaled(tCtx, OUT_W, OUT_H);

      const base64 = tempCanvas.toDataURL('image/png');
      const msgId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
      channel.publish('car', { id: msgId, imageData: base64, carType: currentCarType }, function (err) {
        if (err) {
          setMsg('傳送失敗，請重試', 'err');
          console.error('[submit] publish error:', err);
          el.submitBtn.disabled = false;
          updateSubmitBtn();
          return;
        }
      });
    } catch (err) {
      console.error('[submit] error:', err);
      setMsg('傳送失敗，請重試', 'err');
    }

    showSuccess();
    clearCanvas();
  }

  function applyMaskToScaled(ctx, w, h) {
    if (!maskImageData) return;
    // 將原解析度遮罩縮放比對小尺寸畫布
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
    });

    el.eraserBtn.addEventListener('click', function () {
      tool = tool === 'eraser' ? 'brush' : 'eraser';
      el.eraserBtn.classList.toggle('active', tool === 'eraser');
    });

    el.undoBtn.addEventListener('click', undo);
    el.clearBtn.addEventListener('click', clearCanvas);
    el.submitBtn.addEventListener('click', submitCar);
    el.againBtn.addEventListener('click', hideSuccess);

    el.sizeSlider.addEventListener('input', function () {
      brushSize = parseInt(el.sizeSlider.value, 10);
      el.sizeDisplay.textContent = brushSize;
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
    loadMask('sedan');
    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    window.addEventListener('orientationchange', function () {
      setTimeout(fitCanvas, 200);
    });
  }

  init();
})();
