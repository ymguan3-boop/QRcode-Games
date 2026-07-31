(function () {
  'use strict';

  var CANVAS_SIZE = 500;
  var canvas = document.querySelector('#drawCanvas');
  var ctx = canvas.getContext('2d');

  var elements = {
    connBadge: document.querySelector('#connBadge'),
    roomLabel: document.querySelector('#roomLabel'),
    palette: document.querySelector('#palette'),
    brushBtn: document.querySelector('#brushBtn'),
    eraserBtn: document.querySelector('#eraserBtn'),
    undoBtn: document.querySelector('#undoBtn'),
    clearBtn: document.querySelector('#clearBtn'),
    sizeSlider: document.querySelector('#sizeSlider'),
    sizeDisplay: document.querySelector('#sizeDisplay'),
    submitBtn: document.querySelector('#submitBtn'),
    statusMsg: document.querySelector('#statusMsg')
  };

  var ABLY_KEY = 'XGHDcg.6rIvFg:As3RE8ShoT67QAg1O2GoyRSN50RosUlk5Yfwo4eJkBc';
  var channelName = function (room) { return 'pictionary-' + room; };

  var ably = null;
  var channel = null;
  var isConnected = false;
  var roomId = '';

  var isDrawing = false;
  var lastPoint = null;
  var tool = 'brush';
  var color = '#1a1a1a';
  var brushSize = 6;
  var history = [];
  var hasDrawing = false;

  function initCanvas() {
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    saveState();
  }

  function saveState() {
    history.push(ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE));
    if (history.length > 20) history.shift();
    elements.undoBtn.disabled = history.length <= 1;
  }

  function fitCanvas() {
    var wrap = canvas.parentElement;
    canvas.style.width = wrap.clientWidth + 'px';
    canvas.style.height = wrap.clientHeight + 'px';
  }

  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function startDraw(e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    lastPoint = getPos(e);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    ctx.strokeStyle = tool === 'eraser' ? '#f8f9fa' : color;
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function moveDraw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    var pt = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPoint = pt;
  }

  function endDraw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    isDrawing = false;
    lastPoint = null;
    ctx.restore();
    hasDrawing = true;
    saveState();
    updateSubmitBtn();
  }

  function undo() {
    if (history.length <= 1) return;
    history.pop();
    ctx.putImageData(history[history.length - 1], 0, 0);
    hasDrawing = history.length > 1;
    elements.undoBtn.disabled = history.length <= 1;
    updateSubmitBtn();
  }

  function clearCanvas() {
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    history = [];
    hasDrawing = false;
    saveState();
    updateSubmitBtn();
    setMsg('畫布已清除');
  }

  function updateSubmitBtn() {
    elements.submitBtn.disabled = !(isConnected && hasDrawing);
  }

  function setMsg(text, type) {
    elements.statusMsg.textContent = text;
    elements.statusMsg.className = 'status-msg' + (type ? ' ' + type : '');
  }

  function setConnected(online) {
    isConnected = online;
    elements.connBadge.textContent = online ? '已連線' : '連線中';
    elements.connBadge.className = 'conn-badge ' + (online ? 'online' : 'offline');
    updateSubmitBtn();
  }

  function connectAbly(room) {
    roomId = room;
    elements.roomLabel.textContent = '#' + room;

    if (!ABLY_KEY || ABLY_KEY.indexOf('PASTE_') === 0) {
      setMsg('⚠️ 連線服務未設定，請聯絡主辦單位', 'err');
      setConnected(false);
      console.error('[ably] API key not configured');
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
      console.error('[ably] init error:', err);
      return;
    }

    ably.connection.on('connected', function () {
      setConnected(true);
      setMsg('已連線，開始畫畫吧！');

      channel = ably.channels.get(channelName(room));
      channel.subscribe('ack', function (message) {
        setMsg('🎉 已送出！等待 AI 猜測中', 'ok');
      });

      channel.presence.enter('player');
    });

    ably.connection.on('failed', function (err) {
      setConnected(false);
      setMsg('連線失敗，請確認大螢幕已開啟後重新整理', 'err');
      console.error('[ably] connection failed:', err);
    });

    ably.connection.on('suspended', function () {
      setConnected(false);
      setMsg('連線不穩，嘗試重新連線中…', 'err');
    });

    ably.connection.on('disconnected', function () {
      setConnected(false);
    });

    window.addEventListener('pagehide', function () {
      try {
        if (channel && channel.presence) channel.presence.leave();
        if (ably) ably.close();
      } catch (_) {}
    });
    window.addEventListener('beforeunload', function () {
      try {
        if (channel && channel.presence) channel.presence.leave();
      } catch (_) {}
    });
  }

  function submitDrawing() {
    if (!isConnected || !hasDrawing) return;
    if (!channel) return;
    elements.submitBtn.disabled = true;
    elements.submitBtn.innerHTML = '⏳ 傳送中…';

    try {
      var image = canvas.toDataURL('image/png');
      channel.publish('drawing', image, function (err) {
        if (err) {
          setMsg('❌ 傳送失敗，請重試', 'err');
          console.error('[submit] publish error:', err);
        }
      });
      setMsg('🎉 已送出！等待 AI 猜測中', 'ok');
    } catch (err) {
      setMsg('❌ 傳送失敗，請重試', 'err');
      console.error('[submit] error:', err);
    }

    elements.submitBtn.innerHTML = '🚀 送出畫作給 AI 猜';
    updateSubmitBtn();
  }

  function init() {
    var params = new URLSearchParams(window.location.search);
    var room = params.get('room');
    if (!room) {
      setMsg('⚠️ 缺少房間代號，請掃 QR Code 進入', 'err');
      elements.roomLabel.textContent = '無房間';
      return;
    }
    connectAbly(room);

    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    initCanvas();
    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', moveDraw);
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);

    elements.palette.addEventListener('click', function (e) {
      var swatch = e.target.closest('.swatch');
      if (!swatch) return;
      elements.palette.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('active'); });
      swatch.classList.add('active');
      color = swatch.dataset.color;
      tool = 'brush';
      elements.brushBtn.classList.add('active');
      elements.eraserBtn.classList.remove('active');
    });

    elements.brushBtn.addEventListener('click', function () {
      tool = 'brush';
      elements.brushBtn.classList.add('active');
      elements.eraserBtn.classList.remove('active');
    });

    elements.eraserBtn.addEventListener('click', function () {
      tool = 'eraser';
      elements.eraserBtn.classList.add('active');
      elements.brushBtn.classList.remove('active');
    });

    elements.undoBtn.addEventListener('click', undo);
    elements.clearBtn.addEventListener('click', clearCanvas);
    elements.submitBtn.addEventListener('click', submitDrawing);

    elements.sizeSlider.addEventListener('input', function () {
      brushSize = parseInt(elements.sizeSlider.value, 10);
      elements.sizeDisplay.textContent = brushSize;
    });
  }

  init();
})();
