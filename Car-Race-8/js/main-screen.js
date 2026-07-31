(function () {
  'use strict';

  const ABLY_KEY = 'XGHDcg.6rIvFg:As3RE8ShoT67QAg1O2GoyRSN50RosUlk5Yfwo4eJkBc';
  const channelName = function (room) { return 'carrace-' + room; };

  /* ═══════════ 8 字型賽道參數 ═══════════ */
  const TRACK = {
    centerX: 650,
    centerY: 400,
    halfW: 430,       // cos 振幅（左右）
    yScale: 1.5,      // y = halfW * yScale * sin*cos，控制環形高度
    samples: 520,
    roadWidth: 120
  };
  const VB_W = 1300;
  const VB_H = 800;

  /* ═══════════ 競賽參數 ═══════════ */
  const RACE = {
    laps: 1,                 // 每位車手跑 1 圈
    lapDurMin: 13,           // 每圈秒數下限
    lapDurMax: 18,           // 每圈秒數上限
    maxCars: 12,             // 賽道同時車輛上限
    fadeAfterFinish: 0.8     // 完賽後淡出秒數
  };

  const el = {
    status: document.getElementById('statusBadge'),
    statusLabel: document.getElementById('statusBadge').querySelector('.label'),
    qr: document.getElementById('qrContainer'),
    carLayer: document.getElementById('carLayer'),
    activeCars: document.getElementById('activeCars'),
    playerCount: document.getElementById('playerCount')
  };

  let ably = null;
  let channel = null;
  let roomId = '';
  let myClientId = 'host-' + Math.random().toString(36).substring(2, 8);
  let playerCount = 0;
  let activeCount = 0;
  let racerSeq = 0;

  gsap.registerPlugin(MotionPathPlugin);

  /* ═══════════ 8 字型路徑產生 ═══════════ */
  function buildFigure8() {
    const { centerX, centerY, halfW, yScale, samples } = TRACK;
    const pts = [];
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * Math.PI * 2;
      pts.push({
        x: centerX + halfW * Math.cos(t),
        y: centerY + halfW * yScale * Math.sin(t) * Math.cos(t)
      });
    }
    const d = pts.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
    }).join(' ') + ' Z';
    return { d: d, points: pts };
  }

  /* 車道橫向偏移路徑：以法向量將基準路徑左右平移，讓每台車走不同車道 */
  function buildLanePoints(offset) {
    const base = buildFigure8().points;
    const out = [];
    for (let i = 0; i < base.length; i++) {
      const p = base[i];
      const q = base[(i + 1) % base.length];
      let dx = q.x - p.x;
      let dy = q.y - p.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      out.push({
        x: p.x + (-dy / len) * offset,
        y: p.y + (dx / len) * offset
      });
    }
    return out;
  }

  function applyTrack() {
    const path = buildFigure8();
    const ids = ['trackShadow', 'trackRoad', 'trackEdgeOut', 'trackEdgeIn', 'trackCenter', 'bridgeMark', 'racePath'];
    ids.forEach(function (id) {
      const node = document.getElementById(id);
      if (node) node.setAttribute('d', path.d);
    });

    // START/FINISH 置於路徑起點（最右側）：終點棋盤線 + F1 起跑格位 + 發車燈
    const startP = path.points[0];
    buildStartArea(startP);
    startLightsLoop();
  }

  /* ═══════════ F1 起跑區（起點格位 P1~P5 + 終點棋盤線 + 發車燈） ═══════════ */
  function buildStartArea(p) {
    const g = document.getElementById('startGroup');
    if (!g) return;
    const cx = p.x;
    const cy = p.y;
    const roadW = TRACK.roadWidth;
    const half = roadW / 2;
    let html = '';

    // 終點棋盤線：橫跨賽道、垂直於行進方向（起點處行進方向朝下）
    html +=
      '<g transform="translate(' + (cx - half) + ',' + (cy - 8) + ')">' +
        '<rect width="' + roadW + '" height="16" fill="url(#checker)" stroke="#ffffff" stroke-width="2" opacity="0.95"/>' +
      '</g>';

    // F1 起跑格位 P1~P5（沿行進方向交錯排位，P1 最前方）
    const slots = [
      { y: -34, dx: 0 },
      { y: -62, dx: -22 },
      { y: -90, dx: 22 },
      { y: -118, dx: -22 },
      { y: -146, dx: 22 }
    ];
    slots.forEach(function (s, i) {
      const n = i + 1;
      html +=
        '<g transform="translate(' + (cx + s.dx) + ',' + (cy + s.y) + ')">' +
          '<rect x="-20" y="-11" width="40" height="22" rx="6" fill="#0e1c33" opacity="0.55" stroke="#ffd34d" stroke-width="1.5"/>' +
          '<text x="0" y="5" text-anchor="middle" font-size="13" font-weight="900" fill="#ffd34d" font-family="Orbitron">P' + n + '</text>' +
        '</g>';
    });

    // 發車燈燈座（五燈式，模擬 F1 起跑燈）
    html +=
      '<g transform="translate(' + cx + ',' + (cy - 196) + ')">' +
        '<rect x="-52" y="-14" width="104" height="28" rx="8" fill="#0a1322" stroke="#33507a" stroke-width="2"/>' +
        '<circle class="start-light" cx="-36" cy="0" r="7" fill="#5a2530"/>' +
        '<circle class="start-light" cx="-18" cy="0" r="7" fill="#5a2530"/>' +
        '<circle class="start-light" cx="0" cy="0" r="7" fill="#5a2530"/>' +
        '<circle class="start-light" cx="18" cy="0" r="7" fill="#5a2530"/>' +
        '<circle class="start-light" cx="36" cy="0" r="7" fill="#5a2530"/>' +
        '<text x="0" y="-22" text-anchor="middle" font-size="11" font-weight="900" fill="#ffffff" font-family="Orbitron" letter-spacing="2">START</text>' +
      '</g>';

    g.innerHTML = html;
  }

  function startLightsLoop() {
    const lights = Array.prototype.slice.call(document.querySelectorAll('.start-light'));
    if (!lights.length) return;
    const reset = function () {
      lights.forEach(function (l) { l.setAttribute('fill', '#5a2530'); });
    };
    reset();
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 4, onRepeat: reset });
    lights.forEach(function (l, i) {
      tl.call(function () { l.setAttribute('fill', '#ff2d3a'); }, [], i * 0.4);
    });
    tl.call(function () {}, [], lights.length * 0.4 + 1.2);   // 全亮 hold
    tl.call(reset, [], lights.length * 0.4 + 1.6);            // 熄滅 → 起跑
  }

  /* ═══════════ 場景裝飾（白天） ═══════════ */
  function buildClouds() {
    const layer = document.getElementById('cloudLayer');
    if (!layer) return;
    const clouds = [
      { x: 80, y: 60, s: 1 }, { x: 330, y: 130, s: 0.7 }, { x: 520, y: 45, s: 1.2 },
      { x: 780, y: 150, s: 0.8 }, { x: 960, y: 60, s: 1.1 }, { x: 1160, y: 140, s: 0.7 }
    ];
    let html = '';
    clouds.forEach(function (c) {
      html +=
        '<g transform="translate(' + c.x + ',' + c.y + ') scale(' + c.s + ')">' +
          '<ellipse cx="0" cy="0" rx="46" ry="18" fill="#ffffff" opacity="0.9"/>' +
          '<ellipse cx="-26" cy="6" rx="24" ry="13" fill="#ffffff" opacity="0.9"/>' +
          '<ellipse cx="28" cy="6" rx="26" ry="14" fill="#ffffff" opacity="0.9"/>' +
        '</g>';
    });
    layer.innerHTML = html;
  }

  function buildCity() {
    const layer = document.getElementById('cityLayer');
    if (!layer) return;
    const buildings = [
      [60, 60], [120, 95], [200, 55], [270, 130], [360, 70], [430, 150],
      [520, 90], [600, 45], [670, 120], [750, 65], [830, 145], [910, 80],
      [990, 55], [1060, 125], [1140, 75], [1210, 105]
    ];
    let html = '';
    buildings.forEach(function (b) {
      const h = b[1];
      const w = 46 + Math.random() * 20;
      html += '<rect x="' + b[0] + '" y="' + (500 - h) + '" width="' + w + '" height="' + h + '" rx="2" fill="#b7c6d8"/>';
      for (let wy = 0; wy < h - 14; wy += 16) {
        for (let wx = 0; wx < w - 10; wx += 14) {
          if (Math.random() > 0.4) {
            html += '<rect x="' + (b[0] + 5 + wx) + '" y="' + (500 - h + 6 + wy) + '" width="6" height="8" rx="1" fill="#e6f1ff" opacity="0.85"/>';
          }
        }
      }
    });
    layer.innerHTML = html;
  }

  function buildStands() {
    const stage = document.querySelector('.stage');
    const specs = [
      { top: '420px', left: '24px', cols: 7 },
      { top: '420px', right: '24px', cols: 7 }
    ];
    specs.forEach(function (s) {
      const stand = document.createElement('div');
      stand.className = 'stand';
      stand.style.top = s.top;
      stand.style.left = s.left;
      stand.style.right = s.right;
      let seats = '';
      for (let c = 0; c < s.cols; c++) {
        seats += '<span class="stand-seat"></span>';
      }
      stand.innerHTML = '<div class="stand-roof"></div><div class="stand-seats">' + seats.repeat(3) + '</div>';
      stage.appendChild(stand);
    });
  }

  function buildBoard() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const board = document.getElementById('boardLayer');
    if (!board) return;
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', '470');
    rect.setAttribute('y', '26');
    rect.setAttribute('width', '360');
    rect.setAttribute('height', '54');
    rect.setAttribute('rx', '10');
    rect.setAttribute('fill', '#f4f8ff');
    rect.setAttribute('stroke', '#0a6bd6');
    rect.setAttribute('stroke-width', '3');
    board.appendChild(rect);
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', '650');
    text.setAttribute('y', '62');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '30');
    text.setAttribute('font-weight', '900');
    text.setAttribute('fill', '#12325f');
    text.setAttribute('font-family', 'Orbitron, Noto Sans TC');
    text.textContent = '8字型大獎賽';
    board.appendChild(text);
  }

  /* ═══════════ carLayer 與 SVG 視框同步（避免座標錯位） ═══════════ */
  function syncCarLayer() {
    const svg = document.getElementById('sceneSvg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / VB_W, rect.height / VB_H);
    const offX = (rect.width - VB_W * scale) / 2;
    const offY = (rect.height - VB_H * scale) / 2;
    el.carLayer.style.transformOrigin = '0 0';
    el.carLayer.style.transform = 'translate(' + offX + 'px,' + offY + 'px) scale(' + scale + ')';
  }

  /* ═══════════ QR Code ═══════════ */
  function generateQR() {
    const basePath = location.pathname.replace(/\/?[^/]*$/, '/');
    const mobileUrl = location.origin + basePath + 'mobile.html?room=' + roomId;
    el.qr.innerHTML = '';
    try {
      new QRCode(el.qr, {
        text: mobileUrl,
        width: 132,
        height: 132,
        colorDark: '#0a1e3a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (err) {
      const link = document.createElement('a');
      link.href = mobileUrl;
      link.textContent = '開啟手機版';
      link.target = '_blank';
      el.qr.appendChild(link);
      console.error('[qrcode] generation failed:', err);
    }
  }

  /* ═══════════ Ably ═══════════ */
  function setupAbly() {
    if (!ABLY_KEY || ABLY_KEY.indexOf('PASTE_') === 0) {
      setStatus('offline', 'Ably Key 未設定');
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
      setStatus('ready', '等待玩家著色');
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
    channel.subscribe('car', function (message) {
      handleCar(message.data);
      try {
        channel.publish('ack', { id: message.id });
      } catch (_) {}
    });

    channel.presence.enter('host');
    channel.presence.subscribe('enter', updatePresence);
    channel.presence.subscribe('leave', updatePresence);
    channel.presence.get(updatePresence);
    // 週期性同步，確保玩家離線即時反映
    setInterval(updatePresence, 3000);
  }

  function updatePresence() {
    if (!channel || !channel.presence) return;
    channel.presence.get(function (err, members) {
      if (err) {
        console.error('[presence] error:', err);
        return;
      }
      const others = (members || []).filter(function (m) { return m.clientId !== myClientId; });
      playerCount = others.length;
      el.playerCount.textContent = playerCount;
      if (playerCount === 0) {
        setStatus('ready', '等待玩家著色');
      } else {
        setStatus('online', playerCount + ' 位玩家連線中');
      }
    });
  }

  function setStatus(mode, text) {
    el.status.className = 'status-badge ' + mode;
    el.statusLabel.textContent = ' ' + text;
  }

  /* ═══════════ 賽車競賽 ═══════════ */
  const CAR_SIZE = { sedan: 48, sports: 44, offroad: 56, muscle: 52 };
  const LANE_OFFSETS = [-16, -8, 0, 8, 16];

  function handleCar(data) {
    if (!data || !data.imageData) return;
    retireOldestIfNeeded();
    spawnCar(data.imageData, data.id, data.carType);
  }

  function retireOldestIfNeeded() {
    const activeEls = el.carLayer.querySelectorAll('.car-unit');
    if (activeEls.length >= RACE.maxCars) {
      const oldest = activeEls[0];
      if (oldest && oldest._tl) {
        oldest._tl.kill();
        oldest._tl = null;
        const img = oldest.querySelector('.car-img');
        if (img) { img.src = ''; img.removeAttribute('src'); }
        oldest.remove();
        activeCount = Math.max(0, activeCount - 1);
        updateCounts();
      }
    }
  }

  function spawnCar(imageData, id, carType) {
    racerSeq++;
    const racerName = '車 ' + racerSeq;

    const unit = document.createElement('div');
    unit.className = 'car-unit';
    unit.innerHTML =
      '<img class="car-img" src="" alt="">' +
      '<div class="car-name">' + racerName + '</div>';
    el.carLayer.appendChild(unit);

    const img = unit.querySelector('.car-img');
    const nameEl = unit.querySelector('.car-name');

    // 依車款設定車身寬度（跑車較小、越野較大）
    const type = (carType && CAR_SIZE[carType]) ? carType : 'sedan';
    img.style.width = CAR_SIZE[type] + 'px';

    const car = {
      id: id || Date.now().toString(36),
      unit: unit,
      img: img,
      spawnTime: Date.now()
    };

    const lapDur = RACE.lapDurMin + Math.random() * (RACE.lapDurMax - RACE.lapDurMin);

    img.onload = function () {
      activeCount++;
      updateCounts();

      // 路線多樣化：每台車隨機挑選一條橫向偏移車道
      const laneOffset = LANE_OFFSETS[Math.floor(Math.random() * LANE_OFFSETS.length)];
      const lanePts = buildLanePoints(laneOffset);
      const pathOpts = {
        path: lanePts,
        alignOrigin: [0.5, 0.5],
        autoRotate: true
      };

      const tl = gsap.timeline({
        onComplete: function () {
          finishCar(car);
        }
      });

      const counterRotate = function () {
        const r = gsap.getProperty(unit, 'rotation') || 0;
        if (nameEl) gsap.set(nameEl, { rotation: -r, xPercent: -50 });
      };

      for (let i = 0; i < RACE.laps; i++) {
        tl.to(unit, {
          duration: lapDur,
          ease: 'none',
          motionPath: pathOpts,
          onUpdate: counterRotate
        }, i === 0 ? 0 : '-=0.01');
      }

      unit._tl = tl;
      counterRotate();
    };

    img.onerror = function () {
      unit.remove();
      racerSeq--;
      console.error('[car] image load failed');
    };

    img.src = imageData;
  }

  function finishCar(car) {
    // 跑完一圈：淡出並銷毀
    if (car._tl) { car._tl.kill(); car._tl = null; }
    const img = car.img;
    gsap.to(car.unit, {
      opacity: 0,
      scale: 1.15,
      duration: RACE.fadeAfterFinish,
      ease: 'power2.in',
      onComplete: function () {
        if (img) { img.src = ''; img.removeAttribute('src'); }
        if (car.unit.parentNode) car.unit.remove();
        activeCount = Math.max(0, activeCount - 1);
        updateCounts();
      }
    });
  }

  function updateCounts() {
    el.activeCars.textContent = activeCount;
  }

  /* ═══════════ 測試用：自動發車 ═══════════ */
  function startDemoMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') !== '1') return;
    const demoTypes = Object.keys(CAR_SIZE);
    const demoCar = (function () {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 384;
      const ctx = c.getContext('2d');
      return function (type) {
        const hue = Math.floor(Math.random() * 360);
        ctx.clearRect(0, 0, 200, 384);
        ctx.save();
        ctx.translate(100, 192);
        // 頂視車（車頭朝上），與 car-mask 同方向
        ctx.fillStyle = 'hsl(' + hue + ',80%,55%)';
        ctx.beginPath();
        ctx.moveTo(0, -34);
        ctx.lineTo(24, -26);
        ctx.lineTo(30, -6);
        ctx.lineTo(38, 6);
        ctx.lineTo(30, 22);
        ctx.lineTo(14, 32);
        ctx.lineTo(-14, 32);
        ctx.lineTo(-30, 22);
        ctx.lineTo(-38, 6);
        ctx.lineTo(-30, -6);
        ctx.lineTo(-24, -26);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#101820';
        ctx.fillRect(-12, -14, 24, 30);   // 車窗
        ctx.fillRect(-16, -36, 32, 8);    // 前擋
        ctx.fillRect(-16, 30, 32, 6);     // 尾翼
        ctx.fillRect(-38, -2, 6, 12);     // 後照鏡
        ctx.fillRect(32, -2, 6, 12);
        ctx.restore();
        return c.toDataURL('image/png');
      };
    })();

    const spawnDemo = function () {
      const type = demoTypes[Math.floor(Math.random() * demoTypes.length)];
      spawnCar(demoCar(type), undefined, type);
    };

    setTimeout(spawnDemo, 800);
    setInterval(spawnDemo, 4200);
  }

  /* ═══════════ 初始化 ═══════════ */
  function init() {
    applyTrack();
    buildClouds();
    buildCity();
    buildStands();
    buildBoard();
    syncCarLayer();

    roomId = 'race-' + Math.random().toString(36).substring(2, 8).toLowerCase();
    window.__roomId = roomId;
    generateQR();

    setupAbly();
    startDemoMode();

    window.addEventListener('resize', syncCarLayer);
  }

  init();
})();
