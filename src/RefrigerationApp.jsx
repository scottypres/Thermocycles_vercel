import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { K_LIGHT, K_DARK, FD, FM, lerp, ParamSlider, useIsDesktop, SettingsModal, loadUnits, saveUnits, loadAnimSpeed, saveAnimSpeed, fmtT, fmtP, fmtH, fmtS, cvtT, cvtP, cvtH, cvtS, lblT, lblP, lblH, lblS } from "./shared.jsx";
let K = K_LIGHT;
import { REFRIGERANTS, interpRefrigerant, getRefrigerantDomeBounds, getRefrigerantPhaseInfo, getDefaultPressures } from "./refrigerantData.js";
import { GuidedTour, WelcomePopup, REF_TOUR_STEPS } from "./GuidedTour.jsx";

/* ───────── Cycle Calculation ───────── */
function calculateRefrigerationCycle(ref, pHigh, pLow) {
  const table = ref.table;
  const interp = (P, prop) => interpRefrigerant(table, P, prop);

  const Tsat_high = interp(pHigh, "T");
  const Tsat_low = interp(pLow, "T");
  const hf_low = interp(pLow, "hf"), hg_low = interp(pLow, "hg");
  const sf_low = interp(pLow, "sf"), sg_low = interp(pLow, "sg");
  const hf_high = interp(pHigh, "hf"), hg_high = interp(pHigh, "hg");
  const sf_high = interp(pHigh, "sf"), sg_high = interp(pHigh, "sg");

  // State 1: Saturated vapor at evaporator exit
  const T1 = Tsat_low, h1 = hg_low, s1 = sg_low;

  // State 2: Superheated vapor after isentropic compression
  const s2 = s1; // isentropic
  // Approximate cp for superheated vapor region
  const cp_vap = Math.max(0.8, (hg_high - hf_high) / Math.max(1, (Tsat_high - Tsat_low)));
  const cp_est = Math.min(2.5, Math.max(0.7, cp_vap * 0.15));
  const T2 = Tsat_high + Math.max(5, (s2 - sg_high) * (Tsat_high + 273.15) / cp_est);
  const h2 = hg_high + cp_est * (T2 - Tsat_high);

  // State 3: Saturated liquid at condenser exit
  const T3 = Tsat_high, h3 = hf_high, s3 = sf_high;

  // State 4: Two-phase after isenthalpic expansion
  const h4 = h3; // isenthalpic
  const T4 = Tsat_low;
  let x4 = (h4 - hf_low) / (hg_low - hf_low);
  x4 = Math.max(0, Math.min(1, x4));
  const s4 = sf_low + x4 * (sg_low - sf_low);

  // Performance
  const wComp = h2 - h1;
  const qEvap = h1 - h4;
  const qCond = h2 - h3;
  const copCool = wComp > 0 ? qEvap / wComp : 0;
  const copHeat = wComp > 0 ? qCond / wComp : 0;

  // Condenser path on T-s: 2 → (desuper to sat vapor) → (two-phase at Tsat) → 3
  const condenserTsPath = [];
  // Desuperheating: 2 → sat vapor at pHigh
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    condenserTsPath.push({ s: lerp(f, 0, 1, s2, sg_high), T: lerp(f, 0, 1, T2, Tsat_high) });
  }
  // Condensation: sat vapor → sat liquid at pHigh
  for (let i = 1; i <= 12; i++) {
    const f = i / 12;
    condenserTsPath.push({ s: lerp(f, 0, 1, sg_high, sf_high), T: Tsat_high });
  }

  // Expansion valve path on T-s: 3 → 4 (isenthalpic, NOT isentropic)
  // At constant h = h3, varying P from pHigh to pLow
  const expansionTsPath = [];
  for (let i = 0; i <= 16; i++) {
    const f = i / 16;
    const P_i = lerp(f, 0, 1, pHigh, pLow);
    const T_i = interp(P_i, "T");
    const hf_i = interp(P_i, "hf"), hg_i = interp(P_i, "hg");
    const sf_i = interp(P_i, "sf"), sg_i = interp(P_i, "sg");
    let s_i;
    if (h4 <= hf_i) { s_i = sf_i; }
    else if (h4 >= hg_i) { s_i = sg_i + cp_est * Math.log((h4 - hg_i) / cp_est / (T_i + 273.15) + 1); }
    else { const x_i = (h4 - hf_i) / (hg_i - hf_i); s_i = sf_i + x_i * (sg_i - sf_i); }
    expansionTsPath.push({ s: s_i, T: T_i });
  }

  return {
    states: [
      { label: "1", T: T1, s: s1, h: h1, P: pLow, desc: "Sat. Vapor" },
      { label: "2", T: T2, s: s2, h: h2, P: pHigh, desc: "Superheated" },
      { label: "3", T: T3, s: s3, h: h3, P: pHigh, desc: "Sat. Liquid" },
      { label: "4", T: T4, s: s4, h: h4, P: pLow, desc: "Two-Phase" },
    ],
    Tsat_high, Tsat_low, wComp, qEvap, qCond, copCool, copHeat, x4,
    h1, h2, h3, h4, s1, s2, s3, s4, T1, T2, T3, T4,
    condenserTsPath, expansionTsPath,
  };
}

