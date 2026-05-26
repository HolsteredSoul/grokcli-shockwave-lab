/**
 * GrokCLI Shockwave Lab — Interactive Physics Simulator
 *
 * Real-time educational model of rocket exhaust shock diamonds (Mach diamonds).
 * Uses the Pack/Prandtl shock-cell relation L ≈ 1.3·D₀·√(M_e²−1) with M_e
 * derived from the isentropic chamber-to-exit pressure ratio, plus Rankine-
 * Hugoniot normal-shock relations for the post-shock temperature jump.
 * Atmosphere is a piecewise US-Standard model (troposphere + isothermal
 * stratosphere) accurate within a few percent to 20 km.
 *
 * Public API is on window.ShockwaveLab — nothing else escapes the IIFE.
 */
(() => {
  'use strict';

  // ────────────────────────────────────────────────────────────────────────
  // Constants
  // ────────────────────────────────────────────────────────────────────────
  const LOGICAL_WIDTH = 900;
  const LOGICAL_HEIGHT = 520;

  const SHOCK_SPACING_COEFF = 1.3;       // Pack/Prandtl (γ=1.4 fit, used qualitatively)
  const RAPTOR_GAMMA = 1.22;             // Hot LOX/CH₄ combustion products ~3500 K
  const RAPTOR_T0_K = 3550;              // Chamber stagnation temperature, K

  const ATMOS_T0 = 288.15;               // K at sea level
  const ATMOS_LAPSE = 6.5;               // K per km, troposphere
  const TROPOPAUSE_KM = 11;
  const TROPOPAUSE_T = 216.65;           // K
  const STRATOSPHERE_H = 6.341;          // Scale height in isothermal layer, km

  const PIXELS_PER_METER = 60;           // Canvas visualization scale
  const STORAGE_KEY = 'grokcli-shockwave-lab-state';

  // ────────────────────────────────────────────────────────────────────────
  // DOM helpers — $() fails loud at init, $maybe() tolerates missing elements
  // ────────────────────────────────────────────────────────────────────────
  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Required element #${id} not found`);
    return el;
  }
  function $maybe(id) { return document.getElementById(id); }

  // ────────────────────────────────────────────────────────────────────────
  // Canvas setup (HiDPI-aware)
  // ────────────────────────────────────────────────────────────────────────
  const canvas = $('plume-sim');
  const ctx = canvas.getContext('2d', { alpha: true });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = LOGICAL_WIDTH * dpr;
  canvas.height = LOGICAL_HEIGHT * dpr;
  canvas.style.width = LOGICAL_WIDTH + 'px';
  canvas.style.height = LOGICAL_HEIGHT + 'px';
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;

  // ────────────────────────────────────────────────────────────────────────
  // Physics — pure functions, no DOM
  // ────────────────────────────────────────────────────────────────────────
  const Physics = {
    /** Piecewise US-Standard atmosphere → normalized ambient pressure (1.0 at sea level). */
    atmosphere(altKm) {
      if (altKm <= 0) return { pa: 1.0, T: ATMOS_T0 };
      if (altKm < TROPOPAUSE_KM) {
        const T = ATMOS_T0 - ATMOS_LAPSE * altKm;
        return { pa: Math.pow(T / ATMOS_T0, 5.2561), T };
      }
      const paTropopause = Math.pow(TROPOPAUSE_T / ATMOS_T0, 5.2561);
      return {
        pa: paTropopause * Math.exp(-(altKm - TROPOPAUSE_KM) / STRATOSPHERE_H),
        T: TROPOPAUSE_T
      };
    },

    /** Invert isentropic relation P0/Pe = (1 + (γ−1)/2·Me²)^(γ/(γ−1)) for Me. */
    isentropicMach(p0OverPe, gamma) {
      if (p0OverPe <= 1) return 1;
      const inner = Math.pow(p0OverPe, (gamma - 1) / gamma) - 1;
      const me2 = (2 / (gamma - 1)) * inner;
      return Math.sqrt(Math.max(me2, 1));
    },

    /** Pack/Prandtl shock-cell length. */
    shockCellLength(D0, Me) {
      return SHOCK_SPACING_COEFF * D0 * Math.sqrt(Math.max(Me * Me - 1, 0));
    },

    /** Rankine-Hugoniot normal-shock jumps. */
    normalShock(M1, gamma) {
      const m1s = M1 * M1;
      const p2_p1 = 1 + (2 * gamma / (gamma + 1)) * (m1s - 1);
      const T2_T1 = (p2_p1 * ((gamma - 1) * m1s + 2)) / ((gamma + 1) * m1s);
      const M2 = Math.sqrt(((gamma - 1) * m1s + 2) / (2 * gamma * m1s - (gamma - 1)));
      return { p2_p1, T2_T1, M2 };
    },

    /** Exit static temperature from chamber T0 via isentropic expansion. */
    exitStaticT(T0, Me, gamma) {
      return T0 / (1 + ((gamma - 1) / 2) * Me * Me);
    },

    /** Mach-dependent shock-cell intensity decay factor. Higher Mach ⇒ slower decay. */
    dissipationFactor(Me) {
      if (Me <= 1) return 0.78;
      const raw = 1 - 0.18 * Math.pow(Me - 1, -0.5);
      return Math.max(0.78, Math.min(0.97, raw));
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Mutable state
  // ────────────────────────────────────────────────────────────────────────
  const params = {
    p0: 2.8,
    pa: 1.0,
    d0: 0.85,
    altitude: 0,
    boostBonus: 0
  };
  let diamonds = [];
  let physState = null;
  let animationFrame = null;
  let activePresetBtn = null;
  let isPaused = false;
  let initialized = false;
  let pendingUpdate = false;

  // ────────────────────────────────────────────────────────────────────────
  // Listener registry — every on() call records so teardown() can unbind all
  // ────────────────────────────────────────────────────────────────────────
  const listeners = [];
  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    listeners.push({ target, type, handler, opts });
  }
  function teardown() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    while (listeners.length) {
      const { target, type, handler, opts } = listeners.pop();
      target.removeEventListener(type, handler, opts);
    }
    initialized = false;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Persistence
  // ────────────────────────────────────────────────────────────────────────
  function saveStateToLocalStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        p0: params.p0, altitude: params.altitude, d0: params.d0
      }));
    } catch (_) { /* private mode etc. — silent is fine */ }
  }
  function loadStateFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (typeof s.p0 === 'number') params.p0 = s.p0;
      if (typeof s.altitude === 'number') {
        params.altitude = s.altitude;
        params.pa = Physics.atmosphere(params.altitude).pa;
      }
      if (typeof s.d0 === 'number') params.d0 = s.d0;
      return true;
    } catch (_) { return false; }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Model — translates UI params into diamond positions + metric values
  // ────────────────────────────────────────────────────────────────────────
  function updateModel() {
    const p0OverPa = params.p0 / params.pa;
    const Me = Physics.isentropicMach(p0OverPa, RAPTOR_GAMMA);
    const cellMeters = Physics.shockCellLength(params.d0, Me);
    const dissipation = Math.min(0.97, Physics.dissipationFactor(Me) + params.boostBonus);

    diamonds = [];
    let x = cellMeters * PIXELS_PER_METER * 0.6;
    let intensity = 1.0;
    for (let i = 0; i < 14; i++) {
      if (x > LOGICAL_WIDTH * 0.92) break;
      if (intensity < 0.12) break;
      diamonds.push({ x, width: 18 + i * 3, intensity, index: i + 1, yOffset: 0, widthMod: 1 });
      x += cellMeters * PIXELS_PER_METER * (0.92 + i * 0.015);
      intensity *= dissipation * 0.96;
    }

    const M1 = Math.max(Me, 1.01);
    const { T2_T1 } = Physics.normalShock(M1, RAPTOR_GAMMA);
    const Te = Physics.exitStaticT(RAPTOR_T0_K, Me, RAPTOR_GAMMA);
    const deltaT = Te * (T2_T1 - 1);

    physState = {
      firstDiamond: cellMeters,
      visible: diamonds.length,
      tempJump: deltaT,
      pressureRatio: p0OverPa,
      Me
    };
  }

  function updateMetricsDOM() {
    if (!physState) return;
    $('first-diamond').textContent = physState.firstDiamond.toFixed(1) + ' m';
    $('visible-diamonds').textContent = physState.visible;
    $('temp-jump').textContent = physState.tempJump.toFixed(0) + ' K';
    $('pressure-ratio').textContent = physState.pressureRatio.toFixed(2) + '×';
    $('diamond-count').textContent = physState.visible;
    const meEl = $maybe('exit-mach');
    if (meEl) meEl.textContent = physState.Me.toFixed(2);
  }

  function setAria(id, valueText) {
    const el = $maybe(id);
    if (el) el.setAttribute('aria-valuetext', valueText);
  }

  function updateParamsFromUI() {
    params.p0 = parseFloat($('p0').value);
    params.d0 = parseFloat($('d0').value);

    const altEl = $maybe('altitude');
    if (altEl) {
      params.altitude = parseFloat(altEl.value);
      params.pa = Physics.atmosphere(params.altitude).pa;
      $('altitude-val').textContent = params.altitude.toFixed(1);
      setAria('altitude', `${params.altitude.toFixed(1)} kilometers altitude`);
    } else {
      const paEl = $maybe('pa');
      if (paEl) params.pa = parseFloat(paEl.value);
    }

    $('p0-val').textContent = params.p0.toFixed(2);
    $('d0-val').textContent = params.d0.toFixed(2);
    setAria('p0', `Chamber pressure ${params.p0.toFixed(2)} relative units`);
    setAria('d0', `Effective nozzle diameter ${params.d0.toFixed(2)} meters`);

    updateModel();
    updateMetricsDOM();
    saveStateToLocalStorage();
  }

  // rAF-coalesced version: rapid slider input collapses to ≤1 update per frame.
  function scheduleParamsUpdate() {
    if (pendingUpdate) return;
    pendingUpdate = true;
    requestAnimationFrame(() => {
      pendingUpdate = false;
      updateParamsFromUI();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Rendering
  // ────────────────────────────────────────────────────────────────────────
  function drawPlume(time) {
    const w = LOGICAL_WIDTH, h = LOGICAL_HEIGHT, centerY = h / 2;

    ctx.save();
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#1f242f';
    ctx.fillRect(12, centerY - 52, 48, 104);
    ctx.fillStyle = '#ff5e00';
    ctx.fillRect(48, centerY - 38, 18, 76);

    const breathe = Math.sin(time * 0.9) * 0.5 + 0.5;
    const plumeBrightness = 0.85 + breathe * 0.3;
    const plumeGradient = ctx.createLinearGradient(60, centerY - 70, w - 40, centerY);
    plumeGradient.addColorStop(0, `rgba(15,22,36,${plumeBrightness})`);
    plumeGradient.addColorStop(0.32, `rgba(17,26,46,${plumeBrightness * 0.95})`);
    plumeGradient.addColorStop(1, '#05070d');

    ctx.fillStyle = plumeGradient;
    ctx.beginPath();
    ctx.moveTo(60, centerY - 42);
    ctx.quadraticCurveTo(w * 0.55, centerY - 68, w - 30, centerY - 22);
    ctx.lineTo(w - 30, centerY + 22);
    ctx.quadraticCurveTo(w * 0.55, centerY + 68, 60, centerY + 42);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 200, 120, 0.35)';
    ctx.lineWidth = 1.5;
    for (let s = 0; s < 7; s++) {
      const lane = (s - 3) * 9.5;
      const phase = (time * 95 + s * 67) % (w * 0.85);
      const x = 72 + phase;
      if (x > w - 40) continue;
      const y = centerY + lane + Math.sin(s * 1.7 + time * 1.1) * 3;
      const len = 28 + (s % 3) * 6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + Math.sin(s + time * 0.8) * 1.5);
      ctx.stroke();
      if (s % 2 === 0) {
        ctx.fillStyle = 'rgba(255, 235, 140, 0.5)';
        ctx.fillRect(x + len - 3, y - 1.5, 5, 3);
      }
    }

    diamonds.forEach((d, i) => {
      const y = centerY + (d.yOffset || 0);
      const width = d.width * (d.widthMod || 1);
      const alpha = Math.max(0.18, d.intensity * 0.92);
      const glow = 26 + d.intensity * 22;

      ctx.strokeStyle = `rgba(255, 94, 0, ${alpha * 0.75})`;
      ctx.lineWidth = glow;
      ctx.beginPath();
      ctx.ellipse(d.x, y, width * 0.92, 40 + i * 1.6, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 235, 59, ${alpha * 1.15})`;
      ctx.lineWidth = 6 + d.intensity * 4.5;
      ctx.beginPath();
      ctx.ellipse(d.x, y, width * 0.68, 20, 0, 0, Math.PI * 2);
      ctx.stroke();

      const innerAlpha = alpha * (0.75 + Math.sin(time * 3.4 + i) * 0.25);
      ctx.strokeStyle = `rgba(255, 255, 255, ${innerAlpha})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(d.x, y, width * 0.36, 8, 0, 0, Math.PI * 2);
      ctx.stroke();

      if (i < 4) {
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.75})`;
        ctx.font = '12px Space Mono, monospace';
        ctx.fillText(`#${d.index}`, d.x - 9, y - 52 - i * 2.5);
      }
    });

    if (diamonds.length > 0) {
      const waveX = 80 + ((time * 48) % (w * 0.78));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(waveX, centerY - 55);
      ctx.lineTo(waveX + 18, centerY + 55);
      ctx.stroke();
    }

    ctx.restore();
  }

  function animate() {
    if (!isPaused) {
      const time = Date.now() * 0.0018;
      diamonds.forEach((d, i) => {
        const phase = i * 0.7;
        const pulse = Math.sin(time * 2.1 + phase) * 0.5 + 0.5;
        d.intensity = 0.65 + pulse * 0.55;
        d.yOffset = Math.sin(time * 1.6 + phase) * 2.2;
        d.widthMod = 1 + Math.sin(time * 1.3 + phase * 1.3) * 0.18;
      });
      drawPlume(time);
    }
    animationFrame = requestAnimationFrame(animate);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Control wiring
  // ────────────────────────────────────────────────────────────────────────
  function setupControls() {
    ['p0', 'altitude', 'd0'].forEach(id => {
      const el = $maybe(id);
      if (!el) return;
      on(el, 'input', scheduleParamsUpdate);
      on(el, 'change', scheduleParamsUpdate);
    });

    on(document, 'keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = (e.key || '').toLowerCase();
      if (k === 'r') resetDefaults();
      else if (k === 'c') captureFrame();
      else if (k === 'p' || k === ' ') { e.preventDefault(); togglePause(); }
    });

    const pauseBtn = $maybe('pause-btn');
    if (pauseBtn) {
      on(pauseBtn, 'click', togglePause);
      pauseBtn.setAttribute('aria-pressed', 'false');
    }
    const resetBtn = $maybe('reset-btn');
    if (resetBtn) on(resetBtn, 'click', resetDefaults);
    const captureBtn = $maybe('capture-btn');
    if (captureBtn) on(captureBtn, 'click', captureFrame);
  }

  function setupPresets() {
    const container = $('presets');
    const presets = [
      { label: 'STARSHIP IFT-2',   p0: 2.8, altitude: 0,  d0: 0.85 },
      { label: 'HIGH ALTITUDE',    p0: 2.8, altitude: 12, d0: 0.85 },
      { label: 'FALCON 9',         p0: 1.9, altitude: 0,  d0: 0.52 },
      { label: 'MAX OVEREXPANDED', p0: 4.4, altitude: 0,  d0: 1.1 }
    ];
    presets.forEach(p => {
      const btn = document.createElement('button');
      btn.textContent = p.label;
      btn.className = 'px-4 py-1.5 text-xs border border-white/15 hover:bg-white/10 rounded-full font-mono tracking-wider transition-colors';
      on(btn, 'click', () => {
        if (activePresetBtn) activePresetBtn.classList.remove('bg-orange-500/20', 'border-orange-500');
        btn.classList.add('bg-orange-500/20', 'border-orange-500');
        activePresetBtn = btn;
        $('p0').value = p.p0;
        const altEl = $maybe('altitude');
        if (altEl) altEl.value = p.altitude;
        $('d0').value = p.d0;
        updateParamsFromUI();
      });
      container.appendChild(btn);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Public actions
  // ────────────────────────────────────────────────────────────────────────
  function resetDefaults() {
    if (activePresetBtn) {
      activePresetBtn.classList.remove('bg-orange-500/20', 'border-orange-500');
      activePresetBtn = null;
    }
    $('p0').value = 2.8;
    const altEl = $maybe('altitude');
    if (altEl) altEl.value = 0;
    $('d0').value = 0.85;
    updateParamsFromUI();
  }

  function captureFrame() {
    const link = document.createElement('a');
    link.download = `shockwave-lab-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function togglePause() {
    isPaused = !isPaused;
    const btn = $maybe('pause-btn');
    if (btn) {
      btn.textContent = isPaused ? 'RESUME' : 'PAUSE';
      btn.setAttribute('aria-pressed', String(isPaused));
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Init
  // ────────────────────────────────────────────────────────────────────────
  function init() {
    if (initialized) return;
    initialized = true;

    loadStateFromLocalStorage();

    $('p0').value = params.p0;
    $('d0').value = params.d0;
    const altEl = $maybe('altitude');
    if (altEl) {
      altEl.value = params.altitude;
      $('altitude-val').textContent = params.altitude.toFixed(1);
      params.pa = Physics.atmosphere(params.altitude).pa;
    }

    setupControls();
    setupPresets();
    updateParamsFromUI();
    animate();

    // Easter egg: clicking the canvas briefly boosts shock intensity
    on(canvas, 'click', () => {
      if (!diamonds.length) return;
      params.boostBonus = 0.14;
      updateModel();
      updateMetricsDOM();
      setTimeout(() => {
        if (params.boostBonus === 0.14) {
          params.boostBonus = 0;
          updateModel();
          updateMetricsDOM();
        }
      }, 650);
    });

    // First-Mach-disk tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'absolute hidden px-2 py-1 text-xs bg-black/80 text-white rounded pointer-events-none z-50 font-mono';
    tooltip.style.whiteSpace = 'nowrap';
    const simContainer = canvas.parentElement;
    simContainer.style.position = 'relative';
    simContainer.appendChild(tooltip);

    on(canvas, 'mousemove', (e) => {
      if (!diamonds.length) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) * (LOGICAL_WIDTH / rect.width);
      const first = diamonds[0];
      if (Math.abs(mouseX - first.x) < 40) {
        tooltip.textContent = 'First Mach disk (normal shock) — causes visible glow';
        tooltip.style.left = `${(first.x / LOGICAL_WIDTH) * rect.width + 12}px`;
        tooltip.style.top = '140px';
        tooltip.classList.remove('hidden');
        tooltip.classList.add('block');
      } else {
        tooltip.classList.remove('block');
        tooltip.classList.add('hidden');
      }
    });
    on(canvas, 'mouseleave', () => {
      tooltip.classList.remove('block');
      tooltip.classList.add('hidden');
    });

    on(window, 'pagehide', teardown);

    console.log('%c[GrokCLI] Shockwave Lab initialized — Pack/Prandtl spacing with isentropic Mach closure.', 'color:#888');
  }

  // ────────────────────────────────────────────────────────────────────────
  // Public surface
  // ────────────────────────────────────────────────────────────────────────
  window.ShockwaveLab = { resetDefaults, captureFrame, togglePause, teardown, Physics };

  init();
})();
