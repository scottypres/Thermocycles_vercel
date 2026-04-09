import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { K_LIGHT, K_DARK, FD, FM, lerp, ParamSlider, useIsDesktop } from "./shared.jsx";
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
function RefParticleVisualizer({ phaseInfo, temperature, criticalT }) {
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
    <div style={{ position: "relative" }}>
      <canvas ref={canvasRef} width={W} height={H}
        style={{ width: "100%", height: "auto", display: "block", border: `1.5px solid ${K.ink}`, background: K.cardAlt }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        {phase === "two-phase" ? (
          <div style={{ background: "rgba(255,255,255,0.88)", padding: "8px 18px", border: `1.5px solid ${K.ink}`, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontFamily: FD, color: K.accent, lineHeight: 1.1 }}>{(quality * 100).toFixed(1)}%</div>
            <div style={{ fontSize: 9, fontFamily: FM, color: K.inkMed, letterSpacing: 1, marginTop: 2 }}>QUALITY (x)</div>
          </div>
        ) : (
          <div style={{ background: "rgba(255,255,255,0.88)", padding: "8px 18px", border: `1.5px solid ${K.ink}`, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontFamily: FD, color: K.ink, lineHeight: 1.1 }}>{phaseLabel}</div>
            <div style={{ fontSize: 9, fontFamily: FM, color: K.inkMed, letterSpacing: 1, marginTop: 2 }}>{phase === "subcooled" ? "x = 0 (all liquid)" : "x = 1 (all vapor)"}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: K.liquidBlue }} />
          <span style={{ fontSize: 9, fontFamily: FM, color: K.inkLight }}>Liquid</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: K.vaporRed }} />
          <span style={{ fontSize: 9, fontFamily: FM, color: K.inkLight }}>Vapor</span>
        </div>
        <div style={{ fontSize: 9, fontFamily: FM, color: K.inkLight }}>T = {temperature.toFixed(0)}°C</div>
      </div>
    </div>
  );
}

/* ───────── T-s Diagram ───────── */
const TS_W = 360, TS_H = 285;
const TS_PAD = { l: 38, r: 6, t: 14, b: 28 };
const TS_PLOT = { x: TS_PAD.l, y: TS_PAD.t, w: TS_W - TS_PAD.l - TS_PAD.r, h: TS_H - TS_PAD.t - TS_PAD.b };

