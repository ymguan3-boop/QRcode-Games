/* ============================================================
   Car-Race-8 · main-screen.js v14
   ──────────────────────────────────────────────────────────
   - 賽道底圖在最底層（<image>），真正的跑道繪於其上方
   - 交通工具以 SVG <g> 渲染於同一 viewBox，與跑道完全對齊
   - 6 種交通工具（腳踏車×1、機車×2、跑車×3），3 種行駛路線可重疊
   - 每台車行駛時播放聲音（3 種分類音色：腳踏車/機車/跑車，Web Audio 合成）
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

  /* ── 交通工具規格（×1.2 放大），cat 決定音色分類 ── */
  const CAR = {
    bike1:  { w: 52, h: 100, mask: 'mask-bike1.png',  cat: 'bicycle'    },
    moto1:  { w: 56, h: 108, mask: 'mask-moto1.png',  cat: 'motorcycle' },
    moto2:  { w: 54, h: 104, mask: 'mask-moto2.png',  cat: 'motorcycle' },
    sport4: { w: 62, h: 114, mask: 'mask-sport4.png', cat: 'sports'     },
    sport5: { w: 64, h: 116, mask: 'mask-sport5.png', cat: 'sports'     },
    sport6: { w: 66, h: 118, mask: 'mask-sport6.png', cat: 'sports'     },
  };

  /* ── 行駛音效基頻（3 種分類音色：腳踏車/機車/跑車） ── */
  const TIMBRE_BASE = {
    bicycle:    { base: 180, oscType: 'triangle', filter: 1200, gain: 0.035, pulse: 3, second: 1.2 },  // 腳踏車：輕盈高音
    motorcycle: { base: 105, oscType: 'square',   filter: 1600, gain: 0.05,  pulse: 6, second: 1.5 },  // 機車：中頻帶噗噗
    sports:     { base: 68,  oscType: 'sawtooth', filter: 1000, gain: 0.06,  pulse: 4, second: 2 },    // 跑車：低沉轟鳴
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
    soundBtn:    document.getElementById('soundBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
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

  /* ═══════════ 音效（Web Audio 合成引擎聲） ═══════════ */
  const SOUND = (function () {
    let ctx = null;
    let master = null;
    let enabled = true;
    const voices = new Map();   // idx -> voice

    function ensureCtx() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.9;
        // 壓縮器避免多台車同時發聲時爆音
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 10;
        comp.ratio.value = 6;
        comp.attack.value = 0.004;
        comp.release.value = 0.15;
        master.connect(comp);
        comp.connect(ctx.destination);
      } catch (e) { ctx = null; return null; }
      return ctx;
    }

    function resume() {
      const c = ensureCtx();
      if (c && c.state === 'suspended') { try { c.resume(); } catch (_) {} }
    }

    function startVoice(idx, cat, baseFreq) {
      if (!enabled) return;
      const c = ensureCtx();
      if (!c) return;
      try {
        const tb = TIMBRE_BASE[cat] || TIMBRE_BASE.sports;
        const t = c.currentTime;

        // 主 Gain（淡入避免爆音）
        const out = c.createGain();
        out.gain.setValueAtTime(0.0001, t);
        out.gain.linearRampToValueAtTime(tb.gain, t + 0.4);
        out.connect(master);

        // 主振盪器 + 低通濾波
        const osc = c.createOscillator();
        osc.type = tb.oscType;
        osc.frequency.setValueAtTime(baseFreq, t);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = tb.filter;
        lp.Q.value = 0.6;
        osc.connect(lp);
        lp.connect(out);

        // 第二泛音（增加車種個性）
        const osc2 = c.createOscillator();
        osc2.type = tb.oscType;
        osc2.frequency.setValueAtTime(baseFreq * tb.second, t);
        const g2 = c.createGain();
        g2.gain.value = 0.35;
        osc2.connect(g2);
        g2.connect(lp);

        // 引擎「噗噗」脈衝（低頻 LFO 振幅調變，深度依基頻比例避免爆音）
        const pulse = c.createOscillator();
        pulse.type = 'sine';
        pulse.frequency.value = tb.pulse * 2;
        const pg = c.createGain();
        pg.gain.value = tb.gain * 0.55;
        pulse.connect(pg);
        pg.connect(out.gain);

        osc.start(t);
        osc2.start(t);
        pulse.start(t);

        const voice = {
          osc: osc, osc2: osc2, pulse: pulse, out: out, base: baseFreq,
          stop: function () {
            const now = ctx.currentTime;
            try { out.gain.cancelScheduledValues(now); out.gain.setValueAtTime(out.gain.value, now); out.gain.linearRampToValueAtTime(0.0001, now + 0.3); } catch (_) {}
            setTimeout(function () {
              try { osc.stop(); osc2.stop(); pulse.stop(); } catch (_) {}
              try { out.disconnect(); } catch (_) {}
            }, 400);
          },
          setPitch: function (f) {
            const now = ctx.currentTime;
            try {
              osc.frequency.setTargetAtTime(f, now, 0.08);
              osc2.frequency.setTargetAtTime(f * tb.second, now, 0.08);
            } catch (_) {}
          },
        };
        voices.set(idx, voice);
      } catch (e) { console.warn('[sound] startVoice:', e); }
    }

    function stopVoice(idx) {
      const v = voices.get(idx);
      if (!v) return;
      voices.delete(idx);
      try { v.stop(); } catch (_) {}
    }

    function pitchVoice(idx, progress) {
      const v = voices.get(idx);
      if (!v) return;
      // 音高隨進度(0→1) 提升約 1.4 倍，營造加速感
      try { v.setPitch(v.base * (1 + progress * 0.4)); } catch (_) {}
    }

    function stopAll() {
      voices.forEach(function (v, k) { try { v.stop(); } catch (_) {} });
      voices.clear();
    }

    function setEnabled(on) {
      enabled = on;
      if (!on) stopAll();
      else resume();
      return enabled;
    }

    function isEnabled() { return enabled; }

    // 點擊按鈕：首次點擊為「解鎖音訊」（瀏覽器需使用者手勢），之後才是開/關
    function toggle() {
      const c = ensureCtx();
      const unlocked = c && c.state === 'running';
      if (!unlocked) { resume(); return enabled; }
      enabled = !enabled;
      if (!enabled) stopAll(); else resume();
      return enabled;
    }

    return { startVoice: startVoice, stopVoice: stopVoice, pitchVoice: pitchVoice, stopAll: stopAll, setEnabled: setEnabled, isEnabled: isEnabled, resume: resume, toggle: toggle };
  })();

  function updateSoundBtn() {
    if (!el.soundBtn) return;
    const on = SOUND.isEnabled();
    el.soundBtn.innerHTML = (on ? '&#128266; 音效開' : '&#128263; 音效關');
    el.soundBtn.classList.toggle('muted', !on);
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

    // 播放行駛音效（依分類取音色，頻率隨進度升高 = 加速感）
    const cat = (CAR[carType] || CAR.sport6).cat;
    SOUND.startVoice(idx, cat, (TIMBRE_BASE[cat] || TIMBRE_BASE.sports).base);
    s.hasSound = true;

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
        // 依車速調整引擎音高（進度越快音越高）
        SOUND.pitchVoice(idx, st.progress);
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
    SOUND.stopVoice(idx);
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
    const types = ['bike1', 'moto1', 'moto2', 'sport4', 'sport5', 'sport6'];
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
  updateSoundBtn();
  if (el.soundBtn) {
    el.soundBtn.addEventListener('click', function () {
      SOUND.toggle();
      updateSoundBtn();
    });
  }

  /* ── 全螢幕切換 ── */
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function requestFullscreen() {
    const d = document.documentElement;
    (d.requestFullscreen || d.webkitRequestFullscreen || function () {}).call(d);
  }
  function exitFullscreen() {
    (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
  }
  function updateFullscreenBtn() {
    if (!el.fullscreenBtn) return;
    const on = isFullscreen();
    el.fullscreenBtn.innerHTML = (on ? '&#128682; 離開全螢幕' : '&#128470; 放大為全螢幕');
    el.fullscreenBtn.classList.toggle('fs-on', on);
  }
  if (el.fullscreenBtn) {
    el.fullscreenBtn.addEventListener('click', function () {
      if (isFullscreen()) exitFullscreen();
      else requestFullscreen();
    });
    document.addEventListener('fullscreenchange', updateFullscreenBtn);
    document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
    updateFullscreenBtn();
  }

  if (new URLSearchParams(location.search).has('demo')) runDemo();
})();
