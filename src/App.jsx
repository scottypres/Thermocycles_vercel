import { useState, useMemo, useRef, useEffect, useCallback } from "react";

/* ───────── Steam Property Data ───────── */
const STEAM_TABLE = [
  { P: 1, T: 6.98, hf: 29.3, hg: 2514.2, sf: 0.106, sg: 8.976, vf: 0.001000, vg: 129.2 },
  { P: 5, T: 32.9, hf: 137.8, hg: 2561.5, sf: 0.476, sg: 8.395, vf: 0.001005, vg: 28.19 },
  { P: 10, T: 45.8, hf: 191.8, hg: 2584.7, sf: 0.649, sg: 8.150, vf: 0.001010, vg: 14.67 },
  { P: 20, T: 60.1, hf: 251.4, hg: 2609.7, sf: 0.832, sg: 7.908, vf: 0.001017, vg: 7.649 },
  { P: 50, T: 81.3, hf: 340.5, hg: 2645.9, sf: 1.091, sg: 7.593, vf: 0.001030, vg: 3.240 },
  { P: 75, T: 91.8, hf: 384.4, hg: 2663.0, sf: 1.213, sg: 7.456, vf: 0.001037, vg: 2.217 },
  { P: 100, T: 99.6, hf: 417.4, hg: 2675.5, sf: 1.303, sg: 7.359, vf: 0.001043, vg: 1.694 },
  { P: 200, T: 120.2, hf: 504.7, hg: 2706.7, sf: 1.530, sg: 7.127, vf: 0.001061, vg: 0.8857 },
  { P: 300, T: 133.6, hf: 561.5, hg: 2725.3, sf: 1.672, sg: 6.992, vf: 0.001073, vg: 0.6058 },
  { P: 500, T: 151.9, hf: 640.2, hg: 2748.7, sf: 1.861, sg: 6.822, vf: 0.001093, vg: 0.3749 },
  { P: 750, T: 167.8, hf: 709.3, hg: 2766.4, sf: 2.020, sg: 6.685, vf: 0.001112, vg: 0.2556 },
  { P: 1000, T: 179.9, hf: 762.8, hg: 2778.1, sf: 2.139, sg: 6.586, vf: 0.001127, vg: 0.1944 },
  { P: 1500, T: 198.3, hf: 844.8, hg: 2792.2, sf: 2.315, sg: 6.444, vf: 0.001154, vg: 0.1318 },
  { P: 2000, T: 212.4, hf: 908.8, hg: 2799.5, sf: 2.447, sg: 6.340, vf: 0.001177, vg: 0.09963 },
  { P: 3000, T: 233.9, hf: 1008.4, hg: 2804.2, sf: 2.646, sg: 6.187, vf: 0.001217, vg: 0.06668 },
  { P: 4000, T: 250.4, hf: 1087.3, hg: 2801.4, sf: 2.797, sg: 6.070, vf: 0.001253, vg: 0.04978 },
  { P: 5000, T: 263.9, hf: 1154.2, hg: 2794.3, sf: 2.921, sg: 5.974, vf: 0.001286, vg: 0.03944 },
  { P: 6000, T: 275.6, hf: 1213.4, hg: 2784.3, sf: 3.028, sg: 5.890, vf: 0.001319, vg: 0.03244 },
  { P: 8000, T: 295.1, hf: 1316.6, hg: 2758.0, sf: 3.208, sg: 5.745, vf: 0.001384, vg: 0.02352 },
  { P: 10000, T: 311.1, hf: 1407.6, hg: 2724.7, sf: 3.360, sg: 5.616, vf: 0.001453, vg: 0.01803 },
  { P: 15000, T: 342.2, hf: 1610.5, hg: 2610.5, sf: 3.685, sg: 5.310, vf: 0.001658, vg: 0.01034 },
  { P: 20000, T: 365.8, hf: 1826.3, hg: 2409.7, sf: 3.987, sg: 4.924, vf: 0.002036, vg: 0.005834 },
  { P: 22064, T: 374.0, hf: 2099.3, hg: 2099.3, sf: 4.410, sg: 4.410, vf: 0.003155, vg: 0.003155 },
];

function lerp(x, x0, x1, y0, y1) {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}
function interpSteam(P, prop) {
  if (P <= STEAM_TABLE[0].P) return STEAM_TABLE[0][prop];
  if (P >= STEAM_TABLE[STEAM_TABLE.length - 1].P) return STEAM_TABLE[STEAM_TABLE.length - 1][prop];
  for (let i = 0; i < STEAM_TABLE.length - 1; i++) {
    if (P >= STEAM_TABLE[i].P && P <= STEAM_TABLE[i + 1].P)
      return lerp(P, STEAM_TABLE[i].P, STEAM_TABLE[i + 1].P, STEAM_TABLE[i][prop], STEAM_TABLE[i + 1][prop]);
  }
  return STEAM_TABLE[STEAM_TABLE.length - 1][prop];
}

/* Get sf and sg at a given temperature by interpolating the dome */
function getDomeBounds(T) {
  if (T <= STEAM_TABLE[0].T || T >= 374.0) return null;
  for (let i = 0; i < STEAM_TABLE.length - 1; i++) {
    if (T >= STEAM_TABLE[i].T && T <= STEAM_TABLE[i + 1].T) {
      const sf = lerp(T, STEAM_TABLE[i].T, STEAM_TABLE[i + 1].T, STEAM_TABLE[i].sf, STEAM_TABLE[i + 1].sf);
      const sg = lerp(T, STEAM_TABLE[i].T, STEAM_TABLE[i + 1].T, STEAM_TABLE[i].sg, STEAM_TABLE[i + 1].sg);
      return { sf, sg };
    }
  }
  return null;
}

function getPhaseInfo(s, T) {
  const bounds = getDomeBounds(T);
  if (!bounds) {
    if (T >= 374.0) return { phase: "supercritical", quality: null };
    return { phase: "subcooled", quality: 0 };
  }
  if (s < bounds.sf) return { phase: "subcooled", quality: 0 };
  if (s > bounds.sg) return { phase: "superheated", quality: 1 };
  const x = (s - bounds.sf) / (bounds.sg - bounds.sf);
  return { phase: "two-phase", quality: Math.max(0, Math.min(1, x)) };
}

const CP_STEAM = 2.08;

function calculateCycle(pHigh, pLow, tSuperheat) {
  const Tsat_high = interpSteam(pHigh, "T");
  const Tsat_low = interpSteam(pLow, "T");
  const hf_low = interpSteam(pLow, "hf"); const hg_low = interpSteam(pLow, "hg");
  const sf_low = interpSteam(pLow, "sf"); const sg_low = interpSteam(pLow, "sg");
  const hf_high = interpSteam(pHigh, "hf"); const hg_high = interpSteam(pHigh, "hg");
  const sf_high = interpSteam(pHigh, "sf"); const sg_high = interpSteam(pHigh, "sg");
  const T3 = Math.max(tSuperheat, Tsat_high + 5);
  const T1 = Tsat_low; const h1 = hf_low; const s1 = sf_low;
  const vf = 0.001;
  const wPump = vf * (pHigh - pLow);
  const h2 = h1 + wPump;
  const s2 = s1 + 0.0001 * Math.log(pHigh / pLow);
  const T2 = T1 + wPump / 4.18;
  const h3 = hg_high + CP_STEAM * (T3 - Tsat_high);
  const s3 = sg_high + CP_STEAM * Math.log((T3 + 273.15) / (Tsat_high + 273.15));
  const s4 = s3;
  let x4, h4, T4;
  if (s4 <= sf_low) { x4 = 0; h4 = hf_low; T4 = Tsat_low; }
  else if (s4 >= sg_low) { x4 = 1; h4 = hg_low; T4 = Tsat_low + (s4 - sg_low) / CP_STEAM * (Tsat_low + 273.15); }
  else { x4 = (s4 - sf_low) / (sg_low - sf_low); h4 = hf_low + x4 * (hg_low - hf_low); T4 = Tsat_low; }
  const wTurbine = h3 - h4; const qIn = h3 - h2; const qOut = h4 - h1;
  const wNet = wTurbine - wPump; const eta = wNet / qIn; const bwr = wPump / wTurbine;
  const boilerPath = [];
  for (let i = 0; i <= 8; i++) { const f = i / 8; boilerPath.push({ s: lerp(f, 0, 1, s2, sf_high), T: lerp(f, 0, 1, T2, Tsat_high) }); }
  for (let i = 1; i <= 12; i++) { const f = i / 12; boilerPath.push({ s: lerp(f, 0, 1, sf_high, sg_high), T: Tsat_high }); }
  for (let i = 1; i <= 8; i++) { const f = i / 8; boilerPath.push({ s: lerp(f, 0, 1, sg_high, s3), T: lerp(f, 0, 1, Tsat_high, T3) }); }
  return {
    states: [
      { label: "1", T: T1, s: s1, h: h1, P: pLow, desc: "Sat. Liquid" },
      { label: "2", T: T2, s: s2, h: h2, P: pHigh, desc: "Comp. Liquid" },
      { label: "3", T: T3, s: s3, h: h3, P: pHigh, desc: "Superheated" },
      { label: "4", T: T4, s: s4, h: h4, P: pLow, desc: "Wet Steam" },
    ],
    Tsat_high, Tsat_low, wTurbine, wPump, wNet, qIn, qOut, eta, bwr, x4,
    boilerPath, h1, h2, h3, h4, s1, s2, s3, s4, T1, T2, T3, T4,
  };
}

/* ───────── Palette ───────── */
const K = {
  bg: "#fafaf7", card: "#ffffff", cardAlt: "#f5f4f0",
  border: "#d4d0c8", ink: "#1a1a2e", inkMed: "#3a3a5c", inkLight: "#5c5c78",
  gridFine: "#e8e6e0", gridMajor: "#d4d0c8",
  accent: "#c0392b", accentLight: "#c0392b22",
  heatIn: "#c0392b", heatOut: "#2471a3", workOut: "#1e8449", workIn: "#b7950b",
  dome: "#2471a322", domeLine: "#2471a366",
  stateCircle: "#1a1a2e", stateFill: "#c0392b",
  liquidBlue: "#2471a3", vaporRed: "#c0392b",
};
const FD = "'DM Serif Display',serif";
const FM = "'DM Mono',monospace";

const domeLeft = STEAM_TABLE.map(r => ({ s: r.sf, T: r.T }));
const domeRight = [...STEAM_TABLE].reverse().map(r => ({ s: r.sg, T: r.T }));
const domeCurve = [...domeLeft, ...domeRight];

/* ───────── T-s mapping ───────── */
const TS_W = 360, TS_H = 285;
const TS_PAD = { l: 38, r: 6, t: 14, b: 28 };
const TS_PLOT = { x: TS_PAD.l, y: TS_PAD.t, w: TS_W - TS_PAD.l - TS_PAD.r, h: TS_H - TS_PAD.t - TS_PAD.b };
const S_MIN = 0, S_MAX = 9.5, T_MIN = 0, T_MAX = 650;
function mapS(s) { return TS_PLOT.x + ((s - S_MIN) / (S_MAX - S_MIN)) * TS_PLOT.w; }
function mapT(T) { return TS_PLOT.y + TS_PLOT.h - ((T - T_MIN) / (T_MAX - T_MIN)) * TS_PLOT.h; }
function unmapS(px) { return S_MIN + ((px - TS_PLOT.x) / TS_PLOT.w) * (S_MAX - S_MIN); }
function unmapT(py) { return T_MIN + ((TS_PLOT.y + TS_PLOT.h - py) / TS_PLOT.h) * (T_MAX - T_MIN); }

/* ───────── Particle Phase Visualizer ───────── */
const NUM_PARTICLES = 60;

function tempColor(T, quality) {
  const tNorm = Math.min(1, Math.max(0, T / 500));
  if (quality !== null && quality < 1) {
    // blend blue to red based on temp
    const r = Math.round(40 + tNorm * 180);
    const g = Math.round(60 + (1 - tNorm) * 40);
    const b = Math.round(180 - tNorm * 140);
    return `rgb(${r},${g},${b})`;
  }
  const r = Math.round(50 + tNorm * 190);
  const g = Math.round(40 + (1 - tNorm) * 30);
  const b = Math.round(60 - tNorm * 30);
  return `rgb(${r},${g},${b})`;
}