function RefTsDiagram({ cycle, refData, dragPoint, onDrag, lockS, lockT, showAreas, onPHighChange, onPLowChange, lineDragInfo, onLineDragStart, onLineDragMove, onLineDragEnd }) {
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const lineDragRef = useRef(null);

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
    const r = getSvgXY(e);
    if (r) {
      if (Math.abs(r.px - condTextX) < 25 && Math.abs(r.py - condTextY) < 10) {
        lineDragRef.current = "condenser";
        if (onLineDragStart) onLineDragStart("condenser");
        e.preventDefault();
        return;
      }
      if (Math.abs(r.px - evapTextX) < 30 && Math.abs(r.py - evapTextY) < 10) {
        lineDragRef.current = "evaporator";
        if (onLineDragStart) onLineDragStart("evaporator");
        e.preventDefault();
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
    <svg ref={svgRef} viewBox={`0 0 ${TS_W} ${TS_H}`} style={{ width: "100%", maxWidth: 420, touchAction: "none", cursor: "crosshair" }}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
      {/* Grid */}
      {sGridVals.map((s, i) => <line key={`sg${i}`} x1={mapS(s)} y1={TS_PLOT.y} x2={mapS(s)} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.gridMajor} strokeWidth={0.5} />)}
      {tGridVals.map((t, i) => <line key={`tg${i}`} x1={TS_PLOT.x} y1={mapT(t)} x2={TS_PLOT.x + TS_PLOT.w} y2={mapT(t)} stroke={K.gridMajor} strokeWidth={0.5} />)}
      {/* Axes */}
      <line x1={TS_PLOT.x} y1={TS_PLOT.y + TS_PLOT.h} x2={TS_PLOT.x + TS_PLOT.w} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      <line x1={TS_PLOT.x} y1={TS_PLOT.y} x2={TS_PLOT.x} y2={TS_PLOT.y + TS_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      {sGridVals.map((s, i) => <text key={`sl${i}`} x={mapS(s)} y={TS_PLOT.y + TS_PLOT.h + 10} fill={K.inkMed} fontSize={6.5} textAnchor="middle" fontFamily={FM}>{s.toFixed(1)}</text>)}
      {tGridVals.map((t, i) => <text key={`tl${i}`} x={TS_PLOT.x - 4} y={mapT(t) + 2.5} fill={K.inkMed} fontSize={6.5} textAnchor="end" fontFamily={FM}>{t}</text>)}
      <text x={TS_W / 2} y={TS_H - 1} fill={K.inkMed} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic">s (kJ/kg·K)</text>
      <text x={10} y={TS_H / 2 - 8} fill={K.inkMed} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic" transform={`rotate(-90,10,${TS_H / 2 - 8})`}>T (°C)</text>
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
            <path d={qEvapD} fill={`${K.heatIn}18`} stroke="none" />
            <path d={qCondD} fill={`${K.heatOut}18`} stroke="none" />
            <path d={cycleFillD} fill={`${K.workIn}25`} stroke="none" />
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
        const valueText = `${label} = ${T.toFixed(1)}°C`;
        const boxW = Math.max(104, valueText.length * 5.7 + 16);
        const boxX = TS_PLOT.x + 4;
        const boxY = TS_PLOT.y + 2;
        return (<>
          <line x1={TS_PLOT.x} y1={lineY} x2={TS_PLOT.x + TS_PLOT.w} y2={lineY} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
          <rect x={boxX} y={boxY} width={boxW} height={18} rx={2} fill={K.card} stroke={color} strokeWidth={0.8} />
          <text x={boxX + boxW / 2} y={boxY + 13} fill={color} fontSize={9} fontFamily={FM} textAnchor="middle" fontWeight="600">{valueText}</text>
        </>);
      })()}
      {!showAreas && <>
        <rect x={mapS(st[0].s) + 4} y={(mapT(st[0].T) + mapT(st[1].T)) / 2 - 8} width={52} height={11} rx={2} fill={K.card} />
        <text x={mapS(st[0].s) + 8} y={(mapT(st[0].T) + mapT(st[1].T)) / 2} fill={K.workIn} fontSize={7} fontFamily={FM} fontWeight="500">Compressor</text>
        <rect x={mapS((st[1].s + st[2].s) / 2) - 24} y={mapT(cycle.Tsat_high) - 16} width={48} height={11} rx={2} fill={K.card} />
        <text x={mapS((st[1].s + st[2].s) / 2)} y={mapT(cycle.Tsat_high) - 8} fill={K.heatOut} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "grab" }}>Condenser</text>
        <rect x={mapS((st[2].s + st[3].s) / 2) - 16 - 44} y={(mapT(st[2].T) + mapT(st[3].T)) / 2 - 8} width={44} height={11} rx={2} fill={K.card} />
        <text x={mapS((st[2].s + st[3].s) / 2) - 16} y={(mapT(st[2].T) + mapT(st[3].T)) / 2} fill={K.inkMed} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="end">Exp. Valve</text>
        <rect x={mapS((st[3].s + st[0].s) / 2) - 26} y={mapT(st[0].T) + 5} width={52} height={11} rx={2} fill={K.card} />
        <text x={mapS((st[3].s + st[0].s) / 2)} y={mapT(st[0].T) + 13} fill={K.heatIn} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "grab" }}>Evaporator</text>
        <line x1={dpx} y1={dpy} x2={dpx} y2={TS_PLOT.y + TS_PLOT.h} stroke={lockS ? K.accent : K.inkLight} strokeWidth={lockS ? 1.2 : 0.5} strokeDasharray={lockS ? "none" : "2 2"} />
        <line x1={dpx} y1={dpy} x2={TS_PLOT.x} y2={dpy} stroke={lockT ? K.accent : K.inkLight} strokeWidth={lockT ? 1.2 : 0.5} strokeDasharray={lockT ? "none" : "2 2"} />
      </>}
      {/* State points */}
      {st.map((s, i) => {
        const cx = mapS(s.s), cy = mapT(s.T);
        const off = [{ dx: 8, dy: 14 }, { dx: 8, dy: -10 }, { dx: -14, dy: -10 }, { dx: -14, dy: 14 }];
        const tx = cx + off[i].dx, ty = cy + off[i].dy;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={5} fill={K.card} stroke={K.stateCircle} strokeWidth={1.2} />
            <circle cx={cx} cy={cy} r={1.8} fill={K.stateFill} />
            <rect x={tx - 7} y={ty - 10} width={14} height={13} rx={1} fill={K.card} />
            <text x={tx} y={ty} fill={K.accent} fontSize={12} fontFamily={FD} textAnchor="middle">{s.label}</text>
          </g>
        );
      })}
      {!showAreas && <>
        <circle cx={dpx} cy={dpy} r={9} fill="rgba(192,57,43,0.15)" stroke={K.accent} strokeWidth={2} />
        <circle cx={dpx} cy={dpy} r={4} fill={K.accent} />
        <text x={TS_W - 8} y={TS_PLOT.y + 10} fill={K.inkLight} fontSize={7} fontFamily={FM} textAnchor="end" fontStyle="italic">{lockS ? "s locked" : lockT ? "T locked" : "tap & drag"}</text>
      </>}
      {showAreas && (() => {
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        const lx = TS_PLOT.x + 6, ly = TS_PLOT.y + 4;
        return (
          <>
            <rect x={lx} y={ly} width={160} height={52} rx={2} fill={K.card} stroke={K.border} strokeWidth={0.8} />
            <rect x={lx + 5} y={ly + 5} width={8} height={8} rx={1} fill={`${K.heatIn}30`} stroke={K.heatIn} strokeWidth={0.6} />
            <text x={lx + 17} y={ly + 12} fill={K.heatIn} fontSize={8} fontFamily={FM}>Q_evap (4→1) = {fmt(cycle.qEvap)} kJ/kg</text>
            <rect x={lx + 5} y={ly + 18} width={8} height={8} rx={1} fill={`${K.heatOut}30`} stroke={K.heatOut} strokeWidth={0.6} />
            <text x={lx + 17} y={ly + 25} fill={K.heatOut} fontSize={8} fontFamily={FM}>Q_cond (1→3) = {fmt(cycle.qCond)} kJ/kg</text>
            <rect x={lx + 5} y={ly + 31} width={8} height={8} rx={1} fill={`${K.workIn}40`} stroke={K.workIn} strokeWidth={0.6} />
            <text x={lx + 17} y={ly + 38} fill={K.workIn} fontSize={8} fontFamily={FM}>W_comp (1→2) = {fmt(cycle.wComp)} kJ/kg</text>
            <text x={lx + 5} y={ly + 49} fill={K.ink} fontSize={8} fontFamily={FD} fontWeight="bold">COP = {cycle.copCool.toFixed(2)}</text>
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

function RefPhDiagram({ cycle, refData, dragPoint, onDrag, lockP, lockH, showAreas, onPHighChange, onPLowChange, lineDragInfo, onLineDragStart, onLineDragMove, onLineDragEnd }) {
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const lineDragRef = useRef(null);

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
    const r = getSvgXY(e);
    if (r) {
      if (Math.abs(r.px - condTextX) < 25 && Math.abs(r.py - condTextY) < 10) {
        lineDragRef.current = "condenser";
        if (onLineDragStart) onLineDragStart("condenser");
        e.preventDefault();
        return;
      }
      if (Math.abs(r.px - evapTextX) < 30 && Math.abs(r.py - evapTextY) < 10) {
        lineDragRef.current = "evaporator";
        if (onLineDragStart) onLineDragStart("evaporator");
        e.preventDefault();
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
    <svg ref={svgRef} viewBox={`0 0 ${PH_W} ${PH_H}`} style={{ width: "100%", maxWidth: 420, touchAction: "none", cursor: "crosshair" }}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
      {hGridVals.map((h, i) => <line key={`hg${i}`} x1={mapH(h)} y1={PH_PLOT.y} x2={mapH(h)} y2={PH_PLOT.y + PH_PLOT.h} stroke={K.gridMajor} strokeWidth={0.5} />)}
      {pGridVals.map((p, i) => <line key={`pg${i}`} x1={PH_PLOT.x} y1={mapP(p)} x2={PH_PLOT.x + PH_PLOT.w} y2={mapP(p)} stroke={K.gridMajor} strokeWidth={0.5} />)}
      <line x1={PH_PLOT.x} y1={PH_PLOT.y + PH_PLOT.h} x2={PH_PLOT.x + PH_PLOT.w} y2={PH_PLOT.y + PH_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      <line x1={PH_PLOT.x} y1={PH_PLOT.y} x2={PH_PLOT.x} y2={PH_PLOT.y + PH_PLOT.h} stroke={K.ink} strokeWidth={1.2} />
      {hGridVals.map((h, i) => <text key={`hl${i}`} x={mapH(h)} y={PH_PLOT.y + PH_PLOT.h + 10} fill={K.inkMed} fontSize={6.5} textAnchor="middle" fontFamily={FM}>{h}</text>)}
      {pGridVals.map((p, i) => <text key={`pl${i}`} x={PH_PLOT.x - 4} y={mapP(p) + 2.5} fill={K.inkMed} fontSize={6.5} textAnchor="end" fontFamily={FM}>{p >= 1000 ? `${(p/1000).toFixed(1)}k` : p}</text>)}
      <text x={PH_W / 2} y={PH_H - 1} fill={K.inkMed} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic">h (kJ/kg)</text>
      <text x={10} y={PH_H / 2 - 8} fill={K.inkMed} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic" transform={`rotate(-90,10,${PH_H / 2 - 8})`}>P (kPa) — log</text>
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
            <path d={qEvapD} fill={`${K.heatIn}25`} stroke="none" />
            <path d={qCondD} fill={`${K.heatOut}25`} stroke="none" />
            <path d={wCompD} fill={`${K.workIn}20`} stroke="none" />
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
        const valueText = `${label} = ${P >= 1000 ? (P/1000).toFixed(1) + "k" : P} kPa`;
        const boxW = Math.max(104, valueText.length * 5.7 + 16);
        const boxX = PH_PLOT.x + 4;
        const boxY = PH_PLOT.y + 2;
        return (<>
          <line x1={PH_PLOT.x} y1={lineY} x2={PH_PLOT.x + PH_PLOT.w} y2={lineY} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
          <rect x={boxX} y={boxY} width={boxW} height={18} rx={2} fill={K.card} stroke={color} strokeWidth={0.8} />
          <text x={boxX + boxW / 2} y={boxY + 13} fill={color} fontSize={9} fontFamily={FM} textAnchor="middle" fontWeight="600">{valueText}</text>
        </>);
      })()}
      {!showAreas && <>
        <rect x={(mapH(cycle.h1) + mapH(cycle.h2)) / 2 + 6} y={(mapP(st[0].P) + mapP(st[1].P)) / 2 - 8} width={52} height={11} rx={2} fill={K.card} />
        <text x={(mapH(cycle.h1) + mapH(cycle.h2)) / 2 + 10} y={(mapP(st[0].P) + mapP(st[1].P)) / 2} fill={K.workIn} fontSize={7} fontFamily={FM} fontWeight="500">Compressor</text>
        <rect x={(mapH(cycle.h2) + mapH(cycle.h3)) / 2 - 24} y={mapP(st[1].P) - 15} width={48} height={11} rx={2} fill={K.card} />
        <text x={(mapH(cycle.h2) + mapH(cycle.h3)) / 2} y={mapP(st[1].P) - 7} fill={K.heatOut} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "grab" }}>Condenser</text>
        <rect x={mapH(cycle.h3) - 10 - 44} y={(mapP(st[2].P) + mapP(st[3].P)) / 2 - 8} width={44} height={11} rx={2} fill={K.card} />
        <text x={mapH(cycle.h3) - 10} y={(mapP(st[2].P) + mapP(st[3].P)) / 2} fill={K.inkMed} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="end">Exp. Valve</text>
        <rect x={(mapH(cycle.h4) + mapH(cycle.h1)) / 2 - 26} y={mapP(st[0].P) + 5} width={52} height={11} rx={2} fill={K.card} />
        <text x={(mapH(cycle.h4) + mapH(cycle.h1)) / 2} y={mapP(st[0].P) + 13} fill={K.heatIn} fontSize={7} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "grab" }}>Evaporator</text>
        <line x1={dpx} y1={dpy} x2={dpx} y2={PH_PLOT.y + PH_PLOT.h} stroke={lockH ? K.accent : K.inkLight} strokeWidth={lockH ? 1.2 : 0.5} strokeDasharray={lockH ? "none" : "2 2"} />
        <line x1={dpx} y1={dpy} x2={PH_PLOT.x} y2={dpy} stroke={lockP ? K.accent : K.inkLight} strokeWidth={lockP ? 1.2 : 0.5} strokeDasharray={lockP ? "none" : "2 2"} />
      </>}
      {/* State points */}
      {st.map((s, i) => {
        const cx = mapH(s.h), cy = mapP(s.P);
        const off = [{ dx: 8, dy: 14 }, { dx: 8, dy: -10 }, { dx: -14, dy: -10 }, { dx: -14, dy: 14 }];
        const tx = cx + off[i].dx, ty = cy + off[i].dy;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={5} fill={K.card} stroke={K.stateCircle} strokeWidth={1.2} />
            <circle cx={cx} cy={cy} r={1.8} fill={K.stateFill} />
            <rect x={tx - 7} y={ty - 10} width={14} height={13} rx={1} fill={K.card} />
            <text x={tx} y={ty} fill={K.accent} fontSize={12} fontFamily={FD} textAnchor="middle">{s.label}</text>
          </g>
        );
      })}
      {!showAreas && <>
        <circle cx={dpx} cy={dpy} r={9} fill="rgba(192,57,43,0.15)" stroke={K.accent} strokeWidth={2} />
        <circle cx={dpx} cy={dpy} r={4} fill={K.accent} />
        <text x={PH_W - 8} y={PH_PLOT.y + 10} fill={K.inkLight} fontSize={7} fontFamily={FM} textAnchor="end" fontStyle="italic">{lockP ? "P locked" : lockH ? "h locked" : "tap & drag"}</text>
      </>}
      {showAreas && (() => {
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        const lx = PH_PLOT.x + 6, ly = PH_PLOT.y + 4;
        return (
          <>
            <rect x={lx} y={ly} width={160} height={52} rx={2} fill={K.card} stroke={K.border} strokeWidth={0.8} />
            <rect x={lx + 5} y={ly + 5} width={8} height={8} rx={1} fill={`${K.heatIn}30`} stroke={K.heatIn} strokeWidth={0.6} />
            <text x={lx + 17} y={ly + 12} fill={K.heatIn} fontSize={8} fontFamily={FM}>Q_evap (4→1) = {fmt(cycle.qEvap)} kJ/kg</text>
            <rect x={lx + 5} y={ly + 18} width={8} height={8} rx={1} fill={`${K.heatOut}30`} stroke={K.heatOut} strokeWidth={0.6} />
            <text x={lx + 17} y={ly + 25} fill={K.heatOut} fontSize={8} fontFamily={FM}>Q_cond (2→3) = {fmt(cycle.qCond)} kJ/kg</text>
            <rect x={lx + 5} y={ly + 31} width={8} height={8} rx={1} fill={`${K.workIn}40`} stroke={K.workIn} strokeWidth={0.6} />
            <text x={lx + 17} y={ly + 38} fill={K.workIn} fontSize={8} fontFamily={FM}>W_comp (1→2) = {fmt(cycle.wComp)} kJ/kg</text>
            <text x={lx + 5} y={ly + 49} fill={K.ink} fontSize={8} fontFamily={FD} fontWeight="bold">COP = {cycle.copCool.toFixed(2)}</text>
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

function RefComponentModal({ component, cycle, onClose }) {
  const isWide = useIsDesktop();
  if (!component) return null;
  const info = REF_COMPONENT_INFO[component];
  const color = info.color();
  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);

  const liveValues = {
    compressor: { main: `W_comp = ${f(cycle.wComp)} kJ/kg`, detail: `h₂ − h₁ = ${f(cycle.h2)} − ${f(cycle.h1)}` },
    condenser: { main: `Q_cond = ${f(cycle.qCond)} kJ/kg`, detail: `h₂ − h₃ = ${f(cycle.h2)} − ${f(cycle.h3)}` },
    expvalve: { main: `h₃ = h₄ = ${f(cycle.h3)} kJ/kg`, detail: `x₄ = ${cycle.x4.toFixed(4)} (${(cycle.x4 * 100).toFixed(1)}% vapor)` },
    evaporator: { main: `Q_evap = ${f(cycle.qEvap)} kJ/kg`, detail: `h₁ − h₄ = ${f(cycle.h1)} − ${f(cycle.h4)}` },
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
function RefSchematicDiagram({ cycle }) {
  const fmt = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const [activeComponent, setActiveComponent] = useState(null);
  const mk = [
    { id: "rO", c: K.heatIn }, { id: "rB", c: K.heatOut }, { id: "rY", c: K.workIn },
    { id: "rM", c: K.inkMed }, { id: "rK", c: K.ink },
  ];
  return (<>
    <svg viewBox="0 0 360 320" style={{ width: "100%", maxWidth: 420 }}>
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
        <circle cx={68} cy={172} r={28} fill="rgba(255,255,255,0.01)" stroke={K.workIn} strokeWidth={1.5} />
        <path d="M54,185 L68,158 L82,185 Z" fill="none" stroke={K.workIn} strokeWidth={0.8} />
        <text x={68} y={175} fill={K.workIn} fontSize={10} textAnchor="middle" fontFamily={FD}>Compressor</text>
        <text x={68} y={205} fill={K.inkLight} fontSize={6} textAnchor="middle" fontFamily={FM} fontStyle="italic">isentropic</text>
      </g>
      {/* CONDENSER */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("condenser")}>
        <rect x={110} y={32} width={140} height={50} fill="rgba(255,255,255,0.01)" stroke={K.heatOut} strokeWidth={1.5} />
        <path d="M125,63 Q135,53 145,63 Q155,73 165,63 Q175,53 185,63 Q195,73 205,63 Q215,53 225,63 Q235,73 240,66" fill="none" stroke={K.heatOut} strokeWidth={0.7} />
        <text x={180} y={53} fill={K.heatOut} fontSize={11} textAnchor="middle" fontFamily={FD}>Condenser</text>
        <text x={180} y={67} fill={K.inkLight} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic">const. pressure</text>
      </g>
      {/* EXPANSION VALVE */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("expvalve")}>
        <path d="M295,152 L315,172 L295,192 L275,172 Z" fill="rgba(255,255,255,0.01)" stroke={K.inkMed} strokeWidth={1.5} strokeDasharray="4 2" />
        <text x={295} y={170} fill={K.inkMed} fontSize={8} textAnchor="middle" fontFamily={FD}>Exp.</text>
        <text x={295} y={181} fill={K.inkMed} fontSize={8} textAnchor="middle" fontFamily={FD}>Valve</text>
        <text x={295} y={198} fill={K.inkLight} fontSize={6} textAnchor="middle" fontFamily={FM} fontStyle="italic">isenthalpic</text>
      </g>
      {/* EVAPORATOR */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("evaporator")}>
        <rect x={110} y={248} width={140} height={50} fill="rgba(255,255,255,0.01)" stroke={K.heatIn} strokeWidth={1.5} />
        {[130,150,170,190,210,230].map(x => (
          <g key={x}><line x1={x} y1={258} x2={x} y2={288} stroke={K.heatIn} strokeWidth={0.4} /><path d={`M${x-3},258 L${x},254 L${x+3},258`} fill="none" stroke={K.heatIn} strokeWidth={0.4} /></g>
        ))}
        <text x={180} y={272} fill={K.heatIn} fontSize={11} textAnchor="middle" fontFamily={FD}>Evaporator</text>
        <text x={180} y={286} fill={K.inkLight} fontSize={7} textAnchor="middle" fontFamily={FM} fontStyle="italic">const. pressure</text>
      </g>
      {/* Pipes */}
      <polyline points="68,144 68,82 110,57" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#rK)" />
      <polyline points="250,57 295,57 295,152" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#rK)" />
      <polyline points="295,192 295,273 250,273" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#rK)" />
      <polyline points="110,273 68,273 68,200" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#rK)" />
      {/* State markers */}
      {[{ n:"2",x:88,y:76 },{ n:"3",x:265,y:40 },{ n:"4",x:308,y:242 },{ n:"1",x:88,y:252 }].map((p,i) => (
        <g key={i}><circle cx={p.x} cy={p.y} r={11} fill={K.card} stroke={K.stateCircle} strokeWidth={1.2} /><text x={p.x} y={p.y+4} fill={K.accent} fontSize={12} textAnchor="middle" fontFamily={FD}>{p.n}</text></g>
      ))}
      {/* Energy labels */}
      <line x1={180} y1={10} x2={180} y2={30} stroke={K.heatOut} strokeWidth={1.8} markerEnd="url(#rB)" />
      <text x={180} y={8} fill={K.heatOut} fontSize={8} textAnchor="middle" fontFamily={FM}>Q_cond = {fmt(cycle.qCond)} kJ/kg</text>
      <line x1={180} y1={298} x2={180} y2={312} stroke={K.heatIn} strokeWidth={1.8} />
      <path d="M176,302 L180,298 L184,302" fill="none" stroke={K.heatIn} strokeWidth={1.5} />
      <text x={180} y={318} fill={K.heatIn} fontSize={8} textAnchor="middle" fontFamily={FM}>Q_evap = {fmt(cycle.qEvap)} kJ/kg</text>
      <line x1={36} y1={172} x2={18} y2={172} stroke={K.workIn} strokeWidth={1.8} />
      <path d="M40,168 L36,172 L40,176" fill="none" stroke={K.workIn} strokeWidth={1.5} />
      <text x={27} y={160} fill={K.workIn} fontSize={7.5} textAnchor="middle" fontFamily={FM} fontWeight="500">W_comp</text>
      <text x={27} y={188} fill={K.workIn} fontSize={7} textAnchor="middle" fontFamily={FM}>{fmt(cycle.wComp)}</text>
    </svg>
    <RefComponentModal component={activeComponent} cycle={cycle} onClose={() => setActiveComponent(null)} />
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

function RefEquationsModal({ open, onClose, cycle, initialTopic }) {
  const [topic, setTopic] = useState("wc");
  useEffect(() => { if (initialTopic && open) setTopic(initialTopic); }, [initialTopic, open]);
  if (!open) return null;

  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const sel = REF_EQ_TOPICS.find(t => t.id === topic);
  const stepStyle = { background: K.cardAlt, border: `1px solid ${K.border}`, padding: "10px 12px", marginBottom: 8, fontSize: 10.5, lineHeight: 2, fontFamily: FM };
  const numStyle = { color: K.accent, fontWeight: 700 };
  const resultStyle = { background: K.card, border: `2px solid ${sel.color}`, padding: "10px 12px", textAlign: "center", marginTop: 4 };

  function renderContent() {
    switch (topic) {
      case "wc": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>W_comp = h₂ − h₁</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>Isentropic compression from saturated vapor (state 1) to superheated vapor (state 2). This is the sole work input.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 1 — h₁ at evaporator exit (sat. vapor at P_low)</div>
          <div>h₁ = h_g at P_low = <span style={numStyle}>{f(cycle.states[0].P)}</span> kPa</div>
          <div>h₁ = <span style={numStyle}>{f(cycle.h1)}</span> kJ/kg</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 2 — h₂ after isentropic compression to P_high</div>
          <div>s₂ = s₁ = <span style={numStyle}>{f(cycle.s1)}</span> kJ/kg·K (isentropic)</div>
          <div>h₂ = <span style={numStyle}>{f(cycle.h2)}</span> kJ/kg, T₂ = <span style={numStyle}>{f(cycle.T2)}</span>°C</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: 16, fontFamily: FD, color: sel.color }}>W_comp = {f(cycle.h2)} − {f(cycle.h1)} = <strong>{f(cycle.wComp)}</strong> kJ/kg</div>
        </div>
      </>);
      case "qe": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>Q_evap = h₁ − h₄</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>Heat absorbed in the evaporator at constant pressure. This is the useful cooling effect — the "purpose" of refrigeration.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>VALUES</div>
          <div>h₁ = <span style={numStyle}>{f(cycle.h1)}</span> kJ/kg (sat. vapor at evap. exit)</div>
          <div>h₄ = <span style={numStyle}>{f(cycle.h4)}</span> kJ/kg (two-phase at valve exit)</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: 16, fontFamily: FD, color: sel.color }}>Q_evap = {f(cycle.h1)} − {f(cycle.h4)} = <strong>{f(cycle.qEvap)}</strong> kJ/kg</div>
        </div>
      </>);
      case "qc": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>Q_cond = h₂ − h₃</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>Heat rejected in the condenser. Includes desuperheating and condensation at constant pressure.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>VALUES</div>
          <div>h₂ = <span style={numStyle}>{f(cycle.h2)}</span> kJ/kg (superheated at comp. exit)</div>
          <div>h₃ = <span style={numStyle}>{f(cycle.h3)}</span> kJ/kg (sat. liquid at cond. exit)</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>VERIFY — Energy balance</div>
          <div>Q_cond = Q_evap + W_comp = {f(cycle.qEvap)} + {f(cycle.wComp)} = <span style={numStyle}>{f(cycle.qEvap + cycle.wComp)}</span></div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: 16, fontFamily: FD, color: sel.color }}>Q_cond = {f(cycle.h2)} − {f(cycle.h3)} = <strong>{f(cycle.qCond)}</strong> kJ/kg</div>
        </div>
      </>);
      case "copc": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>COP_cooling = Q_evap / W_comp</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>The COP can exceed 1 because we are moving heat, not creating it. A COP of 3 means 3 units of cooling per unit of work.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>CALCULATION</div>
          <div>COP_cool = {f(cycle.qEvap)} / {f(cycle.wComp)}</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: 16, fontFamily: FD, color: sel.color }}>COP_cooling = <strong>{cycle.copCool.toFixed(2)}</strong></div>
        </div>
      </>);
      case "coph": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>COP_heating = Q_cond / W_comp</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>In heat pump mode, the useful output is Q_cond (heat delivered to the warm space). Always equals COP_cooling + 1.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>CALCULATION</div>
          <div>COP_heat = {f(cycle.qCond)} / {f(cycle.wComp)}</div>
          <div style={{ color: K.inkLight, marginTop: 4 }}>Or: COP_heat = COP_cool + 1 = {cycle.copCool.toFixed(2)} + 1 = <span style={numStyle}>{(cycle.copCool + 1).toFixed(2)}</span></div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: 16, fontFamily: FD, color: sel.color }}>COP_heating = <strong>{cycle.copHeat.toFixed(2)}</strong></div>
        </div>
      </>);
      case "x4": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>FORMULA</div>
          <div>x₄ = (h₄ − h_f) / (h_g − h_f) at P_low</div>
          <div style={{ color: K.inkLight, fontSize: 9, marginTop: 4 }}>Unlike the Rankine cycle (where x₄ uses entropy), refrigeration quality is found from enthalpy because the expansion is isenthalpic (h₃ = h₄), NOT isentropic.</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 1 — h₄ from isenthalpic expansion</div>
          <div>h₄ = h₃ = h_f at P_high = <span style={numStyle}>{f(cycle.h3)}</span> kJ/kg</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STEP 2 — Sat. properties at P_low = {f(cycle.states[0].P)} kPa</div>
          <div>h_f = <span style={numStyle}>{cycle.x4 < 1 ? f((cycle.h4 - cycle.x4 * cycle.h1) / (1 - cycle.x4)) : "—"}</span> kJ/kg</div>
          <div>h_g = <span style={numStyle}>{f(cycle.h1)}</span> kJ/kg</div>
        </div>
        <div style={resultStyle}>
          <div style={{ fontSize: 9, color: K.inkLight, marginBottom: 2 }}>RESULT</div>
          <div style={{ fontSize: 16, fontFamily: FD, color: sel.color }}>x₄ = <strong>{cycle.x4.toFixed(4)}</strong> ({(cycle.x4 * 100).toFixed(1)}% vapor)</div>
        </div>
      </>);
      case "states": return (<>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STATE 1 — Saturated Vapor at P_low (Evaporator Exit)</div>
          <div>P₁ = <span style={numStyle}>{f(cycle.states[0].P)}</span> kPa → sat. vapor properties</div>
          <div>T₁ = <span style={numStyle}>{f(cycle.T1)}</span>°C, h₁ = h_g = <span style={numStyle}>{f(cycle.h1)}</span>, s₁ = s_g = <span style={numStyle}>{f(cycle.s1)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STATE 2 — Superheated Vapor at P_high (Compressor Exit)</div>
          <div>Isentropic: s₂ = s₁ = <span style={numStyle}>{f(cycle.s2)}</span> kJ/kg·K</div>
          <div>T₂ = <span style={numStyle}>{f(cycle.T2)}</span>°C, h₂ = <span style={numStyle}>{f(cycle.h2)}</span> kJ/kg</div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STATE 3 — Saturated Liquid at P_high (Condenser Exit)</div>
          <div>P₃ = <span style={numStyle}>{f(cycle.states[2].P)}</span> kPa → sat. liquid properties</div>
          <div>T₃ = <span style={numStyle}>{f(cycle.T3)}</span>°C, h₃ = h_f = <span style={numStyle}>{f(cycle.h3)}</span>, s₃ = s_f = <span style={numStyle}>{f(cycle.s3)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={{ color: K.inkLight, fontSize: 9, marginBottom: 4 }}>STATE 4 — Two-Phase Mixture at P_low (Valve Exit)</div>
          <div>Isenthalpic: h₄ = h₃ = <span style={numStyle}>{f(cycle.h4)}</span> kJ/kg</div>
          <div>x₄ = <span style={numStyle}>{cycle.x4.toFixed(4)}</span>, T₄ = <span style={numStyle}>{f(cycle.T4)}</span>°C, s₄ = <span style={numStyle}>{f(cycle.s4)}</span></div>
        </div>
      </>);
      default: return null;
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: K.card, border: `1.5px solid ${K.border}`, maxWidth: 420, width: "100%", padding: "20px 16px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontFamily: FD, color: K.ink }}>Solve: <span style={{ color: sel.color }}>{sel.title}</span></h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: 11, cursor: "pointer", padding: "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 14 }}>
          {REF_EQ_TOPICS.map(t => (
            <button key={t.id} onClick={() => setTopic(t.id)} style={{
              padding: "4px 10px", fontSize: 9, fontFamily: FM,
              background: topic === t.id ? t.color : K.cardAlt,
              color: topic === t.id ? "#fff" : K.inkMed,
              border: `1px solid ${topic === t.id ? t.color : K.border}`,
              cursor: "pointer", borderRadius: 3, fontWeight: topic === t.id ? 700 : 400,
              transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>
        {renderContent()}
        <button onClick={onClose} style={{ width: "100%", padding: "10px", background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: FD, cursor: "pointer", marginTop: 12 }}>Close</button>
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
function RefStateTable({ cycle, refData, onSelectState }) {
  const fmt = v => Math.abs(v) < 10 ? v.toFixed(3) : Math.abs(v) < 100 ? v.toFixed(2) : v.toFixed(1);
  const descs = ["Sat. Vapor", "Superheated", "Sat. Liquid", "Two-Phase"];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FM, fontSize: 10 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${K.ink}` }}>
            {["State","Desc","T (°C)","P (kPa)","h (kJ/kg)","s (kJ/kg·K)","x"].map(h => (
              <th key={h} style={{ padding: "6px 3px", color: K.inkMed, fontWeight: 400, textAlign: "center", fontSize: 9, fontStyle: "italic" }}>{h}</th>
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
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.accent, fontFamily: FD, fontSize: 13 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  {s.label}
                  <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.4 }}><circle cx="4" cy="4" r="3" fill="none" stroke={K.accent} strokeWidth="1"/><circle cx="4" cy="4" r="1" fill={K.accent}/></svg>
                </span>
              </td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.inkLight, fontSize: 8 }}>{descs[i]}</td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.ink }}>{fmt(s.T)}</td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.ink }}>{fmt(s.P)}</td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.ink }}>{fmt(s.h)}</td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.ink }}>{fmt(s.s)}</td>
              <td style={{ padding: "6px 3px", textAlign: "center", color: K.inkMed, fontSize: 9 }}>
                {i === 0 ? "1 (sat.v)" : i === 1 ? "— (sup.)" : i === 2 ? "0 (sat.l)" : cycle.x4.toFixed(3)}
              </td>
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

  const [refIdx, setRefIdx] = useState(0);
  const refData = REFRIGERANTS[refIdx];
  const defaults = useMemo(() => getDefaultPressures(refData), [refData]);

  const [pHigh, setPHigh] = useState(() => getDefaultPressures(REFRIGERANTS[0]).pHigh);
  const [pLow, setPLow] = useState(() => getDefaultPressures(REFRIGERANTS[0]).pLow);
  const [showInfo, setShowInfo] = useState(false);
  const [showEqs, setShowEqs] = useState(false);
  const [eqTopic, setEqTopic] = useState(null);
  const [showRefInfo, setShowRefInfo] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return !localStorage.getItem("tourSeen_refrigeration"); } catch { return false; }
  });
  const [showTsAreas, setShowTsAreas] = useState(false);
  const [showPhAreas, setShowPhAreas] = useState(false);
  const [lineDragInfo, setLineDragInfo] = useState(null);

  const table = refData.table;
  const pMin = Math.round(table[0].P);
  const pMax = Math.round(table[table.length - 2].P);

  // Clamp pressures on refrigerant change
  useEffect(() => {
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

  const desktop = useIsDesktop();
  const gap = desktop ? 16 : 12;
  const card = { margin: `${gap}px ${gap}px 0`, padding: desktop ? "18px" : "14px", background: K.card, border: `1px solid ${K.border}` };
  const sec = { margin: "0 0 10px 0", fontSize: sz(desktop ? 14 : 12), fontFamily: FD, color: K.ink, borderBottom: `1px solid ${K.border}`, paddingBottom: 6 };

  // Sync drag from T-s
  const handleTsDrag = useCallback((pt) => {
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
    setDragPoint({ s: pt.s, T: pt.T, h: pt.h, P: pt.P });
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.ink, fontFamily: FM, maxWidth: desktop ? 1100 : 480, margin: "0 auto" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;
          background:${K.accent};border:2px solid ${K.card};cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15);
        }
        input[type="range"]::-moz-range-thumb { width:16px;height:16px;border-radius:50%;background:${K.accent};border:2px solid ${K.card};cursor:pointer; }
        *{box-sizing:border-box}body{margin:0;background:${K.bg}}
        svg text{transform-box:fill-box;transform-origin:0% 50%;transform:scale(${textScale})}
        svg text[text-anchor="middle"]{transform-origin:50% 50%}
        svg text[text-anchor="end"]{transform-origin:100% 50%}
      `}</style>

      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: `2px solid ${K.ink}`, background: K.card }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {onBack && <button onClick={onBack} style={{ background: "none", border: `1px solid ${K.border}`, padding: "5px 10px", color: K.inkMed, fontSize: 10, cursor: "pointer", fontFamily: FM }}>← Back</button>}
            <div>
              <div style={{ fontSize: sz(8), color: K.inkLight, fontFamily: FM, letterSpacing: 3, marginBottom: 1, textTransform: "uppercase" }}>Thermodynamics</div>
              <h1 style={{ margin: 0, fontSize: sz(20), fontFamily: FD, color: K.ink, lineHeight: 1.1 }}>
                Refrigeration <span style={{ color: K.heatOut, fontStyle: "italic" }}>Studio</span>
              </h1>
              <div style={{ fontSize: sz(8), color: K.inkLight, fontFamily: FM, letterSpacing: 2, marginTop: 2 }}>Vapor-Compression Cycle Analysis</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button data-tour="ref-theory" onClick={() => setShowInfo(true)} style={{ background: K.accent, border: "none", padding: "7px 14px", color: "#fff", fontSize: sz(11), cursor: "pointer", fontFamily: FD }}>Theory</button>
            <button data-tour="ref-refrigerants" onClick={() => setShowRefInfo(true)} style={{ background: K.heatOut, border: "none", padding: "7px 14px", color: "#fff", fontSize: sz(11), cursor: "pointer", fontFamily: FD }}>Refrigerants</button>
            <button onClick={() => setShowTour(true)} style={{ background: "none", border: `1px solid ${K.border}`, padding: "7px 14px", color: K.inkMed, fontSize: sz(11), cursor: "pointer", fontFamily: FD }}>Instructions</button>
          </div>
        </div>
        {/* Refrigerant selector */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {REFRIGERANTS.map((r, i) => (
            <button key={r.id} onClick={() => setRefIdx(i)} style={{
              padding: "4px 10px", fontSize: sz(9), fontFamily: FM,
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
      <WelcomePopup open={showWelcome} K={K} textScale={textScale} onScaleChange={handleScaleChange} onStart={() => { setShowWelcome(false); localStorage.setItem("tourSeen_refrigeration", "1"); setShowTour(true); }} onDismiss={() => { setShowWelcome(false); localStorage.setItem("tourSeen_refrigeration", "1"); }} />
      <GuidedTour steps={REF_TOUR_STEPS} isOpen={showTour} onClose={() => setShowTour(false)} K={K} textScale={textScale} onScaleChange={handleScaleChange} />

      {/* Performance bar */}
      <div style={{ margin: `${gap}px ${gap}px 0`, padding: "12px", background: K.card, border: `1px solid ${K.border}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { l: "COP cooling", v: cycle.copCool.toFixed(2), c: K.accent },
          { l: "COP heating", v: cycle.copHeat.toFixed(2), c: K.heatOut },
          { l: "W comp", v: fmt(cycle.wComp), c: K.workIn, s: "kJ/kg" },
        ].map((m, i) => (
          <div key={i} style={{ textAlign: "center", padding: "4px 0" }}>
            <div style={{ fontSize: sz(8), color: K.inkLight, fontFamily: FM, letterSpacing: 1, marginBottom: 3, textTransform: "uppercase", fontStyle: "italic" }}>{m.l}</div>
            <div style={{ fontSize: sz(desktop ? 24 : 20), fontFamily: FD, color: m.c, lineHeight: 1.2 }}>{m.v}</div>
            {m.s && <div style={{ fontSize: sz(8), color: K.inkLight, fontFamily: FM }}>{m.s}</div>}
          </div>
        ))}
      </div>

      {/* Row: Schematic + Phase Visualizer */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>System Schematic <span style={{ fontFamily: FM, fontSize: 9, color: K.inkLight, fontStyle: "italic" }}>— {refData.name}</span></h3>
          <div data-tour="ref-schematic"><RefSchematicDiagram cycle={cycle} /></div>
        </div>
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>Phase Visualizer <span style={{ fontFamily: FM, fontSize: 9, color: K.inkLight, fontStyle: "italic" }}>— drag a point on the diagrams</span></h3>
          <RefParticleVisualizer phaseInfo={phaseInfo} temperature={dragPoint.T} criticalT={refData.criticalT} />
        </div>
      </div>

      {/* Row: T-s + P-h Diagrams */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        {/* T-s Diagram */}
        <div data-tour="ref-ts-diagram" style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...sec, marginBottom: 8 }}>
            <span>T–s Diagram <span style={{ fontFamily: FM, fontSize: 9, color: K.inkLight, fontStyle: "italic" }}>— interactive</span></span>
            <div style={{ display: "flex", gap: 6 }}>
              <button data-tour="ref-cop-areas" onClick={() => setShowTsAreas(a => !a)} style={{
                background: showTsAreas ? K.workIn : "none", border: `1px solid ${showTsAreas ? K.workIn : K.border}`, padding: "3px 8px",
                color: showTsAreas ? "#fff" : K.inkMed, fontSize: sz(9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>COP areas</button>
              <button data-tour="ref-fx" onClick={() => setShowEqs(true)} style={{
                background: "none", border: `1px solid ${K.border}`, padding: "3px 8px",
                color: K.inkMed, fontSize: sz(9), fontFamily: FM, cursor: "pointer", borderRadius: 4,
              }}>f(x)</button>
            </div>
          </div>
          <div data-tour="ref-lock-buttons" style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => { setLockS(l => !l); if (!lockS) { setLockT(false); setLockP(false); setLockH(false); } }}
              style={{ flex: 1, padding: "5px 0", fontSize: sz(9), fontFamily: FM, background: lockS ? K.accent : K.cardAlt, color: lockS ? "#fff" : K.inkMed, border: `1px solid ${lockS ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockS ? 700 : 400, transition: "all 0.15s" }}>
              {lockS ? "\u{1F512}" : "\u{1F513}"} Lock s = {dragPoint.s.toFixed(2)}
            </button>
            <button onClick={() => { setLockT(l => !l); if (!lockT) { setLockS(false); setLockP(false); setLockH(false); } }}
              style={{ flex: 1, padding: "5px 0", fontSize: sz(9), fontFamily: FM, background: lockT ? K.accent : K.cardAlt, color: lockT ? "#fff" : K.inkMed, border: `1px solid ${lockT ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockT ? 700 : 400, transition: "all 0.15s" }}>
              {lockT ? "\u{1F512}" : "\u{1F513}"} Lock T = {dragPoint.T.toFixed(0)}°C
            </button>
          </div>
          <RefTsDiagram cycle={cycle} refData={refData} dragPoint={dragPoint} onDrag={handleTsDrag} lockS={lockS} lockT={lockT} showAreas={showTsAreas}
            onPHighChange={setPHigh} onPLowChange={setPLow}
            lineDragInfo={lineDragInfo} onLineDragStart={(which) => setLineDragInfo({ which })} onLineDragMove={(which) => setLineDragInfo({ which })} onLineDragEnd={() => setLineDragInfo(null)} />
        </div>

        {/* P-h Diagram */}
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...sec, marginBottom: 8 }}>
            <span>P–h Diagram <span style={{ fontFamily: FM, fontSize: 9, color: K.inkLight, fontStyle: "italic" }}>— interactive</span></span>
            <button data-tour="ref-energy-areas" onClick={() => setShowPhAreas(a => !a)} style={{
              background: showPhAreas ? K.workIn : "none", border: `1px solid ${showPhAreas ? K.workIn : K.border}`, padding: "3px 8px",
              color: showPhAreas ? "#fff" : K.inkMed, fontSize: sz(9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
            }}>Energy areas</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => { setLockP(l => !l); if (!lockP) { setLockH(false); setLockS(false); setLockT(false); } }}
              style={{ flex: 1, padding: "5px 0", fontSize: sz(9), fontFamily: FM, background: lockP ? K.accent : K.cardAlt, color: lockP ? "#fff" : K.inkMed, border: `1px solid ${lockP ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockP ? 700 : 400, transition: "all 0.15s" }}>
              {lockP ? "\u{1F512}" : "\u{1F513}"} Lock P = {(dragPoint.P || effectivePLow).toFixed(0)} kPa
            </button>
            <button onClick={() => { setLockH(l => !l); if (!lockH) { setLockP(false); setLockS(false); setLockT(false); } }}
              style={{ flex: 1, padding: "5px 0", fontSize: sz(9), fontFamily: FM, background: lockH ? K.accent : K.cardAlt, color: lockH ? "#fff" : K.inkMed, border: `1px solid ${lockH ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockH ? 700 : 400, transition: "all 0.15s" }}>
              {lockH ? "\u{1F512}" : "\u{1F513}"} Lock h = {(dragPoint.h || cycle.h1).toFixed(0)} kJ/kg
            </button>
          </div>
          <RefPhDiagram cycle={cycle} refData={refData} dragPoint={dragPoint} onDrag={handlePhDrag} lockP={lockP} lockH={lockH} showAreas={showPhAreas}
            onPHighChange={setPHigh} onPLowChange={setPLow}
            lineDragInfo={lineDragInfo} onLineDragStart={(which) => setLineDragInfo({ which })} onLineDragMove={(which) => setLineDragInfo({ which })} onLineDragEnd={() => setLineDragInfo(null)} />
        </div>
      </div>
      <RefEquationsModal open={showEqs} onClose={() => { setShowEqs(false); setEqTopic(null); }} cycle={cycle} initialTopic={eqTopic} />

      {/* Row: Sliders + Table */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : { ...card, padding: "16px" }}>
          <h3 style={sec}>Cycle Parameters</h3>
          <ParamSlider label="Condenser Pressure (P high)" unit="kPa" color={K.heatOut} value={effectivePHigh} min={Math.round(pMin + (pMax - pMin) * 0.2)} max={pMax} step={Math.max(1, Math.round((pMax - pMin) / 100))} onChange={setPHigh} />
          <ParamSlider label="Evaporator Pressure (P low)" unit="kPa" color={K.heatIn} value={effectivePLow} min={pMin} max={Math.round(pMin + (pMax - pMin) * 0.6)} step={Math.max(1, Math.round((pMax - pMin) / 100))} onChange={setPLow} />
          <div style={{ marginTop: 6, fontSize: sz(9), color: K.inkLight, borderTop: `1px solid ${K.gridFine}`, paddingTop: 6, fontStyle: "italic" }}>
            T_evap = {cycle.Tsat_low.toFixed(1)}°C &nbsp;|&nbsp; T_cond = {cycle.Tsat_high.toFixed(1)}°C &nbsp;|&nbsp; x₄ = {cycle.x4.toFixed(3)}
          </div>
        </div>
        <div style={desktop ? { padding: "18px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>State Point Properties <span style={{ fontFamily: FM, fontSize: sz(9), color: K.inkLight, fontStyle: "italic" }}>— Table 1</span></h3>
          <RefStateTable cycle={cycle} refData={refData} onSelectState={setDragPoint} />
        </div>
      </div>

      {/* Energy Balance */}
      <div data-tour="ref-energy-balance" style={{ ...card, marginBottom: 0 }}>
        <h3 style={sec}>Energy Balance</h3>
        <div style={{ display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: desktop ? 16 : 8 }}>
          {/* Heat Transfer group */}
          <div>
            <div style={{ fontSize: sz(desktop ? 15 : 9), fontFamily: FM, color: K.inkLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${K.border}`, textAlign: "center" }}>Heat Transfer</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { l: "Q evap (Cooling)", v: fmt(cycle.qEvap), u: "kJ/kg", c: K.heatIn, topic: "qe" },
                { l: "Q cond (Rejected)", v: fmt(cycle.qCond), u: "kJ/kg", c: K.heatOut, topic: "qc" },
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
                <div style={{ fontSize: sz(desktop ? 35 : 16), fontFamily: FD, color: K.workIn }}>{fmt(cycle.wComp)}</div>
                <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM, marginTop: 2 }}>kJ/kg</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: desktop ? 15 : 8, display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: 8 }}>
          <div style={{ padding: desktop ? "14px 18px" : "8px 10px", background: K.cardAlt, border: `1px solid ${K.border}`, textAlign: "center" }}>
            <div style={{ fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontStyle: "italic", marginBottom: 2 }}>Verify: Q_evap + W_comp</div>
            <div style={{ fontSize: sz(desktop ? 25 : 12), fontFamily: FD, color: K.accent }}>= {fmt(cycle.qEvap + cycle.wComp)} kJ/kg</div>
          </div>
          <div style={{ padding: desktop ? "14px 18px" : "8px 10px", background: K.cardAlt, border: `1px solid ${K.border}`, textAlign: "center" }}>
            <div style={{ fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontStyle: "italic", marginBottom: 2 }}>Q_cond (should match)</div>
            <div style={{ fontSize: sz(desktop ? 25 : 12), fontFamily: FD, color: K.heatOut }}>= {fmt(cycle.qCond)} kJ/kg</div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", padding: desktop ? "20px 12px 12px" : "14px 12px 8px" }}>
        <button data-tour="ref-dark-mode" onClick={toggleDarkMode} style={{
          background: darkMode ? "#30363d" : "#f5f4f0", border: `1px solid ${K.border}`, padding: desktop ? "8px 20px" : "6px 14px",
          color: K.inkMed, fontSize: sz(desktop ? 13 : 10), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.2s",
        }}>{darkMode ? "\u2600 Light Mode" : "\u263E Dark Mode"}</button>
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
