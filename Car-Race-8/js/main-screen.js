/* ============================================================
   Car-Race-8 · main-screen.js v12
   ──────────────────────────────────────────────────────────
   - 賽道底圖在最底層（<image>），真正的跑道繪於其上方
   - 賽車以 SVG <g> 渲染於同一 viewBox，與跑道完全對齊
    - 起跑線位於跑道上方正中間（距 640,84 最近處）
    - 3 種行駛路線（寬/中/窄），車可重疊、同時從起跑線出發
   ============================================================ */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  /* ── 全域 ── */
  const GSAP   = window.gsap;
  const PLUGIN = window.MotionPathPlugin;
  if (GSAP && PLUGIN) GSAP.registerPlugin(PLUGIN);

  /* ── 賽道 ── */
  const TRACK = { roadWidth: 120 };

  /* ── 賽車規格（×1.2 放大） ── */
  const CAR = {
    sports:  { w: 64, h: 104, mask: 'mask-sports.png'  },
    offroad: { w: 71, h: 114, mask: 'mask-offroad.png' },
    muscle:  { w: 68, h: 108, mask: 'mask-muscle.png'  },
  };

  /* ── 3 種行駛路線（法向量偏移），每條隨機選一道 ── */
  const ROUTES = [
    [-28, -18, -8, 0, 8, 18, 28],   // 寬：左右對稱大偏移
    [-20, -10, 0, 10, 20],          // 中：中等偏移
    [-12, -5, 0, 5, 12],            // 窄：靠中央小偏移
  ];

  /* ── 房間代號 ── */
  const ROOM = new URLSearchParams(location.search).get('room') || Math.random().toString(36).slice(2, 7);

  /* ── 比賽參數 ── */
  const MAX_PLAYERS = 10;
  const RACE = {
    laps: 1,
    lapDur: { min: 13, max: 18 },
    maxCars: 24,
    minGap: 40,
    startStagger: 0.0,
    startProgress: 0.0,
  };

  /* ── DOM ── */
  const el = {
    svg:         document.getElementById('sceneSvg'),
    roadLayer:   document.getElementById('roadLayer'),
    startGroup:  document.getElementById('startGroup'),
    carLayer:    document.getElementById('carLayer'),
    statusBadge: document.getElementById('statusBadge'),
    activeCars:  document.getElementById('activeCars'),
    playerCount: document.getElementById('playerCount'),
    qrContainer: document.getElementById('qrContainer'),
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

  /* ── 決定起跑進度（跑道上方正中間） ── */
  let START_IDX = 0;
  (function findStartIdx() {
    const CX = 640, CY = 84;
    let bestDist = Infinity;
    for (let i = 0; i < trackLen(); i++) {
      const dx = path[i * 2] - CX, dy = path[i * 2 + 1] - CY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; START_IDX = i; }
    }
  })();
  const START_PROG = START_IDX / trackLen();
  RACE.startProgress = START_PROG;

  /* ═══════════ 真正的跑道（繪於底圖上方） ═══════════ */
  function offsetPathD(offset) {
    const pts = [];
    for (let i = 0; i < trackLen(); i++) {
      const n = trackNormal(i / trackLen());
      pts.push((path[i * 2] + n.nx * offset).toFixed(1) + ',' + (path[i * 2 + 1] + n.ny * offset).toFixed(1));
    }
    return 'M ' + pts.join(' L ');
  }
  function centerPathD() {
    const pts = [];
    for (let i = 0; i < trackLen(); i++) {
      pts.push(path[i * 2].toFixed(1) + ',' + path[i * 2 + 1].toFixed(1));
    }
    return 'M ' + pts.join(' L ');
  }

  function elSvg(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function buildRoad() {
    el.roadLayer.innerHTML = '';

    // 路面（與底圖路面同色調，半透明疊加使輪廓清楚）
    el.roadLayer.appendChild(elSvg('path', {
      d: centerPathD(), fill: 'none',
      stroke: '#c9a86a', 'stroke-width': TRACK.roadWidth,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.45,
    }));

  }

  /* ═══════════ 起跑棋盤線（垂直於跑道切線） ═══════════ */
  function buildFinishLine() {
    const t = START_PROG;
    const pt = trackPt(t);
    const n  = trackNormal(t);
    const halfW = TRACK.roadWidth / 2 + 5;

    const rx = pt.x + n.nx * halfW, ry = pt.y + n.ny * halfW;
    const lx = pt.x - n.nx * halfW, ly = pt.y - n.ny * halfW;
    const ang = Math.atan2(ry - ly, rx - lx) * 180 / Math.PI;
    const len = Math.sqrt((rx - lx) * (rx - lx) + (ry - ly) * (ry - ly));

    el.startGroup.innerHTML = '';
    el.startGroup.appendChild(elSvg('rect', {
      x: String(-len / 2), y: '-6', width: String(len), height: '12',
      fill: 'url(#checker)', stroke: '#000', 'stroke-width': '1.5',
      transform: 'translate(' + ((rx + lx) / 2).toFixed(1) + ',' + ((ry + ly) / 2).toFixed(1) + ') rotate(' + ang.toFixed(1) + ')',
    }));
  }

  /* ═══════════ 賽車（SVG，與跑道同一座標系） ═══════════ */
  const carState = new Map();
  let nextCarId = 0;

  function createCarEl(type, imgData) {
    const spec = CAR[type];
    const g = elSvg('g', { class: 'car-wrap' });
    const scaleG = elSvg('g', { class: 'car-scale' });
    const img = elSvg('image', {
      href: imgData || ('assets/' + spec.mask),
      x: String(-spec.w / 2), y: String(-spec.h / 2),
      width: String(spec.w), height: String(spec.h),
      filter: 'url(#carOutline)',
    });
    scaleG.appendChild(img);
    g.appendChild(scaleG);
    el.carLayer.appendChild(g);
    return g;
  }

  function spawnCar(imgData, carType) {
    if (carState.size >= RACE.maxCars) { retireOldest(); }

    const routeIdx = Math.floor(Math.random() * ROUTES.length);
    const laneIdx  = Math.floor(Math.random() * ROUTES[routeIdx].length);
    const carEl = createCarEl(carType, imgData);
    const idx = nextCarId++;

    const s = {
      el: carEl,
      routeIdx: routeIdx,
      laneIdx: laneIdx,
      progress: RACE.startProgress,
      done: false,
      carType: carType,
      isPlayer: !!imgData,
      tl: null,
    };
    carState.set(idx, s);

    // 立即定位於起跑線（尚未移動）
    applyTrack(s);

    const dur = RACE.lapDur.min + Math.random() * (RACE.lapDur.max - RACE.lapDur.min);
    const HOLD = 1.4;
    const scaleG = carEl.querySelector('.car-scale');

    // 彈出式出現
    GSAP.fromTo(scaleG,
      { opacity: 0, scale: 0.5 },
      { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' }
    );

    const tl = GSAP.timeline({ onComplete: function () { finishCar(idx); } });
    s.tl = tl;

    tl.to({}, { duration: HOLD }, 0);

    tl.to({ p: s.progress }, {
      p: RACE.startProgress + RACE.laps,
      duration: dur,
      ease: 'none',
      onUpdate: function () {
        const st = carState.get(idx);
        if (!st || st.done) return;
        st.progress = this.targets()[0].p;
        applyTrack(st);
      },
    }, HOLD);

    tl.to(scaleG, { opacity: 0, duration: 0.4 }, HOLD + dur + 0.2);
  }

  function applyTrack(s) {
    const pt = trackPt(s.progress);
    const n  = trackNormal(s.progress);
    const offset = ROUTES[s.routeIdx][s.laneIdx];
    const x  = pt.x + n.nx * offset;
    const y  = pt.y + n.ny * offset;
    const nxt = trackPt(s.progress + 0.002);
    const dx = nxt.x - pt.x, dy = nxt.y - pt.y;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    s.el.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + (ang + 90).toFixed(1) + ')');
    syncCarLayer();
  }

  function finishCar(idx) {
    const s = carState.get(idx);
    if (!s) return;
    s.done = true;
    if (s.tl) { try { s.tl.kill(); } catch (_) {} }
    s.el.parentNode && s.el.parentNode.removeChild(s.el);
    carState.delete(idx);
    syncCarLayer();
  }

  function retireOldest() {
    // 優先移除 demo 車（isPlayer=false）；全為玩家車時才移除最舊玩家車
    let demo = null, playerOldest = null;
    for (const [k, v] of carState) {
      if (v.done) { finishCar(k); continue; }
      if (!v.isPlayer) demo = demo || v;
      if (!playerOldest || v.progress > playerOldest.progress) playerOldest = v;
    }
    const victim = demo || playerOldest;
    if (!victim) return;
    for (const [k, v] of carState) {
      if (v === victim) { finishCar(k); break; }
    }
  }

  function syncCarLayer() { el.activeCars.textContent = carState.size; }

  /* ── QR ── */
  function showQR() {
    el.qrContainer.innerHTML = '';
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const url = base + 'mobile.html?room=' + encodeURIComponent(ROOM);
    new QRCode(el.qrContainer, { text: url, width: 96, height: 96 });
  }

  /* ── Ably ── */
  let ablyClient = null;
  function setupAbly() {
    if (typeof Ably === 'undefined') { setBadge('offline', ' Ably 未載入'); return; }
    try {
      const ably = new Ably.Realtime({ key: 'XGHDcg.6rIvFg:As3RE8ShoT67QAg1O2GoyRSN50RosUlk5Yfwo4eJkBc', clientId: 'screen-' + Math.random().toString(36).slice(2, 6) });
      ablyClient = ably;

      ably.connection.on(function (s) {
        if (s.current === 'connected') { setBadge('online', ' 線上'); enterScreenPresence(); }
        else if (s.current === 'failed' || s.current === 'suspended') setBadge('offline', ' 斷線');
      });

      const channel = ably.channels.get('carrace-' + ROOM);

      channel.presence.subscribe(function () { refreshPlayerCount(channel); });

      channel.subscribe(function (msg) {
        const d = msg.data;
        if (d && d.carType && d.imageData) {
          spawnCar(d.imageData, d.carType);
          // 確認回覆：讓手機端知道已上賽道
          try { channel.publish('ack', { id: d.id }); } catch (_) {}
        }
      });

      ably.connection.once(function (s) {
        if (s.current !== 'connected') { console.warn('Ably not connected'); setBadge('offline', ' 未連線'); }
      });

      // 大螢幕關閉/重整時，立即離開 presence，手機端可即時偵測離線
      window.addEventListener('beforeunload', function () {
        try { channel.presence.leave(); } catch (_) {}
      });
    } catch (e) { console.error('Ably init error', e); setBadge('offline', ' 連線錯誤'); }
  }

  function enterScreenPresence() {
    try {
      const ch = ablyClient && ablyClient.channels.get('carrace-' + ROOM);
      if (ch && ch.presence) ch.presence.enter('screen');
    } catch (_) {}
  }

  function refreshPlayerCount(channel) {
    channel.presence.get(function (e, m) {
      const n = (m || []).filter(function (x) { return x.clientId && x.clientId.startsWith('player-'); }).length;
      el.playerCount.textContent = String(n) + '/' + MAX_PLAYERS;
    });
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
  buildRoad();
  buildFinishLine();
  showQR();
  setupAbly();
  if (new URLSearchParams(location.search).has('demo')) runDemo();
})();