/* ───────── Particle Visualizer (matches steam cycle dynamics) ───────── */
const NUM_PARTICLES = 600;
function RefParticleVisualizer({ phaseInfo, temperature, criticalT, fillHeight, textScale, units }) {
  const ts = textScale || 1;
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const canvasRef = useRef(null);
  const particlesRef = useRef(null);
  const animRef = useRef(null);
  const W = 680, H = 480;
  const quality = phaseInfo.quality !== null ? phaseInfo.quality : (phaseInfo.phase === "superheated" || phaseInfo.phase === "supercritical" ? 1 : 0);
  const phase = phaseInfo.phase;
  const tNorm = Math.min(1, Math.max(0, temperature / (criticalT || 100)));

  if (!particlesRef.current) {
    particlesRef.current = Array.from({ length: NUM_PARTICLES }, (_, i) => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4,
      r: 5 + Math.random() * 3, id: i,
    }));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const liquidLevel = phase === "subcooled" ? 0 : H * quality;
    const speedBase = 0.6 + tNorm * 6;
    const vaporSpeed = speedBase * 4.32;
    const liquidSpeed = speedBase * 0.06;
    const twoPhaseLiquidSpeed = speedBase * 0.672;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      if (quality < 1) {
        const grad = ctx.createLinearGradient(0, liquidLevel, 0, H);
        const lAlpha = 0.15 + (1 - quality) * 0.2;
        grad.addColorStop(0, `rgba(36,113,163,${lAlpha * 0.5})`);
        grad.addColorStop(1, `rgba(36,113,163,${lAlpha})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, liquidLevel, W, H - liquidLevel);
        ctx.strokeStyle = `rgba(36,113,163,${0.3 + (1 - quality) * 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, liquidLevel);
        for (let wx = 0; wx <= W; wx += 4) {
          const wave = Math.sin(wx * 0.04 + Date.now() * 0.002) * 2;
          ctx.lineTo(wx, liquidLevel + wave);
        }
        ctx.stroke();
      }

      const particles = particlesRef.current;
      particles.forEach((p, i) => {
        const isVapor = i < Math.floor(quality * NUM_PARTICLES);
        if (phase === "subcooled") {
          const minY = p.r + 2, maxY = H - p.r - 2;
          const span = Math.max(1, maxY - minY);
          const depthFrac = ((p.id * 0.61803398875) % 1);
          const targetY = minY + depthFrac * span;
          p.vx *= 0.99; p.vy *= 0.99;
          const speed = liquidSpeed * 0.45;
          p.vx += (Math.random() - 0.5) * speed * 0.12;
          p.vy += (Math.random() - 0.5) * speed * 0.12;
          p.vy += (targetY - p.y) * 0.0012;
        } else if (phase === "superheated" || phase === "supercritical") {
          p.vx += (Math.random() - 0.5) * vaporSpeed * 0.5;
          p.vy += (Math.random() - 0.5) * vaporSpeed * 0.5;
          p.vx *= 0.96; p.vy *= 0.96;
        } else {
          if (isVapor) {
            p.vx += (Math.random() - 0.5) * vaporSpeed * 0.4;
            p.vy += (Math.random() - 0.5) * vaporSpeed * 0.4;
            p.vx *= 0.96; p.vy *= 0.96;
            if (p.y > liquidLevel - 5) p.vy -= 0.3;
          } else {
            const minY = liquidLevel + p.r + 2, maxY = H - p.r - 2;
            const span = Math.max(1, maxY - minY);
            const depthFrac = ((p.id * 0.61803398875) % 1);
            const targetY = minY + depthFrac * span;
            p.vx *= 0.94; p.vy *= 0.94;
            p.vx += (Math.random() - 0.5) * twoPhaseLiquidSpeed * 0.85;
            p.vy += (Math.random() - 0.5) * twoPhaseLiquidSpeed * 0.65;
            p.vy += (targetY - p.y) * 0.0016;
            if (p.y < liquidLevel + 8) p.vy += 0.08;
          }
        }
        const maxV = isVapor ? vaporSpeed * 2 : (phase === "two-phase" ? twoPhaseLiquidSpeed * 2.2 : liquidSpeed * 3);
        const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (v > maxV) { p.vx = (p.vx / v) * maxV; p.vy = (p.vy / v) * maxV; }
        p.x += p.vx; p.y += p.vy;

        if (phase === "two-phase") {
          if (isVapor) {
            const maxY2 = liquidLevel - p.r - 1;
            if (p.y > maxY2) { p.y = maxY2; p.vy = -Math.abs(p.vy) * 0.6; }
          } else {
            const minY2 = liquidLevel + p.r + 1;
            if (p.y < minY2) { p.y = minY2 + Math.random() * Math.max(1, H - p.r - 1 - minY2); p.vy = Math.abs(p.vy) * 0.4; }
          }
        }

        if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx); }
        if (p.x > W - p.r) { p.x = W - p.r; p.vx = -Math.abs(p.vx); }
        if (p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy); }
        if (p.y > H - p.r) { p.y = H - p.r; p.vy = -Math.abs(p.vy); }

        if (isVapor) {
          const r2 = p.r * (0.6 + tNorm * 0.3);
          ctx.beginPath(); ctx.arc(p.x, p.y, r2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${160 + Math.round(tNorm * 60)}, ${50 + Math.round((1 - tNorm) * 30)}, 40, 0.49)`;
          ctx.fill();
          ctx.beginPath(); ctx.arc(p.x, p.y, r2 + 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${180 + Math.round(tNorm * 40)}, 60, 40, 0.1)`;
          ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.85, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(36, 113, 163, 0.85)`;
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
        style={{ width: "100%", display: "block", border: `1.5px solid ${K.ink}`, background: K.cardAlt, ...(fillHeight ? { flex: 1, height: 0 } : { height: "auto" }) }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        {phase === "two-phase" ? (
          <div style={{ background: K.bg === "#0d1117" ? "rgba(13,17,23,0.88)" : "rgba(255,255,255,0.88)", padding: fillHeight ? `${18 * ts}px ${38 * ts}px` : `${8 * ts}px ${18 * ts}px`, border: `1.5px solid ${K.ink}`, textAlign: "center" }}>
            <div style={{ fontSize: (fillHeight ? 44 : 28) * ts, fontFamily: FD, color: K.accent, lineHeight: fillHeight ? 1.02 : 1.1 }}>{(quality * 100).toFixed(1)}%</div>
            <div style={{ fontSize: (fillHeight ? 13 : 9) * ts, fontFamily: FM, color: K.inkMed, letterSpacing: fillHeight ? 1.4 : 1, marginTop: (fillHeight ? 4 : 2) * ts }}>QUALITY (x)</div>
          </div>
        ) : (
          <div style={{ background: K.bg === "#0d1117" ? "rgba(13,17,23,0.88)" : "rgba(255,255,255,0.88)", padding: fillHeight ? `${18 * ts}px ${38 * ts}px` : `${8 * ts}px ${18 * ts}px`, border: `1.5px solid ${K.ink}`, textAlign: "center" }}>
            <div style={{ fontSize: (fillHeight ? 44 : 28) * ts, fontFamily: FD, color: K.ink, lineHeight: fillHeight ? 1.02 : 1.1 }}>{phaseLabel}</div>
            <div style={{ fontSize: (fillHeight ? 13 : 9) * ts, fontFamily: FM, color: K.inkMed, letterSpacing: fillHeight ? 1.4 : 1, marginTop: (fillHeight ? 4 : 2) * ts }}>{phase === "subcooled" ? "x = 0 (all liquid)" : "x = 1 (all vapor)"}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: K.liquidBlue }} />
          <span style={{ fontSize: (fillHeight ? 18 : 10) * ts, fontFamily: FM, color: K.inkLight }}>Liquid</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: K.vaporRed }} />
          <span style={{ fontSize: (fillHeight ? 18 : 10) * ts, fontFamily: FM, color: K.inkLight }}>Vapor</span>
        </div>
        <div style={{ fontSize: (fillHeight ? 18 : 10) * ts, fontFamily: FM, color: K.inkLight }}>T = {fmtT(temperature, u, 0)}</div>
      </div>
    </div>
  );
}

/* ───────── T-s Diagram ───────── */
const TS_W = 360, TS_H = 285;
const TS_PAD = { l: 38, r: 6, t: 14, b: 28 };
const TS_PLOT = { x: TS_PAD.l, y: TS_PAD.t, w: TS_W - TS_PAD.l - TS_PAD.r, h: TS_H - TS_PAD.t - TS_PAD.b };

function RefTsDiagram({ cycle, refData, dragPoint, onDrag, lockS, lockT, showAreas, onPHighChange, onPLowChange, lineDragInfo, onLineDragStart, onLineDragMove, onLineDragEnd, textScale, units }) {
  const sz = px => px * (textScale || 1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const lineDragRef = useRef(null);
  const [activeArea, setActiveArea] = useState("qEvap");

  // Auto-scale axes from refrigerant data
  const table = refData.table;
  const sMin = Math.floor(table[0].sf * 10) / 10 - 0.1;
  const sMax = Math.ceil(table[0].sg * 10) / 10 + 0.2;
  const tMin = Math.floor(table[0].T / 10) * 10 - 10;
  const tMax = Math.ceil((cycle.T2 + 20) / 10) * 10;

  const mapS = s => TS_PLOT.x + ((s - sMin) / (sMax - sMin)) * TS_PLOT.w;
  const mapT = T => TS_PLOT.y + TS_PLOT.h - ((T - tMin) / (tMax - tMin)) * TS_PLOT.h;
  const unmapS = px => sMin + ((px - TS_PLOT.x) / TS_PLOT.w) * (sMax - sMin);
  const unmapT = py => tMin + ((TS_PLOT.y + TS_PLOT.h - py) / TS_PLOT.h) * (tMax - tMin);

  // Reverse lookup: T → P for this refrigerant
  const satTempToP = useCallback((T) => {
    if (T <= table[0].T) return table[0].P;
    if (T >= table[table.length - 1].T) return table[table.length - 1].P;
    for (let i = 0; i < table.length - 1; i++) {
      if (T >= table[i].T && T <= table[i + 1].T)
        return lerp(T, table[i].T, table[i + 1].T, table[i].P, table[i + 1].P);
    }
    return table[table.length - 1].P;
  }, [table]);

  const getSvgXY = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = TS_W / rect.width, scaleY = TS_H / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const px = Math.max(TS_PLOT.x, Math.min(TS_PLOT.x + TS_PLOT.w, (clientX - rect.left) * scaleX));
    const py = Math.max(TS_PLOT.y, Math.min(TS_PLOT.y + TS_PLOT.h, (clientY - rect.top) * scaleY));
    return { px, py };
  }, []);

  const getSvgY = useCallback((e) => {
    const r = getSvgXY(e);
    return r ? r.py : null;
  }, [getSvgXY]);

  const getSvgPoint = useCallback((e) => {
    const r = getSvgXY(e);
    if (!r) return null;
    const s = lockS ? dragPoint.s : unmapS(r.px);
    const T = lockT ? dragPoint.T : unmapT(r.py);
    return { s, T };
  }, [getSvgXY, lockS, lockT, dragPoint]);

  // Text label positions for hitbox detection
  const condTextX = mapS((cycle.states[1].s + cycle.states[2].s) / 2);
  const condTextY = mapT(cycle.Tsat_high) - 8;
  const evapTextX = mapS((cycle.states[3].s + cycle.states[0].s) / 2);
  const evapTextY = mapT(cycle.states[0].T) + 13;

  const handleStart = useCallback((e) => {
    if (e.touches && e.touches.length === 0) return;
    if (e.preventDefault) e.preventDefault();
    const r = getSvgXY(e);
    if (r) {
      if (Math.abs(r.px - condTextX) < 25 && Math.abs(r.py - condTextY) < 10) {
        lineDragRef.current = "condenser";
        if (onLineDragStart) onLineDragStart("condenser");
        return;
      }
      if (Math.abs(r.px - evapTextX) < 30 && Math.abs(r.py - evapTextY) < 10) {
        lineDragRef.current = "evaporator";
        if (onLineDragStart) onLineDragStart("evaporator");
        return;
      }
    }
    draggingRef.current = true;
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, condTextX, condTextY, evapTextX, evapTextY, onLineDragStart]);

  const handleMove = useCallback((e) => {
    if (lineDragRef.current) {
      e.preventDefault();
      const py = getSvgY(e);
      if (py == null) return;
      const T = unmapT(py);
      const P = satTempToP(T);
      const pMin = table[0].P;
      const pMax = table[table.length - 2].P;
      if (lineDragRef.current === "condenser") {
        const clamped = Math.max(Math.round(pMin + (pMax - pMin) * 0.2), Math.min(pMax, Math.round(P)));
        if (onPHighChange) onPHighChange(clamped);
        if (onLineDragMove) onLineDragMove("condenser", clamped, T);
      }
      if (lineDragRef.current === "evaporator") {
        const clamped = Math.max(pMin, Math.min(Math.round(pMin + (pMax - pMin) * 0.6), Math.round(P)));
        if (onPLowChange) onPLowChange(clamped);
        if (onLineDragMove) onLineDragMove("evaporator", clamped, T);
      }
      return;
    }
    if (!draggingRef.current) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgPoint, getSvgY, onDrag, satTempToP, table, onPHighChange, onPLowChange, onLineDragMove]);

  const handleEnd = useCallback(() => {
    draggingRef.current = false;
    if (lineDragRef.current) {
      lineDragRef.current = null;
      if (onLineDragEnd) onLineDragEnd();
    }
  }, [onLineDragEnd]);

  // Dome curve
  const domeLeft = table.map(r => ({ s: r.sf, T: r.T }));
  const domeRight = [...table].reverse().map(r => ({ s: r.sg, T: r.T }));
  const domeCurve = [...domeLeft, ...domeRight];
  const domePathD = domeCurve.map((p, i) => `${i === 0 ? "M" : "L"}${mapS(p.s).toFixed(1)},${mapT(p.T).toFixed(1)}`).join(" ") + " Z";

  const st = cycle.states;
  const dpx = mapS(dragPoint.s), dpy = mapT(dragPoint.T);

  // Condenser path
  const condenserD = cycle.condenserTsPath.map((p, i) => `${i === 0 ? "M" : "L"}${mapS(p.s).toFixed(1)},${mapT(p.T).toFixed(1)}`).join(" ");
  // Expansion valve path
  const expansionD = cycle.expansionTsPath.map((p, i) => `${i === 0 ? "M" : "L"}${mapS(p.s).toFixed(1)},${mapT(p.T).toFixed(1)}`).join(" ");

  // Cycle fill path (for W_comp area)
  const cycleFillD = [
    `M${mapS(st[0].s).toFixed(1)},${mapT(st[0].T).toFixed(1)}`,
    `L${mapS(st[1].s).toFixed(1)},${mapT(st[1].T).toFixed(1)}`,
    condenserD.replace(/^M/, "L"),
    expansionD.replace(/^M/, "L"),
    `L${mapS(st[3].s).toFixed(1)},${mapT(st[3].T).toFixed(1)}`,
    "Z"
  ].join(" ");

  // Grid values
  const sStep = (sMax - sMin) / 6;
  const tStep = (tMax - tMin) / 6;
  const sGridVals = Array.from({ length: 7 }, (_, i) => +(sMin + i * sStep).toFixed(2));
  const tGridVals = Array.from({ length: 7 }, (_, i) => Math.round(tMin + i * tStep));

  return (
    <svg ref={svgRef} viewBox={`0 0 ${TS_W} ${TS_H}`} style={{ width: "100%", touchAction: "none", cursor: "crosshair", userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none" }}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
      {/* Grid */}
      {sGridVals.map((s, i) => <line key={`sg${i}`} x1={mapS(s)} y1={TS_PLOT.y} x2={mapS(s)} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.gridMajor} strokeWidth={0.5} />)}
      {tGridVals.map((t, i) => <line key={`tg${i}`} x1={TS_PLOT.x} y1={mapT(t)} x2={TS_PLOT.x + TS_PLOT.w} y2={mapT(t)} stroke={K.gridMajor} strokeWidth={0.5} />)}
      {/* Axes */}
      <line x1={TS_PLOT.x} y1={TS_PLOT.y + TS_PLOT.h} x2={TS_PLOT.x + TS_PLOT.w} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      <line x1={TS_PLOT.x} y1={TS_PLOT.y} x2={TS_PLOT.x} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      {sGridVals.map((s, i) => <text key={`sl${i}`} x={mapS(s)} y={TS_PLOT.y + TS_PLOT.h + 10} fill={K.inkMed} fontSize={sz(6.5)} textAnchor="middle" fontFamily={FM}>{s.toFixed(1)}</text>)}
      {tGridVals.map((t, i) => <text key={`tl${i}`} x={TS_PLOT.x - 4} y={mapT(t) + 2.5} fill={K.inkMed} fontSize={sz(6.5)} textAnchor="end" fontFamily={FM}>{t}</text>)}
      <text x={TS_W / 2} y={TS_H - 1} fill={K.inkMed} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic">s (kJ/kg·K)</text>
      <text x={10} y={TS_H / 2 - 8} fill={K.inkMed} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic" transform={`rotate(-90,10,${TS_H / 2 - 8})`}>T (°C)</text>
      {/* Dome */}
      <path d={domePathD} fill={showAreas ? "none" : K.dome} stroke={K.domeLine} strokeWidth={1} strokeDasharray="6 3" />
      {showAreas && (() => {
        const axisY = TS_PLOT.y + TS_PLOT.h;
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        // Q_evap area: under evaporator (4→1) down to axis
        const qEvapD = [
          `M${mapS(st[3].s).toFixed(1)},${axisY.toFixed(1)}`,
          `L${mapS(st[3].s).toFixed(1)},${mapT(st[3].T).toFixed(1)}`,
          `L${mapS(st[0].s).toFixed(1)},${mapT(st[0].T).toFixed(1)}`,
          `L${mapS(st[0].s).toFixed(1)},${axisY.toFixed(1)}`,
          "Z"
        ].join(" ");
        // Q_cond area: under compressor + condenser (1→2→3) down to axis
        const qCondD = [
          `M${mapS(st[0].s).toFixed(1)},${axisY.toFixed(1)}`,
          `L${mapS(st[0].s).toFixed(1)},${mapT(st[0].T).toFixed(1)}`,
          `L${mapS(st[1].s).toFixed(1)},${mapT(st[1].T).toFixed(1)}`,
          condenserD.replace(/^M/, "L"),
          `L${mapS(st[2].s).toFixed(1)},${axisY.toFixed(1)}`,
          "Z"
        ].join(" ");
        return (
          <>
            {activeArea === "qEvap" && <path d={qEvapD} fill={`${K.heatIn}28`} stroke="none" />}
            {activeArea === "qCond" && <path d={qCondD} fill={`${K.heatOut}28`} stroke="none" />}
            {activeArea === "wComp" && <path d={cycleFillD} fill={`${K.workIn}30`} stroke="none" />}
          </>
        );
      })()}
      {!showAreas && <path d={cycleFillD} fill={K.accentLight} stroke="none" />}
      {/* Process lines */}
      {/* 1→2 Compressor (vertical, s=const) */}
      <line x1={mapS(st[0].s)} y1={mapT(st[0].T)} x2={mapS(st[1].s)} y2={mapT(st[1].T)} stroke={K.workIn} strokeWidth={2.2} strokeLinecap="round" />
      {/* 2→3 Condenser (curved path) */}
      <path d={condenserD} fill="none" stroke={K.heatOut} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      {/* 3→4 Expansion valve (curved, isenthalpic) */}
      <path d={expansionD} fill="none" stroke={K.inkMed} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
      {/* 4→1 Evaporator (horizontal at Tsat_low) */}
      <line x1={mapS(st[3].s)} y1={mapT(st[3].T)} x2={mapS(st[0].s)} y2={mapT(st[0].T)} stroke={K.heatIn} strokeWidth={2.2} strokeLinecap="round" />
      {/* Drag popup for condenser/evaporator labels */}
      {lineDragInfo && (() => {
        const isCond = lineDragInfo.which === "condenser";
        const lineY = isCond ? mapT(cycle.Tsat_high) : mapT(cycle.Tsat_low);
        const color = isCond ? K.heatOut : K.heatIn;
        const T = isCond ? cycle.Tsat_high : cycle.Tsat_low;
        const label = isCond ? "T_cond" : "T_evap";
        const valueText = `${label} = ${fmtT(T, u, 1)}`;
        const boxW = Math.max(sz(104), valueText.length * sz(5.7) + sz(16));
        const boxX = TS_PLOT.x + 4;
        const boxY = TS_PLOT.y + 2;
        return (<>
          <line x1={TS_PLOT.x} y1={lineY} x2={TS_PLOT.x + TS_PLOT.w} y2={lineY} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
          <rect x={boxX} y={boxY} width={boxW} height={sz(18)} rx={2} fill={K.card} stroke={color} strokeWidth={0.8} />
          <text x={boxX + boxW / 2} y={boxY + sz(13)} fill={color} fontSize={sz(9)} fontFamily={FM} textAnchor="middle" fontWeight="600">{valueText}</text>
        </>);
      })()}
      {!showAreas && <>
        <rect x={mapS(st[0].s) + sz(4)} y={(mapT(st[0].T) + mapT(st[1].T)) / 2 - sz(8)} width={sz(52)} height={sz(11)} rx={2} fill={K.card} />
        <text x={mapS(st[0].s) + sz(8)} y={(mapT(st[0].T) + mapT(st[1].T)) / 2} fill={K.workIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500">Compressor</text>
        <rect x={mapS((st[1].s + st[2].s) / 2) - sz(24)} y={mapT(cycle.Tsat_high) - sz(16)} width={sz(48)} height={sz(11)} rx={2} fill={K.card} />
        <text x={mapS((st[1].s + st[2].s) / 2)} y={mapT(cycle.Tsat_high) - sz(8)} fill={K.heatOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "grab" }}>Condenser</text>
        <rect x={mapS((st[2].s + st[3].s) / 2) - sz(16) - sz(44)} y={(mapT(st[2].T) + mapT(st[3].T)) / 2 - sz(8)} width={sz(44)} height={sz(11)} rx={2} fill={K.card} />
        <text x={mapS((st[2].s + st[3].s) / 2) - sz(16)} y={(mapT(st[2].T) + mapT(st[3].T)) / 2} fill={K.inkMed} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="end">Exp. Valve</text>
        <rect x={mapS((st[3].s + st[0].s) / 2) - sz(26)} y={mapT(st[0].T) + sz(5)} width={sz(52)} height={sz(11)} rx={2} fill={K.card} />
        <text x={mapS((st[3].s + st[0].s) / 2)} y={mapT(st[0].T) + sz(13)} fill={K.heatIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "grab" }}>Evaporator</text>
        <line x1={dpx} y1={dpy} x2={dpx} y2={TS_PLOT.y + TS_PLOT.h} stroke={lockS ? K.accent : K.inkLight} strokeWidth={lockS ? 1.2 : 0.5} strokeDasharray={lockS ? "none" : "2 2"} />
        <line x1={dpx} y1={dpy} x2={TS_PLOT.x} y2={dpy} stroke={lockT ? K.accent : K.inkLight} strokeWidth={lockT ? 1.2 : 0.5} strokeDasharray={lockT ? "none" : "2 2"} />
      </>}
      {/* State points */}
      {st.map((s, i) => {
        const cx = mapS(s.s), cy = mapT(s.T);
        const off = [{ dx: sz(8), dy: sz(14) }, { dx: sz(8), dy: -sz(10) }, { dx: -sz(14), dy: -sz(10) }, { dx: -sz(14), dy: sz(14) }];
        const tx = cx + off[i].dx, ty = cy + off[i].dy;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={5} fill={K.card} stroke={K.stateCircle} strokeWidth={1.2} />
            <circle cx={cx} cy={cy} r={1.8} fill={K.stateFill} />
            <rect x={tx - sz(7)} y={ty - sz(10)} width={sz(14)} height={sz(13)} rx={1} fill={K.card} />
            <text x={tx} y={ty} fill={K.accent} fontSize={sz(12)} fontFamily={FD} textAnchor="middle">{s.label}</text>
          </g>
        );
      })}
      {!showAreas && <>
        <circle cx={dpx} cy={dpy} r={9} fill="rgba(192,57,43,0.15)" stroke={K.accent} strokeWidth={2} />
        <circle cx={dpx} cy={dpy} r={4} fill={K.accent} />
        {(() => {
          const label = `${fmtT(dragPoint.T, u, 0)}, ${fmtS(dragPoint.s, u, 2)}`;
          const w = sz(8) * 0.6 * label.length + sz(8);
          const flipLeft = dpx + sz(12) + w > TS_W - 2;
          const rectX = flipLeft ? dpx - sz(12) - w : dpx + sz(12);
          const textX = flipLeft ? rectX + sz(4) : dpx + sz(16);
          return <>
            <rect x={rectX} y={dpy - sz(22)} width={w} height={sz(18)} rx={2} fill={K.card} stroke={K.ink} strokeWidth={0.8} />
            <text x={textX} y={dpy - sz(10)} fill={K.ink} fontSize={sz(8)} fontFamily={FM}>{label}</text>
          </>;
        })()}
        <text x={TS_W - 8} y={TS_PLOT.y + 10} fill={K.inkLight} fontSize={sz(7)} fontFamily={FM} textAnchor="end" fontStyle="italic">{lockS ? "s locked" : lockT ? "T locked" : "tap & drag"}</text>
      </>}
      {showAreas && (() => {
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        const lx = TS_PLOT.x + 6, ly = TS_PLOT.y + 4;
        const dot = (k) => activeArea === k ? 1 : 0.35;
        return (
          <>
            <rect x={lx} y={ly} width={sz(160)} height={sz(52)} rx={2} fill={K.card} stroke={K.border} strokeWidth={0.8} />
            <g onClick={() => setActiveArea("qEvap")} style={{ cursor: "pointer" }} opacity={dot("qEvap")}>
              <rect x={lx + sz(5)} y={ly + sz(5)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.heatIn}30`} stroke={K.heatIn} strokeWidth={activeArea === "qEvap" ? 1.4 : 0.6} />
              <text x={lx + sz(17)} y={ly + sz(12)} fill={K.heatIn} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "qEvap" ? 700 : 400}>Q_evap (4→1) = {fmt(cycle.qEvap)} kJ/kg</text>
            </g>
            <g onClick={() => setActiveArea("qCond")} style={{ cursor: "pointer" }} opacity={dot("qCond")}>
              <rect x={lx + sz(5)} y={ly + sz(18)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.heatOut}30`} stroke={K.heatOut} strokeWidth={activeArea === "qCond" ? 1.4 : 0.6} />
              <text x={lx + sz(17)} y={ly + sz(25)} fill={K.heatOut} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "qCond" ? 700 : 400}>Q_cond (1→3) = {fmt(cycle.qCond)} kJ/kg</text>
            </g>
            <g onClick={() => setActiveArea("wComp")} style={{ cursor: "pointer" }} opacity={dot("wComp")}>
              <rect x={lx + sz(5)} y={ly + sz(31)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.workIn}40`} stroke={K.workIn} strokeWidth={activeArea === "wComp" ? 1.4 : 0.6} />
              <text x={lx + sz(17)} y={ly + sz(38)} fill={K.workIn} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "wComp" ? 700 : 400}>W_comp (1→2) = {fmt(cycle.wComp)} kJ/kg</text>
            </g>
            <text x={lx + sz(5)} y={ly + sz(49)} fill={K.ink} fontSize={sz(8)} fontFamily={FD} fontWeight="bold">COP = {cycle.copCool.toFixed(2)}</text>
          </>
        );
      })()}
    </svg>
  );
}

