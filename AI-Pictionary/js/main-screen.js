(function () {
  'use strict';

  const GEMINI_MODEL = 'gemini-3.1-flash-lite';
  const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
  const GEMINI_SYSTEM_PROMPT = '你是一位幽默熱情的 Pictionary 遊戲主持人。請觀察這張玩家的畫作，猜測他畫的是什麼，並給予 100 字以內的幽默點評與相似度評分 (1-100分)。請用以下格式回應：\n\n答案：[你猜的答案]\n評分：[分數]\n\n[你的幽默點評]';

  const elements = {
    status: document.querySelector('#connectionStatus'),
    statusLabel: document.querySelector('#connectionStatus .label'),
    qrContainer: document.querySelector('#qrCodeContainer'),
    playerList: document.querySelector('#playerList'),
    galleryGrid: document.querySelector('#galleryGrid'),
    drawingCount: document.querySelector('#drawingCount'),
    apiKeyInput: document.querySelector('#apiKeyInput'),
    saveKeyBtn: document.querySelector('#saveKeyBtn'),
    clearKeyBtn: document.querySelector('#clearKeyBtn'),
    apiStatus: document.querySelector('#apiStatus'),
    modelName: document.querySelector('#modelName')
  };

  const ABLY_KEY = 'XGHDcg.6rIvFg:As3RE8ShoT67QAg1O2GoyRSN50RosUlk5Yfwo4eJkBc';
  const channelName = function (room) { return 'pictionary-' + room; };

  let ably = null;
  let channel = null;
  let roomId = '';
  let drawingId = 0;
  let memberCount = 0;
  let myClientId = 'host-' + Math.random().toString(36).substring(2, 8);

  function getApiKey() {
    return localStorage.getItem('gemini_api_key') || '';
  }

  function maskKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  }

  function init() {
    const savedKey = getApiKey();
    if (savedKey) {
      elements.apiKeyInput.placeholder = '已儲存：' + maskKey(savedKey) + '（貼上新 Key 即可更換）';
      elements.apiStatus.textContent = '✅ API Key 已載入（' + maskKey(savedKey) + '）';
      elements.apiStatus.className = 'api-status ok';
    } else {
      elements.apiStatus.textContent = '尚未設定 Key，將無法使用 AI 猜題';
      elements.apiStatus.className = 'api-status';
    }

    if (elements.modelName) {
      elements.modelName.textContent = '模型：' + GEMINI_MODEL;
    }

    roomId = 'pic-' + Math.random().toString(36).substring(2, 8).toLowerCase();
    window.__roomId = roomId;
    generateQR();

    setupAbly();
    setupEvents();
  }

  function generateQR() {
    const basePath = location.pathname.replace(/\/?[^/]*$/, '/');
    const mobileUrl = location.origin + basePath + 'mobile.html?room=' + roomId;
    elements.qrContainer.innerHTML = '';
    try {
      new QRCode(elements.qrContainer, {
        text: mobileUrl,
        width: 160,
        height: 160,
        colorDark: '#0a0e1a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (err) {
      elements.qrContainer.textContent = mobileUrl;
      console.error('[qrcode] generation failed:', err);
    }
  }

  function setupAbly() {
    if (!ABLY_KEY || ABLY_KEY.indexOf('PASTE_') === 0) {
      setStatus('offline', '⚠️ Ably API Key 未設定');
      console.error('[ably] API key not configured');
      return;
    }

    try {
      ably = new Ably.Realtime({
        key: ABLY_KEY,
        clientId: myClientId,
        transportParams: { maxMessageSize: 500000 }
      });
    } catch (err) {
      setStatus('offline', '連線模組載入失敗');
      console.error('[ably] init error:', err);
      return;
    }

    ably.connection.on('connected', function () {
      setStatus('ready', '等待玩家加入');
      console.log('[ably] connected');
    });

    ably.connection.on('failed', function (err) {
      setStatus('offline', '連線失敗');
      console.error('[ably] connection failed:', err);
    });

    ably.connection.on('closed', function () {
      setStatus('offline', '連線已中斷');
    });

    channel = ably.channels.get(channelName(roomId));
    channel.subscribe('drawing', function (message) {
      handleDrawing(message);
      try {
        channel.publish('ack', { id: message.id });
      } catch (_) { }
    });

    channel.presence.enter('host');
    channel.presence.subscribe('enter', function () {
      updatePresence();
    });
    channel.presence.subscribe('leave', function () {
      updatePresence();
    });

    channel.presence.get(function (err, members) {
      if (err) return;
      memberCount = (members || []).filter(function (m) { return m.clientId !== myClientId; }).length;
      updatePresence();
    });
  }

  function updatePresence() {
    if (!channel || !channel.presence) return;
    channel.presence.get(function(err, members) {
      if (err) {
        console.error('[presence] get error:', err);
        return;
      }
      var others = (members || []).filter(function(m) { return m.clientId !== myClientId; });
      memberCount = others.length;
      if (memberCount === 0) {
        setStatus('ready', '等待玩家加入');
        updatePlayerList();
      } else {
        setStatus('online', memberCount + ' 位玩家連線中');
        updatePlayerList();
      }
    });
  }

  function setStatus(mode, text) {
    elements.status.className = 'status-badge ' + mode;
    elements.statusLabel.textContent = ' ' + text;
  }

  function updatePlayerList() {
    elements.playerList.innerHTML = '';
    if (memberCount === 0) {
      elements.playerList.innerHTML = '<li class="empty">等待玩家加入…</li>';
      return;
    }
    for (var i = 0; i < memberCount; i++) {
      var li = document.createElement('li');
      li.textContent = '玩家 ' + (i + 1);
      elements.playerList.appendChild(li);
    }
  }

  function handleDrawing(message) {
    var id = ++drawingId;
    var card = createCard(id, message.data);
    removeEmptyState();
    elements.galleryGrid.insertBefore(card, elements.galleryGrid.firstChild);
    updateCount();

    setTimeout(function () {
      if (card.parentNode) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.8)';
        card.style.transition = 'all 0.5s ease';
        setTimeout(function () { if (card.parentNode) card.remove(); updateCount(); }, 500);
      }
    }, 30000);

    var allCards = elements.galleryGrid.querySelectorAll('.drawing-card');
    if (allCards.length > 6) {
      var oldest = allCards[allCards.length - 1];
      oldest.style.opacity = '0';
      oldest.style.transform = 'scale(0.8)';
      oldest.style.transition = 'all 0.5s ease';
      setTimeout(function () { if (oldest.parentNode) oldest.remove(); updateCount(); }, 500);
    }

    var apiKey = getApiKey();
    if (!apiKey) {
      setAiResult(card, '⚠️ 請設定 Gemini API Key', '');
      return;
    }

    callGemini(apiKey, message.data).then(function (result) {
      setAiResult(card, result.guess, result.comment, result.score);
    }).catch(function (err) {
      console.error('[gemini] error:', err);
      setAiResult(card, '❌ ' + (err.message || 'AI 回應異常'), '');
    });
  }

  function createCard(id, imageData) {
    var card = document.createElement('div');
    card.className = 'drawing-card';
    card.dataset.id = id;

    var img = document.createElement('img');
    img.className = 'thumb';
    img.src = imageData;
    img.alt = '玩家畫作';
    card.appendChild(img);

    var body = document.createElement('div');
    body.className = 'card-body';
    body.innerHTML = '<div class="player-name">🎨 玩家 ' + id + '</div><div class="ai-thinking"><div class="spinner"></div>AI 正在思考中…</div>';
    card.appendChild(body);

    return card;
  }

  function removeEmptyState() {
    var empty = elements.galleryGrid.querySelector('.empty-state');
    if (empty) empty.remove();
  }

  function updateCount() {
    var count = elements.galleryGrid.querySelectorAll('.drawing-card').length;
    elements.drawingCount.textContent = count + ' 幅';
  }

  function setAiResult(card, guess, comment, score) {
    var body = card.querySelector('.card-body');
    var scoreHtml = '';
    if (score) {
      var emoji = score >= 80 ? '🔥' : score >= 50 ? '👍' : '🤔';
      scoreHtml = '<div class="score">' + emoji + ' 相似度：' + score + '/100</div>';
    }
    body.innerHTML = '<div class="player-name">🎨 玩家 ' + card.dataset.id + '</div><div class="ai-result"><div class="guess">' + escapeHtml(guess) + '</div>' + scoreHtml + '<div class="comment">' + escapeHtml(comment) + '</div></div>';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  async function callGemini(apiKey, imageData) {
    var url = GEMINI_API + '?key=' + encodeURIComponent(apiKey);
    var base64 = imageData.split(',')[1];
    if (!base64) throw new Error('無效的圖片資料');

    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: GEMINI_SYSTEM_PROMPT },
            { inline_data: { mime_type: 'image/png', data: base64 } }
          ]
        }]
      })
    });

    if (!res.ok) {
      var errText = await res.text();
      var msg = 'API 請求失敗 (' + res.status + ')';
      try {
        var parsed = JSON.parse(errText);
        if (parsed.error && parsed.error.message) msg = parsed.error.message;
      } catch (_) { }
      throw new Error(msg);
    }

    var data = await res.json();
    if (!data.candidates || data.candidates.length === 0) {
      var reason = data.promptFeedback ? data.promptFeedback.blockReason : '未知';
      throw new Error('AI 無法回應（' + reason + '）');
    }

    var text = data.candidates[0].content.parts[0].text || '（AI 無法辨識）';
    return parseGeminiResponse(text);
  }

  function parseGeminiResponse(text) {
    var guess = '???';
    var score = 0;
    var comment = '';

    var scoreMatch = text.match(/[評分|分數][：:]?\s*(\d+)/);
    if (scoreMatch) score = Math.min(100, Math.max(1, parseInt(scoreMatch[1], 10)));

    var guessMatch = text.match(/[答案][：:]?\s*(.+?)(?:\n|$)/);
    if (guessMatch) guess = guessMatch[1].trim();

    var lines = text.split('\n').filter(function (l) { return l.trim(); });
    var commentLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (/^[答案|評分|分數]/.test(line)) continue;
      if (/^[A-Za-z0-9]/.test(line) && line.length < 3) continue;
      commentLines.push(line);
    }
    comment = commentLines.join(' ').trim() || '';

    return { guess: guess, score: score, comment: comment };
  }

  function setupEvents() {
    elements.saveKeyBtn.addEventListener('click', function () {
      var key = elements.apiKeyInput.value.trim();
      if (!key) {
        elements.apiStatus.textContent = '⚠️ 請輸入 API Key';
        elements.apiStatus.className = 'api-status err';
        return;
      }
      localStorage.setItem('gemini_api_key', key);
      elements.apiKeyInput.value = '';
      elements.apiKeyInput.placeholder = '已儲存：' + maskKey(key) + '（貼上新 Key 即可更換）';
      elements.apiStatus.textContent = '✅ API Key 已儲存（' + maskKey(key) + '）';
      elements.apiStatus.className = 'api-status ok';
    });

    elements.clearKeyBtn.addEventListener('click', function () {
      localStorage.removeItem('gemini_api_key');
      elements.apiKeyInput.value = '';
      elements.apiKeyInput.placeholder = '貼上你的 Gemini API Key';
      elements.apiStatus.textContent = '已清除 Key，輸入新的即可使用';
      elements.apiStatus.className = 'api-status';
    });

    elements.apiKeyInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') elements.saveKeyBtn.click();
    });
  }

  init();
})();