function ParticleVisualizer({ phaseInfo, temperature, fillHeight }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef(null);
  const animRef = useRef(null);

  const W = 680, H = 480;
  const quality = phaseInfo.quality !== null ? phaseInfo.quality : (phaseInfo.phase === "superheated" || phaseInfo.phase === "supercritical" ? 1 : 0);
  const phase = phaseInfo.phase;
  const tNorm = Math.min(1, Math.max(0, temperature / 500));

  // Initialize particles
  if (!particlesRef.current) {
    particlesRef.current = Array.from({ length: NUM_PARTICLES }, (_, i) => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      r: 5 + Math.random() * 3,
      id: i,
    }));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const liquidLevel = H * (1 - quality); // y position of liquid surface
    const speedBase = 0.6 + tNorm * 6;
    const vaporSpeed = speedBase * 1.5;
    const liquidSpeed = speedBase * 0.2;

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // Draw liquid body
      if (quality < 1) {
        const grad = ctx.createLinearGradient(0, liquidLevel, 0, H);
        const lAlpha = 0.15 + (1 - quality) * 0.2;
        grad.addColorStop(0, `rgba(36,113,163,${lAlpha * 0.5})`);
        grad.addColorStop(1, `rgba(36,113,163,${lAlpha})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, liquidLevel, W, H - liquidLevel);

        // Liquid surface line
        ctx.strokeStyle = `rgba(36,113,163,${0.3 + (1 - quality) * 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, liquidLevel);
        // Slight wave
        for (let wx = 0; wx <= W; wx += 4) {
          const wave = Math.sin(wx * 0.04 + Date.now() * 0.002) * 2;
          ctx.lineTo(wx, liquidLevel + wave);
        }
        ctx.stroke();
      }

      // Update and draw particles
      const particles = particlesRef.current;
      particles.forEach((p, i) => {
        const isVapor = i < Math.floor(quality * NUM_PARTICLES);

        if (phase === "subcooled") {
          // All liquid - slow, clustered at bottom
          p.vy += 0.05;
          p.vx *= 0.98;
          p.vy *= 0.98;
          const speed = liquidSpeed;
          p.vx += (Math.random() - 0.5) * speed * 0.3;
          p.vy += (Math.random() - 0.5) * speed * 0.1;
          if (p.y < H * 0.5) p.vy += 0.1;
        } else if (phase === "superheated" || phase === "supercritical") {
          // All vapor - fast, spread out
          p.vx += (Math.random() - 0.5) * vaporSpeed * 0.5;
          p.vy += (Math.random() - 0.5) * vaporSpeed * 0.5;
          p.vx *= 0.96;
          p.vy *= 0.96;
        } else {
          // Two-phase
          if (isVapor) {
            // Vapor - above liquid line, faster
            p.vx += (Math.random() - 0.5) * vaporSpeed * 0.4;
            p.vy += (Math.random() - 0.5) * vaporSpeed * 0.4;
            p.vx *= 0.96;
            p.vy *= 0.96;
            if (p.y > liquidLevel - 5) p.vy -= 0.3;
          } else {
            // Liquid - below surface, slower
            p.vy += 0.04;
            p.vx *= 0.97;
            p.vy *= 0.97;
            p.vx += (Math.random() - 0.5) * liquidSpeed * 0.4;
            p.vy += (Math.random() - 0.5) * liquidSpeed * 0.2;
            if (p.y < liquidLevel + 5) p.vy += 0.15;
          }
        }

        // Clamp velocity
        const maxV = isVapor ? vaporSpeed * 2 : liquidSpeed * 3;
        const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (v > maxV) { p.vx = (p.vx / v) * maxV; p.vy = (p.vy / v) * maxV; }

        p.x += p.vx;
        p.y += p.vy;

        // Bounce off walls
        if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx); }
        if (p.x > W - p.r) { p.x = W - p.r; p.vx = -Math.abs(p.vx); }
        if (p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy); }
        if (p.y > H - p.r) { p.y = H - p.r; p.vy = -Math.abs(p.vy); }

        // Draw
        const pAlpha = isVapor ? 0.7 : 0.85;
        if (isVapor) {
          // Vapor: red-ish, smaller, more transparent
          const r2 = p.r * (0.6 + tNorm * 0.3);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${160 + Math.round(tNorm * 60)}, ${50 + Math.round((1 - tNorm) * 30)}, ${40}, ${pAlpha * 0.7})`;
          ctx.fill();
          // glow
          ctx.beginPath();
          ctx.arc(p.x, p.y, r2 + 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${180 + Math.round(tNorm * 40)}, ${60}, ${40}, 0.1)`;
          ctx.fill();
        } else {
          // Liquid: blue, denser
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 0.85, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(36, 113, 163, ${pAlpha})`;
          ctx.fill();
        }
      });

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [quality, phase, tNorm]);

  const phaseLabel = phase === "two-phase" ? "Two-Phase Mixture" :
    phase === "subcooled" ? "Subcooled Liquid" :
    phase === "superheated" ? "Superheated Vapor" : "Supercritical";

  return (
    <div style={{ position: "relative", ...(fillHeight ? { flex: 1, display: "flex", flexDirection: "column" } : {}) }}>
      <canvas ref={canvasRef} width={W} height={H}
        style={{ width: "100%", display: "block", border: `1.5px solid ${K.ink}`, background: "#f8f7f4", ...(fillHeight ? { flex: 1, height: 0 } : { height: "auto" }) }} />
      {/* Overlay info */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", pointerEvents: "none",
      }}>
        {phase === "two-phase" && (
          <div style={{
            background: "rgba(255,255,255,0.88)", padding: "8px 18px",
            border: `1.5px solid ${K.ink}`, textAlign: "center",
          }}>
            <div style={{ fontSize: 28, fontFamily: FD, color: K.accent, lineHeight: 1.1 }}>
              {(quality * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: 9, fontFamily: FM, color: K.inkMed, letterSpacing: 1, marginTop: 2 }}>
              QUALITY (x)
            </div>
          </div>
        )}
        {phase !== "two-phase" && (
          <div style={{
            background: "rgba(255,255,255,0.88)", padding: "6px 14px",
            border: `1.5px solid ${K.ink}`, textAlign: "center",
          }}>
            <div style={{ fontSize: 14, fontFamily: FD, color: K.ink, lineHeight: 1.2 }}>
              {phaseLabel}
            </div>
            <div style={{ fontSize: 9, fontFamily: FM, color: K.inkMed, marginTop: 2 }}>
              {phase === "subcooled" ? "x = 0 (all liquid)" : "x = 1 (all vapor)"}
            </div>
          </div>
        )}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: K.liquidBlue }} />
          <span style={{ fontSize: 9, fontFamily: FM, color: K.inkLight }}>Liquid</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: K.vaporRed }} />
          <span style={{ fontSize: 9, fontFamily: FM, color: K.inkLight }}>Vapor</span>
        </div>
        <div style={{ fontSize: 9, fontFamily: FM, color: K.inkLight }}>
          T = {temperature.toFixed(0)}°C
        </div>
      </div>
    </div>
  );
}

/* ───────── Interactive T-s Diagram ───────── */
function TsDiagram({ cycle, dragPoint, onDrag, lockS, lockT, showAreas }) {
  const svgRef = useRef(null);
  const draggingRef = useRef(false);

  const domePathD = domeCurve.map((p, i) => `${i === 0 ? "M" : "L"}${mapS(p.s).toFixed(1)},${mapT(p.T).toFixed(1)}`).join(" ") + " Z";
  const boilerD = cycle.boilerPath.map((p, i) => `${i === 0 ? "M" : "L"}${mapS(p.s).toFixed(1)},${mapT(p.T).toFixed(1)}`).join(" ");
  const st = cycle.states;
  const cycleFillD = [boilerD, `L${mapS(st[3].s).toFixed(1)},${mapT(st[3].T).toFixed(1)}`, `L${mapS(st[0].s).toFixed(1)},${mapT(st[0].T).toFixed(1)}`, "Z"].join(" ");

  const getSvgPoint = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = TS_W / rect.width;
    const scaleY = TS_H / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    // Clamp pixel coords to plot area
    const px = Math.max(TS_PLOT.x, Math.min(TS_PLOT.x + TS_PLOT.w, (clientX - rect.left) * scaleX));
    const py = Math.max(TS_PLOT.y, Math.min(TS_PLOT.y + TS_PLOT.h, (clientY - rect.top) * scaleY));
    const s = lockS ? dragPoint.s : Math.max(0.1, Math.min(9.4, unmapS(px)));
    const T = lockT ? dragPoint.T : Math.max(5, Math.min(640, unmapT(py)));
    return { s, T };
  }, [lockS, lockT, dragPoint.s, dragPoint.T]);

  const handleStart = useCallback((e) => {
    if (e.touches && e.touches.length === 0) return;
    draggingRef.current = true;
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgPoint, onDrag]);

  const handleMove = useCallback((e) => {
    if (!draggingRef.current) return;
    if (e.touches && e.touches.length === 0) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgPoint, onDrag]);

  const handleEnd = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const dpx = mapS(dragPoint.s);
  const dpy = mapT(dragPoint.T);
  const phaseInfo = getPhaseInfo(dragPoint.s, dragPoint.T);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${TS_W} ${TS_H}`} style={{ width: "100%", touchAction: "none", cursor: "crosshair" }}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
      {/* Fine grid */}
      {Array.from({ length: 39 }, (_, i) => i * 0.25).map((s, idx) => (
        <line key={`fg${idx}`} x1={mapS(s)} y1={TS_PLOT.y} x2={mapS(s)} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.gridFine} strokeWidth={0.4} />
      ))}
      {Array.from({ length: 27 }, (_, i) => i * 25).map((t, idx) => (
        <line key={`fgt${idx}`} x1={TS_PLOT.x} y1={mapT(t)} x2={TS_PLOT.x + TS_PLOT.w} y2={mapT(t)} stroke={K.gridFine} strokeWidth={0.4} />
      ))}
      {[0,1,2,3,4,5,6,7,8,9].map(s => (
        <line key={`sg${s}`} x1={mapS(s)} y1={TS_PLOT.y} x2={mapS(s)} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.gridMajor} strokeWidth={0.5} />
      ))}
      {[0,100,200,300,400,500,600].map(t => (
        <line key={`tg${t}`} x1={TS_PLOT.x} y1={mapT(t)} x2={TS_PLOT.x + TS_PLOT.w} y2={mapT(t)} stroke={K.gridMajor} strokeWidth={0.5} />
      ))}
      <line x1={TS_PLOT.x} y1={TS_PLOT.y + TS_PLOT.h} x2={TS_PLOT.x + TS_PLOT.w} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      <line x1={TS_PLOT.x} y1={TS_PLOT.y} x2={TS_PLOT.x} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      {[1,2,3,4,5,6,7,8,9].map(s => (
        <g key={`st${s}`}>
          <line x1={mapS(s)} y1={TS_PLOT.y + TS_PLOT.h} x2={mapS(s)} y2={TS_PLOT.y + TS_PLOT.h + 4} stroke={K.ink} strokeWidth={0.8} />
          <text x={mapS(s)} y={TS_PLOT.y + TS_PLOT.h + 10} fill={K.inkMed} fontSize={6.5} textAnchor="middle" fontFamily={FM}>{s}</text>
        </g>
      ))}
      {[100,200,300,400,500,600].map(t => (
        <g key={`tt${t}`}>
          <line x1={TS_PLOT.x - 3} y1={mapT(t)} x2={TS_PLOT.x} y2={mapT(t)} stroke={K.ink} strokeWidth={0.8} />
          <text x={TS_PLOT.x - 4} y={mapT(t) + 2.5} fill={K.inkMed} fontSize={6.5} textAnchor="end" fontFamily={FM}>{t}</text>
        </g>
      ))}
      <text x={TS_W / 2} y={TS_H - 5} fill={K.inkMed} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic">s (kJ/kg·K)</text>
      <text x={10} y={TS_H / 2 - 8} fill={K.inkMed} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic" transform={`rotate(-90,10,${TS_H / 2 - 8})`}>T (°C)</text>
      {/* Dome */}
      <path d={domePathD} fill={showAreas ? "none" : K.dome} stroke={K.domeLine} strokeWidth={1} strokeDasharray="6 3" />
      {showAreas && (() => {
        const axisY = TS_PLOT.y + TS_PLOT.h;
        // Q_in area: under boiler path (1→2→3) down to T=0 axis
        const qInD = [
          `M${mapS(st[0].s).toFixed(1)},${axisY.toFixed(1)}`,
          `L${mapS(st[0].s).toFixed(1)},${mapT(st[0].T).toFixed(1)}`,
          `L${mapS(st[1].s).toFixed(1)},${mapT(st[1].T).toFixed(1)}`,
          boilerD.replace(/^M/, "L"),
          `L${mapS(st[2].s).toFixed(1)},${axisY.toFixed(1)}`,
          "Z"
        ].join(" ");
        // Q_out area: under condenser line (4→1) down to T=0 axis
        const qOutD = [
          `M${mapS(st[0].s).toFixed(1)},${axisY.toFixed(1)}`,
          `L${mapS(st[0].s).toFixed(1)},${mapT(st[0].T).toFixed(1)}`,
          `L${mapS(st[3].s).toFixed(1)},${mapT(st[3].T).toFixed(1)}`,
          `L${mapS(st[3].s).toFixed(1)},${axisY.toFixed(1)}`,
          "Z"
        ].join(" ");
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        return (
          <>
            <path d={qInD} fill={`${K.heatIn}18`} stroke="none" />
            <path d={qOutD} fill={`${K.heatOut}18`} stroke="none" />
            <path d={cycleFillD} fill={`${K.workOut}25`} stroke="none" />
          </>
        );
      })()}
      {!showAreas && <path d={cycleFillD} fill={K.accentLight} stroke="none" />}
      {/* Process lines */}
      <line x1={mapS(st[0].s)} y1={mapT(st[0].T)} x2={mapS(st[1].s)} y2={mapT(st[1].T)} stroke={K.workIn} strokeWidth={2.2} strokeLinecap="round" />
      <path d={boilerD} fill="none" stroke={K.heatIn} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={mapS(st[2].s)} y1={mapT(st[2].T)} x2={mapS(st[3].s)} y2={mapT(st[3].T)} stroke={K.workOut} strokeWidth={2.2} strokeLinecap="round" />
      <line x1={mapS(st[3].s)} y1={mapT(st[3].T)} x2={mapS(st[0].s)} y2={mapT(st[0].T)} stroke={K.heatOut} strokeWidth={2.2} strokeLinecap="round" />
      {!showAreas && <>
        {/* Dimension lines for drag point - solid when locked */}
        <line x1={dpx} y1={dpy} x2={dpx} y2={TS_PLOT.y + TS_PLOT.h} stroke={lockS ? K.accent : K.inkLight} strokeWidth={lockS ? 1.2 : 0.5} strokeDasharray={lockS ? "none" : "2 2"} />
        <line x1={dpx} y1={dpy} x2={TS_PLOT.x} y2={dpy} stroke={lockT ? K.accent : K.inkLight} strokeWidth={lockT ? 1.2 : 0.5} strokeDasharray={lockT ? "none" : "2 2"} />
        {lockT && <line x1={TS_PLOT.x} y1={dpy} x2={TS_PLOT.x + TS_PLOT.w} y2={dpy} stroke={K.accent} strokeWidth={0.6} strokeDasharray="4 3" opacity={0.4} />}
        {lockS && <line x1={dpx} y1={TS_PLOT.y} x2={dpx} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.accent} strokeWidth={0.6} strokeDasharray="4 3" opacity={0.4} />}
      </>}
      {/* State points */}
      {st.map((s, i) => {
        const cx = mapS(s.s), cy = mapT(s.T);
        const off = [{ dx: -14, dy: 14 }, { dx: -14, dy: -10 }, { dx: 8, dy: -10 }, { dx: 8, dy: 14 }];
        const tx = cx + off[i].dx, ty = cy + off[i].dy;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={5} fill="#fff" stroke={K.stateCircle} strokeWidth={1.2} />
            <circle cx={cx} cy={cy} r={1.8} fill={K.stateFill} />
            <rect x={tx - 7} y={ty - 10} width={14} height={13} rx={1} fill="#fff" />
            <text x={tx} y={ty} fill={K.accent} fontSize={12} fontFamily={FD} textAnchor="middle">{s.label}</text>
          </g>
        );
      })}
      {!showAreas && <>
        {/* Draggable point */}
        <circle cx={dpx} cy={dpy} r={9} fill="rgba(192,57,43,0.15)" stroke={K.accent} strokeWidth={2} />
        <circle cx={dpx} cy={dpy} r={4} fill={K.accent} />
        {/* Drag point label */}
        <rect x={dpx + 12} y={dpy - 22} width={70} height={18} rx={2} fill="#fff" stroke={K.ink} strokeWidth={0.8} />
        <text x={dpx + 16} y={dpy - 10} fill={K.ink} fontSize={8} fontFamily={FM}>
          {dragPoint.T.toFixed(0)}°C, {dragPoint.s.toFixed(2)}
        </text>
        {/* Labels */}
        <text x={mapS((st[2].s + st[3].s) / 2) + 16} y={mapT((st[2].T + st[3].T) / 2)} fill={K.workOut} fontSize={7} fontFamily={FM} fontWeight="500">Turbine</text>
        <text x={mapS((st[0].s + st[3].s) / 2)} y={mapT(st[0].T) + 13} fill={K.heatOut} fontSize={7} fontFamily={FM} textAnchor="middle" fontWeight="500">Condenser</text>
        <text x={mapS(st[0].s) - 10} y={mapT((st[0].T + st[1].T) / 2)} fill={K.workIn} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="end">Pump</text>
        <text x={mapS((st[1].s + st[2].s) / 2)} y={mapT(cycle.Tsat_high) - 8} fill={K.heatIn} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="middle">Boiler</text>
        {/* Instruction hint */}
        <text x={TS_W - 8} y={TS_PLOT.y + 10} fill={K.inkLight} fontSize={7} fontFamily={FM} textAnchor="end" fontStyle="italic">{lockS ? "s locked" : lockT ? "T locked" : "tap & drag"}</text>
      </>}
      {showAreas && (() => {
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        const lx = TS_PLOT.x + 6;
        const ly = TS_PLOT.y + 4;
        return (
          <>
            <rect x={lx} y={ly} width={152} height={52} rx={2} fill="#fff" stroke={K.border} strokeWidth={0.8} />
            {/* Q_in */}
            <rect x={lx + 5} y={ly + 5} width={8} height={8} rx={1} fill={`${K.heatIn}30`} stroke={K.heatIn} strokeWidth={0.6} />
            <text x={lx + 17} y={ly + 12} fill={K.heatIn} fontSize={8} fontFamily={FM}>Q_in (1→3) = {fmt(cycle.qIn)} kJ/kg</text>
            {/* Q_out */}
            <rect x={lx + 5} y={ly + 18} width={8} height={8} rx={1} fill={`${K.heatOut}30`} stroke={K.heatOut} strokeWidth={0.6} />
            <text x={lx + 17} y={ly + 25} fill={K.heatOut} fontSize={8} fontFamily={FM}>Q_out (4→1) = {fmt(cycle.qOut)} kJ/kg</text>
            {/* W_net */}
            <rect x={lx + 5} y={ly + 31} width={8} height={8} rx={1} fill={`${K.workOut}40`} stroke={K.workOut} strokeWidth={0.6} />
            <text x={lx + 17} y={ly + 38} fill={K.workOut} fontSize={8} fontFamily={FM}>W_net (1→3→4→1) = {fmt(cycle.wNet)} kJ/kg</text>
            {/* η */}
            <text x={lx + 5} y={ly + 49} fill={K.ink} fontSize={8} fontFamily={FD} fontWeight="bold">η = {(cycle.eta * 100).toFixed(1)}%</text>
          </>
        );
      })()}
    </svg>
  );
}