/* ───────── P-h Diagram ───────── */
const PH_W = 360, PH_H = 285;
const PH_PAD = { l: 38, r: 6, t: 14, b: 28 };
const PH_PLOT = { x: PH_PAD.l, y: PH_PAD.t, w: PH_W - PH_PAD.l - PH_PAD.r, h: PH_H - PH_PAD.t - PH_PAD.b };

function RefPhDiagram({ cycle, refData, dragPoint, onDrag, lockP, lockH, showAreas, onPHighChange, onPLowChange, lineDragInfo, onLineDragStart, onLineDragMove, onLineDragEnd, textScale, units }) {
  const sz = px => px * (textScale || 1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const lineDragRef = useRef(null);
  const [activeArea, setActiveArea] = useState("qEvap");

  const table = refData.table;
  const hMin = Math.floor(table[0].hf / 20) * 20 - 20;
  const hMax = Math.ceil((cycle.h2 + 30) / 20) * 20;
  const pMinLog = Math.floor(Math.log10(table[0].P) * 10) / 10 - 0.2;
  const pMaxLog = Math.ceil(Math.log10(table[table.length - 1].P) * 10) / 10 + 0.2;

  const mapH = h => PH_PLOT.x + ((h - hMin) / (hMax - hMin)) * PH_PLOT.w;
  const mapP = P => { const lp = Math.log10(Math.max(1, P)); return PH_PLOT.y + PH_PLOT.h - ((lp - pMinLog) / (pMaxLog - pMinLog)) * PH_PLOT.h; };
  const unmapH = px => hMin + ((px - PH_PLOT.x) / PH_PLOT.w) * (hMax - hMin);
  const unmapP = py => Math.pow(10, pMinLog + ((PH_PLOT.y + PH_PLOT.h - py) / PH_PLOT.h) * (pMaxLog - pMinLog));

  const getSvgPoint = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    const scaleX = PH_W / rect.width, scaleY = PH_H / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const px = Math.max(PH_PLOT.x, Math.min(PH_PLOT.x + PH_PLOT.w, (clientX - rect.left) * scaleX));
    const py = Math.max(PH_PLOT.y, Math.min(PH_PLOT.y + PH_PLOT.h, (clientY - rect.top) * scaleY));
    const h = lockH ? dragPoint.h : unmapH(px);
    const P = lockP ? dragPoint.P : unmapP(py);
    // Convert P-h to T-s for cross-sync
    const interp = (Pv, prop) => interpRefrigerant(table, Pv, prop);
    const Tsat = interp(P, "T");
    const hf = interp(P, "hf"), hg = interp(P, "hg");
    const sf = interp(P, "sf"), sg = interp(P, "sg");
    let T, s;
    if (h <= hf) { T = Tsat - 2; s = sf; }
    else if (h >= hg) {
      const cp_est = Math.min(2.5, Math.max(0.7, (hg - hf) / Math.max(1, Tsat + 50) * 0.15));
      T = Tsat + (h - hg) / Math.max(0.5, cp_est);
      s = sg + cp_est * Math.log(Math.max(0.01, (T + 273.15) / (Tsat + 273.15)));
    } else {
      const x = (h - hf) / (hg - hf);
      T = Tsat;
      s = sf + x * (sg - sf);
    }
    return { s, T, h, P };
  }, [lockP, lockH, dragPoint, table]);

  const getSvgXY = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = PH_W / rect.width, scaleY = PH_H / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const px = Math.max(PH_PLOT.x, Math.min(PH_PLOT.x + PH_PLOT.w, (clientX - rect.left) * scaleX));
    const py = Math.max(PH_PLOT.y, Math.min(PH_PLOT.y + PH_PLOT.h, (clientY - rect.top) * scaleY));
    return { px, py };
  }, []);

  const getSvgY = useCallback((e) => {
    const r = getSvgXY(e);
    return r ? r.py : null;
  }, [getSvgXY]);

  // Text label positions for hitbox detection
  const condTextX = (mapH(cycle.h2) + mapH(cycle.h3)) / 2;
  const condTextY = mapP(cycle.states[1].P) - 7;
  const evapTextX = (mapH(cycle.h4) + mapH(cycle.h1)) / 2;
  const evapTextY = mapP(cycle.states[0].P) + 13;

  const handleStart = useCallback((e) => {
    if (e.touches && e.touches.length === 0) return;
    if (e.preventDefault) e.preventDefault();
    const r = getSvgXY(e);
    if (r) {
      if (Math.abs(r.px - condTextX) < 25 && Math.abs(r.py - condTextY) < 10) {
        lineDragRef.current = "condenser";
        if (onLineDragStart) onLineDragStart("condenser");
        return;
      }
      if (Math.abs(r.px - evapTextX) < 30 && Math.abs(r.py - evapTextY) < 10) {
        lineDragRef.current = "evaporator";
        if (onLineDragStart) onLineDragStart("evaporator");
        return;
      }
    }
    draggingRef.current = true;
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, condTextX, condTextY, evapTextX, evapTextY, onLineDragStart]);

  const handleMove = useCallback((e) => {
    if (lineDragRef.current) {
      e.preventDefault();
      const py = getSvgY(e);
      if (py == null) return;
      const P = unmapP(py);
      const pMin = table[0].P;
      const pMax = table[table.length - 2].P;
      if (lineDragRef.current === "condenser") {
        const clamped = Math.max(Math.round(pMin + (pMax - pMin) * 0.2), Math.min(pMax, Math.round(P)));
        if (onPHighChange) onPHighChange(clamped);
        if (onLineDragMove) onLineDragMove("condenser", clamped, null);
      }
      if (lineDragRef.current === "evaporator") {
        const clamped = Math.max(pMin, Math.min(Math.round(pMin + (pMax - pMin) * 0.6), Math.round(P)));
        if (onPLowChange) onPLowChange(clamped);
        if (onLineDragMove) onLineDragMove("evaporator", clamped, null);
      }
      return;
    }
    if (!draggingRef.current) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgPoint, getSvgY, onDrag, table, onPHighChange, onPLowChange, onLineDragMove]);

  const handleEnd = useCallback(() => {
    draggingRef.current = false;
    if (lineDragRef.current) {
      lineDragRef.current = null;
      if (onLineDragEnd) onLineDragEnd();
    }
  }, [onLineDragEnd]);

  // Dome curve on P-h: left = hf, right = hg
  const domeLeft = table.map(r => ({ h: r.hf, P: r.P }));
  const domeRight = [...table].reverse().map(r => ({ h: r.hg, P: r.P }));
  const domeCurve = [...domeLeft, ...domeRight];
  const domePathD = domeCurve.map((p, i) => `${i === 0 ? "M" : "L"}${mapH(p.h).toFixed(1)},${mapP(p.P).toFixed(1)}`).join(" ") + " Z";

  const st = cycle.states;
  const dpx = mapH(dragPoint.h || cycle.h1), dpy = mapP(dragPoint.P || cycle.states[0].P);

  // Compressor path (1→2): isentropic, curves from (h1,pLow) to (h2,pHigh)
  const compPath = [];
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    const P_i = st[0].P * Math.pow(st[1].P / st[0].P, f);
    const h_i = lerp(f, 0, 1, cycle.h1, cycle.h2);
    compPath.push({ h: h_i, P: P_i });
  }
  const compD = compPath.map((p, i) => `${i === 0 ? "M" : "L"}${mapH(p.h).toFixed(1)},${mapP(p.P).toFixed(1)}`).join(" ");

  // Grid
  const hStep = (hMax - hMin) / 6;
  const hGridVals = Array.from({ length: 7 }, (_, i) => Math.round(hMin + i * hStep));
  const pGridVals = [];
  const pBase = Math.pow(10, Math.ceil(pMinLog));
  for (let p = pBase; p <= Math.pow(10, pMaxLog); p *= 2) pGridVals.push(Math.round(p));
  if (pGridVals.length < 4) for (let p = pBase; p <= Math.pow(10, pMaxLog); p *= 1.5) pGridVals.push(Math.round(p));

  return (
    <svg ref={svgRef} viewBox={`0 0 ${PH_W} ${PH_H}`} style={{ width: "100%", touchAction: "none", cursor: "crosshair", userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none" }}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
      {hGridVals.map((h, i) => <line key={`hg${i}`} x1={mapH(h)} y1={PH_PLOT.y} x2={mapH(h)} y2={PH_PLOT.y + PH_PLOT.h} stroke={K.gridMajor} strokeWidth={0.5} />)}
      {pGridVals.map((p, i) => <line key={`pg${i}`} x1={PH_PLOT.x} y1={mapP(p)} x2={PH_PLOT.x + PH_PLOT.w} y2={mapP(p)} stroke={K.gridMajor} strokeWidth={0.5} />)}
      <line x1={PH_PLOT.x} y1={PH_PLOT.y + PH_PLOT.h} x2={PH_PLOT.x + PH_PLOT.w} y2={PH_PLOT.y + PH_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      <line x1={PH_PLOT.x} y1={PH_PLOT.y} x2={PH_PLOT.x} y2={PH_PLOT.y + PH_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      {hGridVals.map((h, i) => <text key={`hl${i}`} x={mapH(h)} y={PH_PLOT.y + PH_PLOT.h + 10} fill={K.inkMed} fontSize={sz(6.5)} textAnchor="middle" fontFamily={FM}>{h}</text>)}
      {pGridVals.map((p, i) => <text key={`pl${i}`} x={PH_PLOT.x - 4} y={mapP(p) + 2.5} fill={K.inkMed} fontSize={sz(6.5)} textAnchor="end" fontFamily={FM}>{p >= 1000 ? `${(p/1000).toFixed(1)}k` : p}</text>)}
      <text x={PH_W / 2} y={PH_H - 1} fill={K.inkMed} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic">h (kJ/kg)</text>
      <text x={10} y={PH_H / 2 - 8} fill={K.inkMed} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic" transform={`rotate(-90,10,${PH_H / 2 - 8})`}>P (kPa) — log</text>
      {/* Dome */}
      <path d={domePathD} fill={showAreas ? "none" : K.dome} stroke={K.domeLine} strokeWidth={1} strokeDasharray="6 3" />
      {showAreas && (() => {
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        // Q_evap: horizontal strip at P_low from h4 to h1
        const qEvapD = `M${mapH(cycle.h4).toFixed(1)},${(mapP(st[0].P) - 6).toFixed(1)} L${mapH(cycle.h1).toFixed(1)},${(mapP(st[0].P) - 6).toFixed(1)} L${mapH(cycle.h1).toFixed(1)},${(mapP(st[0].P) + 6).toFixed(1)} L${mapH(cycle.h4).toFixed(1)},${(mapP(st[0].P) + 6).toFixed(1)} Z`;
        // Q_cond: horizontal strip at P_high from h3 to h2
        const qCondD = `M${mapH(cycle.h3).toFixed(1)},${(mapP(st[1].P) - 6).toFixed(1)} L${mapH(cycle.h2).toFixed(1)},${(mapP(st[1].P) - 6).toFixed(1)} L${mapH(cycle.h2).toFixed(1)},${(mapP(st[1].P) + 6).toFixed(1)} L${mapH(cycle.h3).toFixed(1)},${(mapP(st[1].P) + 6).toFixed(1)} Z`;
        // W_comp: enclosed cycle
        const wCompD = [
          `M${mapH(cycle.h1).toFixed(1)},${mapP(st[0].P).toFixed(1)}`,
          compD.replace(/^M/, "L"),
          `L${mapH(cycle.h2).toFixed(1)},${mapP(st[1].P).toFixed(1)}`,
          `L${mapH(cycle.h3).toFixed(1)},${mapP(st[2].P).toFixed(1)}`,
          `L${mapH(cycle.h4).toFixed(1)},${mapP(st[3].P).toFixed(1)}`,
          "Z"
        ].join(" ");
        return (
          <>
            {activeArea === "qEvap" && <path d={qEvapD} fill={`${K.heatIn}40`} stroke="none" />}
            {activeArea === "qCond" && <path d={qCondD} fill={`${K.heatOut}40`} stroke="none" />}
            {activeArea === "wComp" && <path d={wCompD} fill={`${K.workIn}30`} stroke="none" />}
          </>
        );
      })()}
      {/* Process lines */}
      {/* 1→2 Compressor (isentropic curve up-right) */}
      <path d={compD} fill="none" stroke={K.workIn} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      {/* 2→3 Condenser (horizontal left at P_high) */}
      <line x1={mapH(cycle.h2)} y1={mapP(st[1].P)} x2={mapH(cycle.h3)} y2={mapP(st[2].P)} stroke={K.heatOut} strokeWidth={2.2} strokeLinecap="round" />
      {/* 3→4 Expansion valve (vertical down, h=const) */}
      <line x1={mapH(cycle.h3)} y1={mapP(st[2].P)} x2={mapH(cycle.h4)} y2={mapP(st[3].P)} stroke={K.inkMed} strokeWidth={2.2} strokeLinecap="round" strokeDasharray="4 3" />
      {/* 4→1 Evaporator (horizontal right at P_low) */}
      <line x1={mapH(cycle.h4)} y1={mapP(st[3].P)} x2={mapH(cycle.h1)} y2={mapP(st[0].P)} stroke={K.heatIn} strokeWidth={2.2} strokeLinecap="round" />
      {/* Drag popup for condenser/evaporator labels */}
      {lineDragInfo && (() => {
        const isCond = lineDragInfo.which === "condenser";
        const lineY = isCond ? mapP(st[1].P) : mapP(st[0].P);
        const color = isCond ? K.heatOut : K.heatIn;
        const P = isCond ? st[1].P : st[0].P;
        const label = isCond ? "P_cond" : "P_evap";
        const valueText = `${label} = ${fmtP(P, u)}`;
        const boxW = Math.max(sz(104), valueText.length * sz(5.7) + sz(16));
        const boxX = PH_PLOT.x + 4;
        const boxY = PH_PLOT.y + 2;
        return (<>
          <line x1={PH_PLOT.x} y1={lineY} x2={PH_PLOT.x + PH_PLOT.w} y2={lineY} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
          <rect x={boxX} y={boxY} width={boxW} height={sz(18)} rx={2} fill={K.card} stroke={color} strokeWidth={0.8} />
          <text x={boxX + boxW / 2} y={boxY + sz(13)} fill={color} fontSize={sz(9)} fontFamily={FM} textAnchor="middle" fontWeight="600">{valueText}</text>
        </>);
      })()}
      {!showAreas && <>
        <rect x={(mapH(cycle.h1) + mapH(cycle.h2)) / 2 + sz(6)} y={(mapP(st[0].P) + mapP(st[1].P)) / 2 - sz(8)} width={sz(52)} height={sz(11)} rx={2} fill={K.card} />
        <text x={(mapH(cycle.h1) + mapH(cycle.h2)) / 2 + sz(10)} y={(mapP(st[0].P) + mapP(st[1].P)) / 2} fill={K.workIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500">Compressor</text>
        <rect x={(mapH(cycle.h2) + mapH(cycle.h3)) / 2 - sz(24)} y={mapP(st[1].P) - sz(15)} width={sz(48)} height={sz(11)} rx={2} fill={K.card} />
        <text x={(mapH(cycle.h2) + mapH(cycle.h3)) / 2} y={mapP(st[1].P) - sz(7)} fill={K.heatOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "grab" }}>Condenser</text>
        <rect x={mapH(cycle.h3) - sz(10) - sz(44)} y={(mapP(st[2].P) + mapP(st[3].P)) / 2 - sz(8)} width={sz(44)} height={sz(11)} rx={2} fill={K.card} />
        <text x={mapH(cycle.h3) - sz(10)} y={(mapP(st[2].P) + mapP(st[3].P)) / 2} fill={K.inkMed} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="end">Exp. Valve</text>
        <rect x={(mapH(cycle.h4) + mapH(cycle.h1)) / 2 - sz(26)} y={mapP(st[0].P) + sz(5)} width={sz(52)} height={sz(11)} rx={2} fill={K.card} />
        <text x={(mapH(cycle.h4) + mapH(cycle.h1)) / 2} y={mapP(st[0].P) + sz(13)} fill={K.heatIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "grab" }}>Evaporator</text>
        <line x1={dpx} y1={dpy} x2={dpx} y2={PH_PLOT.y + PH_PLOT.h} stroke={lockH ? K.accent : K.inkLight} strokeWidth={lockH ? 1.2 : 0.5} strokeDasharray={lockH ? "none" : "2 2"} />
        <line x1={dpx} y1={dpy} x2={PH_PLOT.x} y2={dpy} stroke={lockP ? K.accent : K.inkLight} strokeWidth={lockP ? 1.2 : 0.5} strokeDasharray={lockP ? "none" : "2 2"} />
      </>}
      {/* State points */}
      {st.map((s, i) => {
        const cx = mapH(s.h), cy = mapP(s.P);
        const off = [{ dx: sz(8), dy: sz(14) }, { dx: sz(8), dy: -sz(10) }, { dx: -sz(14), dy: -sz(10) }, { dx: -sz(14), dy: sz(14) }];
        const tx = cx + off[i].dx, ty = cy + off[i].dy;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={5} fill={K.card} stroke={K.stateCircle} strokeWidth={1.2} />
            <circle cx={cx} cy={cy} r={1.8} fill={K.stateFill} />
            <rect x={tx - sz(7)} y={ty - sz(10)} width={sz(14)} height={sz(13)} rx={1} fill={K.card} />
            <text x={tx} y={ty} fill={K.accent} fontSize={sz(12)} fontFamily={FD} textAnchor="middle">{s.label}</text>
          </g>
        );
      })}
      {!showAreas && <>
        <circle cx={dpx} cy={dpy} r={9} fill="rgba(192,57,43,0.15)" stroke={K.accent} strokeWidth={2} />
        <circle cx={dpx} cy={dpy} r={4} fill={K.accent} />
        {(() => {
          const label = `${fmtP(dragPoint.P || cycle.states[0].P, u)}, ${fmtH(dragPoint.h || cycle.h1, u, 1)}`;
          const w = sz(8) * 0.6 * label.length + sz(8);
          const flipLeft = dpx + sz(12) + w > PH_W - 2;
          const rectX = flipLeft ? dpx - sz(12) - w : dpx + sz(12);
          const textX = flipLeft ? rectX + sz(4) : dpx + sz(16);
          return <>
            <rect x={rectX} y={dpy - sz(22)} width={w} height={sz(18)} rx={2} fill={K.card} stroke={K.ink} strokeWidth={0.8} />
            <text x={textX} y={dpy - sz(10)} fill={K.ink} fontSize={sz(8)} fontFamily={FM}>{label}</text>
          </>;
        })()}
        <text x={PH_W - 8} y={PH_PLOT.y + 10} fill={K.inkLight} fontSize={sz(7)} fontFamily={FM} textAnchor="end" fontStyle="italic">{lockP ? "P locked" : lockH ? "h locked" : "tap & drag"}</text>
      </>}
      {showAreas && (() => {
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        const lx = PH_PLOT.x + 6, ly = PH_PLOT.y + 4;
        const dot = (k) => activeArea === k ? 1 : 0.35;
        return (
          <>
            <rect x={lx} y={ly} width={sz(160)} height={sz(52)} rx={2} fill={K.card} stroke={K.border} strokeWidth={0.8} />
            <g onClick={() => setActiveArea("qEvap")} style={{ cursor: "pointer" }} opacity={dot("qEvap")}>
              <rect x={lx + sz(5)} y={ly + sz(5)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.heatIn}30`} stroke={K.heatIn} strokeWidth={activeArea === "qEvap" ? 1.4 : 0.6} />
              <text x={lx + sz(17)} y={ly + sz(12)} fill={K.heatIn} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "qEvap" ? 700 : 400}>Q_evap (4→1) = {fmt(cycle.qEvap)} kJ/kg</text>
            </g>
            <g onClick={() => setActiveArea("qCond")} style={{ cursor: "pointer" }} opacity={dot("qCond")}>
              <rect x={lx + sz(5)} y={ly + sz(18)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.heatOut}30`} stroke={K.heatOut} strokeWidth={activeArea === "qCond" ? 1.4 : 0.6} />
              <text x={lx + sz(17)} y={ly + sz(25)} fill={K.heatOut} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "qCond" ? 700 : 400}>Q_cond (2→3) = {fmt(cycle.qCond)} kJ/kg</text>
            </g>
            <g onClick={() => setActiveArea("wComp")} style={{ cursor: "pointer" }} opacity={dot("wComp")}>
              <rect x={lx + sz(5)} y={ly + sz(31)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.workIn}40`} stroke={K.workIn} strokeWidth={activeArea === "wComp" ? 1.4 : 0.6} />
              <text x={lx + sz(17)} y={ly + sz(38)} fill={K.workIn} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "wComp" ? 700 : 400}>W_comp (1→2) = {fmt(cycle.wComp)} kJ/kg</text>
            </g>
            <text x={lx + sz(5)} y={ly + sz(49)} fill={K.ink} fontSize={sz(8)} fontFamily={FD} fontWeight="bold">COP = {cycle.copCool.toFixed(2)}</text>
          </>
        );
      })()}
    </svg>
  );
}

/* ───────── Component Detail Modal (Refrigeration) ───────── */
const REF_COMPONENT_INFO = {
  compressor: {
    title: "Compressor",
    color: () => K.workIn,
    process: "1 → 2",
    type: "Isentropic Compression",
    purpose: "The compressor raises the pressure of low-pressure saturated vapor from the evaporator to the high-pressure condenser level. This is the only work input to the cycle. The ideal process is isentropic (constant entropy), producing superheated vapor at the compressor exit.",
    keyPoints: [
      "Only work-input device in the cycle",
      "Ideal process is isentropic (s₁ = s₂)",
      "Compresses vapor, not liquid (centrifugal or reciprocating)",
      "Exit state is superheated vapor at P_high",
      "Higher pressure ratio → more work required → lower COP",
    ],
    equations: [
      { label: "First Law (steady-state, adiabatic)", eq: "w_comp = h₂ − h₁" },
      { label: "Isentropic condition", eq: "s₁ = s₂" },
      { label: "Power input", eq: "Ẇ_comp = ṁ · (h₂ − h₁)" },
    ],
    insight: "Unlike the Rankine cycle pump (which compresses liquid), the refrigeration compressor compresses vapor — requiring significantly more work. This is why COP is typically 2–6 rather than the higher efficiencies seen in power cycles.",
  },
  condenser: {
    title: "Condenser",
    color: () => K.heatOut,
    process: "2 → 3",
    type: "Constant-Pressure Heat Rejection",
    purpose: "The condenser removes heat from the high-pressure superheated vapor, first desuperheating it to saturated vapor, then condensing it to saturated liquid. Heat is rejected to the warm environment (outdoor air, cooling water, etc.).",
    keyPoints: [
      "Operates at constant high pressure (P_high)",
      "No work is done",
      "Fluid enters as superheated vapor, exits as saturated liquid",
      "Heat rejected = Q_evap + W_comp (energy balance)",
      "Lower condenser temperature improves COP",
    ],
    equations: [
      { label: "First Law (open system, steady state)", eq: "q_cond = h₂ − h₃" },
      { label: "Energy balance verification", eq: "q_cond = q_evap + w_comp" },
      { label: "Heat rejected", eq: "Q_cond = ṁ · (h₂ − h₃)" },
    ],
    insight: "In heat pump mode, the condenser heat rejection IS the useful output. COP_heating = Q_cond / W_comp = COP_cooling + 1, which is always greater than 1.",
  },
  expvalve: {
    title: "Expansion Valve",
    color: () => K.inkMed,
    process: "3 → 4",
    type: "Isenthalpic Throttling",
    purpose: "The expansion valve (or throttling device) reduces the refrigerant pressure from condenser to evaporator level. This is an irreversible process with no work or heat transfer — enthalpy remains constant (h₃ = h₄). The result is a cold, low-pressure two-phase mixture.",
    keyPoints: [
      "Isenthalpic process: h₃ = h₄",
      "NOT isentropic — entropy increases (irreversible)",
      "No work done, no heat transfer",
      "Produces a two-phase (liquid + vapor) mixture",
      "Quality x₄ determined from enthalpy, not entropy",
    ],
    equations: [
      { label: "Throttling condition", eq: "h₃ = h₄ (isenthalpic)" },
      { label: "Quality after throttling", eq: "x₄ = (h₄ − h_f) / (h_g − h_f) at P_low" },
      { label: "Entropy change", eq: "s₄ > s₃ (irreversible process)" },
    ],
    insight: "The throttling process is the key difference from power cycles. Because it's irreversible, it's a source of thermodynamic loss. Replacing it with an isentropic expander could recover work, but the complexity isn't worth it for most applications.",
  },
  evaporator: {
    title: "Evaporator",
    color: () => K.heatIn,
    process: "4 → 1",
    type: "Constant-Pressure Heat Absorption",
    purpose: "The evaporator absorbs heat from the cold space (refrigerator interior, building interior, etc.) at constant low pressure. The two-phase mixture from the expansion valve evaporates completely to saturated vapor. This heat absorption IS the useful cooling effect.",
    keyPoints: [
      "Operates at constant low pressure (P_low)",
      "No work is done",
      "Fluid enters as two-phase mixture, exits as saturated vapor",
      "Q_evap is the useful refrigeration effect",
      "Higher evaporator temperature → higher COP",
    ],
    equations: [
      { label: "First Law (open system, steady state)", eq: "q_evap = h₁ − h₄" },
      { label: "Cooling capacity", eq: "Q_evap = ṁ · (h₁ − h₄)" },
      { label: "COP (cooling)", eq: "COP = q_evap / w_comp" },
    ],
    insight: "The evaporator temperature must be below the cold space temperature to drive heat transfer. Each 1°C increase in evaporator temperature can improve COP by 2–4%, which is why proper sizing and airflow are critical.",
  },
};

function RefComponentModal({ component, cycle, onClose, units }) {
  const isWide = useIsDesktop();
  if (!component) return null;
  const info = REF_COMPONENT_INFO[component];
  const color = info.color();
  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const cH = (v) => f(cvtH(v, u));
  const lH = lblH(u);

  const liveValues = {
    compressor: { main: `W_comp = ${cH(cycle.wComp)} ${lH}`, detail: `h₂ − h₁ = ${cH(cycle.h2)} − ${cH(cycle.h1)}` },
    condenser: { main: `Q_cond = ${cH(cycle.qCond)} ${lH}`, detail: `h₂ − h₃ = ${cH(cycle.h2)} − ${cH(cycle.h3)}` },
    expvalve: { main: `h₃ = h₄ = ${cH(cycle.h3)} ${lH}`, detail: `x₄ = ${cycle.x4.toFixed(4)} (${(cycle.x4 * 100).toFixed(1)}% vapor)` },
    evaporator: { main: `Q_evap = ${cH(cycle.qEvap)} ${lH}`, detail: `h₁ − h₄ = ${cH(cycle.h1)} − ${cH(cycle.h4)}` },
  };
  const live = liveValues[component];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: K.card, border: `1.5px solid ${K.border}`, maxWidth: isWide ? 780 : 420, width: "100%", padding: isWide ? "36px 40px" : "20px 16px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginTop: isWide ? 60 : 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isWide ? 22 : 14, borderBottom: `2px solid ${color}`, paddingBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: isWide ? 28 : 16, fontFamily: FD, color }}>{info.title}</h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: isWide ? 14 : 11, cursor: "pointer", padding: isWide ? "6px 20px" : "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: isWide ? 20 : 12, flexWrap: "wrap" }}>
          <span style={{ background: color, color: "#fff", padding: isWide ? "5px 14px" : "3px 10px", fontSize: isWide ? 14 : 9, fontFamily: FM, fontWeight: 700 }}>Process {info.process}</span>
          <span style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: isWide ? "5px 14px" : "3px 10px", fontSize: isWide ? 14 : 9, fontFamily: FM, color: K.inkMed }}>{info.type}</span>
        </div>
        <div style={{ background: K.cardAlt, border: `2px solid ${color}`, padding: isWide ? "18px 24px" : "10px 12px", marginBottom: isWide ? 20 : 12, textAlign: "center" }}>
          <div style={{ fontSize: isWide ? 26 : 16, fontFamily: FD, color, marginBottom: 6 }}>{live.main}</div>
          <div style={{ fontSize: isWide ? 14 : 9, fontFamily: FM, color: K.inkMed }}>{live.detail}</div>
        </div>
        <p style={{ fontSize: isWide ? 16 : 10.5, lineHeight: 1.9, color: K.inkMed, marginBottom: isWide ? 20 : 12 }}>{info.purpose}</p>
        <div style={isWide ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 } : { marginBottom: 12 }}>
          <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14, marginBottom: isWide ? 0 : 12 }}>
            <div style={{ fontFamily: FD, fontSize: isWide ? 18 : 12, marginBottom: 10, color: K.ink }}>Key Points</div>
            {info.keyPoints.map((pt, i) => (
              <div key={i} style={{ fontSize: isWide ? 14 : 10, color: K.inkMed, marginBottom: 6, lineHeight: 1.6 }}>{"▸ " + pt}</div>
            ))}
          </div>
          <div style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: isWide ? "18px 20px" : "10px 12px" }}>
            <div style={{ fontFamily: FD, fontSize: isWide ? 18 : 12, marginBottom: 10, color: K.ink }}>Equations</div>
            {info.equations.map((eq, i) => (
              <div key={i} style={{ marginBottom: 10, fontSize: isWide ? 14 : 10, lineHeight: 1.7 }}>
                <div style={{ color: K.inkLight, fontSize: isWide ? 12 : 8 }}>{eq.label}</div>
                <div style={{ color, fontWeight: 600, fontSize: isWide ? 15 : 10 }}>{eq.eq}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: K.bg === "#0d1117" ? "#1c1f12" : "#fffef5", border: `1px solid ${K.bg === "#0d1117" ? "#3d3a20" : "#e8e0c0"}`, padding: isWide ? "16px 20px" : "10px 12px", marginBottom: isWide ? 20 : 12 }}>
          <div style={{ fontFamily: FD, fontSize: isWide ? 16 : 10, color: K.ink, marginBottom: 6 }}>Engineering Insight</div>
          <div style={{ fontSize: isWide ? 14 : 10, color: K.inkMed, lineHeight: 1.7 }}>{info.insight}</div>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: isWide ? "14px" : "10px", background: color, border: "none", color: "#fff", fontWeight: 500, fontSize: isWide ? 16 : 12, fontFamily: FD, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Schematic ───────── */
function RefSchematicDiagram({ cycle, textScale, units, animating, animProgress }) {
  const sz = px => px * (1 + ((textScale || 1) - 1) * 0.4);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const fmt = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const [activeComponent, setActiveComponent] = useState(null);

  // Sprite path follows the pipes through compressor, condenser, valve, evaporator
  const SEGMENTS = [
    [{x:68,y:273}, {x:68,y:207}, {x:68,y:137}, {x:68,y:82}],
    [{x:68,y:82}, {x:110,y:57}, {x:250,y:57}, {x:273,y:57}],
    [{x:273,y:57}, {x:273,y:152}, {x:273,y:192}, {x:273,y:273}],
    [{x:273,y:273}, {x:250,y:273}, {x:110,y:273}, {x:68,y:273}],
  ];
  const pointAlong = (waypoints, frac) => {
    const lens = [];
    let total = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i], b = waypoints[i+1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      lens.push(len); total += len;
    }
    if (total === 0) return waypoints[0];
    let target = frac * total;
    for (let i = 0; i < lens.length; i++) {
      if (target <= lens[i] || i === lens.length - 1) {
        const a = waypoints[i], b = waypoints[i+1];
        const f = lens[i] === 0 ? 0 : Math.min(1, target / lens[i]);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
      target -= lens[i];
    }
    return waypoints[waypoints.length - 1];
  };
  let spriteX = 68, spriteY = 273;
  if (animating != null) {
    const p = ((animProgress || 0) % 1 + 1) % 1;
    const segIdx = Math.min(3, Math.floor(p * 4));
    const frac = (p * 4) - segIdx;
    const pt = pointAlong(SEGMENTS[segIdx], frac);
    spriteX = pt.x; spriteY = pt.y;
  }
  const mk = [
    { id: "rO", c: K.heatIn }, { id: "rB", c: K.heatOut }, { id: "rY", c: K.workIn },
    { id: "rM", c: K.inkMed }, { id: "rK", c: K.ink },
  ];
  return (<>
    <svg viewBox="-28 0 360 320" style={{ width: "100%", display: "block", margin: "0 auto" }}>
      <defs>
        {mk.map(m => (
          <marker key={m.id} id={m.id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={7} markerHeight={7} orient="auto">
            <path d="M0,1 L9,5 L0,9" fill="none" stroke={m.c} strokeWidth={1.5} />
          </marker>
        ))}
      </defs>
      {Array.from({ length: 18 }, (_, i) => Array.from({ length: 16 }, (_, j) => (
        <circle key={`${i}-${j}`} cx={i * 20 + 10} cy={j * 20 + 10} r={0.6} fill={K.gridMajor} />
      )))}
      {/* COMPRESSOR */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("compressor")}>
        <circle cx={68} cy={172} r={35} fill="rgba(255,255,255,0.01)" stroke={K.workIn} strokeWidth={1.5} />
        <path d="M39,189 L68,139 L97,189 Z" fill="none" stroke={K.workIn} strokeWidth={0.8} />
        <rect x={68 - sz(32)} y={176 - sz(11)} width={sz(64)} height={sz(14)} fill={K.card} />
        <text x={68} y={176} fill={K.workIn} fontSize={sz(10)} textAnchor="middle" fontFamily={FD}>Compressor</text>
      </g>
      {/* CONDENSER */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("condenser")}>
        <rect x={110} y={32} width={140} height={60} fill="rgba(255,255,255,0.01)" stroke={K.heatOut} strokeWidth={1.5} />
        <path d="M125,63 Q135,53 145,63 Q155,73 165,63 Q175,53 185,63 Q195,73 205,63 Q215,53 225,63 Q235,73 240,66" fill="none" stroke={K.heatOut} strokeWidth={0.7} />
        <text x={180} y={53} fill={K.heatOut} fontSize={sz(11)} textAnchor="middle" fontFamily={FD}>Condenser</text>
        <rect x={180 - sz(32)} y={82 - sz(8)} width={sz(64)} height={sz(12)} fill={K.card} />
        <text x={180} y={82} fill={K.inkLight} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic">const. pressure</text>
      </g>
      {/* EXPANSION VALVE */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("expvalve")}>
        <path d="M273,148 L297,172 L273,196 L249,172 Z" fill="rgba(255,255,255,0.01)" stroke={K.inkMed} strokeWidth={1.5} strokeDasharray="4 2" />
        <text x={273} y={170} fill={K.inkMed} fontSize={sz(8)} textAnchor="middle" fontFamily={FD}>Exp.</text>
        <text x={273} y={181} fill={K.inkMed} fontSize={sz(8)} textAnchor="middle" fontFamily={FD}>Valve</text>
      </g>
      {/* EVAPORATOR */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("evaporator")}>
        <rect x={110} y={248} width={140} height={50} fill="rgba(255,255,255,0.01)" stroke={K.heatIn} strokeWidth={1.5} />
        {[130,150,170,190,210,230].map(x => (
          <g key={x}><line x1={x} y1={258} x2={x} y2={288} stroke={K.heatIn} strokeWidth={0.4} /><path d={`M${x-3},258 L${x},254 L${x+3},258`} fill="none" stroke={K.heatIn} strokeWidth={0.4} /></g>
        ))}
        <rect x={180 - sz(32)} y={272 - sz(12)} width={sz(64)} height={sz(16)} fill={K.card} />
        <text x={180} y={272} fill={K.heatIn} fontSize={sz(11)} textAnchor="middle" fontFamily={FD}>Evaporator</text>
        <rect x={180 - sz(32)} y={286 - sz(8)} width={sz(64)} height={sz(12)} fill={K.card} />
        <text x={180} y={286} fill={K.inkLight} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic">const. pressure</text>
      </g>
      {/* Pipes */}
      <polyline points="68,137 68,82 110,57" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#rK)" />
      <polyline points="250,57 273,57 273,152" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#rK)" />
      <polyline points="273,192 273,273 250,273" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#rK)" />
      <polyline points="110,273 68,273 68,207" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#rK)" />
      {/* Labels rendered after pipes so white boxes cover arrows */}
      <rect x={68 - sz(28)} y={225 - sz(8)} width={sz(56)} height={sz(12)} fill={K.card} />
      <text x={68} y={225} fill={K.inkLight} fontSize={sz(6)} textAnchor="middle" fontFamily={FM} fontStyle="italic">isentropic</text>
      <rect x={273 - sz(28)} y={204 - sz(8)} width={sz(56)} height={sz(12)} fill={K.card} />
      <text x={273} y={204} fill={K.inkLight} fontSize={sz(6)} textAnchor="middle" fontFamily={FM} fontStyle="italic">isenthalpic</text>
      {/* State markers */}
      {[{ n:"2",x:68,y:82 },{ n:"3",x:273,y:57 },{ n:"4",x:273,y:273 },{ n:"1",x:68,y:273 }].map((p,i) => (
        <g key={i}><circle cx={p.x} cy={p.y} r={11} fill={K.card} stroke={K.stateCircle} strokeWidth={1.2} /><text x={p.x} y={p.y+4} fill={K.accent} fontSize={sz(12)} textAnchor="middle" fontFamily={FD}>{p.n}</text></g>
      ))}
      {/* Energy labels */}
      <line x1={180} y1={10} x2={180} y2={30} stroke={K.heatOut} strokeWidth={1.8} markerEnd="url(#rB)" />
      <text x={180} y={8} fill={K.heatOut} fontSize={sz(8)} textAnchor="middle" fontFamily={FM}>Q_cond = {fmt(cvtH(cycle.qCond, u))} {lblH(u)}</text>
      <line x1={180} y1={298} x2={180} y2={312} stroke={K.heatIn} strokeWidth={1.8} />
      <path d="M176,302 L180,298 L184,302" fill="none" stroke={K.heatIn} strokeWidth={1.5} />
      <rect x={180 - sz(70)} y={318 - sz(8)} width={sz(140)} height={sz(14)} fill={K.card} />
      <text x={180} y={318} fill={K.heatIn} fontSize={sz(8)} textAnchor="middle" fontFamily={FM}>Q_evap = {fmt(cvtH(cycle.qEvap, u))} {lblH(u)}</text>
      <line x1={8} y1={172} x2={33} y2={172} stroke={K.workIn} strokeWidth={1.8} />
      <path d="M29,168 L33,172 L29,176" fill="none" stroke={K.workIn} strokeWidth={1.5} />
      <text x={14} y={160} fill={K.workIn} fontSize={sz(8)} textAnchor="middle" fontFamily={FM} fontWeight="500">W_comp</text>
      <text x={14} y={188} fill={K.workIn} fontSize={sz(8)} textAnchor="middle" fontFamily={FM}>{fmt(cvtH(cycle.wComp, u))}</text>
      <text x={14} y={198} fill={K.workIn} fontSize={sz(6.5)} textAnchor="middle" fontFamily={FM}>{lblH(u)}</text>
      {animating && <>
        <circle cx={spriteX} cy={spriteY} r={7} fill={K.accent} opacity={0.9} />
        <circle cx={spriteX} cy={spriteY} r={12} fill="none" stroke={K.accent} strokeWidth={1.5} opacity={0.5}>
          <animate attributeName="r" values="7;14;7" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.2s" repeatCount="indefinite" />
        </circle>
      </>}
    </svg>
    <RefComponentModal component={activeComponent} cycle={cycle} onClose={() => setActiveComponent(null)} units={u} />
  </>);
}

/* ───────── Info Modal (Refrigeration Theory) ───────── */
function RefInfoModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: K.card, border: `1.5px solid ${K.border}`, maxWidth: 420, width: "100%", padding: "24px 18px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontFamily: FD, color: K.ink }}>Vapor-Compression Refrigeration</h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: 11, cursor: "pointer", padding: "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <p style={{ fontSize: 11, lineHeight: 1.9, color: K.inkMed, marginBottom: 16 }}>
          The vapor-compression refrigeration cycle is the most widely used cycle for refrigerators, air conditioners, and heat pumps.
          It uses a working fluid (refrigerant) that absorbs heat at low temperature and rejects it at high temperature, driven by compressor work input.
        </p>
        <div style={{ borderLeft: `3px solid ${K.heatOut}`, paddingLeft: 12, marginBottom: 16 }}>
          <div style={{ fontFamily: FD, fontSize: 13, marginBottom: 10, color: K.ink }}>Four Processes</div>
          {[
            { r: "1 → 2", l: "Compressor — Isentropic Compression", c: K.workIn, d: "Saturated vapor from the evaporator is compressed to high pressure superheated vapor. This is the only work input to the cycle." },
            { r: "2 → 3", l: "Condenser — Const-P Heat Rejection", c: K.heatOut, d: "Superheated vapor is desuperheated, then condensed to saturated liquid, rejecting heat to the warm environment." },
            { r: "3 → 4", l: "Expansion Valve — Isenthalpic Throttling", c: K.inkMed, d: "Saturated liquid is throttled through an expansion valve. Pressure drops with no work or heat transfer (h₃ = h₄). Produces a two-phase mixture." },
            { r: "4 → 1", l: "Evaporator — Const-P Heat Absorption", c: K.heatIn, d: "Two-phase mixture absorbs heat from the cold space, evaporating to saturated vapor. This is the useful cooling effect." },
          ].map((p, i) => (
            <div key={i} style={{ marginBottom: 8, fontSize: 10.5, lineHeight: 1.7 }}>
              <span style={{ color: p.c, fontWeight: 700 }}>{p.r}</span>{" "}<span style={{ color: p.c, fontWeight: 500 }}>{p.l}</span><br />
              <span style={{ color: K.inkLight }}>{p.d}</span>
            </div>
          ))}
        </div>
        <div style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: "14px", marginBottom: 14, fontSize: 10.5, lineHeight: 2.3 }}>
          <div style={{ fontFamily: FD, fontSize: 13, marginBottom: 6, color: K.ink }}>Key Equations</div>
          <div style={{ color: K.workIn }}>{"W_comp = h₂ − h₁ (compressor work input)"}</div>
          <div style={{ color: K.heatIn }}>{"Q_evap = h₁ − h₄ (cooling effect)"}</div>
          <div style={{ color: K.heatOut }}>{"Q_cond = h₂ − h₃ (heat rejected)"}</div>
          <div>{"COP_cooling = Q_evap / W_comp"}</div>
          <div>{"COP_heating = Q_cond / W_comp = COP_cool + 1"}</div>
          <div style={{ borderTop: `1px solid ${K.border}`, marginTop: 6, paddingTop: 6, color: K.inkLight }}>Energy balance:</div>
          <div>{"Q_evap + W_comp = Q_cond"}</div>
          <div style={{ color: K.inkLight, marginTop: 4 }}>{"Quality after throttling (from enthalpy, NOT entropy):"}</div>
          <div>{"x₄ = (h₄ − h_f) / (h_g − h_f) at P_low"}</div>
        </div>
        <div style={{ borderLeft: `3px solid ${K.heatOut}`, paddingLeft: 12, marginBottom: 16 }}>
          <div style={{ fontFamily: FD, fontSize: 13, marginBottom: 6, color: K.ink }}>Improving COP</div>
          {[
            "Lower condenser temperature/pressure — reduces compressor work",
            "Raise evaporator temperature/pressure — less compression needed",
            "Subcooling at condenser exit — increases cooling capacity",
            "Superheating at compressor inlet — ensures no liquid enters compressor",
            "Multi-stage compression with intercooling — for large pressure ratios",
          ].map((t,i) => (
            <div key={i} style={{ fontSize: 10.5, color: K.inkMed, marginBottom: 3 }}>{"▸ " + t}</div>
          ))}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: "10px", background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: FD, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Equations Modal (Refrigeration) ───────── */
const REF_EQ_TOPICS = [
  { id: "wc", label: "W_comp", title: "Compressor Work", color: K.workIn },
  { id: "qe", label: "Q_evap", title: "Evaporator Heat (Cooling Effect)", color: K.heatIn },
  { id: "qc", label: "Q_cond", title: "Condenser Heat Rejection", color: K.heatOut },
  { id: "copc", label: "COP_cool", title: "Cooling COP", color: K.accent },
  { id: "coph", label: "COP_heat", title: "Heating COP (Heat Pump)", color: K.heatOut },
  { id: "x4", label: "x₄", title: "Quality After Throttling", color: K.inkMed },
  { id: "states", label: "States", title: "State Point Properties", color: K.ink },
];

function RefEquationsModal({ open, onClose, cycle, initialTopic, units }) {
  const [topic, setTopic] = useState("wc");
  useEffect(() => { if (initialTopic && open) setTopic(initialTopic); }, [initialTopic, open]);
  const isWide = useIsDesktop();
  if (!open) return null;

  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const cT = (v) => f(cvtT(v, u));
  const cP = (v) => f(cvtP(v, u));
  const cH = (v) => f(cvtH(v, u));
  const cS = (v) => { const x = cvtS(v, u); return Math.abs(x) < 10 ? x.toFixed(3) : x.toFixed(2); };
  const lT = lblT(u), lP = lblP(u), lH = lblH(u), lS = lblS(u);
  const sel = REF_EQ_TOPICS.find(t => t.id === topic);
  const stepStyle = { background: K.cardAlt, border: `1px solid ${K.border}`, padding: isWide ? "18px 22px" : "10px 12px", marginBottom: isWide ? 12 : 8, fontSize: isWide ? 16 : 10.5, lineHeight: 2, fontFamily: FM };
  const numStyle = { color: K.accent, fontWeight: 700 };
  const resultStyle = { background: K.card, border: `2px solid ${sel.color}`, padding: isWide ? "18px 22px" : "10px 12px", textAlign: "center", marginTop: isWide ? 10 : 4 };
  const labelStyle = { color: K.inkLight, fontSize: isWide ? 12 : 9, marginBottom: isWide ? 6 : 4 };
  const noteStyle = { color: K.inkLight, fontSize: isWide ? 13 : 9, marginTop: isWide ? 6 : 4 };
  const resultLabelStyle = { fontSize: isWide ? 12 : 9, color: K.inkLight, marginBottom: isWide ? 4 : 2 };
  const resultValueStyle = { fontSize: isWide ? 24 : 16, fontFamily: FD, color: sel.color };

  function renderContent() {
    switch (topic) {
      case "wc": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>W_comp = h₂ − h₁</div>
          <div style={noteStyle}>Isentropic compression from saturated vapor (state 1) to superheated vapor (state 2). This is the sole work input.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 1 — h₁ at evaporator exit (sat. vapor at P_low)</div>
          <div>h₁ = h_g at P_low = <span style={numStyle}>{cP(cycle.states[0].P)}</span> {lP}</div>
          <div>h₁ = <span style={numStyle}>{cH(cycle.h1)}</span> {lH}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 2 — h₂ after isentropic compression to P_high</div>
          <div>s₂ = s₁ = <span style={numStyle}>{cS(cycle.s1)}</span> {lS} (isentropic)</div>
          <div>h₂ = <span style={numStyle}>{cH(cycle.h2)}</span> {lH}, T₂ = <span style={numStyle}>{cT(cycle.T2)}</span> {lT}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>W_comp = {cH(cycle.h2)} − {cH(cycle.h1)} = <strong>{cH(cycle.wComp)}</strong> {lH}</div>
        </div>
      </>);
      case "qe": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>Q_evap = h₁ − h₄</div>
          <div style={noteStyle}>Heat absorbed in the evaporator at constant pressure. This is the useful cooling effect — the "purpose" of refrigeration.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>VALUES</div>
          <div>h₁ = <span style={numStyle}>{cH(cycle.h1)}</span> {lH} (sat. vapor at evap. exit)</div>
          <div>h₄ = <span style={numStyle}>{cH(cycle.h4)}</span> {lH} (two-phase at valve exit)</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>Q_evap = {cH(cycle.h1)} − {cH(cycle.h4)} = <strong>{cH(cycle.qEvap)}</strong> {lH}</div>
        </div>
      </>);
      case "qc": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>Q_cond = h₂ − h₃</div>
          <div style={noteStyle}>Heat rejected in the condenser. Includes desuperheating and condensation at constant pressure.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>VALUES</div>
          <div>h₂ = <span style={numStyle}>{cH(cycle.h2)}</span> {lH} (superheated at comp. exit)</div>
          <div>h₃ = <span style={numStyle}>{cH(cycle.h3)}</span> {lH} (sat. liquid at cond. exit)</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>VERIFY — Energy balance</div>
          <div>Q_cond = Q_evap + W_comp = {cH(cycle.qEvap)} + {cH(cycle.wComp)} = <span style={numStyle}>{cH(cycle.qEvap + cycle.wComp)}</span></div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>Q_cond = {cH(cycle.h2)} − {cH(cycle.h3)} = <strong>{cH(cycle.qCond)}</strong> {lH}</div>
        </div>
      </>);
      case "copc": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>COP_cooling = Q_evap / W_comp</div>
          <div style={noteStyle}>The COP can exceed 1 because we are moving heat, not creating it. A COP of 3 means 3 units of cooling per unit of work.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>CALCULATION</div>
          <div>COP_cool = {cH(cycle.qEvap)} / {cH(cycle.wComp)}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>COP_cooling = <strong>{cycle.copCool.toFixed(2)}</strong></div>
        </div>
      </>);
      case "coph": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>COP_heating = Q_cond / W_comp</div>
          <div style={noteStyle}>In heat pump mode, the useful output is Q_cond (heat delivered to the warm space). Always equals COP_cooling + 1.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>CALCULATION</div>
          <div>COP_heat = {cH(cycle.qCond)} / {cH(cycle.wComp)}</div>
          <div style={{ color: K.inkLight, marginTop: 4 }}>Or: COP_heat = COP_cool + 1 = {cycle.copCool.toFixed(2)} + 1 = <span style={numStyle}>{(cycle.copCool + 1).toFixed(2)}</span></div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>COP_heating = <strong>{cycle.copHeat.toFixed(2)}</strong></div>
        </div>
      </>);
      case "x4": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>x₄ = (h₄ − h_f) / (h_g − h_f) at P_low</div>
          <div style={noteStyle}>Unlike the Rankine cycle (where x₄ uses entropy), refrigeration quality is found from enthalpy because the expansion is isenthalpic (h₃ = h₄), NOT isentropic.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 1 — h₄ from isenthalpic expansion</div>
          <div>h₄ = h₃ = h_f at P_high = <span style={numStyle}>{cH(cycle.h3)}</span> {lH}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 2 — Sat. properties at P_low = {cP(cycle.states[0].P)} {lP}</div>
          <div>h_f = <span style={numStyle}>{cycle.x4 < 1 ? cH((cycle.h4 - cycle.x4 * cycle.h1) / (1 - cycle.x4)) : "—"}</span> {lH}</div>
          <div>h_g = <span style={numStyle}>{cH(cycle.h1)}</span> {lH}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>x₄ = <strong>{cycle.x4.toFixed(4)}</strong> ({(cycle.x4 * 100).toFixed(1)}% vapor)</div>
        </div>
      </>);
      case "states": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 1 — Saturated Vapor at P_low (Evaporator Exit)</div>
          <div>P₁ = <span style={numStyle}>{cP(cycle.states[0].P)}</span> {lP} → sat. vapor properties</div>
          <div>T₁ = <span style={numStyle}>{cT(cycle.T1)}</span> {lT}, h₁ = h_g = <span style={numStyle}>{cH(cycle.h1)}</span>, s₁ = s_g = <span style={numStyle}>{cS(cycle.s1)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 2 — Superheated Vapor at P_high (Compressor Exit)</div>
          <div>Isentropic: s₂ = s₁ = <span style={numStyle}>{cS(cycle.s2)}</span> {lS}</div>
          <div>T₂ = <span style={numStyle}>{cT(cycle.T2)}</span> {lT}, h₂ = <span style={numStyle}>{cH(cycle.h2)}</span> {lH}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 3 — Saturated Liquid at P_high (Condenser Exit)</div>
          <div>P₃ = <span style={numStyle}>{cP(cycle.states[2].P)}</span> kPa → sat. liquid properties</div>
          <div>T₃ = <span style={numStyle}>{cT(cycle.T3)}</span> {lT}, h₃ = h_f = <span style={numStyle}>{cH(cycle.h3)}</span>, s₃ = s_f = <span style={numStyle}>{cS(cycle.s3)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 4 — Two-Phase Mixture at P_low (Valve Exit)</div>
          <div>Isenthalpic: h₄ = h₃ = <span style={numStyle}>{cH(cycle.h4)}</span> {lH}</div>
          <div>x₄ = <span style={numStyle}>{cycle.x4.toFixed(4)}</span>, T₄ = <span style={numStyle}>{cT(cycle.T4)}</span> {lT}, s₄ = <span style={numStyle}>{cS(cycle.s4)}</span></div>
        </div>
      </>);
      default: return null;
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: K.card, border: `1.5px solid ${K.border}`, maxWidth: isWide ? 820 : 420, width: "100%", padding: isWide ? "36px 40px" : "20px 16px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginTop: isWide ? 60 : 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isWide ? 22 : 14, borderBottom: `2px solid ${K.ink}`, paddingBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: isWide ? 28 : 16, fontFamily: FD, color: K.ink }}>Solve: <span style={{ color: sel.color }}>{sel.title}</span></h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: isWide ? 14 : 11, cursor: "pointer", padding: isWide ? "6px 20px" : "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: isWide ? 8 : 5, marginBottom: isWide ? 22 : 14 }}>
          {REF_EQ_TOPICS.map(t => (
            <button key={t.id} onClick={() => setTopic(t.id)} style={{
              padding: isWide ? "8px 18px" : "4px 10px", fontSize: isWide ? 14 : 9, fontFamily: FM,
              background: topic === t.id ? t.color : K.cardAlt,
              color: topic === t.id ? "#fff" : K.inkMed,
              border: `1px solid ${topic === t.id ? t.color : K.border}`,
              cursor: "pointer", borderRadius: 3, fontWeight: topic === t.id ? 700 : 400,
              transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>
        {renderContent()}
        <button onClick={onClose} style={{ width: "100%", padding: isWide ? "14px" : "10px", background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: isWide ? 16 : 12, fontFamily: FD, cursor: "pointer", marginTop: 14 }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Refrigerant Info Modal ───────── */
function RefrigerantInfoModal({ open, onClose, currentRef }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: K.card, border: `1.5px solid ${K.border}`, maxWidth: 520, width: "100%", padding: "24px 18px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontFamily: FD, color: K.ink }}>Refrigerant Reference</h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: 11, cursor: "pointer", padding: "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {REFRIGERANTS.map(r => {
            const isCurrent = r.id === currentRef.id;
            return (
              <div key={r.id} style={{
                padding: "12px", border: `1.5px solid ${isCurrent ? K.accent : K.border}`,
                background: isCurrent ? `${K.accent}08` : K.cardAlt,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontFamily: FD, fontSize: 14, color: isCurrent ? K.accent : K.ink }}>{r.name}</span>
                  <span style={{ fontSize: 8, color: K.inkLight, fontFamily: FM }}>{r.type}</span>
                </div>
                <div style={{ fontSize: 9, color: K.inkMed, marginBottom: 4 }}>{r.formula}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, fontSize: 9, marginBottom: 6 }}>
                  <div><span style={{ color: K.inkLight }}>GWP:</span> <span style={{ color: r.gwp > 1000 ? K.accent : r.gwp < 10 ? K.workOut : K.ink, fontWeight: 600 }}>{r.gwp}</span></div>
                  <div><span style={{ color: K.inkLight }}>ODP:</span> <span style={{ fontWeight: 600 }}>{r.odp}</span></div>
                  <div><span style={{ color: K.inkLight }}>T_crit:</span> {r.criticalT}°C</div>
                  <div><span style={{ color: K.inkLight }}>P_crit:</span> {r.criticalP} kPa</div>
                </div>
                <div style={{ fontSize: 9, color: K.inkMed, lineHeight: 1.6, marginBottom: 4 }}>{r.applications}</div>
                <div style={{ fontSize: 8, color: K.inkLight, fontStyle: "italic", lineHeight: 1.5 }}>{r.notes}</div>
                <div style={{ fontSize: 8, marginTop: 4, padding: "2px 6px", display: "inline-block",
                  background: r.status.includes("Emerging") ? "#27ae6018" : r.status.includes("phase") ? `${K.accent}15` : "#2471a318",
                  color: r.status.includes("Emerging") ? "#1e8449" : r.status.includes("phase") ? K.accent : K.heatOut,
                  border: `1px solid ${r.status.includes("Emerging") ? "#1e844930" : r.status.includes("phase") ? `${K.accent}30` : "#2471a330"}`,
                }}>{r.status}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, padding: "10px", background: K.cardAlt, border: `1px solid ${K.border}`, fontSize: 9, lineHeight: 1.8 }}>
          <div style={{ fontFamily: FD, fontSize: 11, marginBottom: 4, color: K.ink }}>Key Metrics</div>
          <div><strong>GWP</strong> (Global Warming Potential) — CO₂ = 1. Lower is better for climate impact.</div>
          <div><strong>ODP</strong> (Ozone Depletion Potential) — 0 = no ozone damage. All modern refrigerants have ODP = 0.</div>
          <div style={{ color: K.inkLight, marginTop: 4, fontStyle: "italic" }}>Trend: industry moving from high-GWP HFCs toward HFOs and natural refrigerants (CO₂, NH₃, propane).</div>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: "10px", marginTop: 12, background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: FD, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── State Table (Refrigeration) ───────── */
function RefStateTable({ cycle, refData, onSelectState, textScale, units }) {
  const isWide = useIsDesktop();
  const sc = textScale || 1;
  const sz = (px) => Math.round(px * sc);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const fmt = v => Math.abs(v) < 10 ? v.toFixed(3) : Math.abs(v) < 100 ? v.toFixed(2) : v.toFixed(1);
  const descs = ["Sat. Vapor", "Superheated", "Sat. Liquid", "Two-Phase"];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FM, fontSize: sz(isWide ? 16 : 10) }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${K.ink}` }}>
            {["State","Desc",`T (${lblT(u)})`,`P (${lblP(u)})`,`h (${lblH(u)})`,`s (${lblS(u)})`,"x"].map(h => (
              <th key={h} style={{ padding: isWide ? "8px 4px" : "6px 3px", color: K.inkMed, fontWeight: 400, textAlign: "center", fontSize: sz(isWide ? 14 : 9), fontStyle: "italic" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cycle.states.map((s, i) => (
            <tr key={i}
              onClick={() => onSelectState({ s: s.s, T: s.T, h: s.h, P: s.P })}
              style={{ borderBottom: `0.5px solid ${K.gridMajor}`, cursor: "pointer", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = K.cardAlt}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.accent, fontFamily: FD, fontSize: sz(isWide ? 20 : 13) }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  {s.label}
                  <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.4 }}><circle cx="4" cy="4" r="3" fill="none" stroke={K.accent} strokeWidth="1"/><circle cx="4" cy="4" r="1" fill={K.accent}/></svg>
                </span>
              </td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.inkLight, fontSize: sz(isWide ? 12 : 8) }}>{descs[i]}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.ink }}>{fmt(cvtT(s.T, u))}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.ink }}>{fmt(cvtP(s.P, u))}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.ink }}>{fmt(cvtH(s.h, u))}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.ink }}>{fmt(cvtS(s.s, u))}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.inkMed, fontSize: sz(isWide ? 14 : 9) }}>
                {i === 0 ? "1 (sat.v)" : i === 1 ? "— (sup.)" : i === 2 ? "0 (sat.l)" : cycle.x4.toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontSize: sz(isWide ? 13 : 8), color: K.inkLight, fontStyle: "italic", textAlign: "center" }}>
        Tap a row to visualize that state point
      </div>
    </div>
  );
}

