/**
 * GrokCLI Shockwave Lab — Interactive Physics Simulator
 * Educational real-time approximation of rocket exhaust shock diamonds (Mach diamonds).
 * Uses the well-known relation: x ≈ 0.67 * D0 * sqrt(P0 / Pa)
 */

const canvas = document.getElementById('plume-sim');
const ctx = canvas.getContext('2d', { alpha: true });

let params = {
  p0: 2.8,      // chamber pressure (relative)
  pa: 1.0,      // ambient pressure
  d0: 0.85,     // effective nozzle diameter (m)
  dissipation: 0.82
};

let animationFrame = null;
let diamonds = [];

function updateParamsFromUI() {
  params.p0 = parseFloat(document.getElementById('p0').value);
  params.pa = parseFloat(document.getElementById('pa').value);
  params.d0 = parseFloat(document.getElementById('d0').value);

  // Live labels
  document.getElementById('p0-val').textContent = params.p0.toFixed(2);
  document.getElementById('pa-val').textContent = params.pa.toFixed(2);
  document.getElementById('d0-val').textContent = params.d0.toFixed(2);

  calculateAndRender();
}

function calculatePhysics() {
  const ratio = params.p0 / params.pa;
  const firstDiamondDistance = 0.67 * params.d0 * Math.sqrt(Math.max(ratio, 0.01));

  // Number of visible diamonds (rough empirical model)
  const maxDiamonds = Math.floor(3 + (ratio * 2.8) * params.dissipation);
  const visibleDiamonds = Math.max(1, Math.min(12, maxDiamonds));

  // Approximate temperature jump across first normal shock (simplified γ ≈ 1.3 for hot exhaust)
  const gamma = 1.3;
  const machApprox = 3.2; // typical Raptor plume Mach
  const pressureJump = 1 + (2 * gamma / (gamma + 1)) * (machApprox * machApprox - 1);
  const tempJump = (pressureJump * (gamma - 1) + 2) / (gamma + 1); // rough normalized ΔT factor

  return {
    firstDiamond: firstDiamondDistance,
    visible: visibleDiamonds,
    tempJump: (tempJump * 420).toFixed(0), // very rough K delta for visualization
    pressureRatio: ratio.toFixed(2)
  };
}

function calculateDiamonds() {
  const ratio = params.p0 / params.pa;
  const baseSpacing = 0.67 * params.d0 * Math.sqrt(Math.max(ratio, 0.05));
  diamonds = [];

  let x = baseSpacing * 0.6; // first diamond a bit before theoretical
  let intensity = 1.0;

  for (let i = 0; i < 14; i++) {
    if (x > canvas.width * 0.92) break;
    if (intensity < 0.12) break;

    diamonds.push({
      x: x,
      width: 18 + i * 3,
      intensity: intensity,
      index: i + 1
    });

    // Spacing grows slightly then decays
    x += baseSpacing * (0.92 + i * 0.015);
    intensity *= params.dissipation * 0.96;
  }
}

function drawPlume(globalBreathe = 0.7, time = Date.now() * 0.0018) {
  const w = canvas.width;
  const h = canvas.height;
  const centerY = h / 2;

  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, w, h);

  // Nozzle (fixed)
  ctx.fillStyle = '#1f242f';
  ctx.fillRect(12, centerY - 52, 48, 104);
  ctx.fillStyle = '#ff5e00';
  ctx.fillRect(48, centerY - 38, 18, 76);

  // Plume core with time-based brightness breathing (makes the whole thing feel alive)
  const plumeBrightness = 0.85 + globalBreathe * 0.3;
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

  // === MOVING EXHAUST FLOW PARTICLES / STREAKS ===
  // These give very obvious motion even when parameters are not changing
  ctx.strokeStyle = 'rgba(255, 200, 120, 0.35)';
  ctx.lineWidth = 1.5;
  const flowSpeed = 95; // pixels per second
  const numStreaks = 7;

  for (let s = 0; s < numStreaks; s++) {
    const lane = (s - 3) * 9.5;                    // vertical spread
    const phase = (time * flowSpeed + s * 67) % (w * 0.85);
    const x = 72 + phase;

    if (x > w - 40) continue;

    // short flowing streak
    const y = centerY + lane + Math.sin(s * 1.7 + time * 1.1) * 3;
    const len = 28 + (s % 3) * 6;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + Math.sin(s + time * 0.8) * 1.5);
    ctx.stroke();

    // occasional brighter head
    if (s % 2 === 0) {
      ctx.fillStyle = 'rgba(255, 235, 140, 0.5)';
      ctx.fillRect(x + len - 3, y - 1.5, 5, 3);
    }
  }

  // === SHOCK DIAMONDS (now with rich time-based animation) ===
  diamonds.forEach((d, i) => {
    const y = centerY + (d.yOffset || 0);
    const width = d.width * (d.widthMod || 1);

    const alpha = Math.max(0.18, d.intensity * 0.92);
    const glow = 26 + d.intensity * 22;

    // Outer glow — strongly pulsing
    ctx.strokeStyle = `rgba(255, 94, 0, ${alpha * 0.75})`;
    ctx.lineWidth = glow;
    ctx.beginPath();
    ctx.ellipse(d.x, y, width * 0.92, 40 + i * 1.6, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Bright yellow core diamond
    ctx.strokeStyle = `rgba(255, 235, 59, ${alpha * 1.15})`;
    ctx.lineWidth = 6 + d.intensity * 4.5;
    ctx.beginPath();
    ctx.ellipse(d.x, y, width * 0.68, 20, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Hot white inner core (flickers more)
    const innerAlpha = alpha * (0.75 + Math.sin(time * 3.4 + i) * 0.25);
    ctx.strokeStyle = `rgba(255, 255, 255, ${innerAlpha})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(d.x, y, width * 0.36, 8, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Labels on first few (now with better contrast)
    if (i < 4) {
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.75})`;
      ctx.font = '11px Space Mono, monospace';
      ctx.fillText(`#${d.index}`, d.x - 9, y - 52 - i * 2.5);
    }
  });

  // Subtle traveling compression highlight that moves through the diamonds
  if (diamonds.length > 0) {
    const waveX = 80 + ((time * 48) % (w * 0.78));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(waveX, centerY - 55);
    ctx.lineTo(waveX + 18, centerY + 55);
    ctx.stroke();
  }
}