/* ───────── P-v Diagram ───────── */
const PV_W = 360, PV_H = 285;
const PV_PAD = { l: 38, r: 6, t: 14, b: 28 };
const PV_PLOT = { x: PV_PAD.l, y: PV_PAD.t, w: PV_W - PV_PAD.l - PV_PAD.r, h: PV_H - PV_PAD.t - PV_PAD.b };
const V_MIN_LOG = -3.2, V_MAX_LOG = 2.5; // log10(v) range: 0.00063 to ~316
const P_MIN_LOG = 0, P_MAX_LOG = 4.5; // log10(P) range: 1 to ~31623

function mapV(v) { const lv = Math.log10(Math.max(1e-4, v)); return PV_PLOT.x + ((lv - V_MIN_LOG) / (V_MAX_LOG - V_MIN_LOG)) * PV_PLOT.w; }
function mapP(P) { const lp = Math.log10(Math.max(1, P)); return PV_PLOT.y + PV_PLOT.h - ((lp - P_MIN_LOG) / (P_MAX_LOG - P_MIN_LOG)) * PV_PLOT.h; }
function unmapV(px) { const lv = V_MIN_LOG + ((px - PV_PLOT.x) / PV_PLOT.w) * (V_MAX_LOG - V_MIN_LOG); return Math.pow(10, lv); }
function unmapP(py) { const lp = P_MIN_LOG + ((PV_PLOT.y + PV_PLOT.h - py) / PV_PLOT.h) * (P_MAX_LOG - P_MIN_LOG); return Math.pow(10, lp); }

/* Convert (v,P) drag to approximate (s,T) */
function pvToST(v, P) {
  const Pclamp = Math.max(2, Math.min(20000, P));
  const Tsat = interpSteam(Pclamp, "T");
  const vf = interpSteam(Pclamp, "vf");
  const vg = interpSteam(Pclamp, "vg");
  const sf = interpSteam(Pclamp, "sf");
  const sg = interpSteam(Pclamp, "sg");
  
  if (Pclamp >= 22000) {
    // Near critical point, treat as supercritical
    return { s: Math.min(9.4, 4.4), T: Math.min(640, 374) };
  }
  if (v <= vf) {
    // Subcooled liquid — estimate slightly below Tsat
    const subFrac = Math.max(0.5, v / vf);
    return { s: Math.max(0.1, sf * subFrac), T: Math.max(5, Tsat * subFrac) };
  }
  if (v >= vg) {
    // Superheated vapor
    const ratio = Math.min(10, v / vg);
    const Tsup = Tsat + (ratio - 1) * 100;
    const ssup = sg + CP_STEAM * Math.log(Math.max(1, (Tsup + 273.15) / (Tsat + 273.15)));
    return { s: Math.max(0.1, Math.min(9.4, ssup)), T: Math.max(5, Math.min(640, Tsup)) };
  }
  // Two-phase
  const x = Math.max(0, Math.min(1, (v - vf) / (vg - vf)));
  return { s: Math.max(0.1, Math.min(9.4, sf + x * (sg - sf))), T: Math.max(5, Tsat) };
}

/* Get specific volume from (s,T) */
function stToV(s, T) {
  const bounds = getDomeBounds(T);
  const P = stToP(s, T);

  if (bounds && s >= bounds.sf && s <= bounds.sg) {
    // Two-phase: use quality to interpolate vf-vg at this pressure
    const x = (s - bounds.sf) / (bounds.sg - bounds.sf);
    const vf = interpSteam(P, "vf");
    const vg = interpSteam(P, "vg");
    return vf + x * (vg - vf);
  }
  if (bounds && s < bounds.sf) {
    // Subcooled liquid: v ≈ vf at saturation pressure for this T
    return interpSteam(P, "vf");
  }
  // Superheated or supercritical: ideal gas v = RT/P
  return 0.4615 * (T + 273.15) / Math.max(1, P);
}