/* ───────── Main Refrigeration Page ───────── */
export default function RefrigerationPage({ onBack }) {
  const [darkMode, setDarkMode] = useState(() => {
    try { return document.cookie.split('; ').find(c => c.startsWith('darkMode='))?.split('=')[1] === 'true'; } catch { return false; }
  });
  K = darkMode ? K_DARK : K_LIGHT;
  const toggleDarkMode = useCallback(() => {
    setDarkMode(d => {
      const next = !d;
      document.cookie = `darkMode=${next};path=/;max-age=31536000`;
      return next;
    });
  }, []);

  const [textScale, setTextScale] = useState(() => {
    try { const v = parseFloat(document.cookie.split('; ').find(c => c.startsWith('textScale='))?.split('=')[1]); return isNaN(v) ? 1 : Math.max(0.8, Math.min(1.6, v)); } catch { return 1; }
  });
  const handleScaleChange = useCallback((s) => { setTextScale(s); document.cookie = `textScale=${s};path=/;max-age=31536000`; }, []);
  const sz = (px) => Math.round(px * textScale);

  const initParams = (() => {
    try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
  })();
  const initNum = (key, def) => { const v = parseFloat(initParams.get(key)); return isNaN(v) ? def : v; };
  const initRefIdx = (() => {
    const v = parseInt(initParams.get("ref"), 10);
    return Number.isInteger(v) && v >= 0 && v < REFRIGERANTS.length ? v : 0;
  })();
  const [refIdx, setRefIdx] = useState(initRefIdx);
  const refData = REFRIGERANTS[refIdx];
  const defaults = useMemo(() => getDefaultPressures(refData), [refData]);

  const [pHigh, setPHigh] = useState(() => initNum("pHigh", getDefaultPressures(REFRIGERANTS[initRefIdx]).pHigh));
  const [pLow, setPLow] = useState(() => initNum("pLow", getDefaultPressures(REFRIGERANTS[initRefIdx]).pLow));
  const [shareCopied, setShareCopied] = useState(false);
  const [eqsCopied, setEqsCopied] = useState(false);
  const [units, setUnits] = useState(() => loadUnits());
  const [showSettings, setShowSettings] = useState(false);
  const handleUnitsChange = useCallback((up) => { setUnits(up); saveUnits(up); }, []);
  const [animating, setAnimating] = useState(true); // the page opens mid-cycle; any click, drag or slider move pauses it
  const stopAnim = (e) => { if (!(e.target.closest && e.target.closest("[data-anim-keep]"))) setAnimating(false); };
  const [animProgress, setAnimProgress] = useState(0);
  const [animSpeed, setAnimSpeed] = useState(() => loadAnimSpeed());
  const handleAnimSpeedChange = useCallback((v) => { setAnimSpeed(v); saveAnimSpeed(v); }, []);
  const [showInfo, setShowInfo] = useState(false);
  const [showEqs, setShowEqs] = useState(false);
  const [eqTopic, setEqTopic] = useState(null);
  const [showRefInfo, setShowRefInfo] = useState(false);
  const [showTour, setShowTour] = useState(() => {
    try { return !localStorage.getItem("tourSeen"); } catch { return false; }
  });
  const [forcedTour, setForcedTour] = useState(() => {
    try { return !localStorage.getItem("tourSeen"); } catch { return false; }
  });
  const [showWelcome] = useState(false);
  const [showTsAreas, setShowTsAreas] = useState(false);
  const [showPhAreas, setShowPhAreas] = useState(false);
  const [lineDragInfo, setLineDragInfo] = useState(null);

  const table = refData.table;
  const pMin = Math.round(table[0].P);
  const pMax = Math.round(table[table.length - 2].P);

  // Clamp pressures on refrigerant change (but skip first render when URL provides values)
  const skipFirstClamp = useRef(initParams.has("pHigh") || initParams.has("pLow"));
  useEffect(() => {
    if (skipFirstClamp.current) { skipFirstClamp.current = false; return; }
    const d = getDefaultPressures(refData);
    setPHigh(d.pHigh);
    setPLow(d.pLow);
  }, [refIdx]);

  // Ensure pLow < pHigh
  const effectivePLow = Math.min(pLow, pHigh - Math.round((pMax - pMin) * 0.05));
  const effectivePHigh = Math.max(pHigh, pLow + Math.round((pMax - pMin) * 0.05));

  const cycle = useMemo(() => calculateRefrigerationCycle(refData, effectivePHigh, effectivePLow), [refData, effectivePHigh, effectivePLow]);

  const [dragPoint, setDragPoint] = useState({ s: cycle.s1, T: cycle.T1, h: cycle.h1, P: cycle.states[0].P });
  const [lockS, setLockS] = useState(false);
  const [lockT, setLockT] = useState(false);
  const [lockP, setLockP] = useState(false);
  const [lockH, setLockH] = useState(false);

  const phaseInfo = useMemo(() => getRefrigerantPhaseInfo(table, dragPoint.s, dragPoint.T), [table, dragPoint.s, dragPoint.T]);
  const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);

  // Animate the cycle: dragPoint walks 1→2→3→4→1 (~6s loop at 1×).
  // Segments 1→2 and 4→1 are straight in (s, T); 2→3 walks the condenser
  // T-s path through the dome and 3→4 walks the isenthalpic expansion path
  // so the cursor traces the actual drawn lines.
  useEffect(() => {
    if (!animating) return;
    const segMs = 1500 / Math.max(0.05, animSpeed);
    const totalMs = segMs * 4;
    const walkPath = (pts, frac) => {
      if (!pts || pts.length === 0) return null;
      if (pts.length === 1) return pts[0];
      const lens = [];
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b.s - a.s, b.T - a.T);
        lens.push(len); total += len;
      }
      if (total === 0) return pts[0];
      let target = frac * total;
      for (let i = 0; i < lens.length; i++) {
        if (target <= lens[i] || i === lens.length - 1) {
          const a = pts[i], b = pts[i + 1];
          const f = lens[i] === 0 ? 0 : Math.min(1, target / lens[i]);
          return { s: a.s + (b.s - a.s) * f, T: a.T + (b.T - a.T) * f };
        }
        target -= lens[i];
      }
      return pts[pts.length - 1];
    };
    let cancelled = false;
    let rafId = 0;
    const t0 = performance.now();
    const tick = (now) => {
      if (cancelled) return;
      // rAF timestamps can precede the performance.now() captured above → keep elapsed in [0, totalMs)
      const elapsed = ((now - t0) % totalMs + totalMs) % totalMs;
      const segIdx = Math.min(3, Math.max(0, Math.floor(elapsed / segMs)));
      const frac = (elapsed - segIdx * segMs) / segMs;
      const a = cycle.states[segIdx];
      const b = cycle.states[(segIdx + 1) % 4];
      let s, T;
      if (segIdx === 1 && cycle.condenserTsPath) {
        const pt = walkPath(cycle.condenserTsPath, frac);
        s = pt.s; T = pt.T;
      } else if (segIdx === 2 && cycle.expansionTsPath) {
        const pt = walkPath(cycle.expansionTsPath, frac);
        s = pt.s; T = pt.T;
      } else {
        s = a.s + (b.s - a.s) * frac;
        T = a.T + (b.T - a.T) * frac;
      }
      const h = a.h + (b.h - a.h) * frac;
      const P = a.P + (b.P - a.P) * frac;
      setDragPoint({ s, T, h, P });
      setAnimProgress(elapsed / totalMs);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(rafId); };
  }, [animating, cycle, animSpeed]);

  const desktop = useIsDesktop();
  const gap = desktop ? 25 : 12;
  const card = { margin: `${gap}px ${gap}px 0`, padding: desktop ? "24px" : "14px", background: K.card, border: `1px solid ${K.border}` };
  const sec = { margin: "0 0 14px 0", fontSize: sz(desktop ? 22.50 : 12), fontFamily: FD, color: K.ink, borderBottom: `1px solid ${K.border}`, paddingBottom: 8 };

  // Sync drag from T-s
  const handleTsDrag = useCallback((pt) => {
    setAnimating(false);
    // Convert T,s to h,P for P-h sync
    const P_est = interpRefrigerant(table, Math.max(table[0].P, Math.min(table[table.length-1].P, pt.P || effectivePLow)), "T") === pt.T ? (pt.P || effectivePLow) : effectivePLow;
    // Find pressure from temperature
    let P_drag = effectivePLow;
    for (let i = 0; i < table.length - 1; i++) {
      if (pt.T >= table[i].T && pt.T <= table[i + 1].T) {
        P_drag = lerp(pt.T, table[i].T, table[i + 1].T, table[i].P, table[i + 1].P);
        break;
      }
    }
    if (pt.T > table[table.length - 1].T) P_drag = table[table.length - 1].P;
    if (pt.T < table[0].T) P_drag = table[0].P;
    const hf = interpRefrigerant(table, P_drag, "hf");
    const hg = interpRefrigerant(table, P_drag, "hg");
    const sf = interpRefrigerant(table, P_drag, "sf");
    const sg = interpRefrigerant(table, P_drag, "sg");
    let h_est;
    if (pt.s <= sf) h_est = hf;
    else if (pt.s >= sg) {
      const cp_est = Math.min(2.5, Math.max(0.7, (hg - hf) / Math.max(1, interpRefrigerant(table, P_drag, "T") + 50) * 0.15));
      h_est = hg + cp_est * (pt.T - interpRefrigerant(table, P_drag, "T"));
    }
    else { const x = (pt.s - sf) / (sg - sf); h_est = hf + x * (hg - hf); }
    setDragPoint({ s: pt.s, T: pt.T, h: h_est, P: P_drag });
  }, [table, effectivePLow]);

  // Sync drag from P-h
  const handlePhDrag = useCallback((pt) => {
    setAnimating(false);
    setDragPoint({ s: pt.s, T: pt.T, h: pt.h, P: pt.P });
  }, []);

  return (
    <div onClickCapture={stopAnim} onInputCapture={stopAnim} onPointerDownCapture={e => { if (e.pointerType !== "touch" && e.target.closest && e.target.closest("svg")) stopAnim(e); }} style={{ minHeight: "100vh", background: K.bg, color: K.ink, fontFamily: FM, maxWidth: desktop ? 1750 : 480, margin: "0 auto" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;
          background:${K.accent};border:2px solid ${K.card};cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15);
        }
        input[type="range"]::-moz-range-thumb { width:16px;height:16px;border-radius:50%;background:${K.accent};border:2px solid ${K.card};cursor:pointer; }
        *{box-sizing:border-box}body{margin:0;background:${K.bg}}
      `}</style>

      {/* Header */}
      <div style={{ padding: desktop ? "20px 24px 16px" : "16px 16px 12px", borderBottom: `2px solid ${K.ink}`, background: K.card }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: desktop ? 14 : 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {onBack && <button onClick={onBack} style={{ background: "none", border: `1px solid ${K.border}`, padding: desktop ? "8px 16px" : "5px 10px", color: K.inkMed, fontSize: sz(desktop ? 15 : 10), cursor: "pointer", fontFamily: FM }}>← Back</button>}
            <div>
              <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM, letterSpacing: 3, marginBottom: 1, textTransform: "uppercase" }}>Thermodynamics</div>
              <h1 style={{ margin: 0, fontSize: sz(desktop ? 35 : 20), fontFamily: FD, color: K.ink, lineHeight: 1.1 }}>
                Refrigeration <span style={{ color: K.heatOut, fontStyle: "italic" }}>Cycle</span>
              </h1>
              <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM, letterSpacing: 2, marginTop: 2 }}>Vapor-Compression Cycle Analysis</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button data-tour="ref-theory" onClick={() => setShowInfo(true)} style={{ background: K.accent, border: "none", padding: desktop ? "10px 20px" : "7px 14px", color: "#fff", fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>Theory</button>
            <button data-tour="ref-refrigerants" onClick={() => setShowRefInfo(true)} style={{ background: K.heatOut, border: "none", padding: desktop ? "10px 20px" : "7px 14px", color: "#fff", fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>Refrigerants</button>
            <button data-tour="ref-settings" onClick={() => setShowSettings(true)} style={{ background: "none", border: `1px solid ${K.border}`, padding: desktop ? "10px 20px" : "7px 14px", color: K.inkMed, fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>⚙ Settings</button>
            <button onClick={() => { setForcedTour(false); setShowTour(true); }} style={{ background: "none", border: `1px solid ${K.border}`, padding: desktop ? "10px 20px" : "7px 14px", color: K.inkMed, fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>Instructions</button>
          </div>
        </div>
        {/* Refrigerant selector */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: desktop ? 8 : 5 }}>
          {REFRIGERANTS.map((r, i) => (
            <button key={r.id} onClick={() => setRefIdx(i)} style={{
              padding: desktop ? "6px 14px" : "4px 10px", fontSize: sz(desktop ? 13 : 9), fontFamily: FM,
              background: i === refIdx ? K.heatOut : K.cardAlt,
              color: i === refIdx ? "#fff" : K.inkMed,
              border: `1px solid ${i === refIdx ? K.heatOut : K.border}`,
              cursor: "pointer", borderRadius: 3, fontWeight: i === refIdx ? 700 : 400,
              transition: "all 0.15s",
            }}>{r.name}</button>
          ))}
        </div>
      </div>

      <RefInfoModal open={showInfo} onClose={() => setShowInfo(false)} />
      <RefrigerantInfoModal open={showRefInfo} onClose={() => setShowRefInfo(false)} currentRef={refData} />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} K={K} FD={FD} FM={FM}
        textScale={textScale} onTextScaleChange={handleScaleChange}
        darkMode={darkMode} onDarkModeToggle={toggleDarkMode}
        units={units} onUnitsChange={handleUnitsChange}
        animSpeed={animSpeed} onAnimSpeedChange={handleAnimSpeedChange} />
      <WelcomePopup open={showWelcome} K={K} textScale={textScale} onScaleChange={handleScaleChange} onStart={() => { setShowWelcome(false); localStorage.setItem("tourSeen", "1"); setShowTour(true); }} onDismiss={() => { setShowWelcome(false); localStorage.setItem("tourSeen", "1"); }} />
      <GuidedTour steps={REF_TOUR_STEPS} isOpen={showTour} forced={forcedTour} onClose={() => { setShowTour(false); setForcedTour(false); localStorage.setItem("tourSeen", "1"); }} K={K} textScale={textScale} onScaleChange={handleScaleChange} />

      {/* Performance bar */}
      <div style={{ margin: `${gap}px ${gap}px 0`, padding: desktop ? "16px" : "12px", background: K.card, border: `1px solid ${K.border}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { l: "COP cooling", v: cycle.copCool.toFixed(2), c: K.accent },
          { l: "COP heating", v: cycle.copHeat.toFixed(2), c: K.heatOut },
          { l: "W comp", v: fmt(cvtH(cycle.wComp, units)), c: K.workIn, s: lblH(units) },
        ].map((m, i) => (
          <div key={i} style={{ textAlign: "center", padding: desktop ? "8px 0" : "4px 0" }}>
            <div style={{ fontSize: sz(desktop ? 15 : 8), color: K.inkLight, fontFamily: FM, letterSpacing: 1, marginBottom: 3, textTransform: "uppercase", fontStyle: "italic" }}>{m.l}</div>
            <div style={{ fontSize: sz(desktop ? 40 : 20), fontFamily: FD, color: m.c, lineHeight: 1.2 }}>{m.v}</div>
            {m.s && <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM }}>{m.s}</div>}
          </div>
        ))}
      </div>

      {/* Row: Schematic + Phase Visualizer */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>System Schematic <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— {refData.name}</span></h3>
          <div data-tour="ref-schematic"><RefSchematicDiagram cycle={cycle} textScale={textScale} units={units} animating={animating} animProgress={animProgress} /></div>
        </div>
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}`, display: "flex", flexDirection: "column" } : card}>
          <h3 style={sec}>Phase Visualizer <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— drag a point on the diagrams</span></h3>
          <RefParticleVisualizer phaseInfo={phaseInfo} temperature={dragPoint.T} criticalT={refData.criticalT} fillHeight={desktop} textScale={textScale} units={units} />
        </div>
      </div>

      {/* Row: T-s + P-h Diagrams */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        {/* T-s Diagram */}
        <div data-tour="ref-ts-diagram" style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...sec, marginBottom: desktop ? 15 : 8 }}>
            <span>T–s Diagram <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— interactive</span></span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setAnimating(a => !a)} style={{
                background: animating ? K.accent : "none", border: `1px solid ${animating ? K.accent : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: animating ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }} data-anim-keep="1">{animating ? "⏸ Pause" : "▶ Animate"}</button>
              <button data-tour="ref-cop-areas" onClick={() => setShowTsAreas(a => !a)} style={{
                background: showTsAreas ? K.workIn : "none", border: `1px solid ${showTsAreas ? K.workIn : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: showTsAreas ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>COP areas</button>
              <button data-tour="ref-fx" onClick={() => setShowEqs(true)} style={{
                background: "none", border: `1px solid ${K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4,
              }}>f(x)</button>
            </div>
          </div>
          <div data-tour="ref-lock-buttons" style={{ display: "flex", gap: 8, marginBottom: desktop ? 15 : 8 }}>
            <button onClick={() => { setLockS(l => !l); if (!lockS) { setLockT(false); setLockP(false); setLockH(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockS ? K.accent : K.cardAlt, color: lockS ? "#fff" : K.inkMed, border: `1px solid ${lockS ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockS ? 700 : 400, transition: "all 0.15s" }}>
              {lockS ? "\u{1F512}" : "\u{1F513}"} Lock s = {cvtS(dragPoint.s, units).toFixed(2)} {lblS(units)}
            </button>
            <button onClick={() => { setLockT(l => !l); if (!lockT) { setLockS(false); setLockP(false); setLockH(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockT ? K.accent : K.cardAlt, color: lockT ? "#fff" : K.inkMed, border: `1px solid ${lockT ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockT ? 700 : 400, transition: "all 0.15s" }}>
              {lockT ? "\u{1F512}" : "\u{1F513}"} Lock T = {fmtT(dragPoint.T, units, 0)}
            </button>
          </div>
          <RefTsDiagram cycle={cycle} refData={refData} dragPoint={dragPoint} onDrag={handleTsDrag} lockS={lockS} lockT={lockT} showAreas={showTsAreas}
            onPHighChange={setPHigh} onPLowChange={setPLow}
            lineDragInfo={lineDragInfo} onLineDragStart={(which) => { setAnimating(false); setLineDragInfo({ which }); }} onLineDragMove={(which) => setLineDragInfo({ which })} onLineDragEnd={() => setLineDragInfo(null)} textScale={textScale} units={units} />
        </div>

        {/* P-h Diagram */}
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...sec, marginBottom: desktop ? 15 : 8 }}>
            <span>P–h Diagram <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— interactive</span></span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setAnimating(a => !a)} style={{
                background: animating ? K.accent : "none", border: `1px solid ${animating ? K.accent : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: animating ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }} data-anim-keep="1">{animating ? "⏸ Pause" : "▶ Animate"}</button>
              <button data-tour="ref-energy-areas" onClick={() => setShowPhAreas(a => !a)} style={{
                background: showPhAreas ? K.workIn : "none", border: `1px solid ${showPhAreas ? K.workIn : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: showPhAreas ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>Energy areas</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: desktop ? 15 : 8 }}>
            <button onClick={() => { setLockP(l => !l); if (!lockP) { setLockH(false); setLockS(false); setLockT(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockP ? K.accent : K.cardAlt, color: lockP ? "#fff" : K.inkMed, border: `1px solid ${lockP ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockP ? 700 : 400, transition: "all 0.15s" }}>
              {lockP ? "\u{1F512}" : "\u{1F513}"} Lock P = {fmtP(dragPoint.P || effectivePLow, units)}
            </button>
            <button onClick={() => { setLockH(l => !l); if (!lockH) { setLockP(false); setLockS(false); setLockT(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockH ? K.accent : K.cardAlt, color: lockH ? "#fff" : K.inkMed, border: `1px solid ${lockH ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockH ? 700 : 400, transition: "all 0.15s" }}>
              {lockH ? "\u{1F512}" : "\u{1F513}"} Lock h = {fmtH(dragPoint.h || cycle.h1, units, 0)}
            </button>
          </div>
          <RefPhDiagram cycle={cycle} refData={refData} dragPoint={dragPoint} onDrag={handlePhDrag} lockP={lockP} lockH={lockH} showAreas={showPhAreas}
            onPHighChange={setPHigh} onPLowChange={setPLow}
            lineDragInfo={lineDragInfo} onLineDragStart={(which) => { setAnimating(false); setLineDragInfo({ which }); }} onLineDragMove={(which) => setLineDragInfo({ which })} onLineDragEnd={() => setLineDragInfo(null)} textScale={textScale} units={units} />
        </div>
      </div>
      <RefEquationsModal open={showEqs} onClose={() => { setShowEqs(false); setEqTopic(null); }} cycle={cycle} initialTopic={eqTopic} units={units} />

      {/* Row: Sliders + Table */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : { ...card, padding: "16px" }}>
          <h3 style={sec}>Cycle Parameters</h3>
          <ParamSlider label="Condenser Pressure (P high)" kind="P" color={K.heatOut} value={effectivePHigh} min={Math.round(pMin + (pMax - pMin) * 0.2)} max={pMax} step={Math.max(1, Math.round((pMax - pMin) / 100))} onChange={setPHigh} textScale={textScale} units={units} />
          <ParamSlider label="Evaporator Pressure (P low)" kind="P" color={K.heatIn} value={effectivePLow} min={pMin} max={Math.round(pMin + (pMax - pMin) * 0.6)} step={Math.max(1, Math.round((pMax - pMin) / 100))} onChange={setPLow} textScale={textScale} units={units} />
          <div style={{ marginTop: 6, fontSize: sz(desktop ? 15 : 9), color: K.inkLight, borderTop: `1px solid ${K.gridFine}`, paddingTop: 6, fontStyle: "italic" }}>
            T_evap = {fmtT(cycle.Tsat_low, units)} &nbsp;|&nbsp; T_cond = {fmtT(cycle.Tsat_high, units)} &nbsp;|&nbsp; x₄ = {cycle.x4.toFixed(3)}
          </div>
        </div>
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>State Point Properties <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— Table 1</span></h3>
          <RefStateTable cycle={cycle} refData={refData} onSelectState={setDragPoint} textScale={textScale} units={units} />
        </div>
      </div>

      {/* Energy Balance */}
      <div data-tour="ref-energy-balance" style={card}>
        <h3 style={sec}>Energy Balance</h3>
        <div style={{ display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: desktop ? 16 : 8 }}>
          {/* Heat Transfer group */}
          <div>
            <div style={{ fontSize: sz(desktop ? 15 : 9), fontFamily: FM, color: K.inkLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${K.border}`, textAlign: "center" }}>Heat Transfer</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { l: "Q evap (Cooling)", v: fmt(cvtH(cycle.qEvap, units)), u: lblH(units), c: K.heatIn, topic: "qe" },
                { l: "Q cond (Rejected)", v: fmt(cvtH(cycle.qCond, units)), u: lblH(units), c: K.heatOut, topic: "qc" },
              ].map((e, i) => (
                <div key={i} onClick={() => { setEqTopic(e.topic); setShowEqs(true); }} style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: desktop ? "16px 18px" : "8px 10px", textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, marginBottom: 4, fontStyle: "italic", letterSpacing: 1, textTransform: "uppercase" }}>{e.l}</div>
                  <div style={{ fontSize: sz(desktop ? 35 : 16), fontFamily: FD, color: e.c }}>{e.v}</div>
                  <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM, marginTop: 2 }}>{e.u}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Work group */}
          <div>
            <div style={{ fontSize: sz(desktop ? 15 : 9), fontFamily: FM, color: K.inkLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${K.border}`, textAlign: "center" }}>Work</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              <div onClick={() => { setEqTopic("wc"); setShowEqs(true); }} style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: desktop ? "16px 18px" : "8px 10px", textAlign: "center", cursor: "pointer" }}>
                <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, marginBottom: 4, fontStyle: "italic", letterSpacing: 1, textTransform: "uppercase" }}>W compressor</div>
                <div style={{ fontSize: sz(desktop ? 35 : 16), fontFamily: FD, color: K.workIn }}>{fmt(cvtH(cycle.wComp, units))}</div>
                <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM, marginTop: 2 }}>{lblH(units)}</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: desktop ? 15 : 8, display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: 8 }}>
          <div style={{ padding: desktop ? "14px 18px" : "8px 10px", background: K.cardAlt, border: `1px solid ${K.border}`, textAlign: "center" }}>
            <div style={{ fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontStyle: "italic", marginBottom: 2 }}>Verify: Q_evap + W_comp</div>
            <div style={{ fontSize: sz(desktop ? 25 : 12), fontFamily: FD, color: K.accent }}>= {fmt(cvtH(cycle.qEvap + cycle.wComp, units))} {lblH(units)}</div>
          </div>
          <div style={{ padding: desktop ? "14px 18px" : "8px 10px", background: K.cardAlt, border: `1px solid ${K.border}`, textAlign: "center" }}>
            <div style={{ fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontStyle: "italic", marginBottom: 2 }}>Q_cond (should match)</div>
            <div style={{ fontSize: sz(desktop ? 25 : 12), fontFamily: FD, color: K.heatOut }}>= {fmt(cvtH(cycle.qCond, units))} {lblH(units)}</div>
          </div>
        </div>
      </div>

      <div data-tour="ref-share-solution" style={{ textAlign: "center", padding: desktop ? "20px 12px 12px" : "14px 12px 8px", display: "flex", justifyContent: "center", gap: desktop ? 12 : 8, flexWrap: "wrap" }}>
        <button onClick={() => {
          const u = `${window.location.origin}${window.location.pathname}?view=refrigeration&ref=${refIdx}&pHigh=${effectivePHigh}&pLow=${effectivePLow}`;
          navigator.clipboard.writeText(u).then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); });
        }} style={{
          background: shareCopied ? K.workOut : "none", border: `1px solid ${shareCopied ? K.workOut : K.border}`, padding: desktop ? "8px 20px" : "6px 14px",
          color: shareCopied ? "#fff" : K.inkMed, fontSize: sz(desktop ? 13 : 10), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.2s",
        }}>{shareCopied ? "\u2713 Link Copied" : "\uD83D\uDD17 Share Setup"}</button>
        <button onClick={() => {
          const lT = lblT(units), lP = lblP(units), lH = lblH(units), lS = lblS(units);
          const T_ = (v) => cvtT(v, units).toFixed(2);
          const P_ = (v) => cvtP(v, units).toFixed(units.P === "MPa" ? 3 : units.P === "bar" || units.P === "atm" ? 2 : 1);
          const H_ = (v) => cvtH(v, units).toFixed(2);
          const S_ = (v) => cvtS(v, units).toFixed(4);
          const text = [
            `VAPOR-COMPRESSION REFRIGERATION CYCLE \u2014 Solution`,
            `Refrigerant: ${refData.name} (${refData.formula})`,
            `Inputs: P_high (cond) = ${P_(effectivePHigh)} ${lP}, P_low (evap) = ${P_(effectivePLow)} ${lP}`,
            `T_evap = ${T_(cycle.Tsat_low)} ${lT}, T_cond = ${T_(cycle.Tsat_high)} ${lT}`,
            ``,
            `State 1 (sat. vapor at P_low):     T = ${T_(cycle.states[0].T)} ${lT}, P = ${P_(cycle.states[0].P)} ${lP}, h = ${H_(cycle.states[0].h)} ${lH}, s = ${S_(cycle.states[0].s)} ${lS}`,
            `State 2 (after isentropic comp.):  T = ${T_(cycle.states[1].T)} ${lT}, P = ${P_(cycle.states[1].P)} ${lP}, h = ${H_(cycle.states[1].h)} ${lH}, s = ${S_(cycle.states[1].s)} ${lS}`,
            `State 3 (sat. liquid at P_high):   T = ${T_(cycle.states[2].T)} ${lT}, P = ${P_(cycle.states[2].P)} ${lP}, h = ${H_(cycle.states[2].h)} ${lH}, s = ${S_(cycle.states[2].s)} ${lS}`,
            `State 4 (after expansion, two-ph): T = ${T_(cycle.states[3].T)} ${lT}, P = ${P_(cycle.states[3].P)} ${lP}, h = ${H_(cycle.states[3].h)} ${lH}, s = ${S_(cycle.states[3].s)} ${lS}, x_4 = ${cycle.x4.toFixed(4)}`,
            ``,
            `Compressor:  W_comp = h2 \u2212 h1 = ${H_(cycle.wComp)} ${lH}`,
            `Evaporator:  Q_evap = h1 \u2212 h4 = ${H_(cycle.qEvap)} ${lH}  (cooling effect)`,
            `Condenser:   Q_cond = h2 \u2212 h3 = ${H_(cycle.qCond)} ${lH}  (rejected)`,
            `Throttle:    h3 = h4 (isenthalpic)`,
            ``,
            `COP_cooling = Q_evap / W_comp = ${cycle.copCool.toFixed(3)}`,
            `COP_heating = Q_cond / W_comp = ${cycle.copHeat.toFixed(3)}`,
            `Energy balance check: Q_evap + W_comp = ${H_(cycle.qEvap + cycle.wComp)} ${lH} \u2248 Q_cond = ${H_(cycle.qCond)} ${lH}`,
          ].join("\n");
          navigator.clipboard.writeText(text).then(() => { setEqsCopied(true); setTimeout(() => setEqsCopied(false), 2000); });
        }} style={{
          background: eqsCopied ? K.accent : "none", border: `1px solid ${eqsCopied ? K.accent : K.border}`, padding: desktop ? "8px 20px" : "6px 14px",
          color: eqsCopied ? "#fff" : K.inkMed, fontSize: sz(desktop ? 13 : 10), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.2s",
        }}>{eqsCopied ? "\u2713 Copied" : "\uD83D\uDCCB Copy Solution"}</button>
      </div>
      <div style={{ textAlign: "center", padding: desktop ? "8px 12px 8px" : "6px 12px 6px", fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontFamily: FM, fontStyle: "italic", letterSpacing: 1 }}>
        Vapor-Compression Refrigeration · {refData.name} ({refData.formula})
      </div>
      <div style={{ textAlign: "center", padding: desktop ? "8px 12px 36px" : "6px 12px 28px", borderTop: `1px solid ${K.border}`, marginTop: desktop ? 8 : 4, marginLeft: desktop ? 40 : 16, marginRight: desktop ? 40 : 16 }}>
        <div style={{ fontSize: sz(desktop ? 14 : 9), color: K.inkMed, fontFamily: FM, marginBottom: 4 }}>Built by <span style={{ fontWeight: 600, color: K.ink }}>Scott Presbrey</span></div>
        <span onClick={() => { const u="scottypres",d="gmail",t="com"; window.location.href="mailto:"+u+"\u0040"+d+"."+t; }} style={{ fontSize: sz(desktop ? 13 : 8), color: K.accent, fontFamily: FM, textDecoration: "underline", cursor: "pointer" }}>{"scottypres" + "\u0040" + "gmail.com"}</span>
      </div>
    </div>
  );
}
