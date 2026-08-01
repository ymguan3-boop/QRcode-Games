/* ============================================================
   Car-Race-8 · main-screen.js v5
   ──────────────────────────────────────────────────────────
   - 賽道圖背景（賽道.png），右側起跑棋盤線
   - 無飄移：7 條固定車道（法向量偏移 ±30/±15/0）
   - 車輛嚴格行走在道路上
   ============================================================ */
(function () {
  'use strict';

  /* ── 全域 ── */
  const GSAP   = window.gsap;
  const PLUGIN = window.MotionPathPlugin;
  if (GSAP && PLUGIN) GSAP.registerPlugin(PLUGIN);

  /* ── 賽道 ── */
  const TRACK = { roadWidth: 120, centerOffset: 0 };

  /* ── 賽車規格（×1.1 放大） ── */
  const CAR = {
    sports:  { w: 53, h: 87, mask: 'mask-sports.png'  },
    offroad: { w: 59, h: 95, mask: 'mask-offroad.png' },
    muscle:  { w: 57, h: 90, mask: 'mask-muscle.png'  },
  };

  /* ── 車道偏移（法向量方向，共 7 條） ── */
  const LANE_OFFSETS = [-30, -20, -10, 0, 10, 20, 30];

  /* ── 房間代號（畫面自己的 URL 參數，或隨機產生） ── */
  const ROOM = new URLSearchParams(location.search).get('room') || Math.random().toString(36).slice(2, 7);

  /* ── 比賽參數 ── */
  const RACE = {
    laps: 1,
    lapDur: { min: 13, max: 18 },
    maxCars: 12,
    fadeAfterFinish: 0.8,
    minGap: 40,
    startStagger: 0.005,
    startProgress: 0.0,
  };

  /* ── DOM ── */
  const el = {
    svg:           document.getElementById('sceneSvg'),
    boardLayer:    document.getElementById('boardLayer'),
    startGroup:    document.getElementById('startGroup'),
    carLayer:      document.getElementById('carLayer'),
    statusBadge:   document.getElementById('statusBadge'),
    activeCars:    document.getElementById('activeCars'),
    playerCount:   document.getElementById('playerCount'),
    qrContainer:   document.getElementById('qrContainer'),
  };

  /* ── 賽道座標 ── */
  const path = (window.TRACK_PATH || []).slice();
  if (path.length < 4) { console.error('TRACK_PATH missing'); return; }

  function trackLen() { return path.length / 2; }
  function trackXY(i) { const n = trackLen(); i = ((i % n) + n) % n; return { x: path[i * 2], y: path[i * 2 + 1] }; }

  function trackPt(t) {
    const n = trackLen();
    const f = ((t % 1) + 1) % 1 * n;
    const i = Math.floor(f);
    const r = f - i;
    const a = trackXY(i), b = trackXY(i + 1);
    return { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
  }

  /* ── 法向量（垂直於路徑切線） ── */
  function trackNormal(t) {
    const n = trackLen();
    const f = ((t % 1) + 1) % 1 * n;
    const i = Math.floor(f);
    const a = trackXY(i), b = trackXY(i + 1);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { nx: -dy / len, ny: dx / len };
  }

  /* ── 判斷 t 是否在賽道上（簡易距離檢查） ── */
  function isOnTrack(x, y, threshold) {
    const thr = threshold || TRACK.roadWidth * 0.55;
    for (let i = 0; i < trackLen(); i += 3) {
      const p = trackXY(i);
      const dx = x - p.x, dy = y - p.y;
      if (dx * dx + dy * dy < thr * thr) return true;
    }
    return false;
  }

  /* ── 偏移路徑（固定車道） ── */
  function computeLanePaths() {
    const lanes = [];
    LANE_OFFSETS.forEach(function (offset) {
      const pts = [];
      for (let t = 0; t < trackLen(); t++) {
        const pt = trackXY(t);
        const n  = trackNormal(t);
        pts.push(pt.x + n.nx * offset);
        pts.push(pt.y + n.ny * offset);
      }
      lanes.push(pts);
    });
    return lanes;
  }
  const LANES = computeLanePaths();

  /* ── 決定起跑進度（右側垂直路段，x 最大處，再上移約 1cm ≈ 30 單位） ── */
  let START_IDX = 0;
  (function findStartIdx() {
    let maxX = -Infinity;
    for (let i = 0; i < trackLen(); i++) {
      if (path[i * 2] > maxX) { maxX = path[i * 2]; START_IDX = i; }
    }
  })();
  const START_PROG = (START_IDX - 6.4) / trackLen();
  RACE.startProgress = START_PROG;

  /* ── 賽車圖層 ── */
  const carState = new Map();
  let nextCarId = 0;

  function makeCarSvg(type, imgData) {
    const spec = CAR[type];
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    const img = document.createElementNS(ns, 'image');
    img.setAttribute('href', imgData || ('assets/' + spec.mask));
    img.setAttribute('x', String(-spec.w / 2));
    img.setAttribute('y', String(-spec.h / 2));
    img.setAttribute('width', String(spec.w));
    img.setAttribute('height', String(spec.h));
    img.setAttribute('filter', 'url(#carOutline)');
    g.appendChild(img);
    return g;
  }

  function createCarEl(type, imgData) {
    const wrap = document.createElement('div');
    wrap.className = 'car-wrap';

    const svgWrap = document.createElement('div');
    svgWrap.style.cssText = 'position:absolute;overflow:visible;pointer-events:none;';
    svgWrap.appendChild(makeCarSvg(type, imgData));
    wrap.appendChild(svgWrap);
    el.carLayer.appendChild(wrap);
    return wrap;
  }

  /* ── 距離檢查 ── */
  function isLaneOccupied(laneIdx, progress) {
    for (const s of carState.values()) {
      if (s.laneIdx !== laneIdx) continue;
      if (Math.abs(s.progress - progress) < RACE.minGap / trackLen()) return true;
    }
    return false;
  }

  /* ── 發車 ── */
  function spawnCar(imgData, carType) {
    if (carState.size >= RACE.maxCars) { retireOldest(); }

    const laneIdx = Math.floor(Math.random() * LANES.length);
    const spec = CAR[carType];
    const pts = LANES[laneIdx];

    const carEl = createCarEl(carType, imgData);
    carEl.style.opacity = '0';
    GSAP.set(carEl, { opacity: 0 });

    let idx = nextCarId++;
    carState.set(idx, { el: carEl, laneIdx: laneIdx, progress: RACE.startProgress, done: false, carType: carType });

    // 從起跑線開始，帶錯開
    const stagger = carState.size * RACE.startStagger;

    carEl.style.opacity = '0';
    GSAP.set(carEl, { opacity: 0 });

    const dur = RACE.lapDur.min + Math.random() * (RACE.lapDur.max - RACE.lapDur.min);

    const tl = GSAP.timeline({
      onComplete: function () { finishCar(idx); },
    });

    // 淡入
    tl.to(carEl, { opacity: 1, duration: 0.3 }, 0);

    // 沿路徑移動（起跑線出發，跑完 1 圈回到起跑線）
    tl.to({ p: RACE.startProgress + stagger }, {
      p: RACE.startProgress + RACE.laps,
      duration: dur,
      ease: 'none',
      onUpdate: function () {
        const s = carState.get(idx);
        if (!s || s.done) return;
        s.progress = this.targets()[0].p;
        applyTrack(s);
      },
    }, 0);

    // 超車淡出
    tl.to(carEl, {
      opacity: 0,
      duration: 0.4,
      delay: dur * RACE.fadeAfterFinish,
    }, 0);
  }

  function applyTrack(s) {
    const pt  = trackPt(s.progress);
    const n   = trackNormal(s.progress);
    const x   = pt.x + n.nx * LANE_OFFSETS[s.laneIdx];
    const y   = pt.y + n.ny * LANE_OFFSETS[s.laneIdx];
    const nxt = trackPt(s.progress + 0.002);
    const dx  = nxt.x - pt.x;
    const dy  = nxt.y - pt.y;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const spec = CAR[s.carType] || CAR.sports;
    s.el.style.transform = `translate(${x - spec.w / 2}px,${y - spec.h / 2}px) rotate(${ang + 90}deg)`;
    syncCarLayer();
  }

  function finishCar(idx) {
    const s = carState.get(idx);
    if (!s) return;
    s.done = true;
    s.el.remove();
    carState.delete(idx);
  }

  function retireOldest() {
    let oldest = null;
    for (const [k, v] of carState) {
      if (v.done) { v.el.remove(); carState.delete(k); continue; }
      if (!oldest || v.progress > oldest.progress) oldest = v;
    }
  }

  function syncCarLayer() { el.activeCars.textContent = carState.size; }

  /* ── 起跑棋盤線（右側，上移約 1cm） ── */
  function buildFinishLine() {
    const t = START_PROG;
    const pt = trackPt(t);
    const n  = trackNormal(t);
    const halfW = TRACK.roadWidth / 2 + 5;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // 橫跨道路的棋盤紋矩形
    const rx = pt.x + n.nx * halfW;
    const ry = pt.y + n.ny * halfW;
    const lx = pt.x - n.nx * halfW;
    const ly = pt.y - n.ny * halfW;
    const ang = Math.atan2(ry - ly, rx - lx) * 180 / Math.PI;
    const len = Math.sqrt((rx - lx) * (rx - lx) + (ry - ly) * (ry - ly));

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(-len / 2));
    rect.setAttribute('y', '-6');
    rect.setAttribute('width', String(len));
    rect.setAttribute('height', '12');
    rect.setAttribute('fill', 'url(#checker)');
    rect.setAttribute('stroke', '#000');
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('transform', `translate(${(rx + lx) / 2},${(ry + ly) / 2}) rotate(${ang})`);
    g.appendChild(rect);

    el.startGroup.innerHTML = '';
    el.startGroup.appendChild(g);
  }

  /* ── 看板 ── */
  function buildBoard() {
    const boardW = 260, boardH = 110, bx = 30, by = 50;
    const boardG = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', bx); rect.setAttribute('y', by);
    rect.setAttribute('width', boardW); rect.setAttribute('height', boardH);
    rect.setAttribute('rx', '12');
    rect.setAttribute('fill', 'rgba(255,255,255,0.92)');
    rect.setAttribute('stroke', '#1a1a2e'); rect.setAttribute('stroke-width', '3');
    boardG.appendChild(rect);

    const t1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t1.setAttribute('x', bx + boardW / 2); t1.setAttribute('y', by + 40);
    t1.setAttribute('text-anchor', 'middle'); t1.setAttribute('class', 'board-title');
    t1.textContent = 'Flower 1 世界賽';
    boardG.appendChild(t1);

    const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t2.setAttribute('x', bx + boardW / 2); t2.setAttribute('y', by + 68);
    t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('class', 'board-sub');
    t2.textContent = 'FLOWER 1 WORLD CUP';
    boardG.appendChild(t2);

    el.boardLayer.appendChild(boardG);
  }

  /* ── QR ── */
  function showQR() {
    el.qrContainer.innerHTML = '';
    // 指向 mobile.html 並帶入房間代號（不重複加 carrace- 前綴）
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const url = base + 'mobile.html?room=' + encodeURIComponent(ROOM);
    new QRCode(el.qrContainer, { text: url, width: 160, height: 160 });
  }

  /* ── Ably ── */
  function setupAbly() {
    if (typeof Ably === 'undefined') { setBadge('offline', ' Ably 未載入'); return; }
    try {
      const ably = new Ably.Realtime({ key: 'XGHDcg.6rIvFg:As3RE8ShoT67QAg1O2GoyRSN50RosUlk5Yfwo4eJkBc', clientId: 'screen-' + Math.random().toString(36).slice(2, 6) });

      ably.connection.on(function (s) {
        if (s.current === 'connected') { setBadge('online', ' 線上'); el.playerCount.textContent = '0'; }
        else if (s.current === 'failed' || s.current === 'suspended') setBadge('offline', ' 斷線');
      });

      const channel = ably.channels.get('carrace-' + ROOM);

      channel.presence.subscribe(function () { channel.presence.get(function (e, m) { el.playerCount.textContent = String(m.filter(function (x) { return x.clientId && x.clientId.startsWith('player-'); }).length); }); });

      channel.subscribe(function (msg) {
        const d = msg.data;
        if (d && d.carType && d.imageData) spawnCar(d.imageData, d.carType);
      });

      ably.connection.once(function (s) {
        if (s.current !== 'connected') { console.warn('Ably not connected'); setBadge('offline', ' 未連線'); }
      });
    } catch (e) { console.error('Ably init error', e); setBadge('offline', ' 連線錯誤'); }
  }

  function setBadge(cls, text) { el.statusBadge.className = 'status-badge ' + cls; el.statusBadge.querySelector('.label').textContent = text; }

  /* ── Demo ── */
  function runDemo() {
    const types = ['sports', 'offroad', 'muscle'];
    function scheduleNext() {
      const delay = 1800 + Math.random() * 2500;
      setTimeout(function () {
        spawnCar(null, types[Math.floor(Math.random() * types.length)]);
        if (carState.size < RACE.maxCars) scheduleNext();
      }, delay);
    }
    scheduleNext();
  }

  /* ── init ── */
  buildFinishLine();
  buildBoard();
  showQR();
  setupAbly();
  if (new URLSearchParams(location.search).has('demo')) runDemo();
})();