/* Get pressure from (s,T) approximately */
function stToP(s, T) {
  const bounds = getDomeBounds(T);
  // Two-phase or subcooled: P ≈ Psat(T)
  if (bounds && s <= bounds.sg) {
    for (let i = 0; i < STEAM_TABLE.length - 1; i++) {
      if (T >= STEAM_TABLE[i].T && T <= STEAM_TABLE[i + 1].T)
        return lerp(T, STEAM_TABLE[i].T, STEAM_TABLE[i + 1].T, STEAM_TABLE[i].P, STEAM_TABLE[i + 1].P);
    }
    if (T < STEAM_TABLE[0].T) return STEAM_TABLE[0].P;
    return STEAM_TABLE[STEAM_TABLE.length - 1].P;
  }
  // Superheated (or supercritical): solve for P via binary search
  // s = sg(P) + Cp·ln((T+273)/(Tsat(P)+273)); s_calc decreases as P increases
  let lo = 1, hi = 22000;
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const Tsat = interpSteam(mid, "T");
    if (T <= Tsat) { hi = mid; continue; }
    const sg = interpSteam(mid, "sg");
    const sCalc = sg + CP_STEAM * Math.log((T + 273.15) / (Tsat + 273.15));
    if (sCalc > s) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const pvDomeLeft = STEAM_TABLE.filter(r => r.P <= 22064).map(r => ({ v: r.vf, P: r.P }));
const pvDomeRight = [...STEAM_TABLE].filter(r => r.P <= 22064).reverse().map(r => ({ v: r.vg, P: r.P }));
const pvDomeCurve = [...pvDomeLeft, ...pvDomeRight];

function PvDiagram({ cycle, dragPoint, onDrag, lockP, lockV }) {
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const lockedVRef = useRef(null);
  const lockedPRef = useRef(null);

  // Capture exact lock values when locks activate
  useEffect(() => {
    if (lockV) lockedVRef.current = stToV(dragPoint.s, dragPoint.T);
    else lockedVRef.current = null;
  }, [lockV]); // only on lock toggle, not on dragPoint changes

  useEffect(() => {
    if (lockP) lockedPRef.current = stToP(dragPoint.s, dragPoint.T);
    else lockedPRef.current = null;
  }, [lockP]);

  const getSvgPoint = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = PV_W / rect.width;
    const scaleY = PV_H / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    // Clamp pixel coords to plot area
    const px = Math.max(PV_PLOT.x, Math.min(PV_PLOT.x + PV_PLOT.w, (clientX - rect.left) * scaleX));
    const py = Math.max(PV_PLOT.y, Math.min(PV_PLOT.y + PV_PLOT.h, (clientY - rect.top) * scaleY));
    const v = lockV && lockedVRef.current !== null ? lockedVRef.current : unmapV(px);
    const P = lockP && lockedPRef.current !== null ? lockedPRef.current : unmapP(py);
    const st = pvToST(v, P);
    return { ...st, v, P };
  }, [lockP, lockV]);

  const handleStart = useCallback((e) => {
    if (e.touches && e.touches.length === 0) return;
    draggingRef.current = true;
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgPoint, onDrag]);
  const handleMove = useCallback((e) => {
    if (!draggingRef.current) return;
    if (e.touches && e.touches.length === 0) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgPoint, onDrag]);
  const handleEnd = useCallback(() => { draggingRef.current = false; }, []);

  const domePathD = pvDomeCurve.map((p, i) => `${i === 0 ? "M" : "L"}${mapV(p.v).toFixed(1)},${mapP(p.P).toFixed(1)}`).join(" ") + " Z";

  const st = cycle.states;
  // Calculate v for each state
  const stateV = st.map(s => stToV(s.s, s.T));
  const stateP = st.map(s => s.P);

  // Drag point in P-v coords
  // Use raw v,P from dragPoint when available (set by PV drag), fall back to conversion
  const dpV = lockV && lockedVRef.current !== null ? lockedVRef.current : (dragPoint.v != null ? dragPoint.v : stToV(dragPoint.s, dragPoint.T));
  const dpP = lockP && lockedPRef.current !== null ? lockedPRef.current : (dragPoint.P != null ? dragPoint.P : stToP(dragPoint.s, dragPoint.T));
  const dpx = mapV(dpV);
  const dpy = mapP(dpP);

  // P grid values (log scale)
  const pGridVals = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000];
  // V grid values (log scale)
  const vGridVals = [0.001, 0.01, 0.1, 1, 10, 100];

  return (
    <svg ref={svgRef} viewBox={`0 0 ${PV_W} ${PV_H}`} style={{ width: "100%", touchAction: "none", cursor: "crosshair" }}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
      {/* Grid */}
      {vGridVals.map((v, i) => (
        <line key={`vg${i}`} x1={mapV(v)} y1={PV_PLOT.y} x2={mapV(v)} y2={PV_PLOT.y + PV_PLOT.h} stroke={K.gridMajor} strokeWidth={0.5} />
      ))}
      {pGridVals.map((p, i) => (
        <line key={`pg${i}`} x1={PV_PLOT.x} y1={mapP(p)} x2={PV_PLOT.x + PV_PLOT.w} y2={mapP(p)} stroke={K.gridMajor} strokeWidth={0.5} />
      ))}
      {/* Axes */}
      <line x1={PV_PLOT.x} y1={PV_PLOT.y + PV_PLOT.h} x2={PV_PLOT.x + PV_PLOT.w} y2={PV_PLOT.y + PV_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      <line x1={PV_PLOT.x} y1={PV_PLOT.y} x2={PV_PLOT.x} y2={PV_PLOT.y + PV_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      {/* Axis labels */}
      {vGridVals.map((v, i) => (
        <text key={`vl${i}`} x={mapV(v)} y={PV_PLOT.y + PV_PLOT.h + 10} fill={K.inkMed} fontSize={6.5} textAnchor="middle" fontFamily={FM}>{v >= 1 ? v : v >= 0.01 ? v : v.toFixed(3)}</text>
      ))}
      {pGridVals.map((p, i) => (
        <text key={`pl${i}`} x={PV_PLOT.x - 4} y={mapP(p) + 2.5} fill={K.inkMed} fontSize={6.5} textAnchor="end" fontFamily={FM}>{p >= 1000 ? `${p/1000}k` : p}</text>
      ))}
      <text x={PV_W / 2} y={PV_H - 5} fill={K.inkMed} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic">v (m³/kg) — log scale</text>
      <text x={10} y={PV_H / 2 - 8} fill={K.inkMed} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic" transform={`rotate(-90,10,${PV_H / 2 - 8})`}>P (kPa)</text>
      {/* Dome */}
      <path d={domePathD} fill={K.dome} stroke={K.domeLine} strokeWidth={1} strokeDasharray="6 3" />
      {/* Cycle lines */}
      {/* 1→2 Pump (vertical-ish line, low v, P goes up) */}
      <line x1={mapV(stateV[0])} y1={mapP(stateP[0])} x2={mapV(stateV[1])} y2={mapP(stateP[1])} stroke={K.workIn} strokeWidth={2.2} strokeLinecap="round" />
      {/* 2→3 Boiler (constant P, v increases) */}
      <line x1={mapV(stateV[1])} y1={mapP(stateP[1])} x2={mapV(stateV[2])} y2={mapP(stateP[2])} stroke={K.heatIn} strokeWidth={2.2} strokeLinecap="round" />
      {/* 3→4 Turbine (P drops, v increases) */}
      <line x1={mapV(stateV[2])} y1={mapP(stateP[2])} x2={mapV(stateV[3])} y2={mapP(stateP[3])} stroke={K.workOut} strokeWidth={2.2} strokeLinecap="round" />
      {/* 4→1 Condenser (constant P, v decreases) */}
      <line x1={mapV(stateV[3])} y1={mapP(stateP[3])} x2={mapV(stateV[0])} y2={mapP(stateP[0])} stroke={K.heatOut} strokeWidth={2.2} strokeLinecap="round" />
      {/* Process labels */}
      <text x={mapV(stateV[0]) - 10} y={(mapP(stateP[0]) + mapP(stateP[1])) / 2} fill={K.workIn} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="end">Pump</text>
      <text x={(mapV(stateV[1]) + mapV(stateV[2])) / 2} y={mapP(stateP[1]) - 7} fill={K.heatIn} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="middle">Boiler</text>
      <text x={(mapV(stateV[2]) + mapV(stateV[3])) / 2 + 14} y={(mapP(stateP[2]) + mapP(stateP[3])) / 2} fill={K.workOut} fontSize={7} fontFamily={FM} fontWeight="500">Turbine</text>
      <text x={(mapV(stateV[3]) + mapV(stateV[0])) / 2} y={mapP(stateP[0]) + 12} fill={K.heatOut} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="middle">Condenser</text>
      {/* Dimension lines - solid when locked */}
      <line x1={dpx} y1={dpy} x2={dpx} y2={PV_PLOT.y + PV_PLOT.h} stroke={lockV ? K.accent : K.inkLight} strokeWidth={lockV ? 1.2 : 0.5} strokeDasharray={lockV ? "none" : "2 2"} />
      <line x1={dpx} y1={dpy} x2={PV_PLOT.x} y2={dpy} stroke={lockP ? K.accent : K.inkLight} strokeWidth={lockP ? 1.2 : 0.5} strokeDasharray={lockP ? "none" : "2 2"} />
      {lockP && <line x1={PV_PLOT.x} y1={dpy} x2={PV_PLOT.x + PV_PLOT.w} y2={dpy} stroke={K.accent} strokeWidth={0.6} strokeDasharray="4 3" opacity={0.4} />}
      {lockV && <line x1={dpx} y1={PV_PLOT.y} x2={dpx} y2={PV_PLOT.y + PV_PLOT.h} stroke={K.accent} strokeWidth={0.6} strokeDasharray="4 3" opacity={0.4} />}
      {/* State points */}
      {st.map((s, i) => {
        const cx = mapV(stateV[i]), cy = mapP(stateP[i]);
        const off = [{ dx: -12, dy: 12 }, { dx: -12, dy: -8 }, { dx: 10, dy: -8 }, { dx: 10, dy: 12 }];
        const tx = cx + off[i].dx, ty = cy + off[i].dy;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={5} fill="#fff" stroke={K.stateCircle} strokeWidth={1.2} />
            <circle cx={cx} cy={cy} r={1.8} fill={K.stateFill} />
            <rect x={tx - 7} y={ty - 10} width={14} height={13} rx={1} fill="#fff" />
            <text x={tx} y={ty} fill={K.accent} fontSize={12} fontFamily={FD} textAnchor="middle">{s.label}</text>
          </g>
        );
      })}
      {/* Drag point */}
      <circle cx={dpx} cy={dpy} r={9} fill="rgba(192,57,43,0.15)" stroke={K.accent} strokeWidth={2} />
      <circle cx={dpx} cy={dpy} r={4} fill={K.accent} />
      <text x={PV_W - 8} y={PV_PLOT.y + 10} fill={K.inkLight} fontSize={7} fontFamily={FM} textAnchor="end" fontStyle="italic">{lockP ? "P locked" : lockV ? "v locked" : "tap & drag"}</text>
    </svg>
  );
}

