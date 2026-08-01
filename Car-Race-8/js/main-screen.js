/* ============================================================
   Car-Race-8 · main-screen.js v7
   ──────────────────────────────────────────────────────────
   - 賽道底圖在最底層（<image>），真正的跑道繪於其上方
   - 賽車以 SVG <g> 渲染於同一 viewBox，與跑道完全對齊
   - 起跑線垂直於跑道切線，配合真正的跑道角度
   - 無飄移：7 條固定車道（法向量偏移）
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

  /* ── 賽車規格（×1.1 放大） ── */
  const CAR = {
    sports:  { w: 53, h: 87, mask: 'mask-sports.png'  },
    offroad: { w: 59, h: 95, mask: 'mask-offroad.png' },
    muscle:  { w: 57, h: 90, mask: 'mask-muscle.png'  },
  };

  /* ── 車道偏移（法向量方向，共 7 條） ── */
  const LANE_OFFSETS = [-30, -20, -10, 0, 10, 20, 30];

  /* ── 房間代號 ── */
  const ROOM = new URLSearchParams(location.search).get('room') || Math.random().toString(36).slice(2, 7);

  /* ── 比賽參數 ── */
  const RACE = {
    laps: 1,
    lapDur: { min: 13, max: 18 },
    maxCars: 12,
    minGap: 40,
    startStagger: 0.005,
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

  /* ── 決定起跑進度（右側垂直路段，x 最大處，再上移約 1cm） ── */
  let START_IDX = 0;
  (function findStartIdx() {
    let maxX = -Infinity;
    for (let i = 0; i < trackLen(); i++) {
      if (path[i * 2] > maxX) { maxX = path[i * 2]; START_IDX = i; }
    }
  })();
  const START_PROG = (START_IDX - 6.4) / trackLen();
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

    // 瀝青路面
    el.roadLayer.appendChild(elSvg('path', {
      d: centerPathD(), fill: 'none',
      stroke: '#4a4a52', 'stroke-width': TRACK.roadWidth,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.9,
    }));

    // 路緣線（兩側）
    [TRACK.roadWidth / 2 - 6, -(TRACK.roadWidth / 2 - 6)].forEach(function (off) {
      el.roadLayer.appendChild(elSvg('path', {
        d: offsetPathD(off), fill: 'none',
        stroke: '#f4f4f6', 'stroke-width': 4,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }));
    });

    // 中央虛線
    el.roadLayer.appendChild(elSvg('path', {
      d: centerPathD(), fill: 'none',
      stroke: '#e8e8ea', 'stroke-width': 3,
      'stroke-dasharray': '14 18',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
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

    const laneIdx = Math.floor(Math.random() * LANE_OFFSETS.length);
    const carEl = createCarEl(carType, imgData);
    const idx = nextCarId++;

    const stagger = (carState.size % 7) * RACE.startStagger;
    const s = {
      el: carEl,
      laneIdx: laneIdx,
      progress: RACE.startProgress + stagger,
      done: false,
      carType: carType,
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
    const x  = pt.x + n.nx * LANE_OFFSETS[s.laneIdx];
    const y  = pt.y + n.ny * LANE_OFFSETS[s.laneIdx];
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
    s.el.parentNode && s.el.parentNode.removeChild(s.el);
    carState.delete(idx);
  }

  function retireOldest() {
    let oldest = null;
    for (const [k, v] of carState) {
      if (v.done) { v.el.parentNode && v.el.parentNode.removeChild(v.el); carState.delete(k); continue; }
      if (!oldest || v.progress > oldest.progress) oldest = v;
    }
  }

  function syncCarLayer() { el.activeCars.textContent = carState.size; }

  /* ── QR ── */
  function showQR() {
    el.qrContainer.innerHTML = '';
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const url = base + 'mobile.html?room=' + encodeURIComponent(ROOM);
    new QRCode(el.qrContainer, { text: url, width: 112, height: 112 });
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
  buildRoad();
  buildFinishLine();
  showQR();
  setupAbly();
  if (new URLSearchParams(location.search).has('demo')) runDemo();
})();