function updateMetrics(phys) {
  document.getElementById('first-diamond').textContent = phys.firstDiamond.toFixed(1) + ' m';
  document.getElementById('visible-diamonds').textContent = phys.visible;
  document.getElementById('temp-jump').textContent = phys.tempJump + ' K';
  document.getElementById('pressure-ratio').textContent = phys.pressureRatio + '×';

  document.getElementById('diamond-count').textContent = phys.visible;
}

function calculateAndRender() {
  calculateDiamonds();
  const phys = calculatePhysics();
  // Pass current animation state so drawPlume can render the living version
  const t = Date.now() * 0.0018;
  const breathe = Math.sin(t * 0.9) * 0.5 + 0.5;
  drawPlume(breathe, t);
  updateMetrics(phys);
}

function animate() {
  // Strong, obvious continuous animation so the lab feels alive
  const time = Date.now() * 0.0018;

  // Global plume breathing + traveling wave
  const globalBreathe = Math.sin(time * 0.9) * 0.5 + 0.5;

  diamonds.forEach((d, i) => {
    const phase = i * 0.7;
    // Strong pulsing on intensity
    const pulse = Math.sin(time * 2.1 + phase) * 0.5 + 0.5;
    d.intensity = 0.65 + pulse * 0.55;

    // Subtle vertical bob and width breathing (very visible)
    d.yOffset = Math.sin(time * 1.6 + phase) * 2.2;
    d.widthMod = 1 + Math.sin(time * 1.3 + phase * 1.3) * 0.18;
  });

  drawPlume(globalBreathe, time);
  animationFrame = requestAnimationFrame(animate);
}

function setupControls() {
  ['p0', 'pa', 'd0'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', updateParamsFromUI);
    el.addEventListener('change', updateParamsFromUI);
  });

  // Keyboard support
  document.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      resetDefaults();
    }
    if (e.key.toLowerCase() === 'c') {
      captureFrame();
    }
  });
}

function setupPresets() {
  const container = document.getElementById('presets');
  const presets = [
    { label: 'STARSHIP IFT-2', p0: 2.8, pa: 1.0, d0: 0.85 },
    { label: 'HIGH ALTITUDE', p0: 2.8, pa: 0.35, d0: 0.85 },
    { label: 'FALCON 9', p0: 1.9, pa: 1.0, d0: 0.52 },
    { label: 'MAX OVEREXPANDED', p0: 4.4, pa: 1.35, d0: 1.1 }
  ];

  presets.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p.label;
    btn.className = 'px-4 py-1.5 text-xs border border-white/15 hover:bg-white/10 rounded-full font-mono tracking-wider transition-colors';
    btn.onclick = () => {
      document.getElementById('p0').value = p.p0;
      document.getElementById('pa').value = p.pa;
      document.getElementById('d0').value = p.d0;
      updateParamsFromUI();
    };
    container.appendChild(btn);
  });
}

function resetDefaults() {
  document.getElementById('p0').value = 2.8;
  document.getElementById('pa').value = 1.0;
  document.getElementById('d0').value = 0.85;
  updateParamsFromUI();
}

function captureFrame() {
  const link = document.createElement('a');
  link.download = `shockwave-lab-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function init() {
  // Initial UI sync
  document.getElementById('p0').value = params.p0;
  document.getElementById('pa').value = params.pa;
  document.getElementById('d0').value = params.d0;

  setupControls();
  setupPresets();

  // First physics + render
  updateParamsFromUI();

  // Gentle continuous animation
  animate();

  // Easter egg: click canvas to "ignite" stronger diamonds temporarily
  canvas.addEventListener('click', () => {
    if (diamonds.length > 0) {
      const orig = params.dissipation;
      params.dissipation = 0.96;
      calculateAndRender();
      setTimeout(() => {
        params.dissipation = orig;
        calculateAndRender();
      }, 650);
    }
  });

  // Make sure everything is crisp on resize (simple)
  window.addEventListener('resize', () => {
    // Canvas is fixed size in HTML for predictability in this demo
  });

  console.log('%c[GrokCLI] Shockwave Lab simulator initialized. Physics model is educational.', 'color:#555');
}

window.resetDefaults = resetDefaults;
window.captureFrame = captureFrame;

init();