/* ───────── Component Detail Modal ───────── */
const COMPONENT_INFO = {
  boiler: {
    title: "Boiler (Steam Generator)",
    color: K.heatIn,
    process: "2 → 3",
    type: "Constant-Pressure Heat Addition",
    purpose: "The boiler heats compressed liquid water at constant pressure, transforming it into superheated steam. This is where energy enters the cycle from an external heat source (combustion, nuclear, solar, etc.). The fluid undergoes three phases: subcooled liquid heating, vaporization (phase change), and superheating.",
    keyPoints: [
      "Operates at constant high pressure (P_H)",
      "No work is done (rigid vessel, no moving parts)",
      "All energy transfer is heat (Q_in)",
      "Temperature rises from T₂ to T₃",
      "Fluid enters as compressed liquid, exits as superheated vapor",
    ],
    equations: [
      { label: "First Law (open system, steady state)", eq: "q_in = h₃ − h₂" },
      { label: "Since no work is done", eq: "w_boiler = 0" },
      { label: "Heat input calculation", eq: "Q_in = ṁ · (h₃ − h₂)" },
      { label: "Entropy change", eq: "Δs = s₃ − s₂ > 0 (entropy increases)" },
    ],
    insight: "Increasing boiler pressure raises the average temperature of heat addition, improving cycle efficiency. Superheating beyond the saturation dome improves turbine exit quality and prevents blade erosion from liquid droplets.",
  },
  turbine: {
    title: "Turbine",
    color: K.workOut,
    process: "3 → 4",
    type: "Isentropic Expansion",
    purpose: "The turbine converts the thermal energy of high-pressure superheated steam into mechanical shaft work. As steam expands through the turbine blades, its pressure and temperature drop while producing the cycle's primary work output. In the ideal Rankine cycle, this expansion is isentropic (reversible and adiabatic).",
    keyPoints: [
      "Primary work-producing device in the cycle",
      "Ideal process is isentropic (s₃ = s₄)",
      "Pressure drops from P_H to P_L",
      "Steam may become a wet mixture at the exit (state 4)",
      "Quality x₄ < 1 means liquid droplets are present",
    ],
    equations: [
      { label: "First Law (steady-state, adiabatic)", eq: "w_turbine = h₃ − h₄" },
      { label: "Isentropic condition", eq: "s₃ = s₄" },
      { label: "Exit quality (if two-phase)", eq: "x₄ = (s₄ − s_f) / (s_g − s_f)" },
      { label: "Exit enthalpy", eq: "h₄ = h_f + x₄ · h_fg" },
      { label: "Power output", eq: "Ẇ_t = ṁ · (h₃ − h₄)" },
    ],
    insight: "The turbine produces the largest work term in the cycle. Turbine exit quality (x₄) should stay above ~0.88 to avoid excessive blade erosion from liquid droplets. Reheating can improve exit quality.",
  },
  condenser: {
    title: "Condenser",
    color: K.heatOut,
    process: "4 → 1",
    type: "Constant-Pressure Heat Rejection",
    purpose: "The condenser removes heat from the wet steam exiting the turbine, condensing it back into a saturated liquid. This heat is rejected to a cooling medium (river water, cooling tower, etc.). The condenser completes the cycle by returning the working fluid to a liquid state so the pump can pressurize it.",
    keyPoints: [
      "Operates at constant low pressure (P_L)",
      "No work is done",
      "Heat is rejected to the surroundings (Q_out)",
      "Fluid enters as a wet mixture, exits as saturated liquid (x₁ = 0)",
      "Lower condenser pressure → higher efficiency (but limited by cooling source temperature)",
    ],
    equations: [
      { label: "First Law (open system, steady state)", eq: "q_out = h₄ − h₁" },
      { label: "Since no work is done", eq: "w_condenser = 0" },
      { label: "Heat rejected", eq: "Q_out = ṁ · (h₄ − h₁)" },
      { label: "Exit state", eq: "x₁ = 0 (saturated liquid at P_L)" },
    ],
    insight: "The condenser is necessary because pumping a liquid requires far less work than compressing a gas. Lowering the condenser pressure improves efficiency but is limited by the temperature of the available cooling medium.",
  },
  pump: {
    title: "Pump",
    color: K.workIn,
    process: "1 → 2",
    type: "Isentropic Compression",
    purpose: "The pump raises the pressure of the saturated liquid from condenser pressure (P_L) to boiler pressure (P_H). Because liquids are nearly incompressible, the pump requires very little work compared to the turbine output — this is a key advantage of the Rankine cycle over gas power cycles.",
    keyPoints: [
      "Ideal process is isentropic (s₁ = s₂)",
      "Compresses liquid, not vapor (much less work needed)",
      "Back Work Ratio (BWR) is typically 1–3% for steam cycles",
      "Negligible temperature rise across the pump",
      "Specific volume remains nearly constant (v ≈ v_f)",
    ],
    equations: [
      { label: "Pump work (exact)", eq: "w_pump = h₂ − h₁" },
      { label: "Pump work (incompressible approx.)", eq: "w_pump ≈ v_f · (P_H − P_L)" },
      { label: "Exit enthalpy", eq: "h₂ = h₁ + w_pump" },
      { label: "Isentropic condition", eq: "s₁ = s₂" },
      { label: "Back Work Ratio", eq: "BWR = w_pump / w_turbine" },
    ],
    insight: "The pump work is tiny compared to the turbine output because liquid specific volume is ~1000× smaller than steam. This gives the Rankine cycle a very low BWR compared to gas cycles like the Brayton cycle (~40–80% BWR).",
  },
};

function ComponentModal({ component, cycle, onClose }) {
  const isWide = useIsDesktop();
  if (!component) return null;
  const info = COMPONENT_INFO[component];
  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);

  const liveValues = {
    boiler: { main: `Q_in = ${f(cycle.qIn)} kJ/kg`, detail: `h₃ − h₂ = ${f(cycle.h3)} − ${f(cycle.h2)}` },
    turbine: { main: `W_t = ${f(cycle.wTurbine)} kJ/kg`, detail: `h₃ − h₄ = ${f(cycle.h3)} − ${f(cycle.h4)}, x₄ = ${cycle.x4.toFixed(4)}` },
    condenser: { main: `Q_out = ${f(cycle.qOut)} kJ/kg`, detail: `h₄ − h₁ = ${f(cycle.h4)} − ${f(cycle.h1)}` },
    pump: { main: `W_p = ${f(cycle.wPump)} kJ/kg`, detail: `v_f·(P_H − P_L) = 0.001 × (${f(cycle.states[2].P)} − ${f(cycle.states[0].P)}), BWR = ${(cycle.bwr * 100).toFixed(2)}%` },
  };
  const live = liveValues[component];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", border: `1.5px solid ${K.border}`, maxWidth: isWide ? 680 : 420, width: "100%", padding: isWide ? "28px 32px" : "20px 16px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginTop: isWide ? 60 : 0 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isWide ? 18 : 14, borderBottom: `2px solid ${info.color}`, paddingBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: isWide ? 22 : 16, fontFamily: FD, color: info.color }}>{info.title}</h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: isWide ? 12 : 11, cursor: "pointer", padding: isWide ? "5px 16px" : "3px 12px", fontFamily: FM }}>Close</button>
        </div>

        {/* Process badge */}
        <div style={{ display: "flex", gap: 8, marginBottom: isWide ? 16 : 12, flexWrap: "wrap" }}>
          <span style={{ background: info.color, color: "#fff", padding: "3px 10px", fontSize: isWide ? 11 : 9, fontFamily: FM, fontWeight: 700 }}>Process {info.process}</span>
          <span style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: "3px 10px", fontSize: isWide ? 11 : 9, fontFamily: FM, color: K.inkMed }}>{info.type}</span>
        </div>

        {/* Live values */}
        <div style={{ background: K.cardAlt, border: `2px solid ${info.color}`, padding: isWide ? "14px 18px" : "10px 12px", marginBottom: isWide ? 16 : 12, textAlign: "center" }}>
          <div style={{ fontSize: isWide ? 20 : 16, fontFamily: FD, color: info.color, marginBottom: 4 }}>{live.main}</div>
          <div style={{ fontSize: isWide ? 11 : 9, fontFamily: FM, color: K.inkMed }}>{live.detail}</div>
        </div>

        {/* Purpose */}
        <p style={{ fontSize: isWide ? 12.5 : 10.5, lineHeight: 1.9, color: K.inkMed, marginBottom: isWide ? 16 : 12 }}>{info.purpose}</p>

        {/* Key points and equations side by side on desktop */}
        <div style={isWide ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 } : { marginBottom: 12 }}>
          {/* Key Points */}
          <div style={{ borderLeft: `3px solid ${info.color}`, paddingLeft: 12, marginBottom: isWide ? 0 : 12 }}>
            <div style={{ fontFamily: FD, fontSize: isWide ? 14 : 12, marginBottom: 8, color: K.ink }}>Key Points</div>
            {info.keyPoints.map((pt, i) => (
              <div key={i} style={{ fontSize: isWide ? 11 : 10, color: K.inkMed, marginBottom: 4, lineHeight: 1.6 }}>{"▸ " + pt}</div>
            ))}
          </div>

          {/* Equations */}
          <div style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: isWide ? "14px 16px" : "10px 12px" }}>
            <div style={{ fontFamily: FD, fontSize: isWide ? 14 : 12, marginBottom: 8, color: K.ink }}>Equations</div>
            {info.equations.map((eq, i) => (
              <div key={i} style={{ marginBottom: 8, fontSize: isWide ? 11 : 10, lineHeight: 1.7 }}>
                <div style={{ color: K.inkLight, fontSize: isWide ? 9 : 8 }}>{eq.label}</div>
                <div style={{ color: info.color, fontWeight: 600 }}>{eq.eq}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Insight */}
        <div style={{ background: "#fffef5", border: `1px solid #e8e0c0`, padding: isWide ? "12px 16px" : "10px 12px", marginBottom: isWide ? 16 : 12 }}>
          <div style={{ fontFamily: FD, fontSize: isWide ? 12 : 10, color: K.ink, marginBottom: 4 }}>💡 Engineering Insight</div>
          <div style={{ fontSize: isWide ? 11 : 10, color: K.inkMed, lineHeight: 1.7 }}>{info.insight}</div>
        </div>

        <button onClick={onClose} style={{ width: "100%", padding: isWide ? "12px" : "10px", background: info.color, border: "none", color: "#fff", fontWeight: 500, fontSize: isWide ? 14 : 12, fontFamily: FD, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Schematic ───────── */
function SchematicDiagram({ cycle }) {
  const fmt = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const [activeComponent, setActiveComponent] = useState(null);
  const mk = [
    { id: "mO", c: K.heatIn }, { id: "mB", c: K.heatOut }, { id: "mG", c: K.workOut },
    { id: "mY", c: K.workIn }, { id: "mK", c: K.ink },
  ];
  return (<>
    <svg viewBox="-40 0 440 330" style={{ width: "100%" }}>
      <defs>
        {mk.map(m => (
          <marker key={m.id} id={m.id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={7} markerHeight={7} orient="auto">
            <path d="M0,1 L9,5 L0,9" fill="none" stroke={m.c} strokeWidth={1.5} />
          </marker>
        ))}
      </defs>
      {Array.from({ length: 22 }, (_, i) => Array.from({ length: 16 }, (_, j) => (
        <circle key={`${i}-${j}`} cx={i * 20 - 30} cy={j * 20 + 10} r={0.6} fill={K.gridMajor} />
      )))}
      {/* BOILER */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("boiler")}>
        <rect x={110} y={32} width={140} height={50} fill="rgba(255,255,255,0.01)" stroke={K.heatIn} strokeWidth={1.5} />
        {[130,150,170,190,210,230].map(x => (
          <g key={x}><line x1={x} y1={42} x2={x} y2={72} stroke={K.heatIn} strokeWidth={0.4} /><path d={`M${x-3},72 L${x},76 L${x+3},72`} fill="none" stroke={K.heatIn} strokeWidth={0.4} /></g>
        ))}
        <rect x={152} y={40} width={56} height={16} fill="#fff" />
        <text x={180} y={53} fill={K.heatIn} fontSize={11} textAnchor="middle" fontFamily={FD}>Boiler</text>
        <rect x={148} y={58} width={64} height={12} fill="#fff" />
        <text x={180} y={67} fill={K.inkLight} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic">const. pressure</text>
      </g>
      {/* TURBINE */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("turbine")}>
        <path d="M282,122 L322,142 L322,202 L282,222 Z" fill="rgba(255,255,255,0.01)" stroke={K.workOut} strokeWidth={1.5} strokeLinejoin="round" />
        {[132, 145, 158, 171, 184, 197, 212].map(y => {
          const xr = y < 142 ? 282 + (y - 122) / 20 * 40 : y > 202 ? 322 - (y - 202) / 20 * 40 : 322;
          return <line key={y} x1={286} y1={y} x2={xr - 4} y2={y} stroke={K.workOut} strokeWidth={0.3} />;
        })}
        <text x={302} y={170} fill={K.workOut} fontSize={10} textAnchor="middle" fontFamily={FD}>Turbine</text>
        <text x={302} y={183} fill={K.inkLight} fontSize={6} textAnchor="middle" fontFamily={FM} fontStyle="italic">isentropic</text>
      </g>
      {/* CONDENSER */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("condenser")}>
        <rect x={110} y={248} width={140} height={50} fill="rgba(255,255,255,0.01)" stroke={K.heatOut} strokeWidth={1.5} />
        <path d="M125,275 Q135,265 145,275 Q155,285 165,275 Q175,265 185,275 Q195,285 205,275 Q215,265 225,275 Q235,285 240,278" fill="none" stroke={K.heatOut} strokeWidth={0.7} />
        <text x={180} y={265} fill={K.heatOut} fontSize={11} textAnchor="middle" fontFamily={FD}>Condenser</text>
        <text x={180} y={292} fill={K.inkLight} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic">const. pressure</text>
      </g>
      {/* PUMP */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("pump")}>
        <circle cx={60} cy={172} r={28} fill="rgba(255,255,255,0.01)" stroke={K.workIn} strokeWidth={1.5} />
        <path d="M46,181 L60,151 L74,181 Z" fill="none" stroke={K.workIn} strokeWidth={0.8} />
        <text x={60} y={193} fill={K.workIn} fontSize={10} textAnchor="middle" fontFamily={FD}>Pump</text>
      </g>
      {/* Pipes */}
      <polyline points="60,144 60,82 110,57" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#mK)" />
      <polyline points="250,57 282,57 282,122" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#mK)" />
      <polyline points="302,212 302,273 250,273" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#mK)" />
      <polyline points="110,273 60,273 60,200" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#mK)" />
      {/* State markers */}
      {[{ n:"2",x:80,y:76 },{ n:"3",x:268,y:102 },{ n:"4",x:314,y:242 },{ n:"1",x:80,y:252 }].map((p,i) => (
        <g key={i}><circle cx={p.x} cy={p.y} r={11} fill="#fff" stroke={K.stateCircle} strokeWidth={1.2} /><text x={p.x} y={p.y+4} fill={K.accent} fontSize={12} textAnchor="middle" fontFamily={FD}>{p.n}</text></g>
      ))}
      {/* Energy */}
      <line x1={180} y1={10} x2={180} y2={30} stroke={K.heatIn} strokeWidth={1.8} markerEnd="url(#mO)" />
      <text x={180} y={8} fill={K.heatIn} fontSize={8} textAnchor="middle" fontFamily={FM}>Q_in = {fmt(cycle.qIn)} kJ/kg</text>
      <line x1={180} y1={298} x2={180} y2={312} stroke={K.heatOut} strokeWidth={1.8} markerEnd="url(#mB)" />
      <text x={180} y={324} fill={K.heatOut} fontSize={8} textAnchor="middle" fontFamily={FM}>Q_out = {fmt(cycle.qOut)} kJ/kg</text>
      <line x1={321} y1={172} x2={340} y2={172} stroke={K.workOut} strokeWidth={1.8} markerEnd="url(#mG)" />
      <text x={345} y={168} fill={K.workOut} fontSize={7.5} textAnchor="start" fontFamily={FM} fontWeight="500">W_t</text>
      <text x={345} y={180} fill={K.workOut} fontSize={7} textAnchor="start" fontFamily={FM}>{fmt(cycle.wTurbine)} kJ/kg</text>
      <line x1={28} y1={172} x2={8} y2={172} stroke={K.workIn} strokeWidth={1.8} markerEnd="url(#mY)" />
      <text x={4} y={168} fill={K.workIn} fontSize={7.5} textAnchor="end" fontFamily={FM} fontWeight="500">W_p</text>
      <text x={4} y={180} fill={K.workIn} fontSize={7} textAnchor="end" fontFamily={FM}>{fmt(cycle.wPump)} kJ/kg</text>
    </svg>
    <ComponentModal component={activeComponent} cycle={cycle} onClose={() => setActiveComponent(null)} />
  </>);
}

/* ───────── Info Modal ───────── */
function InfoModal({ open, onClose }) {
  const isWide = useIsDesktop();
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", border: `1.5px solid ${K.border}`, maxWidth: isWide ? 720 : 420, width: "100%", padding: isWide ? "32px 36px" : "24px 18px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginTop: isWide ? 60 : 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isWide ? 20 : 16, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: isWide ? 24 : 18, fontFamily: FD, color: K.ink }}>The Rankine Cycle</h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: isWide ? 12 : 11, cursor: "pointer", padding: isWide ? "5px 16px" : "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <p style={{ fontSize: isWide ? 14 : 11, lineHeight: 1.9, color: K.inkMed, marginBottom: isWide ? 20 : 16 }}>
          The Rankine cycle is the fundamental thermodynamic cycle used in steam power plants. It converts heat into mechanical work using water as the working fluid, undergoing phase changes between liquid and vapor.
        </p>
        <div style={isWide ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 } : {}}>
          <div style={{ borderLeft: `3px solid ${K.accent}`, paddingLeft: 12, marginBottom: isWide ? 0 : 16 }}>
            <div style={{ fontFamily: FD, fontSize: isWide ? 15 : 13, marginBottom: 10, color: K.ink }}>Four Processes</div>
            {[
              { r: "1 → 2", l: "Pump — Isentropic Compression", c: K.workIn, d: "Saturated liquid at condenser pressure is compressed to boiler pressure." },
              { r: "2 → 3", l: "Boiler — Const-P Heat Addition", c: K.heatIn, d: "Compressed liquid is heated, vaporized, and superheated at constant pressure." },
              { r: "3 → 4", l: "Turbine — Isentropic Expansion", c: K.workOut, d: "Superheated steam expands through the turbine, producing work." },
              { r: "4 → 1", l: "Condenser — Const-P Heat Rejection", c: K.heatOut, d: "Wet steam is condensed to saturated liquid, rejecting heat." },
            ].map((p, i) => (
              <div key={i} style={{ marginBottom: isWide ? 12 : 8, fontSize: isWide ? 12 : 10.5, lineHeight: 1.7 }}>
                <span style={{ color: p.c, fontWeight: 700 }}>{p.r}</span>{" "}<span style={{ color: p.c, fontWeight: 500 }}>{p.l}</span><br />
                <span style={{ color: K.inkLight }}>{p.d}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: isWide ? "18px" : "14px", marginBottom: 14, fontSize: isWide ? 12 : 10.5, lineHeight: 2.3 }}>
              <div style={{ fontFamily: FD, fontSize: isWide ? 15 : 13, marginBottom: 6, color: K.ink }}>Key Equations</div>
              <div>{"η_th = W_net / Q_in = (W_t − W_p) / Q_in"}</div>
              <div style={{ color: K.workOut }}>{"W_turbine = h₃ − h₄"}</div>
              <div style={{ color: K.workIn }}>{"W_pump = h₂ − h₁ ≈ v_f·(P_H − P_L)"}</div>
              <div style={{ color: K.heatIn }}>{"Q_in = h₃ − h₂"}</div>
              <div style={{ color: K.heatOut }}>{"Q_out = h₄ − h₁"}</div>
              <div>BWR = W_pump / W_turbine</div>
              <div style={{ borderTop: `1px solid ${K.border}`, marginTop: 6, paddingTop: 6, color: K.inkLight }}>Quality at turbine exit:</div>
              <div>{"x₄ = (s₄ − s_f) / s_fg"}</div>
              <div>{"h₄ = h_f + x₄ · h_fg"}</div>
            </div>
            <div style={{ borderLeft: `3px solid ${K.workOut}`, paddingLeft: 12, marginBottom: isWide ? 0 : 16 }}>
              <div style={{ fontFamily: FD, fontSize: isWide ? 15 : 13, marginBottom: 6, color: K.ink }}>Improving Efficiency</div>
              {["Increase boiler pressure — raises average T of heat addition","Increase superheat temperature — better quality at turbine exit","Lower condenser pressure — lowers T of heat rejection","Reheat & regeneration — advanced cycle modifications"].map((t,i) => (
                <div key={i} style={{ fontSize: isWide ? 12 : 10.5, color: K.inkMed, marginBottom: 3 }}>{"▸ " + t}</div>
              ))}
            </div>
          </div>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: isWide ? "12px" : "10px", background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: isWide ? 14 : 12, fontFamily: FD, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Equations Solver Modal ───────── */
const EQ_TOPICS = [
  { id: "wt", label: "W_turbine", title: "Turbine Work Output", color: K.workOut },
  { id: "wp", label: "W_pump", title: "Pump Work Input", color: K.workIn },
  { id: "qin", label: "Q_in", title: "Boiler Heat Input", color: K.heatIn },
  { id: "qout", label: "Q_out", title: "Condenser Heat Rejection", color: K.heatOut },
  { id: "eta", label: "η_th", title: "Thermal Efficiency", color: K.accent },
  { id: "wnet", label: "W_net", title: "Net Work Output", color: K.workOut },
  { id: "x4", label: "x₄", title: "Quality at Turbine Exit", color: K.inkMed },
  { id: "bwr", label: "BWR", title: "Back Work Ratio", color: K.workIn },
  { id: "states", label: "States", title: "Finding State Point Properties", color: K.ink },
];

function EquationsModal({ open, onClose, cycle }) {
  const [topic, setTopic] = useState("wt");
  const isWide = useIsDesktop();
  if (!open) return null;

  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const sel = EQ_TOPICS.find(t => t.id === topic);

  const stepStyle = { background: K.cardAlt, border: `1px solid ${K.border}`, padding: isWide ? "14px 18px" : "10px 12px", marginBottom: isWide ? 10 : 8, fontSize: isWide ? 12.5 : 10.5, lineHeight: 2, fontFamily: FM };
  const numStyle = { color: K.accent, fontWeight: 700 };
  const resultStyle = { background: "#fff", border: `2px solid ${sel.color}`, padding: isWide ? "14px 18px" : "10px 12px", textAlign: "center", marginTop: isWide ? 8 : 4 };

  function renderContent() {
    switch (topic) {
      case "wt": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>W_turbine = h₃ − h₄</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>The turbine extracts work as steam expands isentropically from boiler pressure to condenser pressure.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 1 — Find h₃ (superheated steam at turbine inlet)</div>
          <div>At P_high = <span style={numStyle}>{f(cycle.states[2].P)}</span> kPa, T₃ = <span style={numStyle}>{f(cycle.T3)}</span>°C:</div>
          <div>h₃ = h_g + c_p·(T₃ − T_sat)</div>
          <div>h₃ = <span style={numStyle}>{f(cycle.h3)}</span> kJ/kg</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 2 — Find h₄ (wet mixture at turbine exit)</div>
          <div>Since s₄ = s₃ (isentropic): s₄ = <span style={numStyle}>{f(cycle.s4)}</span> kJ/kg·K</div>
          <div>x₄ = (s₄ − s_f) / (s_g − s_f) = <span style={numStyle}>{cycle.x4.toFixed(4)}</span></div>
          <div>h₄ = h_f + x₄·(h_g − h_f) = <span style={numStyle}>{f(cycle.h4)}</span> kJ/kg</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: isWide ? 10 : 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: isWide ? 20 : 16, fontFamily: FD, color: sel.color }}>W_turbine = {f(cycle.h3)} − {f(cycle.h4)} = <strong>{f(cycle.wTurbine)}</strong> kJ/kg</div>
        </div>
      </>);
      case "wp": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>W_pump = h₂ − h₁ ≈ v_f · (P_high − P_low)</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>For incompressible liquid, pump work is well approximated by the specific volume times the pressure difference.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 1 — Find h₁ (saturated liquid at condenser pressure)</div>
          <div>At P_low = <span style={numStyle}>{f(cycle.states[0].P)}</span> kPa:</div>
          <div>h₁ = h_f = <span style={numStyle}>{f(cycle.h1)}</span> kJ/kg</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 2 — Calculate pump work</div>
          <div>v_f ≈ 0.001 m³/kg</div>
          <div>W_pump = 0.001 × ({f(cycle.states[2].P)} − {f(cycle.states[0].P)})</div>
          <div>W_pump = <span style={numStyle}>{f(cycle.wPump)}</span> kJ/kg</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 3 — Find h₂</div>
          <div>h₂ = h₁ + W_pump = {f(cycle.h1)} + {f(cycle.wPump)} = <span style={numStyle}>{f(cycle.h2)}</span> kJ/kg</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: isWide ? 10 : 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: isWide ? 20 : 16, fontFamily: FD, color: sel.color }}>W_pump = <strong>{f(cycle.wPump)}</strong> kJ/kg</div>
        </div>
      </>);
      case "qin": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>Q_in = h₃ − h₂</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>Heat is added at constant pressure in the boiler. This includes sensible heating, latent heat, and superheating.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>VALUES</div>
          <div>h₂ = <span style={numStyle}>{f(cycle.h2)}</span> kJ/kg (compressed liquid entering boiler)</div>
          <div>h₃ = <span style={numStyle}>{f(cycle.h3)}</span> kJ/kg (superheated steam leaving boiler)</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: isWide ? 10 : 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: isWide ? 20 : 16, fontFamily: FD, color: sel.color }}>Q_in = {f(cycle.h3)} − {f(cycle.h2)} = <strong>{f(cycle.qIn)}</strong> kJ/kg</div>
        </div>
      </>);
      case "qout": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>Q_out = h₄ − h₁</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>Heat is rejected at constant pressure in the condenser as wet steam is cooled to saturated liquid.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>VALUES</div>
          <div>h₄ = <span style={numStyle}>{f(cycle.h4)}</span> kJ/kg (wet mixture entering condenser)</div>
          <div>h₁ = <span style={numStyle}>{f(cycle.h1)}</span> kJ/kg (saturated liquid leaving condenser)</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: isWide ? 10 : 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: isWide ? 20 : 16, fontFamily: FD, color: sel.color }}>Q_out = {f(cycle.h4)} − {f(cycle.h1)} = <strong>{f(cycle.qOut)}</strong> kJ/kg</div>
        </div>
      </>);
      case "eta": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>η_th = W_net / Q_in = (W_t − W_p) / Q_in</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>Also: η_th = 1 − Q_out / Q_in</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 1 — Net work</div>
          <div>W_net = W_t − W_p = {f(cycle.wTurbine)} − {f(cycle.wPump)} = <span style={numStyle}>{f(cycle.wNet)}</span> kJ/kg</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 2 — Divide by heat input</div>
          <div>η_th = {f(cycle.wNet)} / {f(cycle.qIn)}</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: isWide ? 10 : 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: isWide ? 20 : 16, fontFamily: FD, color: sel.color }}>η_th = <strong>{(cycle.eta * 100).toFixed(2)}%</strong></div>
        </div>
      </>);
      case "wnet": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>W_net = W_turbine − W_pump</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>Also: W_net = Q_in − Q_out (energy balance)</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>METHOD 1 — From work terms</div>
          <div>W_net = {f(cycle.wTurbine)} − {f(cycle.wPump)} = <span style={numStyle}>{f(cycle.wNet)}</span> kJ/kg</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>METHOD 2 — From heat terms (verify)</div>
          <div>W_net = {f(cycle.qIn)} − {f(cycle.qOut)} = <span style={numStyle}>{f(cycle.qIn - cycle.qOut)}</span> kJ/kg</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: isWide ? 10 : 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: isWide ? 20 : 16, fontFamily: FD, color: sel.color }}>W_net = <strong>{f(cycle.wNet)}</strong> kJ/kg</div>
        </div>
      </>);
      case "x4": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>x₄ = (s₄ − s_f) / (s_g − s_f)</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>For isentropic expansion: s₄ = s₃. The quality tells us the fraction of vapor in the wet mixture.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 1 — s₃ from superheated state</div>
          <div>s₃ = s₄ = <span style={numStyle}>{f(cycle.s3)}</span> kJ/kg·K (isentropic)</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 2 — Look up sat. properties at P_low = {f(cycle.states[0].P)} kPa</div>
          <div>s_f = <span style={numStyle}>{f(cycle.s1)}</span> kJ/kg·K</div>
          <div>s_g = <span style={numStyle}>{interpSteam(cycle.states[0].P, "sg").toFixed(3)}</span> kJ/kg·K</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 3 — Calculate quality</div>
          <div>x₄ = ({f(cycle.s4)} − {f(cycle.s1)}) / ({interpSteam(cycle.states[0].P, "sg").toFixed(3)} − {f(cycle.s1)})</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 4 — Find h₄</div>
          <div>h₄ = h_f + x₄·h_fg = <span style={numStyle}>{f(cycle.h4)}</span> kJ/kg</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: isWide ? 10 : 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: isWide ? 20 : 16, fontFamily: FD, color: sel.color }}>x₄ = <strong>{cycle.x4.toFixed(4)}</strong> ({(cycle.x4 * 100).toFixed(1)}% vapor)</div>
        </div>
      </>);
      case "bwr": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>BWR = W_pump / W_turbine</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>The back work ratio measures what fraction of turbine output is consumed by the pump. For steam cycles this is typically very small (&lt;5%).</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>CALCULATION</div>
          <div>BWR = {f(cycle.wPump)} / {f(cycle.wTurbine)}</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: isWide ? 10 : 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: isWide ? 20 : 16, fontFamily: FD, color: sel.color }}>BWR = <strong>{(cycle.bwr * 100).toFixed(2)}%</strong></div>
        </div>
      </>);
      case "states": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STATE 1 — Saturated Liquid at P_low</div>
          <div>P₁ = <span style={numStyle}>{f(cycle.states[0].P)}</span> kPa → look up sat. liquid properties</div>
          <div>T₁ = T_sat = <span style={numStyle}>{f(cycle.T1)}</span>°C, h₁ = h_f = <span style={numStyle}>{f(cycle.h1)}</span>, s₁ = s_f = <span style={numStyle}>{f(cycle.s1)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STATE 2 — Compressed Liquid at P_high</div>
          <div>h₂ = h₁ + v_f·(P₂ − P₁) = {f(cycle.h1)} + 0.001×({f(cycle.states[2].P)} − {f(cycle.states[0].P)})</div>
          <div>h₂ = <span style={numStyle}>{f(cycle.h2)}</span> kJ/kg, T₂ ≈ <span style={numStyle}>{f(cycle.T2)}</span>°C</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STATE 3 — Superheated Vapor at P_high, T₃</div>
          <div>Given: P₃ = <span style={numStyle}>{f(cycle.states[2].P)}</span> kPa, T₃ = <span style={numStyle}>{f(cycle.T3)}</span>°C</div>
          <div>Look up (or interpolate): h₃ = <span style={numStyle}>{f(cycle.h3)}</span>, s₃ = <span style={numStyle}>{f(cycle.s3)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STATE 4 — Wet Mixture at P_low</div>
          <div>s₄ = s₃ = <span style={numStyle}>{f(cycle.s4)}</span> (isentropic expansion)</div>
          <div>x₄ = <span style={numStyle}>{cycle.x4.toFixed(4)}</span>, h₄ = <span style={numStyle}>{f(cycle.h4)}</span> kJ/kg, T₄ = <span style={numStyle}>{f(cycle.T4)}</span>°C</div>
        </div>
      </>);
      default: return null;
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", border: `1.5px solid ${K.border}`, maxWidth: isWide ? 760 : 420, width: "100%", padding: isWide ? "32px 36px" : "20px 16px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginTop: isWide ? 60 : 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isWide ? 18 : 14, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: isWide ? 22 : 16, fontFamily: FD, color: K.ink }}>Solve: <span style={{ color: sel.color }}>{sel.title}</span></h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: isWide ? 12 : 11, cursor: "pointer", padding: isWide ? "5px 16px" : "3px 12px", fontFamily: FM }}>Close</button>
        </div>

        {/* Topic selector pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: isWide ? 6 : 5, marginBottom: isWide ? 18 : 14 }}>
          {EQ_TOPICS.map(t => (
            <button key={t.id} onClick={() => setTopic(t.id)} style={{
              padding: isWide ? "6px 16px" : "4px 10px", fontSize: isWide ? 11 : 9, fontFamily: FM,
              background: topic === t.id ? t.color : K.cardAlt,
              color: topic === t.id ? "#fff" : K.inkMed,
              border: `1px solid ${topic === t.id ? t.color : K.border}`,
              cursor: "pointer", borderRadius: 3, fontWeight: topic === t.id ? 700 : 400,
              transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* Content */}
        {renderContent()}

        <button onClick={onClose} style={{ width: "100%", padding: isWide ? "12px" : "10px", background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: isWide ? 14 : 12, fontFamily: FD, cursor: "pointer", marginTop: 12 }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Slider ───────── */
function ParamSlider({ label, unit, value, min, max, step, onChange, color }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontFamily: FM, color: K.inkMed }}>{label}</span>
        <span style={{ fontSize: 14, fontFamily: FD, color: color || K.accent }}>{value.toFixed(0)} <span style={{ fontSize: 10, fontFamily: FM, color: K.inkLight }}>{unit}</span></span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", height: 3, appearance: "none", WebkitAppearance: "none", background: `linear-gradient(to right, ${color || K.accent} 0%, ${color || K.accent} ${pct}%, ${K.border} ${pct}%, ${K.border} 100%)`, borderRadius: 0, outline: "none", cursor: "pointer" }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 8, color: K.inkLight, fontFamily: FM }}>{min}</span>
        <span style={{ fontSize: 8, color: K.inkLight, fontFamily: FM }}>{max}</span>
      </div>
    </div>
  );
}

/* ───────── State Table ───────── */
function StateTable({ cycle, onSelectState }) {
  const fmt = v => v < 10 ? v.toFixed(3) : v < 100 ? v.toFixed(2) : v.toFixed(1);
  const qualities = cycle.states.map(s => {
    const info = getPhaseInfo(s.s, s.T);
    if (info.phase === "subcooled") return "0 (sub.)";
    if (info.phase === "superheated") return "1 (sup.)";
    if (info.phase === "supercritical") return "—";
    return info.quality.toFixed(3);
  });
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FM, fontSize: 10 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${K.ink}` }}>
            {["State","T (°C)","P (kPa)","h (kJ/kg)","s (kJ/kg·K)","x"].map(h => (
              <th key={h} style={{ padding: "6px 3px", color: K.inkMed, fontWeight: 400, textAlign: "center", fontSize: 9, fontStyle: "italic" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cycle.states.map((s, i) => (
            <tr key={i}
              onClick={() => onSelectState({ s: s.s, T: s.T })}
              style={{ borderBottom: `0.5px solid ${K.gridMajor}`, cursor: "pointer", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = K.cardAlt}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.accent, fontFamily: FD, fontSize: 13 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  {s.label}
                  <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.4 }}><circle cx="4" cy="4" r="3" fill="none" stroke={K.accent} strokeWidth="1"/><circle cx="4" cy="4" r="1" fill={K.accent}/></svg>
                </span>
              </td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.ink }}>{fmt(s.T)}</td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.ink }}>{fmt(s.P)}</td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.ink }}>{fmt(s.h)}</td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.ink }}>{fmt(s.s)}</td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.inkMed, fontSize: 9 }}>{qualities[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontSize: 8, color: K.inkLight, fontStyle: "italic", textAlign: "center" }}>
        Tap a row to visualize that state point
      </div>
    </div>
  );
}

/* ───────── Desktop detection ───────── */
function useIsDesktop(breakpoint = 840) {
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.innerWidth >= breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isDesktop;
}

/* ───────── Main ───────── */
export default function App() {
  const [pHigh, setPHigh] = useState(4000);
  const [pLow, setPLow] = useState(20);
  const [tSup, setTSup] = useState(450);
  const [showInfo, setShowInfo] = useState(false);
  const [showEqs, setShowEqs] = useState(false);
  const [dragPoint, setDragPoint] = useState({ s: 4.2, T: 200 });
  const [showAreas, setShowAreas] = useState(false);
  const [lockS, setLockS] = useState(false);
  const [lockT, setLockT] = useState(false);
  const [lockP, setLockP] = useState(false);
  const [lockV, setLockV] = useState(false);

  const tSatHigh = interpSteam(pHigh, "T");
  const minTSup = Math.ceil(tSatHigh + 10);
  const adjustedTSup = Math.max(tSup, minTSup);
  const cycle = useMemo(() => calculateCycle(pHigh, pLow, adjustedTSup), [pHigh, pLow, adjustedTSup]);
  const phaseInfo = useMemo(() => getPhaseInfo(dragPoint.s, dragPoint.T), [dragPoint]);
  const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);

  const desktop = useIsDesktop();
  const gap = desktop ? 16 : 12;
  const card = { margin: `${gap}px ${gap}px 0`, padding: desktop ? "18px" : "14px", background: K.card, border: `1px solid ${K.border}` };
  const sec = { margin: "0 0 10px 0", fontSize: desktop ? 14 : 12, fontFamily: FD, color: K.ink, borderBottom: `1px solid ${K.border}`, paddingBottom: 6 };

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.ink, fontFamily: FM, maxWidth: desktop ? "100%" : 480, margin: "0 auto" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;
          background:${K.accent};border:2px solid #fff;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15);
        }
        input[type="range"]::-moz-range-thumb { width:16px;height:16px;border-radius:50%;background:${K.accent};border:2px solid #fff;cursor:pointer; }
        *{box-sizing:border-box}body{margin:0;background:${K.bg}}
      `}</style>

      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: `2px solid ${K.ink}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 8, color: K.inkLight, fontFamily: FM, letterSpacing: 3, marginBottom: 1, textTransform: "uppercase" }}>Thermodynamics</div>
          <h1 style={{ margin: 0, fontSize: 20, fontFamily: FD, color: K.ink, lineHeight: 1.1 }}>
            SteamCycle <span style={{ color: K.accent, fontStyle: "italic" }}>Studio</span>
          </h1>
          <div style={{ fontSize: 8, color: K.inkLight, fontFamily: FM, letterSpacing: 2, marginTop: 2 }}>Ideal Rankine Cycle Analysis</div>
        </div>
        <button onClick={() => setShowInfo(true)} style={{ background: K.accent, border: "none", padding: "7px 14px", color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: FD }}>Theory</button>
      </div>
      <InfoModal open={showInfo} onClose={() => setShowInfo(false)} />

      {/* Performance */}
      <div style={{ margin: `${gap}px ${gap}px 0`, padding: "12px", background: "#fff", border: `1px solid ${K.border}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { l: "η thermal", v: `${(cycle.eta * 100).toFixed(1)}%`, c: K.accent },
          { l: "W net", v: fmt(cycle.wNet), c: K.workOut, s: "kJ/kg" },
          { l: "BWR", v: `${(cycle.bwr * 100).toFixed(2)}%`, c: K.workIn },
        ].map((m, i) => (
          <div key={i} style={{ textAlign: "center", padding: "4px 0" }}>
            <div style={{ fontSize: 8, color: K.inkLight, fontFamily: FM, letterSpacing: 1, marginBottom: 3, textTransform: "uppercase", fontStyle: "italic" }}>{m.l}</div>
            <div style={{ fontSize: desktop ? 24 : 20, fontFamily: FD, color: m.c, lineHeight: 1.2 }}>{m.v}</div>
            {m.s && <div style={{ fontSize: 8, color: K.inkLight, fontFamily: FM }}>{m.s}</div>}
          </div>
        ))}
      </div>

      {/* Row: Schematic + Phase Visualizer (side by side on desktop) */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>System Schematic</h3>
          <SchematicDiagram cycle={cycle} />
        </div>
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}`, display: "flex", flexDirection: "column" } : card}>
          <h3 style={sec}>Phase Visualizer <span style={{ fontFamily: FM, fontSize: 9, color: K.inkLight, fontStyle: "italic" }}>— drag a point on the diagrams below</span></h3>
          <ParticleVisualizer phaseInfo={phaseInfo} temperature={dragPoint.T} fillHeight={desktop} />
        </div>
      </div>

      {/* Row: T-s + P-v Diagrams (side by side on desktop) */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        {/* T-s Diagram */}
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...sec, marginBottom: 8 }}>
            <span>T–s Diagram <span style={{ fontFamily: FM, fontSize: 9, color: K.inkLight, fontStyle: "italic" }}>— interactive</span></span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setShowAreas(a => !a)} style={{
                background: showAreas ? K.workOut : "none", border: `1px solid ${showAreas ? K.workOut : K.border}`, padding: "3px 8px",
                color: showAreas ? "#fff" : K.inkMed, fontSize: 9, fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>η areas</button>
              <button onClick={() => setShowEqs(true)} style={{
                background: "none", border: `1px solid ${K.border}`, padding: "3px 8px",
                color: K.inkMed, fontSize: 9, fontFamily: FM, cursor: "pointer", borderRadius: 4,
              }}>f(x)</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => { setLockS(l => !l); if (!lockS) { setLockT(false); setLockP(false); setLockV(false); } }}
              style={{ flex: 1, padding: "5px 0", fontSize: 9, fontFamily: FM, background: lockS ? K.accent : K.cardAlt, color: lockS ? "#fff" : K.inkMed, border: `1px solid ${lockS ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockS ? 700 : 400, transition: "all 0.15s" }}>
              {lockS ? "🔒" : "🔓"} Lock s = {dragPoint.s.toFixed(2)}
            </button>
            <button onClick={() => { setLockT(l => !l); if (!lockT) { setLockS(false); setLockP(false); setLockV(false); } }}
              style={{ flex: 1, padding: "5px 0", fontSize: 9, fontFamily: FM, background: lockT ? K.accent : K.cardAlt, color: lockT ? "#fff" : K.inkMed, border: `1px solid ${lockT ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockT ? 700 : 400, transition: "all 0.15s" }}>
              {lockT ? "🔒" : "🔓"} Lock T = {dragPoint.T.toFixed(0)}°C
            </button>
          </div>
          <TsDiagram cycle={cycle} dragPoint={dragPoint} onDrag={setDragPoint} lockS={lockS} lockT={lockT} showAreas={showAreas} />
        </div>

        {/* P-v Diagram */}
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <div style={{ ...sec, marginBottom: 8 }}>
            <span>P–v Diagram <span style={{ fontFamily: FM, fontSize: 9, color: K.inkLight, fontStyle: "italic" }}>— interactive</span></span>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => { setLockP(l => !l); if (!lockP) { setLockV(false); setLockS(false); setLockT(false); } }}
              style={{ flex: 1, padding: "5px 0", fontSize: 9, fontFamily: FM, background: lockP ? K.accent : K.cardAlt, color: lockP ? "#fff" : K.inkMed, border: `1px solid ${lockP ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockP ? 700 : 400, transition: "all 0.15s" }}>
              {lockP ? "🔒" : "🔓"} Lock P = {(dragPoint.P != null ? dragPoint.P : stToP(dragPoint.s, dragPoint.T)).toFixed(0)} kPa
            </button>
            <button onClick={() => { setLockV(l => !l); if (!lockV) { setLockP(false); setLockS(false); setLockT(false); } }}
              style={{ flex: 1, padding: "5px 0", fontSize: 9, fontFamily: FM, background: lockV ? K.accent : K.cardAlt, color: lockV ? "#fff" : K.inkMed, border: `1px solid ${lockV ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockV ? 700 : 400, transition: "all 0.15s" }}>
              {lockV ? "🔒" : "🔓"} Lock v = {(dragPoint.v != null ? dragPoint.v : stToV(dragPoint.s, dragPoint.T)).toFixed(4)} m³/kg
            </button>
          </div>
          <PvDiagram cycle={cycle} dragPoint={dragPoint} onDrag={setDragPoint} lockP={lockP} lockV={lockV} />
        </div>
      </div>
      <EquationsModal open={showEqs} onClose={() => setShowEqs(false)} cycle={cycle} />

      {/* Row: Sliders + Table (side by side on desktop) */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : { ...card, padding: "16px" }}>
          <h3 style={sec}>Cycle Parameters</h3>
          <ParamSlider label="Boiler Pressure (P high)" unit="kPa" color={K.heatIn} value={pHigh} min={500} max={10000} step={100} onChange={setPHigh} />
          <ParamSlider label="Condenser Pressure (P low)" unit="kPa" color={K.heatOut} value={pLow} min={5} max={100} step={1} onChange={setPLow} />
          <ParamSlider label="Superheat Temperature (T₃)" unit="°C" color={K.workOut} value={adjustedTSup} min={minTSup} max={600} step={5} onChange={v => setTSup(v)} />
          <div style={{ marginTop: 6, fontSize: 9, color: K.inkLight, borderTop: `1px solid ${K.gridFine}`, paddingTop: 6, fontStyle: "italic" }}>
            T_sat at P_high = {tSatHigh.toFixed(1)}°C &nbsp;|&nbsp; x₄ = {cycle.x4.toFixed(3)}
          </div>
        </div>
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>State Point Properties <span style={{ fontFamily: FM, fontSize: 9, color: K.inkLight, fontStyle: "italic" }}>— Table 1</span></h3>
          <StateTable cycle={cycle} onSelectState={setDragPoint} />
        </div>
      </div>

      {/* Energy Balance */}
      <div style={{ ...card, marginBottom: 0 }}>
        <h3 style={sec}>Energy Balance</h3>
        <div style={{ display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: desktop ? 16 : 8 }}>
          {/* Heat Transfer group */}
          <div>
            <div style={{ fontSize: 9, fontFamily: FM, color: K.inkLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${K.border}`, textAlign: "center" }}>Heat Transfer</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { l: "Q in (Boiler)", v: fmt(cycle.qIn), u: "kJ/kg", c: K.heatIn },
                { l: "Q out (Cond.)", v: fmt(cycle.qOut), u: "kJ/kg", c: K.heatOut },
              ].map((e, i) => (
                <div key={i} style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: desktop ? "12px 14px" : "8px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: K.inkLight, marginBottom: 4, fontStyle: "italic", letterSpacing: 1, textTransform: "uppercase" }}>{e.l}</div>
                  <div style={{ fontSize: desktop ? 22 : 16, fontFamily: FD, color: e.c }}>{e.v}</div>
                  <div style={{ fontSize: 8, color: K.inkLight, fontFamily: FM, marginTop: 2 }}>{e.u}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Work group */}
          <div>
            <div style={{ fontSize: 9, fontFamily: FM, color: K.inkLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${K.border}`, textAlign: "center" }}>Work</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { l: "W turbine", v: fmt(cycle.wTurbine), u: "kJ/kg", c: K.workOut },
                { l: "W pump", v: fmt(cycle.wPump), u: "kJ/kg", c: K.workIn },
              ].map((e, i) => (
                <div key={i} style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: desktop ? "12px 14px" : "8px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: K.inkLight, marginBottom: 4, fontStyle: "italic", letterSpacing: 1, textTransform: "uppercase" }}>{e.l}</div>
                  <div style={{ fontSize: desktop ? 22 : 16, fontFamily: FD, color: e.c }}>{e.v}</div>
                  <div style={{ fontSize: 8, color: K.inkLight, fontFamily: FM, marginTop: 2 }}>{e.u}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: 8 }}>
          <div style={{ padding: desktop ? "10px 14px" : "8px 10px", background: K.cardAlt, border: `1px solid ${K.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: K.inkLight, fontStyle: "italic", marginBottom: 2 }}>Q_in − Q_out</div>
            <div style={{ fontSize: desktop ? 16 : 12, fontFamily: FD, color: K.accent }}>≈ {fmt(cycle.qIn - cycle.qOut)} kJ/kg</div>
          </div>
          <div style={{ padding: desktop ? "10px 14px" : "8px 10px", background: K.cardAlt, border: `1px solid ${K.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: K.inkLight, fontStyle: "italic", marginBottom: 2 }}>W_net = W_t − W_p</div>
            <div style={{ fontSize: desktop ? 16 : 12, fontFamily: FD, color: K.workOut }}>= {fmt(cycle.wNet)} kJ/kg</div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", padding: "14px 12px 28px", fontSize: 9, color: K.inkLight, fontFamily: FM, fontStyle: "italic", letterSpacing: 1 }}>
        Ideal Rankine Cycle · Simplified Steam Properties
      </div>
    </div>
  );
}
