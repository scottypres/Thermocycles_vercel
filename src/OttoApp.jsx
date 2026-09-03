import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { K_LIGHT, K_DARK, FD, FM, lerp, ParamSlider, useIsDesktop, SettingsModal, loadUnits, saveUnits, loadAnimSpeed, saveAnimSpeed, fmtT, fmtP, fmtS, cvtT, cvtP, cvtH, cvtS, lblT, lblP, lblH, lblS } from "./shared.jsx";
import { GuidedTour, WelcomePopup, OTTO_TOUR_STEPS } from "./GuidedTour.jsx";
import { GASES } from "./BraytonApp.jsx";
let K = K_LIGHT;

/* ───────── Ideal-gas helpers (constant c_p / c_v — "cold-air standard" for air) ─────────
   The Otto cycle is a closed piston-cylinder system, so energies are internal energy u = c_v·T
   and work is boundary work ∫P dv. Entropy is referenced at 300 K, 100 kPa like the Brayton page. */
const T_REF_K = 300, P_REF = 100;
const K2C = 273.15;
const cvOf = g => g.cp - g.R;
const sOf = (g, TK, P) => g.sRef + g.cp * Math.log(TK / T_REF_K) - g.R * Math.log(P / P_REF);
const pOf = (g, TK, s) => P_REF * Math.exp((g.sRef + g.cp * Math.log(TK / T_REF_K) - s) / g.R);
const vOf = (g, TK, P) => g.R * TK / P;
const uOf = (g, TK) => cvOf(g) * TK;
/* Specific volume on the isochore family: s = sRef + c_v ln(T/300) + R ln(v/v_ref) */
const vFromST = (g, TK, s) => (g.R * T_REF_K / P_REF) * Math.exp((s - g.sRef - cvOf(g) * Math.log(TK / T_REF_K)) / g.R);
function propsST(g, s, Tc) { const TK = Math.max(1, Tc + K2C); const P = pOf(g, TK, s); return { s, T: Tc, P, v: vOf(g, TK, P), u: uOf(g, TK) }; }
function propsPV(g, P, v) { const TK = Math.max(1, P * v / g.R); return { s: sOf(g, TK, P), T: TK - K2C, P, v, u: uOf(g, TK) }; }

const R_MIN = 4, R_MAX = 14, P1_MIN = 50, P1_MAX = 200, T1_MIN = -20, T1_MAX = 60, T3_MAX = 2200;
const clampR = r => Math.max(R_MIN, Math.min(R_MAX, Math.round(r * 2) / 2));
const clampP1 = p => Math.max(P1_MIN, Math.min(P1_MAX, Math.round(p / 5) * 5));

function calculateOtto(gas, r, p1, t1c, t3c) {
  const cv = cvOf(gas), km1 = gas.k - 1;
  const T1 = t1c + K2C, P1 = p1, v1 = vOf(gas, T1, P1);
  const v2 = v1 / r, T2 = T1 * Math.pow(r, km1), P2 = P1 * Math.pow(r, gas.k);
  const T3 = t3c + K2C, P3 = P2 * T3 / T2, v3 = v2;
  const T4 = T3 / Math.pow(r, km1), P4 = P3 / Math.pow(r, gas.k), v4 = v1;
  const mk = (label, TK, P, v, desc) => ({ label, T: TK - K2C, P, v, s: sOf(gas, TK, P), u: uOf(gas, TK), desc });
  const states = [mk("1", T1, P1, v1, "BDC · Compression Start"), mk("2", T2, P2, v2, "TDC · Compression End"), mk("3", T3, P3, v3, "TDC · Peak (Combustion)"), mk("4", T4, P4, v4, "BDC · Expansion End")];
  const [s1, s2, s3, s4] = states.map(s => s.s);
  const [u1, u2, u3, u4] = states.map(s => s.u);
  const wComp = u2 - u1, wExp = u3 - u4, qIn = u3 - u2, qOut = u4 - u1;
  const wNet = wExp - wComp, eta = wNet / qIn, mep = wNet / (v1 - v2);
  const N = 24;
  // Isochores on T–s: T = T₀·exp((s − s₀)/c_v)
  const combPath = Array.from({ length: N + 1 }, (_, i) => { const s = lerp(i / N, 0, 1, s2, s3); return { s, T: T2 * Math.exp((s - s2) / cv) - K2C }; });
  const rejPath = Array.from({ length: N + 1 }, (_, i) => { const s = lerp(i / N, 0, 1, s4, s1); return { s, T: T4 * Math.exp((s - s4) / cv) - K2C }; });
  // Isentropes on P–v: P·v^k = const
  const iso = (Pa, va, vb) => Array.from({ length: N + 1 }, (_, i) => { const v = lerp(i / N, 0, 1, va, vb); return { v, P: Pa * Math.pow(va / v, gas.k) }; });
  const compPvPath = iso(P1, v1, v2);
  const expPvPath = iso(P3, v3, v4);
  return {
    gas, states, r, p1, p2: P2, p3: P3, p4: P4, wComp, wExp, qIn, qOut, wNet, eta, mep,
    vMin: v2, vMax: v1,
    tsMin: -100, tsMax: Math.ceil((t3c + 120) / 100) * 100,
    // s padding scales with the cycle's entropy spread so the loop fills the plot for every gas
    ...(() => { const sp = s3 - s1, pad = Math.max(0.04, 0.15 * sp), q = sp < 0.5 ? 100 : 10;
      return { sAxisMin: Math.floor((s1 - pad) * q) / q, sAxisMax: Math.ceil((s3 + pad * 1.25) * q) / q }; })(),
    u1, u2, u3, u4, s1, s2, s3, s4, T1: t1c, T2: T2 - K2C, T3: t3c, T4: T4 - K2C, v1, v2,
    combPath, rejPath, compPvPath, expPvPath,
  };
}

function niceStep(range, maxTicks) {
  const c = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return c.find(s => range / s <= maxTicks) || c[c.length - 1];
}
function logTicks(lo, hi) { // 1-2-5 sequence per decade, thinned so labels never crowd
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) { const t = m * Math.pow(10, e); if (t >= lo && t <= hi) out.push(t); }
  return out.length > 8 ? out.filter((_, i) => i % 2 === 0) : out;
}
function ticks(min, max, step) { const out = []; for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(+t.toFixed(6)); return out; }
const walkPath = (pts, frac, kx, ky) => {
  if (!pts || pts.length === 0) return null;
  if (pts.length === 1) return pts[0];
  const lens = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const len = Math.hypot(b[kx] - a[kx], b[ky] - a[ky]); lens.push(len); total += len; }
  if (total === 0) return pts[0];
  let target = frac * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const a = pts[i], b = pts[i + 1]; const f = lens[i] === 0 ? 0 : Math.min(1, target / lens[i]);
      return { [kx]: a[kx] + (b[kx] - a[kx]) * f, [ky]: a[ky] + (b[ky] - a[ky]) * f };
    }
    target -= lens[i];
  }
  return pts[pts.length - 1];
};

/* ───────── Specific-Volume Box Visualizer ─────────
   The charge trapped in the cylinder: a fixed mass in a box whose size tracks specific
   volume between v₂ (TDC) and v₁ (BDC). Particle speed and colour track temperature. */
const NUM_PARTICLES = 320;
const W_CANVAS = 680, H_CANVAS = 480;
const BOX_PAD = 6; // px of clearance between the readout overlay and the smallest box

function VolumeBoxVisualizer({ T, P, v, vMin, vMax, tLow, tHigh, fillHeight, textScale, units, smooth }) {
  const ts = textScale || 1;
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const overlayRef = useRef(null);
  const particlesRef = useRef(null);
  const animRef = useRef(null);
  const [fracMin, setFracMin] = useState(0.4);
  useEffect(() => {
    const measure = () => {
      const f = frameRef.current?.getBoundingClientRect(), o = overlayRef.current?.getBoundingClientRect();
      if (!f || !o || !f.width || !f.height) return;
      const m = Math.min(0.95, Math.max((o.width + 2 * BOX_PAD) / f.width, (o.height + 2 * BOX_PAD) / f.height));
      setFracMin(prev => Math.abs(prev - m) > 0.003 ? m : prev);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frameRef.current) ro.observe(frameRef.current);
    if (overlayRef.current) ro.observe(overlayRef.current);
    return () => ro.disconnect();
  }, [fillHeight, ts, u.T, u.P]);
  const span = Math.log(Math.max(1e-9, vMax) / Math.max(1e-9, vMin));
  const t = span > 1e-9 ? Math.max(0, Math.min(1, Math.log(Math.max(1e-9, v) / Math.max(1e-9, vMin)) / span)) : 1;
  const frac = fracMin + (1 - fracMin) * t;
  const cw = Math.round(W_CANVAS * frac), ch = Math.round(H_CANVAS * frac);
  const TK = Math.max(1, T + K2C);
  const tNorm = Math.max(0, Math.min(1, (T - tLow) / Math.max(1, tHigh - tLow)));
  const speedF = 0.4 + 7 * Math.pow(Math.min(1, TK / 2400), 0.75);

  if (!particlesRef.current) {
    particlesRef.current = Array.from({ length: NUM_PARTICLES }, (_, i) => ({
      u: Math.random(), w: Math.random(),
      vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4,
      r: 4.5 + Math.random() * 2.5, id: i,
    }));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d");
    const cr = Math.round(60 + tNorm * 170), cg = Math.round(120 - tNorm * 30), cb = Math.round(200 - tNorm * 160);
    const glowR = Math.round(90 + tNorm * 150), glowB = Math.round(220 - tNorm * 180);
    const maxV = speedF * 4;
    function draw() {
      ctx.clearRect(0, 0, cw, ch);
      const particles = particlesRef.current;
      for (const p of particles) {
        p.vx += (Math.random() - 0.5) * speedF;
        p.vy += (Math.random() - 0.5) * speedF;
        p.vx *= 0.96; p.vy *= 0.96;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > maxV) { p.vx = (p.vx / sp) * maxV; p.vy = (p.vy / sp) * maxV; }
        let x = p.u * cw + p.vx, y = p.w * ch + p.vy;
        if (x < p.r) { x = p.r; p.vx = Math.abs(p.vx); }
        if (x > cw - p.r) { x = cw - p.r; p.vx = -Math.abs(p.vx); }
        if (y < p.r) { y = p.r; p.vy = Math.abs(p.vy); }
        if (y > ch - p.r) { y = ch - p.r; p.vy = -Math.abs(p.vy); }
        p.u = x / cw; p.w = y / ch;
        ctx.beginPath(); ctx.arc(x, y, p.r * (0.7 + tNorm * 0.2), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.72)`; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, p.r + 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${glowR},80,${glowB},0.1)`; ctx.fill();
      }
      animRef.current = requestAnimationFrame(draw);
    }
    draw();
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [cw, ch, tNorm, speedF]);

  const overlayBg = K.bg === "#0d1117" ? "rgba(13,17,23,0.88)" : "rgba(255,255,255,0.88)";
  const rows = [
    { l: "SPECIFIC VOLUME (v)", v: `${v.toFixed(3)} m³/kg`, c: K.accent },
    { l: "TEMPERATURE (T)", v: fmtT(T, u, 0), c: K.heatIn },
    { l: "PRESSURE (P)", v: fmtP(P, u), c: K.heatOut },
  ];
  return (
    <div style={{ position: "relative", ...(fillHeight ? { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 } : {}) }}>
      <div ref={frameRef} style={fillHeight ? { flex: 1, minHeight: 0, position: "relative" } : { width: "100%", aspectRatio: `${W_CANVAS} / ${H_CANVAS}`, position: "relative" }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: `${frac * 100}%`, height: `${frac * 100}%`,
          border: `1.5px solid ${K.ink}`, background: K.cardAlt, boxSizing: "border-box", transition: smooth ? "width 0.12s linear, height 0.12s linear" : "none" }}>
          <canvas ref={canvasRef} width={cw} height={ch} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div ref={overlayRef} style={{ background: overlayBg, padding: fillHeight ? `${12 * ts}px ${26 * ts}px` : `${6 * ts}px ${14 * ts}px`, border: `1.5px solid ${K.ink}`, textAlign: "center" }}>
            {rows.map((r, i) => (
              <div key={i} style={{ marginTop: i === 0 ? 0 : (fillHeight ? 8 : 4) * ts }}>
                <div style={{ fontSize: (fillHeight ? 26 : 15) * ts, fontFamily: FD, color: r.c, lineHeight: 1.1 }}>{r.v}</div>
                <div style={{ fontSize: (fillHeight ? 10 : 7) * ts, fontFamily: FM, color: K.inkMed, letterSpacing: fillHeight ? 1.4 : 1, marginTop: 1 }}>{r.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 6, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 10, height: 8, border: `1.5px solid ${K.ink}` }} />
          <span style={{ fontSize: (fillHeight ? 18 : 10) * ts, fontFamily: FM, color: K.inkLight }}>Box size ∝ v (v₂ → v₁)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: `linear-gradient(90deg, ${K.liquidBlue}, ${K.vaporRed})` }} />
          <span style={{ fontSize: (fillHeight ? 18 : 10) * ts, fontFamily: FM, color: K.inkLight }}>Speed & colour ∝ T</span>
        </div>
      </div>
    </div>
  );
}

/* ───────── T-s Diagram ───────── */
const TS_W = 360, TS_H = 285;
const TS_PAD = { l: 38, r: 6, t: 14, b: 28 };
const TS_PLOT = { x: TS_PAD.l, y: TS_PAD.t, w: TS_W - TS_PAD.l - TS_PAD.r, h: TS_H - TS_PAD.t - TS_PAD.b };

function OttoTsDiagram({ cycle, dragPoint, onDrag, lockS, lockT, showAreas, onRChange, onP1Change, lineDragInfo, onLineDragStart, onLineDragMove, onLineDragEnd, textScale, units }) {
  const sz = px => px * (textScale || 1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const lineDragRef = useRef(null);
  const [activeArea, setActiveArea] = useState("qIn");

  const sMin = cycle.sAxisMin, sMax = cycle.sAxisMax;
  const tMin = cycle.tsMin, tMax = cycle.tsMax;
  const mapS = s => TS_PLOT.x + ((s - sMin) / (sMax - sMin)) * TS_PLOT.w;
  const mapT = T => TS_PLOT.y + TS_PLOT.h - ((T - tMin) / (tMax - tMin)) * TS_PLOT.h;
  const unmapS = px => sMin + ((px - TS_PLOT.x) / TS_PLOT.w) * (sMax - sMin);
  const unmapT = py => tMin + ((TS_PLOT.y + TS_PLOT.h - py) / TS_PLOT.h) * (tMax - tMin);

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

  const getSvgPoint = useCallback((e) => {
    const r = getSvgXY(e);
    if (!r) return null;
    const s = lockS ? dragPoint.s : unmapS(r.px);
    const T = lockT ? dragPoint.T : Math.max(tMin + 5, unmapT(r.py));
    return propsST(cycle.gas, s, T); // only this diagram's window clamps the point; the other diagram just keeps its value box on-screen
  }, [getSvgXY, lockS, lockT, dragPoint, sMin, sMax, tMin, tMax, cycle.gas]); // eslint-disable-line react-hooks/exhaustive-deps

  const st = cycle.states;
  const cv = cvOf(cycle.gas);
  const combMidS = (st[1].s + st[2].s) / 2;
  const combMidT = (st[1].T + K2C) * Math.exp((combMidS - st[1].s) / cv) - K2C;
  const combShort = Math.abs(mapS(st[2].s) - mapS(st[1].s)) < sz(64); // 2→3 shorter than the label: lift it above the state digits
  const combTextX = mapS(combMidS), combTextY = mapT(combMidT) - (combShort ? 22 : 9);
  const compLeft = mapS(st[0].s) - sz(62) >= TS_PLOT.x; // room for the Compression label left of the 1→2 line?
  const expLeft = mapS(st[2].s) + sz(52) > TS_W; // no room right of the 3→4 line (CO₂ at high r): put the Expansion label inside the loop
  const rejShort = Math.abs(mapS(st[3].s) - mapS(st[0].s)) < sz(80); // 4→1 shorter than the label (argon at r = 14): centre it and drop it below the state digits
  const rejMidS = st[0].s + (rejShort ? 0.5 : 0.65) * (st[3].s - st[0].s); // otherwise biased toward state 4 so it clears the state-1 value box
  const rejMidT = (st[3].T + K2C) * Math.exp((rejMidS - st[3].s) / cv) - K2C;
  const rejTextX = mapS(rejMidS), rejTextY = mapT(rejMidT) + (rejShort ? 24 : 13);
  const hintClear = !(mapS(st[2].s) + sz(17) > TS_W - sz(62) && mapT(st[2].T) - sz(8) < TS_PLOT.y + sz(32)); // state 3 in the top-right corner (low r, hot intake) would sit on the "tap & drag" hint

  const handleStart = useCallback((e) => {
    if (e.touches && e.touches.length === 0) return;
    if (e.preventDefault) e.preventDefault();
    const r = getSvgXY(e);
    if (r) {
      if (Math.abs(r.px - combTextX) < 30 && Math.abs(r.py - combTextY) < 10) {
        lineDragRef.current = "combustion";
        if (onLineDragStart) onLineDragStart("combustion");
        return;
      }
      if (Math.abs(r.px - rejTextX) < 40 && Math.abs(r.py - rejTextY) < 10) {
        lineDragRef.current = "rejection";
        if (onLineDragStart) onLineDragStart("rejection");
        return;
      }
    }
    draggingRef.current = true;
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, combTextX, combTextY, rejTextX, rejTextY, onLineDragStart]);

  const handleMove = useCallback((e) => {
    if (lineDragRef.current) {
      e.preventDefault();
      const r = getSvgXY(e);
      if (!r) return;
      const TK = Math.max(150, unmapT(r.py) + K2C);
      if (lineDragRef.current === "combustion") {
        // Moving the 2→3 isochore up means a smaller v₂ at the same entropy, i.e. a larger compression ratio
        const v = vFromST(cycle.gas, TK, combMidS);
        if (onRChange) onRChange(clampR(cycle.v1 / v));
        if (onLineDragMove) onLineDragMove("combustion");
      } else {
        // Moving the 4→1 isochore sets v₁ at fixed T₁, i.e. the intake pressure P₁
        const v = vFromST(cycle.gas, TK, rejMidS);
        if (onP1Change) onP1Change(clampP1(cycle.gas.R * (cycle.T1 + K2C) / v));
        if (onLineDragMove) onLineDragMove("rejection");
      }
      return;
    }
    if (!draggingRef.current) return;
    if (e.touches && e.touches.length === 0) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, onRChange, onP1Change, onLineDragMove, combMidS, rejMidS, cycle.gas, cycle.v1, cycle.T1]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnd = useCallback(() => {
    draggingRef.current = false;
    if (lineDragRef.current) { lineDragRef.current = null; if (onLineDragEnd) onLineDragEnd(); }
  }, [onLineDragEnd]);

  const toD = (pts) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${mapS(p.s).toFixed(1)},${mapT(p.T).toFixed(1)}`).join(" ");
  const combD = toD(cycle.combPath);
  const rejD = toD(cycle.rejPath);
  const cycleFillD = [`M${mapS(st[0].s).toFixed(1)},${mapT(st[0].T).toFixed(1)}`, `L${mapS(st[1].s).toFixed(1)},${mapT(st[1].T).toFixed(1)}`, combD.replace(/^M/, "L"), `L${mapS(st[3].s).toFixed(1)},${mapT(st[3].T).toFixed(1)}`, rejD.replace(/^M/, "L"), "Z"].join(" ");
  const dpx = mapS(dragPoint.s), dpy = mapT(dragPoint.T);
  const sGrid = ticks(sMin, sMax, niceStep(sMax - sMin, 8));
  const tGrid = ticks(tMin, tMax, niceStep(tMax - tMin, 9));
  const axisY = TS_PLOT.y + TS_PLOT.h;

  return (
    <svg ref={svgRef} viewBox={`0 0 ${TS_W} ${TS_H}`} style={{ width: "100%", touchAction: "none", cursor: "crosshair", userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none" }}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
      {sGrid.map((s, i) => <line key={`sg${i}`} x1={mapS(s)} y1={TS_PLOT.y} x2={mapS(s)} y2={axisY} stroke={K.gridMajor} strokeWidth={0.5} />)}
      {tGrid.map((t, i) => <line key={`tg${i}`} x1={TS_PLOT.x} y1={mapT(t)} x2={TS_PLOT.x + TS_PLOT.w} y2={mapT(t)} stroke={K.gridMajor} strokeWidth={0.5} />)}
      <line x1={TS_PLOT.x} y1={axisY} x2={TS_PLOT.x + TS_PLOT.w} y2={axisY} stroke={K.ink} strokeWidth={1.2} />
      <line x1={TS_PLOT.x} y1={TS_PLOT.y} x2={TS_PLOT.x} y2={axisY} stroke={K.ink} strokeWidth={1.2} />
      {sGrid.filter(s => mapS(s) < TS_W - sz(9)).map((s, i) => <text key={`sl${i}`} x={mapS(s)} y={axisY + 10} fill={K.inkMed} fontSize={sz(6.5)} textAnchor="middle" fontFamily={FM}>{+s.toFixed(2)}</text>)}
      {tGrid.map((t, i) => <text key={`tl${i}`} x={TS_PLOT.x - 4} y={mapT(t) + 2.5} fill={K.inkMed} fontSize={sz(6.5)} textAnchor="end" fontFamily={FM}>{t}</text>)}
      <text x={TS_W / 2} y={TS_H - 4} fill={K.inkMed} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic">s (kJ/kg·K)</text>
      <text x={10} y={TS_H / 2 - 8} fill={K.inkMed} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic" transform={`rotate(-90,10,${TS_H / 2 - 8})`}>T (°C)</text>
      {showAreas && (() => {
        const qInD = [`M${mapS(st[1].s).toFixed(1)},${axisY.toFixed(1)}`, `L${mapS(st[1].s).toFixed(1)},${mapT(st[1].T).toFixed(1)}`, combD.replace(/^M/, "L"), `L${mapS(st[2].s).toFixed(1)},${axisY.toFixed(1)}`, "Z"].join(" ");
        const qOutD = [`M${mapS(st[3].s).toFixed(1)},${axisY.toFixed(1)}`, `L${mapS(st[3].s).toFixed(1)},${mapT(st[3].T).toFixed(1)}`, rejD.replace(/^M/, "L"), `L${mapS(st[0].s).toFixed(1)},${axisY.toFixed(1)}`, "Z"].join(" ");
        return (<>
          {activeArea === "qIn" && <path d={qInD} fill={`${K.heatIn}28`} stroke="none" />}
          {activeArea === "qOut" && <path d={qOutD} fill={`${K.heatOut}28`} stroke="none" />}
          {activeArea === "wNet" && <path d={cycleFillD} fill={`${K.workOut}30`} stroke="none" />}
        </>);
      })()}
      {!showAreas && <path d={cycleFillD} fill={K.accentLight} stroke="none" />}
      {/* Process lines */}
      <line x1={mapS(st[0].s)} y1={mapT(st[0].T)} x2={mapS(st[1].s)} y2={mapT(st[1].T)} stroke={K.workIn} strokeWidth={2.2} strokeLinecap="round" />
      <path d={combD} fill="none" stroke={K.heatIn} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={mapS(st[2].s)} y1={mapT(st[2].T)} x2={mapS(st[3].s)} y2={mapT(st[3].T)} stroke={K.workOut} strokeWidth={2.2} strokeLinecap="round" />
      <path d={rejD} fill="none" stroke={K.heatOut} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      {lineDragInfo && (() => {
        const isComb = lineDragInfo.which === "combustion";
        const color = isComb ? K.heatIn : K.heatOut;
        const valueText = isComb ? `r = v₁/v₂ = ${cycle.r.toFixed(1)}` : `P₁ = ${fmtP(cycle.p1, u)}`;
        const boxW = Math.max(sz(104), valueText.length * sz(5.7) + sz(16));
        const boxY = TS_PLOT.y + 2;
        return (<>
          <rect x={TS_PLOT.x + TS_PLOT.w / 2 - boxW / 2} y={boxY} width={boxW} height={sz(18)} rx={2} fill={K.card} stroke={color} strokeWidth={0.8} />
          <text x={TS_PLOT.x + TS_PLOT.w / 2} y={boxY + sz(13)} fill={color} fontSize={sz(9)} fontFamily={FM} textAnchor="middle" fontWeight="600">{valueText}</text>
        </>);
      })()}
      {!showAreas && <>
        <line x1={dpx} y1={dpy} x2={dpx} y2={axisY} stroke={lockS ? K.accent : K.inkLight} strokeWidth={lockS ? 1.2 : 0.5} strokeDasharray={lockS ? "none" : "2 2"} />
        <line x1={dpx} y1={dpy} x2={TS_PLOT.x} y2={dpy} stroke={lockT ? K.accent : K.inkLight} strokeWidth={lockT ? 1.2 : 0.5} strokeDasharray={lockT ? "none" : "2 2"} />
        {lockT && <line x1={TS_PLOT.x} y1={dpy} x2={TS_PLOT.x + TS_PLOT.w} y2={dpy} stroke={K.accent} strokeWidth={0.6} strokeDasharray="4 3" opacity={0.4} />}
        {lockS && <line x1={dpx} y1={TS_PLOT.y} x2={dpx} y2={axisY} stroke={K.accent} strokeWidth={0.6} strokeDasharray="4 3" opacity={0.4} />}
      </>}
      {st.map((s, i) => {
        const cx = mapS(s.s), cy = mapT(s.T);
        const off = [{ dx: sz(-14), dy: sz(14) }, { dx: sz(-14), dy: sz(-8) }, { dx: sz(10), dy: sz(-8) }, { dx: sz(10), dy: sz(14) }];
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
        <rect x={compLeft ? mapS(st[0].s) - sz(62) : mapS(st[0].s) + sz(6)} y={(mapT(st[0].T) + mapT(st[1].T)) / 2 - sz(8)} width={sz(56)} height={sz(11)} rx={2} fill={K.card} />
        <text x={compLeft ? mapS(st[0].s) - sz(8) : mapS(st[0].s) + sz(8)} y={(mapT(st[0].T) + mapT(st[1].T)) / 2} fill={K.workIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor={compLeft ? "end" : "start"}>Compression</text>
        <rect x={combTextX - sz(26)} y={combTextY - sz(8)} width={sz(52)} height={sz(11)} rx={2} fill={K.card} />
        <text x={combTextX} y={combTextY} fill={K.heatIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "ns-resize" }}>Combustion</text>
        <rect x={expLeft ? mapS(st[2].s) - sz(50) : mapS(st[2].s) + sz(6)} y={(mapT(st[2].T) + mapT(st[3].T)) / 2 - sz(8)} width={sz(44)} height={sz(11)} rx={2} fill={K.card} />
        <text x={expLeft ? mapS(st[2].s) - sz(8) : mapS(st[2].s) + sz(8)} y={(mapT(st[2].T) + mapT(st[3].T)) / 2} fill={K.workOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor={expLeft ? "end" : "start"}>Expansion</text>
        <rect x={rejTextX - sz(36)} y={rejTextY - sz(8)} width={sz(72)} height={sz(11)} rx={2} fill={K.card} />
        <text x={rejTextX} y={rejTextY} fill={K.heatOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "ns-resize" }}>Heat Rejection</text>
        <circle cx={dpx} cy={dpy} r={9} fill={`${K.accent}25`} stroke={K.accent} strokeWidth={2} />
        <circle cx={dpx} cy={dpy} r={4} fill={K.accent} />
        {(() => {
          const label = `${fmtT(dragPoint.T, u, 0)}, ${fmtS(dragPoint.s, u, 2)}`;
          const w = sz(8) * 0.6 * label.length + sz(8);
          const flipLeft = dpx + sz(12) + w > TS_W - 2;
          let rectX = flipLeft ? dpx - sz(12) - w : dpx + sz(12);
          let rectY = dpy - sz(22) < 1 ? dpy + sz(6) : dpy - sz(22); // flip below when near the top edge
          rectX = Math.max(1, Math.min(TS_W - w - 1, rectX)); rectY = Math.max(1, Math.min(TS_H - sz(18) - 1, rectY)); // never leave the SVG
          return <>
            <rect x={rectX} y={rectY} width={w} height={sz(18)} rx={2} fill={K.card} stroke={K.ink} strokeWidth={0.8} />
            <text x={rectX + sz(4)} y={rectY + sz(12)} fill={K.ink} fontSize={sz(8)} fontFamily={FM}>{label}</text>
          </>;
        })()}
        {hintClear && <text x={TS_W - 8} y={TS_PLOT.y + 10} fill={K.inkLight} fontSize={sz(7)} fontFamily={FM} textAnchor="end" fontStyle="italic">{lockS ? "s locked" : lockT ? "T locked" : "tap & drag"}</text>}
      </>}
      {showAreas && (() => {
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        const lx = TS_PLOT.x + 6, ly = TS_PLOT.y + 4;
        const dot = (k) => activeArea === k ? 1 : 0.35;
        return (<>
          <rect x={lx} y={ly} width={sz(160)} height={sz(52)} rx={2} fill={K.card} stroke={K.border} strokeWidth={0.8} />
          <g onClick={() => setActiveArea("qIn")} style={{ cursor: "pointer" }} opacity={dot("qIn")}>
            <rect x={lx + sz(5)} y={ly + sz(5)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.heatIn}30`} stroke={K.heatIn} strokeWidth={activeArea === "qIn" ? 1.4 : 0.6} />
            <text x={lx + sz(17)} y={ly + sz(12)} fill={K.heatIn} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "qIn" ? 700 : 400}>Q_in (2→3) = {fmt(cycle.qIn)} kJ/kg</text>
          </g>
          <g onClick={() => setActiveArea("qOut")} style={{ cursor: "pointer" }} opacity={dot("qOut")}>
            <rect x={lx + sz(5)} y={ly + sz(18)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.heatOut}30`} stroke={K.heatOut} strokeWidth={activeArea === "qOut" ? 1.4 : 0.6} />
            <text x={lx + sz(17)} y={ly + sz(25)} fill={K.heatOut} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "qOut" ? 700 : 400}>Q_out (4→1) = −{fmt(cycle.qOut)} kJ/kg</text>
          </g>
          <g onClick={() => setActiveArea("wNet")} style={{ cursor: "pointer" }} opacity={dot("wNet")}>
            <rect x={lx + sz(5)} y={ly + sz(31)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.workOut}40`} stroke={K.workOut} strokeWidth={activeArea === "wNet" ? 1.4 : 0.6} />
            <text x={lx + sz(17)} y={ly + sz(38)} fill={K.workOut} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "wNet" ? 700 : 400}>W_net (1→2→3→4→1) = {fmt(cycle.wNet)} kJ/kg</text>
          </g>
          <text x={lx + sz(5)} y={ly + sz(49)} fill={K.ink} fontSize={sz(8)} fontFamily={FD} fontWeight="bold">η = {(cycle.eta * 100).toFixed(1)}%</text>
        </>);
      })()}
    </svg>
  );
}

/* ───────── P-v Diagram (log–log axes) ───────── */
const PV_W = 360, PV_H = 285;
const PV_PAD = { l: 38, r: 6, t: 14, b: 28 };
const PV_PLOT = { x: PV_PAD.l, y: PV_PAD.t, w: PV_W - PV_PAD.l - PV_PAD.r, h: PV_H - PV_PAD.t - PV_PAD.b };

function OttoPvDiagram({ cycle, dragPoint, onDrag, lockP, lockV, showPvAreas, onRChange, onP1Change, lineDragInfo, onLineDragStart, onLineDragMove, onLineDragEnd, textScale, units }) {
  const sz = px => px * (textScale || 1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const lineDragRef = useRef(null);
  const [activeArea, setActiveArea] = useState("wExp");

  const st = cycle.states;
  // Log–log axes (as on the Rankine and Brayton pages): isentropes become straight lines and isochores stay vertical
  const lvLo = Math.log10(cycle.vMin / 1.7), lvHi = Math.log10(cycle.vMax * 1.7);
  const lpLo = Math.log10(cycle.p1 / 1.7), lpHi = Math.log10(cycle.p3 * 1.7);
  const mapV = v => PV_PLOT.x + ((Math.log10(Math.max(1e-6, v)) - lvLo) / (lvHi - lvLo)) * PV_PLOT.w;
  const mapP = P => PV_PLOT.y + PV_PLOT.h - ((Math.log10(Math.max(1e-6, P)) - lpLo) / (lpHi - lpLo)) * PV_PLOT.h;
  const unmapV = px => Math.pow(10, lvLo + ((px - PV_PLOT.x) / PV_PLOT.w) * (lvHi - lvLo));
  const unmapP = py => Math.pow(10, lpLo + ((PV_PLOT.y + PV_PLOT.h - py) / PV_PLOT.h) * (lpHi - lpLo));
  const vMax = Math.pow(10, lvHi), pMax = Math.pow(10, lpHi);

  const getSvgXY = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = PV_W / rect.width, scaleY = PV_H / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const px = Math.max(PV_PLOT.x, Math.min(PV_PLOT.x + PV_PLOT.w, (clientX - rect.left) * scaleX));
    const py = Math.max(PV_PLOT.y, Math.min(PV_PLOT.y + PV_PLOT.h, (clientY - rect.top) * scaleY));
    return { px, py };
  }, []);

  const getSvgPoint = useCallback((e) => {
    const r = getSvgXY(e);
    if (!r) return null;
    const v = lockV ? dragPoint.v : unmapV(r.px);
    const P = lockP ? dragPoint.P : unmapP(r.py);
    return propsPV(cycle.gas, P, v); // only this diagram's window clamps the point
  }, [getSvgXY, lockP, lockV, dragPoint, vMax, pMax, cycle.gas]); // eslint-disable-line react-hooks/exhaustive-deps

  // The isochores are vertical lines; their labels sit on the line at mid-height and drag sideways
  // When the isochore is shorter than the state-digit boxes beside it (helium/argon at r = 14 with the minimum T₃), the label
  // moves off the line to the side away from the digits (digits 2/3 sit left of the 2→3 line, digits 4/1 right of the 4→1 line)
  const combShort = Math.abs(mapP(cycle.p3) - mapP(cycle.p2)) < sz(40), rejShort = Math.abs(mapP(cycle.p1) - mapP(cycle.p4)) < sz(40);
  const combTextX = mapV(cycle.v2) + (combShort ? sz(32) : 0), combTextY = (mapP(cycle.p2) + mapP(cycle.p3)) / 2;
  const rejTextX = mapV(cycle.v1) - (rejShort ? sz(44) : 0), rejTextY = (mapP(cycle.p4) + mapP(cycle.p1)) / 2;

  const handleStart = useCallback((e) => {
    if (e.touches && e.touches.length === 0) return;
    if (e.preventDefault) e.preventDefault();
    const r = getSvgXY(e);
    if (r) {
      if (Math.abs(r.px - combTextX) < 30 && Math.abs(r.py - combTextY) < 10) {
        lineDragRef.current = "combustion";
        if (onLineDragStart) onLineDragStart("combustion");
        return;
      }
      if (Math.abs(r.px - rejTextX) < 40 && Math.abs(r.py - rejTextY) < 10) {
        lineDragRef.current = "rejection";
        if (onLineDragStart) onLineDragStart("rejection");
        return;
      }
    }
    draggingRef.current = true;
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, combTextX, combTextY, rejTextX, rejTextY, onLineDragStart]);

  const handleMove = useCallback((e) => {
    if (lineDragRef.current) {
      e.preventDefault();
      const r = getSvgXY(e);
      if (!r) return;
      const v = unmapV(r.px);
      if (lineDragRef.current === "combustion") {
        if (onRChange) onRChange(clampR(cycle.v1 / v));
        if (onLineDragMove) onLineDragMove("combustion");
      } else {
        if (onP1Change) onP1Change(clampP1(cycle.gas.R * (cycle.T1 + K2C) / v));
        if (onLineDragMove) onLineDragMove("rejection");
      }
      return;
    }
    if (!draggingRef.current) return;
    if (e.touches && e.touches.length === 0) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, onRChange, onP1Change, onLineDragMove, cycle.v1, cycle.gas, cycle.T1]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnd = useCallback(() => {
    draggingRef.current = false;
    if (lineDragRef.current) { lineDragRef.current = null; if (onLineDragEnd) onLineDragEnd(); }
  }, [onLineDragEnd]);

  const toD = pts => pts.map((p, i) => `${i === 0 ? "M" : "L"}${mapV(p.v).toFixed(1)},${mapP(p.P).toFixed(1)}`).join(" ");
  const compD = toD(cycle.compPvPath), expD = toD(cycle.expPvPath);
  const cycleFillD = [compD, `L${mapV(st[2].v).toFixed(1)},${mapP(st[2].P).toFixed(1)}`, expD.replace(/^M/, "L"), `L${mapV(st[0].v).toFixed(1)},${mapP(st[0].P).toFixed(1)}`, "Z"].join(" ");
  const dpx = mapV(dragPoint.v), dpy = mapP(dragPoint.P);
  const vGrid = logTicks(Math.pow(10, lvLo), vMax);
  const pGrid = logTicks(Math.pow(10, lpLo), pMax);
  const axisY = PV_PLOT.y + PV_PLOT.h;

  return (
    <svg ref={svgRef} viewBox={`0 0 ${PV_W} ${PV_H}`} style={{ width: "100%", touchAction: "none", cursor: "crosshair", userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none" }}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
      {vGrid.map((v, i) => <line key={`vg${i}`} x1={mapV(v)} y1={PV_PLOT.y} x2={mapV(v)} y2={axisY} stroke={K.gridMajor} strokeWidth={0.5} />)}
      {pGrid.map((p, i) => <line key={`pg${i}`} x1={PV_PLOT.x} y1={mapP(p)} x2={PV_PLOT.x + PV_PLOT.w} y2={mapP(p)} stroke={K.gridMajor} strokeWidth={0.5} />)}
      <line x1={PV_PLOT.x} y1={axisY} x2={PV_PLOT.x + PV_PLOT.w} y2={axisY} stroke={K.ink} strokeWidth={1.2} />
      <line x1={PV_PLOT.x} y1={PV_PLOT.y} x2={PV_PLOT.x} y2={axisY} stroke={K.ink} strokeWidth={1.2} />
      {vGrid.filter(v => mapV(v) < PV_W - sz(9)).map((v, i) => <text key={`vl${i}`} x={mapV(v)} y={axisY + 10} fill={K.inkMed} fontSize={sz(6.5)} textAnchor="middle" fontFamily={FM}>{+v.toPrecision(2)}</text>)}
      {pGrid.map((p, i) => <text key={`pl${i}`} x={PV_PLOT.x - 4} y={mapP(p) + 2.5} fill={K.inkMed} fontSize={sz(6.5)} textAnchor="end" fontFamily={FM}>{p >= 1000 ? `${+(p / 1000).toFixed(2)}k` : p}</text>)}
      <text x={PV_W / 2} y={PV_H - 5} fill={K.inkMed} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic">v (m³/kg) — log scale</text>
      <text x={10} y={PV_H / 2 - 8} fill={K.inkMed} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic" transform={`rotate(-90,10,${PV_H / 2 - 8})`}>P (kPa) — log</text>
      {showPvAreas && (() => {
        // Boundary work = ∫P dv: the region between each isentrope and the v axis
        const wExpD = [`M${mapV(st[2].v).toFixed(1)},${axisY.toFixed(1)}`, `L${mapV(st[2].v).toFixed(1)},${mapP(st[2].P).toFixed(1)}`, expD.replace(/^M/, "L"), `L${mapV(st[3].v).toFixed(1)},${axisY.toFixed(1)}`, "Z"].join(" ");
        const wCompD = [`M${mapV(st[0].v).toFixed(1)},${axisY.toFixed(1)}`, `L${mapV(st[0].v).toFixed(1)},${mapP(st[0].P).toFixed(1)}`, compD.replace(/^M/, "L"), `L${mapV(st[1].v).toFixed(1)},${axisY.toFixed(1)}`, "Z"].join(" ");
        return (<>
          {activeArea === "wExp" && <path d={wExpD} fill={`${K.workOut}28`} stroke="none" />}
          {activeArea === "wComp" && <path d={wCompD} fill={`${K.workIn}28`} stroke="none" />}
          {activeArea === "wNet" && <path d={cycleFillD} fill={`${K.workOut}30`} stroke="none" />}
        </>);
      })()}
      {!showPvAreas && <path d={cycleFillD} fill={K.accentLight} stroke="none" />}
      <path d={compD} fill="none" stroke={K.workIn} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={mapV(st[1].v)} y1={mapP(st[1].P)} x2={mapV(st[2].v)} y2={mapP(st[2].P)} stroke={K.heatIn} strokeWidth={2.2} strokeLinecap="round" />
      <path d={expD} fill="none" stroke={K.workOut} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={mapV(st[3].v)} y1={mapP(st[3].P)} x2={mapV(st[0].v)} y2={mapP(st[0].P)} stroke={K.heatOut} strokeWidth={2.2} strokeLinecap="round" />
      {lineDragInfo && (() => {
        const isComb = lineDragInfo.which === "combustion";
        const lineX = isComb ? mapV(cycle.v2) : mapV(cycle.v1);
        const color = isComb ? K.heatIn : K.heatOut;
        const valueText = isComb ? `r = v₁/v₂ = ${cycle.r.toFixed(1)} (v₂ = ${cycle.v2.toFixed(3)} m³/kg)` : `P₁ = ${fmtP(cycle.p1, u)} (v₁ = ${cycle.v1.toFixed(3)} m³/kg)`;
        const boxW = Math.max(sz(96), valueText.length * sz(5.7) + sz(16));
        const boxY = PV_PLOT.y + 2;
        return (<>
          <line x1={lineX} y1={PV_PLOT.y} x2={lineX} y2={axisY} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
          <rect x={PV_PLOT.x + PV_PLOT.w / 2 - boxW / 2} y={boxY} width={boxW} height={sz(18)} rx={2} fill={K.card} stroke={color} strokeWidth={0.8} />
          <text x={PV_PLOT.x + PV_PLOT.w / 2} y={boxY + sz(13)} fill={color} fontSize={sz(9)} fontFamily={FM} textAnchor="middle" fontWeight="600">{valueText}</text>
        </>);
      })()}
      {!showPvAreas && <>
        <line x1={dpx} y1={dpy} x2={dpx} y2={axisY} stroke={lockV ? K.accent : K.inkLight} strokeWidth={lockV ? 1.2 : 0.5} strokeDasharray={lockV ? "none" : "2 2"} />
        <line x1={dpx} y1={dpy} x2={PV_PLOT.x} y2={dpy} stroke={lockP ? K.accent : K.inkLight} strokeWidth={lockP ? 1.2 : 0.5} strokeDasharray={lockP ? "none" : "2 2"} />
        {lockP && <line x1={PV_PLOT.x} y1={dpy} x2={PV_PLOT.x + PV_PLOT.w} y2={dpy} stroke={K.accent} strokeWidth={0.6} strokeDasharray="4 3" opacity={0.4} />}
        {lockV && <line x1={dpx} y1={PV_PLOT.y} x2={dpx} y2={axisY} stroke={K.accent} strokeWidth={0.6} strokeDasharray="4 3" opacity={0.4} />}
      </>}
      {st.map((s, i) => {
        const cx = mapV(s.v), cy = mapP(s.P);
        const off = [{ dx: sz(10), dy: sz(14) }, { dx: sz(-12), dy: sz(14) }, { dx: sz(-12), dy: sz(-8) }, { dx: sz(10), dy: sz(-8) }];
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
      {!showPvAreas && <>
        {(() => {
          // below-left of the 1→2 isentrope: outside the loop and clear of the 4→1 label
          const mid = cycle.compPvPath[10];
          const x = mapV(mid.v) - sz(6), y = mapP(mid.P) + sz(10);
          return <><rect x={x - sz(54)} y={y - sz(8)} width={sz(56)} height={sz(11)} rx={2} fill={K.card} /><text x={x} y={y} fill={K.workIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="end">Compression</text></>;
        })()}
        <rect x={combTextX - sz(26)} y={combTextY - sz(8)} width={sz(52)} height={sz(11)} rx={2} fill={K.card} />
        <text x={combTextX} y={combTextY} fill={K.heatIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "ew-resize" }}>Combustion</text>
        {(() => {
          const mid = cycle.expPvPath[10];
          const x = mapV(mid.v) + sz(8), y = mapP(mid.P) - sz(3);
          return <><rect x={x - sz(2)} y={y - sz(8)} width={sz(44)} height={sz(11)} rx={2} fill={K.card} /><text x={x} y={y} fill={K.workOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500">Expansion</text></>;
        })()}
        <rect x={rejTextX - sz(36)} y={rejTextY - sz(8)} width={sz(72)} height={sz(11)} rx={2} fill={K.card} />
        <text x={rejTextX} y={rejTextY} fill={K.heatOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "ew-resize" }}>Heat Rejection</text>
        <circle cx={dpx} cy={dpy} r={9} fill={`${K.accent}25`} stroke={K.accent} strokeWidth={2} />
        <circle cx={dpx} cy={dpy} r={4} fill={K.accent} />
        {(() => {
          const label = `${fmtP(dragPoint.P, u)}, ${dragPoint.v.toFixed(3)} m³/kg`;
          const w = sz(8) * 0.6 * label.length + sz(8);
          const flipLeft = dpx + sz(12) + w > PV_W - 2;
          let rectX = flipLeft ? dpx - sz(12) - w : dpx + sz(12);
          let rectY = dpy - sz(22) < 1 ? dpy + sz(6) : dpy - sz(22); // flip below when near the top edge
          rectX = Math.max(1, Math.min(PV_W - w - 1, rectX)); rectY = Math.max(1, Math.min(PV_H - sz(18) - 1, rectY)); // never leave the SVG
          return <>
            <rect x={rectX} y={rectY} width={w} height={sz(18)} rx={2} fill={K.card} stroke={K.ink} strokeWidth={0.8} />
            <text x={rectX + sz(4)} y={rectY + sz(12)} fill={K.ink} fontSize={sz(8)} fontFamily={FM}>{label}</text>
          </>;
        })()}
        <text x={PV_W - 8} y={PV_PLOT.y + 10} fill={K.inkLight} fontSize={sz(7)} fontFamily={FM} textAnchor="end" fontStyle="italic">{lockP ? "P locked" : lockV ? "v locked" : "tap & drag"}</text>
      </>}
      {showPvAreas && (() => {
        const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        const boxW = sz(168);
        const lx = PV_PLOT.x + PV_PLOT.w - boxW - 6, ly = PV_PLOT.y + 4;
        const dot = (k) => activeArea === k ? 1 : 0.35;
        return (<>
          <rect x={lx} y={ly} width={boxW} height={sz(52)} rx={2} fill={K.card} stroke={K.border} strokeWidth={0.8} />
          <g onClick={() => setActiveArea("wExp")} style={{ cursor: "pointer" }} opacity={dot("wExp")}>
            <rect x={lx + sz(5)} y={ly + sz(5)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.workOut}30`} stroke={K.workOut} strokeWidth={activeArea === "wExp" ? 1.4 : 0.6} />
            <text x={lx + sz(17)} y={ly + sz(12)} fill={K.workOut} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "wExp" ? 700 : 400}>W_expansion (3→4) = {fmt(cycle.wExp)} kJ/kg</text>
          </g>
          <g onClick={() => setActiveArea("wComp")} style={{ cursor: "pointer" }} opacity={dot("wComp")}>
            <rect x={lx + sz(5)} y={ly + sz(18)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.workIn}30`} stroke={K.workIn} strokeWidth={activeArea === "wComp" ? 1.4 : 0.6} />
            <text x={lx + sz(17)} y={ly + sz(25)} fill={K.workIn} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "wComp" ? 700 : 400}>W_comp (1→2) = −{fmt(cycle.wComp)} kJ/kg</text>
          </g>
          <g onClick={() => setActiveArea("wNet")} style={{ cursor: "pointer" }} opacity={dot("wNet")}>
            <rect x={lx + sz(5)} y={ly + sz(31)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.workOut}40`} stroke={K.workOut} strokeWidth={activeArea === "wNet" ? 1.4 : 0.6} />
            <text x={lx + sz(17)} y={ly + sz(38)} fill={K.workOut} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "wNet" ? 700 : 400}>W_net = {fmt(cycle.wNet)} kJ/kg</text>
          </g>
          <text x={lx + sz(5)} y={ly + sz(49)} fill={K.ink} fontSize={sz(8)} fontFamily={FD} fontWeight="bold">MEP = {fmtP(cycle.mep, u)}</text>
        </>);
      })()}
    </svg>
  );
}

/* ───────── Process Detail Modal ───────── */
const OTTO_PROCESS_INFO = {
  compression: {
    title: "Compression Stroke", color: () => K.workIn, process: "1 → 2", type: "Isentropic Compression",
    purpose: "With both valves closed, the piston rises from bottom dead centre (BDC) to top dead centre (TDC), squeezing the trapped charge into the clearance volume. The volume falls by the compression ratio r = v₁/v₂ and, because the process is ideally adiabatic and reversible, temperature and pressure climb steeply with no heat added.",
    keyPoints: [
      "Ideal process is isentropic (s₁ = s₂)",
      "Volume falls from v₁ to v₂ = v₁ / r",
      "Temperature rises: T₂ = T₁ · r^(k−1)",
      "Pressure rises: P₂ = P₁ · r^k",
      "Boundary work is done ON the gas: w_comp = u₂ − u₁",
    ],
    equations: [
      { label: "First Law (closed system, adiabatic)", eq: "w_comp = u₂ − u₁ = c_v (T₂ − T₁)" },
      { label: "Isentropic relations", eq: "T₂/T₁ = r^(k−1),   P₂/P₁ = r^k" },
      { label: "Boundary work", eq: "w = −∫₁² P dv" },
    ],
    insight: "Because the system is closed, the work is boundary work ∫P dv, and internal energy u = c_v·T is the right energy — not enthalpy. On the P–v diagram the compression work is the area between the 1→2 isentrope and the v axis.",
  },
  combustion: {
    title: "Combustion (Heat Addition)", color: () => K.heatIn, process: "2 → 3", type: "Constant-Volume Heat Addition",
    purpose: "At TDC the spark ignites the charge. In the ideal cycle the burn is instantaneous, so the piston has not moved and the volume is constant while pressure and temperature jump to their peak values. The air-standard model replaces combustion with heat transfer from an external source.",
    keyPoints: [
      "Volume is constant (v₂ = v₃) — no boundary work",
      "All the heat goes into internal energy: q_in = u₃ − u₂",
      "Pressure jumps in proportion to temperature: P₃ = P₂ · T₃/T₂",
      "T₃ is the peak cycle temperature (set by fuel energy and mixture)",
      "Real engines: finite burn duration, spark advanced before TDC",
    ],
    equations: [
      { label: "First Law (closed system, w = 0)", eq: "q_in = u₃ − u₂ = c_v (T₃ − T₂)" },
      { label: "Ideal-gas isochore", eq: "P₃ / P₂ = T₃ / T₂" },
      { label: "Entropy change", eq: "s₃ − s₂ = c_v · ln(T₃ / T₂)" },
    ],
    insight: "On the T–s diagram an isochore is the curve T = T₂·exp((s − s₂)/c_v). It is steeper than an isobar because c_v < c_p — constant-volume heating raises temperature faster per unit entropy than constant-pressure heating.",
  },
  expansion: {
    title: "Power Stroke", color: () => K.workOut, process: "3 → 4", type: "Isentropic Expansion",
    purpose: "The hot, high-pressure gas drives the piston from TDC back to BDC. This is the only stroke that delivers work to the crankshaft; it must pay for the compression stroke and still leave net output. In the ideal cycle the expansion is isentropic.",
    keyPoints: [
      "Ideal process is isentropic (s₃ = s₄)",
      "Volume expands from v₂ back to v₁ (same ratio r)",
      "Temperature falls: T₄ = T₃ / r^(k−1)",
      "Boundary work is done BY the gas: w_exp = u₃ − u₄",
      "T₄ is still hot — the exhaust carries away q_out",
    ],
    equations: [
      { label: "First Law (closed system, adiabatic)", eq: "w_exp = u₃ − u₄ = c_v (T₃ − T₄)" },
      { label: "Isentropic relations", eq: "T₄ = T₃ / r^(k−1),   P₄ = P₃ / r^k" },
      { label: "Boundary work", eq: "w = ∫₃⁴ P dv" },
    ],
    insight: "Because T₃ ≫ T₁, the expansion stroke's temperature drop exceeds the compression stroke's rise by the same factor, so w_exp > w_comp. The ratio of the two, w_comp/w_exp = T₁/T₄ · (T₂/T₁)/(T₃/T₄) = T₁/T₄, is the back work ratio.",
  },
  rejection: {
    title: "Heat Rejection (Exhaust Blowdown)", color: () => K.heatOut, process: "4 → 1", type: "Constant-Volume Heat Rejection",
    purpose: "At BDC the exhaust valve opens and the pressure collapses to the intake pressure before the piston moves appreciably. The ideal cycle models this as constant-volume heat rejection back to state 1. In a real engine the spent charge is pushed out and fresh charge drawn in, which is thermodynamically equivalent for a closed-cycle analysis.",
    keyPoints: [
      "Volume is constant (v₄ = v₁) — no boundary work",
      "Heat rejected: q_out = u₄ − u₁",
      "Pressure drops: P₁ = P₄ · T₁/T₄",
      "Real engines replace this with the exhaust and intake strokes",
      "Lower T₄ means less energy thrown away — a higher r does this",
    ],
    equations: [
      { label: "First Law (closed system, w = 0)", eq: "q_out = u₄ − u₁ = c_v (T₄ − T₁)" },
      { label: "Ideal-gas isochore", eq: "P₄ / P₁ = T₄ / T₁" },
      { label: "Entropy change", eq: "s₁ − s₄ = c_v · ln(T₁ / T₄) < 0" },
    ],
    insight: "Since q_in and q_out are both c_v·ΔT along isochores, η = 1 − q_out/q_in = 1 − (T₄ − T₁)/(T₃ − T₂) = 1 − 1/r^(k−1). The efficiency depends only on r and k — not on how much fuel you burn.",
  },
};

function OttoProcessModal({ process, cycle, onClose, units }) {
  const isWide = useIsDesktop();
  if (!process) return null;
  const info = OTTO_PROCESS_INFO[process];
  const color = info.color();
  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const cH = (v) => f(cvtH(v, u)); const lH = lblH(u);
  const cT = (v) => f(cvtT(v, u)); const lT = lblT(u);
  const liveValues = {
    compression: { main: `W_comp = −${cH(cycle.wComp)} ${lH}`, detail: `u₂ − u₁ = ${cH(cycle.u2)} − ${cH(cycle.u1)}; T₂ = ${cT(cycle.T2)} ${lT}` },
    combustion: { main: `Q_in = ${cH(cycle.qIn)} ${lH}`, detail: `u₃ − u₂ = ${cH(cycle.u3)} − ${cH(cycle.u2)}; P₃ = ${fmtP(cycle.p3, u)}` },
    expansion: { main: `W_exp = ${cH(cycle.wExp)} ${lH}`, detail: `u₃ − u₄ = ${cH(cycle.u3)} − ${cH(cycle.u4)}; T₄ = ${cT(cycle.T4)} ${lT}` },
    rejection: { main: `Q_out = −${cH(cycle.qOut)} ${lH}`, detail: `−(u₄ − u₁) = −(${cH(cycle.u4)} − ${cH(cycle.u1)})` },
  };
  const live = liveValues[process];
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
            {info.keyPoints.map((pt, i) => <div key={i} style={{ fontSize: isWide ? 14 : 10, color: K.inkMed, marginBottom: 6, lineHeight: 1.6 }}>{"▸ " + pt}</div>)}
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
          <div style={{ fontFamily: FD, fontSize: isWide ? 16 : 10, color: K.ink, marginBottom: 6 }}>💡 Engineering Insight</div>
          <div style={{ fontSize: isWide ? 14 : 10, color: K.inkMed, lineHeight: 1.7 }}>{info.insight}</div>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: isWide ? "14px" : "10px", background: color, border: "none", color: "#fff", fontWeight: 500, fontSize: isWide ? 16 : 12, fontFamily: FD, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Schematic: piston–cylinder ─────────
   The piston position tracks the drag point's specific volume (v₂ at TDC, v₁ at BDC); the
   charge colour tracks temperature; a flame appears in the clearance volume during 2→3. */
const CYL = { x: 130, w: 100, head: 40, stroke: 160 }; // piston top runs from y = head + stroke/r (TDC) to head + stroke (BDC)
function OttoSchematicDiagram({ cycle, dragPoint, textScale, units, animating, animSeg }) {
  const sz = px => px * (1 + ((textScale || 1) - 1) * 0.4);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const fmt = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const [activeProcess, setActiveProcess] = useState(null);
  const vFrac = Math.max(1 / cycle.r, Math.min(1, dragPoint.v / cycle.v1));
  const yTop = CYL.head + CYL.stroke * vFrac;
  const tNorm = Math.max(0, Math.min(1, (dragPoint.T - cycle.T1) / Math.max(1, cycle.T3 - cycle.T1)));
  const gasFill = `rgb(${Math.round(60 + tNorm * 170)},${Math.round(120 - tNorm * 30)},${Math.round(200 - tNorm * 160)})`;
  const nearTDC = dragPoint.v < cycle.v2 * 1.15;
  const flame = nearTDC ? Math.max(0, (tNorm - 0.25) / 0.75) : 0;
  // Crank angle from piston position; the compression stroke sweeps the other half-turn so the crank rotates during Animate
  const x = Math.max(0, Math.min(1, (dragPoint.v - cycle.v2) / Math.max(1e-9, cycle.v1 - cycle.v2)));
  const base = Math.acos(1 - 2 * x);
  const theta = animSeg === 0 ? 2 * Math.PI - base : base;
  const crank = { cx: 180, cy: 292, r: 22 };
  const pin = { x: crank.cx + crank.r * Math.sin(theta), y: crank.cy - crank.r * Math.cos(theta) };
  const badges = [
    { id: "compression", seg: 0, x: 22, y: 64, c: K.workIn, l1: "1 → 2", l2: "Compression" },
    { id: "rejection", seg: 3, x: 22, y: 206, c: K.heatOut, l1: "4 → 1", l2: "Heat Rejection" },
    { id: "combustion", seg: 1, x: 282, y: 64, c: K.heatIn, l1: "2 → 3", l2: "Combustion" },
    { id: "expansion", seg: 2, x: 282, y: 206, c: K.workOut, l1: "3 → 4", l2: "Expansion" },
  ];
  const mk = [{ id: "oO", c: K.heatIn }, { id: "oB", c: K.heatOut }, { id: "oG", c: K.workOut }, { id: "oY", c: K.workIn }];
  return (<>
    <svg viewBox="-8 -2 381 330" style={{ width: "100%" }}>
      <defs>
        {mk.map(m => (
          <marker key={m.id} id={m.id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={7} markerHeight={7} orient="auto">
            <path d="M0,1 L9,5 L0,9" fill="none" stroke={m.c} strokeWidth={1.5} />
          </marker>
        ))}
        <radialGradient id="oFlame"><stop offset="0%" stopColor="#ffe28a" stopOpacity={0.95} /><stop offset="55%" stopColor="#ff8c1a" stopOpacity={0.7} /><stop offset="100%" stopColor="#e0341a" stopOpacity={0} /></radialGradient>
      </defs>
      {Array.from({ length: 21 }, (_, i) => Array.from({ length: 17 }, (_, j) => (
        <circle key={`${i}-${j}`} cx={i * 20 - 10} cy={j * 20} r={0.6} fill={K.gridMajor} />
      )))}
      {/* Trapped charge */}
      <rect x={CYL.x + 1} y={CYL.head} width={CYL.w - 2} height={Math.max(0, yTop - CYL.head)} fill={gasFill} opacity={0.22 + tNorm * 0.2} />
      {flame > 0 && <ellipse cx={180} cy={CYL.head + (yTop - CYL.head) / 2} rx={46} ry={Math.max(6, (yTop - CYL.head) * 0.8)} fill="url(#oFlame)" opacity={flame} />}
      {/* Cylinder walls + head */}
      <line x1={CYL.x} y1={CYL.head} x2={CYL.x} y2={252} stroke={K.ink} strokeWidth={3} />
      <line x1={CYL.x + CYL.w} y1={CYL.head} x2={CYL.x + CYL.w} y2={252} stroke={K.ink} strokeWidth={3} />
      <rect x={CYL.x - 8} y={CYL.head - 16} width={CYL.w + 16} height={16} fill={K.cardAlt} stroke={K.ink} strokeWidth={1.5} />
      {/* Valves */}
      <g>
        <line x1={152} y1={CYL.head - 16} x2={152} y2={CYL.head - 30} stroke={K.inkMed} strokeWidth={1.5} />
        <line x1={144} y1={CYL.head + 1} x2={160} y2={CYL.head + 1} stroke={K.inkMed} strokeWidth={2.5} />
        <text x={152} y={CYL.head - 33} fill={K.inkLight} fontSize={sz(5.5)} textAnchor="middle" fontFamily={FM} fontStyle="italic">intake</text>
        <line x1={208} y1={CYL.head - 16} x2={208} y2={CYL.head - 30} stroke={K.inkMed} strokeWidth={1.5} />
        <line x1={200} y1={CYL.head + 1} x2={216} y2={CYL.head + 1} stroke={K.inkMed} strokeWidth={2.5} />
        <text x={208} y={CYL.head - 33} fill={K.inkLight} fontSize={sz(5.5)} textAnchor="middle" fontFamily={FM} fontStyle="italic">exhaust</text>
      </g>
      {/* Spark plug */}
      <rect x={176} y={CYL.head - 30} width={8} height={14} fill={K.cardAlt} stroke={K.ink} strokeWidth={1} />
      <line x1={180} y1={CYL.head - 30} x2={180} y2={CYL.head - 38} stroke={K.ink} strokeWidth={1.2} />
      <polyline points={`180,${CYL.head} 177,${CYL.head + 4} 183,${CYL.head + 6}`} fill="none" stroke={K.ink} strokeWidth={1} />
      {flame > 0 && [[-6, 8], [6, 8], [0, 11]].map(([dx, dy], i) => <line key={i} x1={180} y1={CYL.head + 5} x2={180 + dx} y2={CYL.head + 5 + dy} stroke="#ffd23f" strokeWidth={1.2} opacity={flame} />)}
      {/* Piston, pin, rod, crank */}
      <line x1={180} y1={yTop + 12} x2={pin.x} y2={pin.y} stroke={K.inkMed} strokeWidth={4} strokeLinecap="round" />
      <rect x={CYL.x + 1} y={yTop} width={CYL.w - 2} height={24} fill={K.cardAlt} stroke={K.ink} strokeWidth={1.5} />
      <line x1={CYL.x + 1} y1={yTop + 5} x2={CYL.x + CYL.w - 1} y2={yTop + 5} stroke={K.inkLight} strokeWidth={1} />
      <line x1={CYL.x + 1} y1={yTop + 9} x2={CYL.x + CYL.w - 1} y2={yTop + 9} stroke={K.inkLight} strokeWidth={1} />
      <circle cx={180} cy={yTop + 12} r={3.5} fill={K.card} stroke={K.ink} strokeWidth={1.2} />
      <circle cx={crank.cx} cy={crank.cy} r={crank.r} fill="none" stroke={K.inkLight} strokeWidth={1} strokeDasharray="3 3" />
      <line x1={crank.cx} y1={crank.cy} x2={pin.x} y2={pin.y} stroke={K.ink} strokeWidth={3} strokeLinecap="round" />
      <circle cx={crank.cx} cy={crank.cy} r={5} fill={K.card} stroke={K.ink} strokeWidth={1.5} />
      <circle cx={pin.x} cy={pin.y} r={3.5} fill={K.card} stroke={K.ink} strokeWidth={1.2} />
      {/* TDC / BDC ticks */}
      <line x1={CYL.x + CYL.w + 4} y1={CYL.head + CYL.stroke / cycle.r} x2={CYL.x + CYL.w + 12} y2={CYL.head + CYL.stroke / cycle.r} stroke={K.inkLight} strokeWidth={1} />
      <text x={CYL.x + CYL.w + 14} y={CYL.head + CYL.stroke / cycle.r + 2.5} fill={K.inkLight} fontSize={sz(6)} fontFamily={FM} fontStyle="italic">TDC</text>
      <line x1={CYL.x + CYL.w + 4} y1={CYL.head + CYL.stroke} x2={CYL.x + CYL.w + 12} y2={CYL.head + CYL.stroke} stroke={K.inkLight} strokeWidth={1} />
      <text x={CYL.x + CYL.w + 14} y={CYL.head + CYL.stroke + 2.5} fill={K.inkLight} fontSize={sz(6)} fontFamily={FM} fontStyle="italic">BDC</text>
      <text x={CYL.x - 6} y={CYL.head + 8 + CYL.stroke / 2} fill={K.inkLight} fontSize={sz(6)} fontFamily={FM} fontStyle="italic" textAnchor="middle" transform={`rotate(-90,${CYL.x - 6},${CYL.head + 8 + CYL.stroke / 2})`}>r = {cycle.r.toFixed(1)}</text>
      {/* Process badges (clickable) */}
      {badges.map(b => {
        const on = animating && animSeg === b.seg;
        return (
          <g key={b.id} style={{ cursor: "pointer" }} onClick={() => setActiveProcess(b.id)}>
            <rect x={b.x} y={b.y} width={82} height={36} rx={2} fill={on ? `${b.c}22` : K.card} stroke={b.c} strokeWidth={on ? 2.4 : 1.5} />
            <text x={b.x + 41} y={b.y + 14} fill={b.c} fontSize={sz(9)} textAnchor="middle" fontFamily={FD}>{b.l1}</text>
            <text x={b.x + 41} y={b.y + 28} fill={b.c} fontSize={sz(8)} textAnchor="middle" fontFamily={FM} fontWeight="500">{b.l2}</text>
          </g>
        );
      })}
      {/* Energy */}
      <line x1={112} y1={14} x2={128} y2={26} stroke={K.heatIn} strokeWidth={1.8} markerEnd="url(#oO)" />
      <text x={108} y={12} fill={K.heatIn} fontSize={sz(8)} textAnchor="end" fontFamily={FM} fontWeight="700">Q_in = {fmt(cvtH(cycle.qIn, u))} {lblH(u)}</text>
      <line x1={128} y1={238} x2={104} y2={252} stroke={K.heatOut} strokeWidth={1.8} markerEnd="url(#oB)" />
      <text x={104} y={266} fill={K.heatOut} fontSize={sz(8)} textAnchor="end" fontFamily={FM} fontWeight="700">Q_out = −{fmt(cvtH(cycle.qOut, u))} {lblH(u)}</text>
      <line x1={crank.cx + crank.r + 6} y1={crank.cy} x2={crank.cx + crank.r + 24} y2={crank.cy} stroke={K.workOut} strokeWidth={1.8} markerEnd="url(#oG)" />
      <text x={crank.cx + crank.r + 28} y={crank.cy - 3} fill={K.workOut} fontSize={sz(7.5)} textAnchor="start" fontFamily={FM} fontWeight="700">W_net</text>
      <text x={crank.cx + crank.r + 28} y={crank.cy + 8} fill={K.workOut} fontSize={sz(7)} textAnchor="start" fontFamily={FM} fontWeight="700">{fmt(cvtH(cycle.wNet, u))} {lblH(u)}</text>
      <text x={crank.cx - crank.r - 6} y={crank.cy + 3} fill={K.inkLight} fontSize={sz(6)} textAnchor="end" fontFamily={FM} fontStyle="italic">crank</text>
      {/* Live state readout */}
      <text x={180} y={322} fill={K.inkMed} fontSize={sz(7)} textAnchor="middle" fontFamily={FM}>v = {dragPoint.v.toFixed(3)} m³/kg · T = {fmtT(dragPoint.T, u, 0)} · P = {fmtP(dragPoint.P, u)}</text>
    </svg>
    <OttoProcessModal process={activeProcess} cycle={cycle} onClose={() => setActiveProcess(null)} units={u} />
  </>);
}

/* ───────── Info Modal (Theory) ───────── */
function OttoInfoModal({ open, onClose }) {
  const isWide = useIsDesktop();
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: K.card, border: `1.5px solid ${K.border}`, maxWidth: isWide ? 780 : 420, width: "100%", padding: isWide ? "36px 40px" : "24px 18px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginTop: isWide ? 60 : 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isWide ? 20 : 16, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: isWide ? 28 : 18, fontFamily: FD, color: K.ink }}>The Otto Cycle</h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: isWide ? 14 : 11, cursor: "pointer", padding: isWide ? "5px 16px" : "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <p style={{ fontSize: isWide ? 16 : 11, lineHeight: 1.9, color: K.inkMed, marginBottom: isWide ? 20 : 16 }}>
          The Otto cycle is the ideal cycle for spark-ignition (gasoline) piston engines. Unlike the steady-flow Rankine and Brayton cycles, it is a closed system: a fixed mass of gas trapped in a cylinder is compressed, heated at constant volume by a spark-ignited burn, expanded to produce work, and cooled at constant volume. Energies are internal energy u = c_v·T and work is boundary work ∫P dv. This tool uses ideal-gas, constant-specific-heat assumptions (the "cold-air standard" when the gas is air). Pick the working gas in the header: the specific-heat ratio k sets the efficiency for a given compression ratio.
        </p>
        <div style={isWide ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 } : {}}>
          <div style={{ borderLeft: `3px solid ${K.workIn}`, paddingLeft: 12, marginBottom: isWide ? 0 : 16 }}>
            <div style={{ fontFamily: FD, fontSize: isWide ? 18 : 13, marginBottom: 10, color: K.ink }}>Four Processes</div>
            {[
              { r: "1 → 2", l: "Compression — Isentropic", c: K.workIn, d: "The piston rises from BDC to TDC, reducing the volume by r = v₁/v₂. Temperature and pressure climb with no heat transfer." },
              { r: "2 → 3", l: "Combustion — Const-v Heat Addition", c: K.heatIn, d: "The spark fires at TDC. Pressure and temperature jump to their peaks while the volume stays fixed." },
              { r: "3 → 4", l: "Expansion — Isentropic (Power Stroke)", c: K.workOut, d: "Hot gas drives the piston back to BDC, delivering boundary work to the crank." },
              { r: "4 → 1", l: "Heat Rejection — Const-v", c: K.heatOut, d: "The exhaust valve opens at BDC; pressure collapses to intake pressure at constant volume." },
            ].map((p, i) => (
              <div key={i} style={{ marginBottom: isWide ? 12 : 8, fontSize: isWide ? 15 : 10.5, lineHeight: 1.7 }}>
                <span style={{ color: p.c, fontWeight: 700 }}>{p.r}</span>{" "}<span style={{ color: p.c, fontWeight: 500 }}>{p.l}</span><br />
                <span style={{ color: K.inkLight }}>{p.d}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: isWide ? "18px" : "14px", marginBottom: 14, fontSize: isWide ? 15 : 10.5, lineHeight: 2.3 }}>
              <div style={{ fontFamily: FD, fontSize: isWide ? 18 : 13, marginBottom: 6, color: K.ink }}>Key Equations</div>
              <div>{"η_th = W_net / Q_in = 1 − 1 / r^(k−1)"}</div>
              <div style={{ color: K.workIn }}>{"W_comp = −c_v (T₂ − T₁)  (−, work in)"}</div>
              <div style={{ color: K.heatIn }}>{"Q_in = c_v (T₃ − T₂)  (+, heat in)"}</div>
              <div style={{ color: K.workOut }}>{"W_exp = c_v (T₃ − T₄)  (+, work out)"}</div>
              <div style={{ color: K.heatOut }}>{"Q_out = −c_v (T₄ − T₁)  (−, heat out)"}</div>
              <div>{"MEP = W_net / (v₁ − v₂)"}</div>
              <div style={{ borderTop: `1px solid ${K.border}`, marginTop: 6, paddingTop: 6, color: K.inkLight }}>Isentropic relations:</div>
              <div>{"T₂/T₁ = T₃/T₄ = r^(k−1),  P₂/P₁ = P₃/P₄ = r^k"}</div>
              <div>{"P·v^k = const,  v = R·T / P,  c_v = c_p − R"}</div>
            </div>
            <div style={{ borderLeft: `3px solid ${K.workOut}`, paddingLeft: 12, marginBottom: isWide ? 0 : 16 }}>
              <div style={{ fontFamily: FD, fontSize: isWide ? 18 : 13, marginBottom: 6, color: K.ink }}>Improving Performance</div>
              {["Raise the compression ratio — efficiency depends only on r and k (ideal)", "Compression ratio is capped by knock (autoignition) — typically 8–12 for gasoline", "Higher peak temperature T₃ — more net work per kg of charge, same efficiency", "Mean effective pressure (MEP) compares engines of different displacement", "Real engines: finite burn, heat loss, friction, pumping work cut η to 25–35%"].map((t, i) => (
                <div key={i} style={{ fontSize: isWide ? 15 : 10.5, color: K.inkMed, marginBottom: 3 }}>{"▸ " + t}</div>
              ))}
            </div>
          </div>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: isWide ? "12px" : "10px", background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: isWide ? 16 : 12, fontFamily: FD, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Working Gas Reference Modal ───────── */
function OttoGasInfoModal({ open, onClose, currentGas }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: K.card, border: `1.5px solid ${K.border}`, maxWidth: 560, width: "100%", padding: "24px 18px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontFamily: FD, color: K.ink }}>Working Gas Reference</h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: 11, cursor: "pointer", padding: "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {GASES.map(g => {
            const isCurrent = g.id === currentGas.id;
            const eta8 = (1 - Math.pow(8, -(g.k - 1))) * 100;
            return (
              <div key={g.id} style={{ padding: "12px", border: `1.5px solid ${isCurrent ? K.workOut : K.border}`, background: isCurrent ? `${K.workOut}12` : K.cardAlt }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontFamily: FD, fontSize: 14, color: isCurrent ? K.workOut : K.ink }}>{g.name}</span>
                  <span style={{ fontSize: 9, color: K.inkLight, fontFamily: FM }}>{g.formula}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, fontSize: 9, marginBottom: 6 }}>
                  <div><span style={{ color: K.inkLight }}>c_v:</span> {(g.cp - g.R).toFixed(4)} kJ/kg·K</div>
                  <div><span style={{ color: K.inkLight }}>R:</span> {g.R} kJ/kg·K</div>
                  <div><span style={{ color: K.inkLight }}>k:</span> <span style={{ fontWeight: 600 }}>{g.k}</span></div>
                  <div><span style={{ color: K.inkLight }}>M:</span> {g.M} kg/kmol</div>
                  <div style={{ gridColumn: "1 / -1" }}><span style={{ color: K.inkLight }}>η at r = 8:</span> <span style={{ color: K.accent, fontWeight: 600 }}>{eta8.toFixed(1)}%</span></div>
                </div>
                <div style={{ fontSize: 9, color: K.inkMed, lineHeight: 1.6, marginBottom: 4 }}>{g.id === "air" ? "Spark-ignition engines: the air-standard textbook default." : g.uses}</div>
                <div style={{ fontSize: 8, color: K.inkLight, fontStyle: "italic", lineHeight: 1.5 }}>{g.note}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, padding: "10px", background: K.cardAlt, border: `1px solid ${K.border}`, fontSize: 9, lineHeight: 1.8 }}>
          <div style={{ fontFamily: FD, fontSize: 11, marginBottom: 4, color: K.ink }}>Why the gas matters</div>
          <div><strong>k = c_p / c_v</strong> sets η = 1 − 1/r^(k−1): monatomic gases (k = 1.667) beat diatomic (k = 1.4) at every compression ratio, but their T₂ rises faster, which raises the minimum peak temperature.</div>
          <div><strong>c_v = c_p − R</strong> sets how much heat each kelvin of temperature rise stores: high-c_v gases (helium) need far more q_in to reach the same T₃, and deliver proportionally more work.</div>
          <div style={{ color: K.inkLight, marginTop: 4, fontStyle: "italic" }}>Only air is a realistic engine charge; the others show how k and c_v shape the cycle. All properties are constant-specific-heat values near 300 K.</div>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: "10px", marginTop: 12, background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: FD, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Equations Solver Modal ───────── */
const OTTO_EQ_TOPICS = [
  { id: "wexp", label: "W_expansion", title: "Expansion (Power Stroke) Work", color: () => K.workOut },
  { id: "wcomp", label: "W_comp", title: "Compression Work Input", color: () => K.workIn },
  { id: "qin", label: "Q_in", title: "Combustion Heat Input", color: () => K.heatIn },
  { id: "qout", label: "Q_out", title: "Heat Rejection", color: () => K.heatOut },
  { id: "eta", label: "η_th", title: "Thermal Efficiency", color: () => K.accent },
  { id: "wnet", label: "W_net", title: "Net Work Output", color: () => K.workOut },
  { id: "mep", label: "MEP", title: "Mean Effective Pressure", color: () => K.workIn },
  { id: "states", label: "States", title: "State Points 1–4", color: () => K.ink },
];

function OttoEquationsModal({ open, onClose, cycle, initialTopic, units }) {
  const [topic, setTopic] = useState("wexp");
  useEffect(() => { if (initialTopic && open) setTopic(initialTopic); }, [initialTopic, open]);
  const isWide = useIsDesktop();
  if (!open) return null;
  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const cT = (v) => f(cvtT(v, u)); const cP = (v) => f(cvtP(v, u)); const cH = (v) => f(cvtH(v, u));
  const cS = (v) => { const x = cvtS(v, u); return Math.abs(x) < 10 ? x.toFixed(3) : x.toFixed(2); };
  const lT = lblT(u), lP = lblP(u), lH = lblH(u), lS = lblS(u);
  const sel = OTTO_EQ_TOPICS.find(t => t.id === topic);
  const selColor = sel.color();
  const g = cycle.gas;
  const cv = cvOf(g), cvs = cv.toFixed(4);
  const km1 = (g.k - 1).toFixed(3);
  const rk1 = Math.pow(cycle.r, g.k - 1), rk = Math.pow(cycle.r, g.k);
  const TK = (c) => (c + K2C).toFixed(1);
  const stepStyle = { background: K.cardAlt, border: `1px solid ${K.border}`, padding: isWide ? "18px 22px" : "10px 12px", marginBottom: isWide ? 12 : 8, fontSize: isWide ? 16 : 10.5, lineHeight: 2, fontFamily: FM };
  const numStyle = { color: K.accent, fontWeight: 700 };
  const resultStyle = { background: K.card, border: `2px solid ${selColor}`, padding: isWide ? "18px 22px" : "10px 12px", textAlign: "center", marginTop: isWide ? 10 : 4 };
  const labelStyle = { color: K.inkLight, fontSize: isWide ? 12 : 9, marginBottom: isWide ? 6 : 4 };
  const noteStyle = { color: K.inkLight, fontSize: isWide ? 13 : 9, marginTop: isWide ? 6 : 4 };
  const resultLabelStyle = { fontSize: isWide ? 12 : 9, color: K.inkLight, marginBottom: isWide ? 4 : 2 };
  const resultValueStyle = { fontSize: isWide ? 24 : 16, fontFamily: FD, color: selColor };

  function renderContent() {
    switch (topic) {
      case "wexp": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>W_expansion = u₃ − u₄ = c_v (T₃ − T₄)</div>
          <div style={noteStyle}>Isentropic expansion of a closed system: boundary work ∫P dv equals the drop in internal energy. With constant c_v, that is c_v·ΔT (temperatures in kelvin).</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 1 — T₄ from the isentropic relation</div>
          <div>T₄ = T₃ / r^(k−1) = {TK(cycle.T3)} K / {cycle.r.toFixed(1)}^{km1} = {TK(cycle.T3)} / {rk1.toFixed(4)}</div>
          <div>T₄ = <span style={numStyle}>{TK(cycle.T4)}</span> K = <span style={numStyle}>{cT(cycle.T4)}</span> {lT}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 2 — Internal energies (c_v = c_p − R = {cvs} kJ/kg·K)</div>
          <div>u₃ = c_v·T₃ = {cvs} × {TK(cycle.T3)} = <span style={numStyle}>{cH(cycle.u3)}</span> {lH}</div>
          <div>u₄ = c_v·T₄ = {cvs} × {TK(cycle.T4)} = <span style={numStyle}>{cH(cycle.u4)}</span> {lH}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>W_expansion = {cH(cycle.u3)} − {cH(cycle.u4)} = <strong>{cH(cycle.wExp)}</strong> {lH}</div>
        </div>
      </>);
      case "wcomp": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA (sign convention: work in is negative)</div>
          <div>W_comp = −(u₂ − u₁) = −c_v (T₂ − T₁)</div>
          <div style={noteStyle}>Isentropic compression of the trapped charge from BDC to TDC. The gas gains the work as internal energy.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 1 — T₂ from the isentropic relation</div>
          <div>T₂ = T₁ · r^(k−1) = {TK(cycle.T1)} K × {cycle.r.toFixed(1)}^{km1} = {TK(cycle.T1)} × {rk1.toFixed(4)}</div>
          <div>T₂ = <span style={numStyle}>{TK(cycle.T2)}</span> K = <span style={numStyle}>{cT(cycle.T2)}</span> {lT}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 2 — Internal energies</div>
          <div>u₁ = c_v·T₁ = <span style={numStyle}>{cH(cycle.u1)}</span> {lH}</div>
          <div>u₂ = c_v·T₂ = <span style={numStyle}>{cH(cycle.u2)}</span> {lH}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>W_comp = −({cH(cycle.u2)} − {cH(cycle.u1)}) = <strong>−{cH(cycle.wComp)}</strong> {lH}</div>
        </div>
      </>);
      case "qin": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>Q_in = u₃ − u₂ = c_v (T₃ − T₂)</div>
          <div style={noteStyle}>Constant-volume heat addition: no boundary work, so every joule of heat becomes internal energy. This is what makes the Otto cycle's heat addition c_v-based, not c_p-based.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>CALCULATION</div>
          <div>u₂ = c_v·T₂ = {cvs} × {TK(cycle.T2)} = <span style={numStyle}>{cH(cycle.u2)}</span> {lH}</div>
          <div>u₃ = c_v·T₃ = {cvs} × {TK(cycle.T3)} = <span style={numStyle}>{cH(cycle.u3)}</span> {lH}</div>
          <div style={{ color: K.inkLight, marginTop: 4 }}>Peak pressure: P₃ = P₂ · T₃/T₂ = {cP(cycle.p2)} × {TK(cycle.T3)}/{TK(cycle.T2)} = <span style={numStyle}>{cP(cycle.p3)}</span> {lP}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>Q_in = {cH(cycle.u3)} − {cH(cycle.u2)} = <strong>{cH(cycle.qIn)}</strong> {lH}</div>
        </div>
      </>);
      case "qout": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA (sign convention: heat out is negative)</div>
          <div>Q_out = −(u₄ − u₁) = −c_v (T₄ − T₁)</div>
          <div style={noteStyle}>Constant-volume heat rejection at BDC (the exhaust blowdown). In a real engine this energy leaves with the exhaust gas.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>CALCULATION</div>
          <div>u₄ = c_v·T₄ = {cvs} × {TK(cycle.T4)} = <span style={numStyle}>{cH(cycle.u4)}</span> {lH}</div>
          <div>u₁ = c_v·T₁ = {cvs} × {TK(cycle.T1)} = <span style={numStyle}>{cH(cycle.u1)}</span> {lH}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>Q_out = −({cH(cycle.u4)} − {cH(cycle.u1)}) = <strong>−{cH(cycle.qOut)}</strong> {lH}</div>
        </div>
      </>);
      case "eta": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>η_th = W_net / Q_in = (W_exp + W_comp) / Q_in</div>
          <div style={noteStyle}>For the ideal constant-c_v Otto cycle this reduces to η_th = 1 − 1 / r^(k−1): efficiency depends only on the compression ratio and the gas's k = {g.k} ({g.name}), not on T₃ or how much fuel is burned.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 1 — From the energy terms</div>
          <div>W_net = {cH(cycle.wExp)} + (−{cH(cycle.wComp)}) = <span style={numStyle}>{cH(cycle.wNet)}</span> {lH}</div>
          <div>η_th = {cH(cycle.wNet)} / {cH(cycle.qIn)} = <span style={numStyle}>{(cycle.eta * 100).toFixed(2)}%</span></div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 2 — From the compression ratio (check)</div>
          <div>η_th = 1 − 1 / {cycle.r.toFixed(1)}^{km1} = 1 − 1 / {rk1.toFixed(4)} = <span style={numStyle}>{((1 - 1 / rk1) * 100).toFixed(2)}%</span></div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>η_th = <strong>{(cycle.eta * 100).toFixed(2)}%</strong></div>
        </div>
      </>);
      case "wnet": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>W_net = W_expansion + W_comp  (W_comp is negative)</div>
          <div style={noteStyle}>Also: W_net = Q_in + Q_out  (Q_out is negative, energy balance). On the P–v diagram W_net is the area enclosed by the loop.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>FROM WORK TERMS</div>
          <div>W_net = {cH(cycle.wExp)} + (−{cH(cycle.wComp)}) = <span style={numStyle}>{cH(cycle.wNet)}</span> {lH}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>FROM HEAT TERMS (check)</div>
          <div>W_net = {cH(cycle.qIn)} + (−{cH(cycle.qOut)}) = <span style={numStyle}>{cH(cycle.qIn - cycle.qOut)}</span> {lH}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>W_net = <strong>{cH(cycle.wNet)}</strong> {lH}</div>
        </div>
      </>);
      case "mep": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>MEP = W_net / (v₁ − v₂) = W_net / (v_max − v_min)</div>
          <div style={noteStyle}>The mean effective pressure is the constant pressure that, acting over the full stroke, would do the same net work. It lets engines of different displacement be compared directly.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>CALCULATION</div>
          <div>v₁ − v₂ = {cycle.v1.toFixed(4)} − {cycle.v2.toFixed(4)} = <span style={numStyle}>{(cycle.v1 - cycle.v2).toFixed(4)}</span> m³/kg</div>
          <div>MEP = {cycle.wNet.toFixed(1)} kJ/kg / {(cycle.v1 - cycle.v2).toFixed(4)} m³/kg = <span style={numStyle}>{cycle.mep.toFixed(0)}</span> kPa</div>
          <div style={{ color: K.inkLight, marginTop: 4 }}>Compare with P₁ = {cP(cycle.p1)} {lP} and peak P₃ = {cP(cycle.p3)} {lP}: MEP / P₁ = {(cycle.mep / cycle.p1).toFixed(2)}.</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>MEP = <strong>{fmtP(cycle.mep, u)}</strong></div>
        </div>
      </>);
      case "states": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 1 — BDC, start of compression (given)</div>
          <div>T₁ = <span style={numStyle}>{cT(cycle.T1)}</span> {lT} = {TK(cycle.T1)} K, P₁ = <span style={numStyle}>{cP(cycle.p1)}</span> {lP}</div>
          <div>v₁ = R·T₁/P₁ = <span style={numStyle}>{cycle.v1.toFixed(4)}</span> m³/kg, u₁ = c_v·T₁ = <span style={numStyle}>{cH(cycle.u1)}</span> {lH}, s₁ = <span style={numStyle}>{cS(cycle.s1)}</span> {lS}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 2 — TDC, end of compression (isentropic, v₂ = v₁/r)</div>
          <div>v₂ = {cycle.v1.toFixed(4)} / {cycle.r.toFixed(1)} = <span style={numStyle}>{cycle.v2.toFixed(4)}</span> m³/kg; T₂ = T₁·r^(k−1) = <span style={numStyle}>{cT(cycle.T2)}</span> {lT}</div>
          <div>P₂ = P₁·r^k = {cP(cycle.p1)} × {rk.toFixed(3)} = <span style={numStyle}>{cP(cycle.p2)}</span> {lP}, u₂ = <span style={numStyle}>{cH(cycle.u2)}</span> {lH}, s₂ = s₁ = <span style={numStyle}>{cS(cycle.s2)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 3 — TDC, after combustion (given T₃, v₃ = v₂)</div>
          <div>T₃ = <span style={numStyle}>{cT(cycle.T3)}</span> {lT}, v₃ = <span style={numStyle}>{cycle.v2.toFixed(4)}</span> m³/kg</div>
          <div>P₃ = P₂·T₃/T₂ = <span style={numStyle}>{cP(cycle.p3)}</span> {lP}, u₃ = <span style={numStyle}>{cH(cycle.u3)}</span> {lH}, s₃ = s₂ + c_v·ln(T₃/T₂) = <span style={numStyle}>{cS(cycle.s3)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 4 — BDC, end of expansion (isentropic, v₄ = v₁)</div>
          <div>T₄ = T₃ / r^(k−1) = <span style={numStyle}>{cT(cycle.T4)}</span> {lT}, v₄ = <span style={numStyle}>{cycle.v1.toFixed(4)}</span> m³/kg</div>
          <div>P₄ = P₃ / r^k = <span style={numStyle}>{cP(cycle.p4)}</span> {lP}, u₄ = <span style={numStyle}>{cH(cycle.u4)}</span> {lH}, s₄ = s₃ = <span style={numStyle}>{cS(cycle.s4)}</span></div>
        </div>
      </>);
      default: return null;
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: K.card, border: `1.5px solid ${K.border}`, maxWidth: isWide ? 820 : 420, width: "100%", padding: isWide ? "36px 40px" : "20px 16px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginTop: isWide ? 60 : 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isWide ? 22 : 14, borderBottom: `2px solid ${K.ink}`, paddingBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: isWide ? 28 : 16, fontFamily: FD, color: K.ink }}>Solve: <span style={{ color: selColor }}>{sel.title}</span></h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: isWide ? 14 : 11, cursor: "pointer", padding: isWide ? "6px 20px" : "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: isWide ? 8 : 5, marginBottom: isWide ? 22 : 14 }}>
          {OTTO_EQ_TOPICS.map(t => {
            const c = t.color();
            return (
              <button key={t.id} onClick={() => setTopic(t.id)} style={{
                padding: isWide ? "8px 18px" : "4px 10px", fontSize: isWide ? 14 : 9, fontFamily: FM,
                background: topic === t.id ? c : K.cardAlt, color: topic === t.id ? "#fff" : K.inkMed,
                border: `1px solid ${topic === t.id ? c : K.border}`, cursor: "pointer", borderRadius: 3, fontWeight: topic === t.id ? 700 : 400, transition: "all 0.15s",
              }}>{t.label}</button>
            );
          })}
        </div>
        {renderContent()}
        <button onClick={onClose} style={{ width: "100%", padding: isWide ? "14px" : "10px", background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: isWide ? 16 : 12, fontFamily: FD, cursor: "pointer", marginTop: 14 }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── State Table ───────── */
function OttoStateTable({ cycle, onSelectState, textScale, units }) {
  const isWide = useIsDesktop();
  const sc = textScale || 1;
  const sz = (px) => Math.round(px * sc);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const fmt = v => Math.abs(v) < 10 ? v.toFixed(3) : Math.abs(v) < 100 ? v.toFixed(2) : v.toFixed(1);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FM, fontSize: sz(isWide ? 16 : 10) }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${K.ink}` }}>
            {["State", "Desc", `T (${lblT(u)})`, `P (${lblP(u)})`, `u (${lblH(u)})`, `s (${lblS(u)})`, "v (m³/kg)"].map(h => (
              <th key={h} style={{ padding: isWide ? "8px 4px" : "6px 3px", color: K.inkMed, fontWeight: 400, textAlign: "center", fontSize: sz(isWide ? 14 : 9), fontStyle: "italic" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cycle.states.map((s, i) => (
            <tr key={i}
              onClick={() => onSelectState({ s: s.s, T: s.T, P: s.P, v: s.v, u: s.u })}
              style={{ borderBottom: `0.5px solid ${K.gridMajor}`, cursor: "pointer", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = K.cardAlt}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.accent, fontFamily: FD, fontSize: sz(isWide ? 20 : 13) }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  {s.label}
                  <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.4 }}><circle cx="4" cy="4" r="3" fill="none" stroke={K.accent} strokeWidth="1" /><circle cx="4" cy="4" r="1" fill={K.accent} /></svg>
                </span>
              </td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.inkLight, fontSize: sz(isWide ? 12 : 8) }}>{s.desc}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.ink }}>{fmt(cvtT(s.T, u))}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.ink }}>{fmt(cvtP(s.P, u))}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.ink }}>{fmt(cvtH(s.u, u))}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.ink }}>{fmt(cvtS(s.s, u))}</td>
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.inkMed, fontSize: sz(isWide ? 14 : 9) }}>{s.v.toFixed(4)}</td>
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

/* ───────── Main Otto Page ───────── */
export default function OttoPage({ onBack }) {
  const [darkMode, setDarkMode] = useState(() => {
    try { return document.cookie.split('; ').find(c => c.startsWith('darkMode='))?.split('=')[1] === 'true'; } catch { return false; }
  });
  K = darkMode ? K_DARK : K_LIGHT;
  const toggleDarkMode = useCallback(() => {
    setDarkMode(d => { const next = !d; document.cookie = `darkMode=${next};path=/;max-age=31536000`; return next; });
  }, []);

  const [textScale, setTextScale] = useState(() => {
    try { const v = parseFloat(document.cookie.split('; ').find(c => c.startsWith('textScale='))?.split('=')[1]); return isNaN(v) ? 1 : Math.max(0.8, Math.min(1.6, v)); } catch { return 1; }
  });
  const handleScaleChange = useCallback((s) => { setTextScale(s); document.cookie = `textScale=${s};path=/;max-age=31536000`; }, []);
  const sz = (px) => Math.round(px * textScale);

  const initParams = (() => { try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); } })();
  const initNum = (key, def) => { const v = parseFloat(initParams.get(key)); return isNaN(v) ? def : v; };
  const [gasIdx, setGasIdx] = useState(() => Math.max(0, GASES.findIndex(g => g.id === initParams.get("gas"))));
  const [showGasInfo, setShowGasInfo] = useState(false);
  const [r, setR] = useState(() => clampR(initNum("r", 8)));
  const [p1, setP1] = useState(() => clampP1(initNum("p1", 100)));
  const [t1, setT1] = useState(() => Math.max(T1_MIN, Math.min(T1_MAX, initNum("t1", 25))));
  const [t3, setT3] = useState(() => Math.max(300, Math.min(T3_MAX, initNum("t3", 1500))));
  const [shareCopied, setShareCopied] = useState(false);
  const [eqsCopied, setEqsCopied] = useState(false);
  const [units, setUnits] = useState(() => loadUnits());
  const [showSettings, setShowSettings] = useState(false);
  const handleUnitsChange = useCallback((up) => { setUnits(up); saveUnits(up); }, []);
  const [animating, setAnimating] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const [animSpeed, setAnimSpeed] = useState(() => loadAnimSpeed());
  const handleAnimSpeedChange = useCallback((v) => { setAnimSpeed(v); saveAnimSpeed(v); }, []);
  const [showInfo, setShowInfo] = useState(false);
  const [showEqs, setShowEqs] = useState(false);
  const [eqTopic, setEqTopic] = useState(null);
  const [showTour, setShowTour] = useState(() => { try { return !localStorage.getItem("tourSeen"); } catch { return false; } });
  const [forcedTour, setForcedTour] = useState(() => { try { return !localStorage.getItem("tourSeen"); } catch { return false; } });
  const [showWelcome] = useState(false);
  const [showAreas, setShowAreas] = useState(false);
  const [showPvAreas, setShowPvAreas] = useState(false);
  const [lineDragInfo, setLineDragInfo] = useState(null);
  const [lockS, setLockS] = useState(false);
  const [lockT, setLockT] = useState(false);
  const [lockP, setLockP] = useState(false);
  const [lockV, setLockV] = useState(false);

  const gas = GASES[gasIdx];
  const t2c = (t1 + K2C) * Math.pow(r, gas.k - 1) - K2C;
  const minT3 = Math.ceil((t2c + 100) / 10) * 10;
  const adjustedT3 = Math.max(t3, minT3);
  const cycle = useMemo(() => calculateOtto(gas, r, p1, t1, adjustedT3), [gas, r, p1, t1, adjustedT3]);
  const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);

  const [dragPoint, setDragPoint] = useState(() => ({ ...cycle.states[0] }));
  const handleDrag = useCallback((pt) => setDragPoint({ s: pt.s, T: pt.T, P: pt.P, v: pt.v, u: pt.u }), []);
  const animSeg = animating ? Math.min(3, Math.floor(animProgress * 4)) : -1;

  // Animate: dragPoint walks 1→2→3→4→1 along the drawn lines (~6 s loop at 1×)
  useEffect(() => {
    if (!animating) return;
    const segMs = 1500 / Math.max(0.05, animSpeed);
    const totalMs = segMs * 4;
    let cancelled = false, rafId = 0;
    const t0 = performance.now();
    const tick = (now) => {
      if (cancelled) return;
      // rAF timestamps can precede the performance.now() captured above → keep elapsed in [0, totalMs)
      const elapsed = ((now - t0) % totalMs + totalMs) % totalMs;
      const segIdx = Math.min(3, Math.max(0, Math.floor(elapsed / segMs)));
      const frac = (elapsed - segIdx * segMs) / segMs;
      let pt;
      if (segIdx === 1) pt = walkPath(cycle.combPath, frac, "s", "T");
      else if (segIdx === 3) pt = walkPath(cycle.rejPath, frac, "s", "T");
      else { const a = cycle.states[segIdx], b = cycle.states[(segIdx + 1) % 4]; pt = { s: a.s + (b.s - a.s) * frac, T: a.T + (b.T - a.T) * frac }; }
      setDragPoint(propsST(cycle.gas, pt.s, pt.T));
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

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.ink, fontFamily: FM, maxWidth: desktop ? 1750 : 480, margin: "0 auto" }}>
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
                Otto <span style={{ color: K.workOut, fontStyle: "italic" }}>Cycle</span>
              </h1>
              <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM, letterSpacing: 2, marginTop: 2 }}>Ideal Spark-Ignition Engine Cycle Analysis</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button data-tour="otto-theory" onClick={() => setShowInfo(true)} style={{ background: K.accent, border: "none", padding: desktop ? "10px 20px" : "7px 14px", color: "#fff", fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>Theory</button>
            <button data-tour="otto-gases" onClick={() => setShowGasInfo(true)} style={{ background: K.workOut, border: "none", padding: desktop ? "10px 20px" : "7px 14px", color: "#fff", fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>Gases</button>
            <button data-tour="otto-settings" onClick={() => setShowSettings(true)} style={{ background: "none", border: `1px solid ${K.border}`, padding: desktop ? "10px 20px" : "7px 14px", color: K.inkMed, fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>⚙ Settings</button>
            <button onClick={() => { setForcedTour(false); setShowTour(true); }} style={{ background: "none", border: `1px solid ${K.border}`, padding: desktop ? "10px 20px" : "7px 14px", color: K.inkMed, fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>Instructions</button>
          </div>
        </div>
        {/* Working-gas selector */}
        <div data-tour="otto-gas-selector" style={{ display: "flex", flexWrap: "wrap", gap: desktop ? 8 : 5 }}>
          {GASES.map((g, i) => (
            <button key={g.id} onClick={() => setGasIdx(i)} style={{
              padding: desktop ? "6px 14px" : "4px 10px", fontSize: sz(desktop ? 13 : 9), fontFamily: FM,
              background: i === gasIdx ? K.workOut : K.cardAlt, color: i === gasIdx ? "#fff" : K.inkMed,
              border: `1px solid ${i === gasIdx ? K.workOut : K.border}`, cursor: "pointer", borderRadius: 3, fontWeight: i === gasIdx ? 700 : 400, transition: "all 0.15s",
            }}>{g.name} <span style={{ opacity: 0.75 }}>k={g.k}</span></button>
          ))}
        </div>
      </div>
      <OttoInfoModal open={showInfo} onClose={() => setShowInfo(false)} />
      <OttoGasInfoModal open={showGasInfo} onClose={() => setShowGasInfo(false)} currentGas={gas} />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} K={K} FD={FD} FM={FM}
        textScale={textScale} onTextScaleChange={handleScaleChange}
        darkMode={darkMode} onDarkModeToggle={toggleDarkMode}
        units={units} onUnitsChange={handleUnitsChange}
        animSpeed={animSpeed} onAnimSpeedChange={handleAnimSpeedChange} />
      <WelcomePopup open={showWelcome} K={K} textScale={textScale} onScaleChange={handleScaleChange} onStart={() => { localStorage.setItem("tourSeen", "1"); setShowTour(true); }} onDismiss={() => { localStorage.setItem("tourSeen", "1"); }} />
      <GuidedTour steps={OTTO_TOUR_STEPS} isOpen={showTour} forced={forcedTour} onClose={() => { setShowTour(false); setForcedTour(false); localStorage.setItem("tourSeen", "1"); }} K={K} textScale={textScale} onScaleChange={handleScaleChange} />

      {/* Performance */}
      <div style={{ margin: `${gap}px ${gap}px 0`, padding: desktop ? "16px" : "12px", background: K.card, border: `1px solid ${K.border}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { l: "η thermal", v: `${(cycle.eta * 100).toFixed(1)}%`, c: K.accent },
          { l: "W net", v: fmt(cvtH(cycle.wNet, units)), c: K.workOut, s: lblH(units) },
          { l: "MEP", v: fmt(cvtP(cycle.mep, units)), c: K.workIn, s: lblP(units) },
        ].map((m, i) => (
          <div key={i} style={{ textAlign: "center", padding: desktop ? "8px 0" : "4px 0" }}>
            <div style={{ fontSize: sz(desktop ? 15 : 8), color: K.inkLight, fontFamily: FM, letterSpacing: 1, marginBottom: 3, textTransform: "uppercase", fontStyle: "italic" }}>{m.l}</div>
            <div style={{ fontSize: sz(desktop ? 40 : 20), fontFamily: FD, color: m.c, lineHeight: 1.2 }}>{m.v}</div>
            {m.s && <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM }}>{m.s}</div>}
          </div>
        ))}
      </div>

      {/* Row: Schematic + Volume Visualizer */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>Piston–Cylinder Schematic <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— {gas.name}</span></h3>
          <div data-tour="otto-schematic"><OttoSchematicDiagram cycle={cycle} dragPoint={dragPoint} textScale={textScale} units={units} animating={animating} animSeg={animSeg} /></div>
        </div>
        <div data-tour="otto-visualizer" style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}`, display: "flex", flexDirection: "column" } : card}>
          <h3 style={sec}>Volume Visualizer <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— drag a point on the diagrams below</span></h3>
          <VolumeBoxVisualizer T={dragPoint.T} P={dragPoint.P} v={dragPoint.v} vMin={cycle.vMin} vMax={cycle.vMax} tLow={cycle.T1} tHigh={cycle.T3} fillHeight={desktop} textScale={textScale} units={units} smooth={!animating} />
        </div>
      </div>

      {/* Row: T-s + P-v Diagrams */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div data-tour="otto-ts-diagram" style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...sec, marginBottom: desktop ? 15 : 8 }}>
            <span>T–s Diagram <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— interactive</span></span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setAnimating(a => !a)} style={{
                background: animating ? K.accent : "none", border: `1px solid ${animating ? K.accent : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: animating ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>{animating ? "⏸ Pause" : "▶ Animate"}</button>
              <button data-tour="otto-eta-areas" onClick={() => setShowAreas(a => !a)} style={{
                background: showAreas ? K.workOut : "none", border: `1px solid ${showAreas ? K.workOut : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: showAreas ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>η areas</button>
              <button data-tour="otto-fx" onClick={() => setShowEqs(true)} style={{
                background: "none", border: `1px solid ${K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4,
              }}>f(x)</button>
            </div>
          </div>
          <div data-tour="otto-lock-buttons" style={{ display: "flex", gap: 8, marginBottom: desktop ? 15 : 8 }}>
            <button onClick={() => { setLockS(l => !l); if (!lockS) { setLockT(false); setLockP(false); setLockV(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockS ? K.accent : K.cardAlt, color: lockS ? "#fff" : K.inkMed, border: `1px solid ${lockS ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockS ? 700 : 400, transition: "all 0.15s" }}>
              {lockS ? "🔒" : "🔓"} Lock s = {cvtS(dragPoint.s, units).toFixed(2)} {lblS(units)}
            </button>
            <button onClick={() => { setLockT(l => !l); if (!lockT) { setLockS(false); setLockP(false); setLockV(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockT ? K.accent : K.cardAlt, color: lockT ? "#fff" : K.inkMed, border: `1px solid ${lockT ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockT ? 700 : 400, transition: "all 0.15s" }}>
              {lockT ? "🔒" : "🔓"} Lock T = {fmtT(dragPoint.T, units, 0)}
            </button>
          </div>
          <OttoTsDiagram cycle={cycle} dragPoint={dragPoint} onDrag={handleDrag} lockS={lockS} lockT={lockT} showAreas={showAreas} onRChange={setR} onP1Change={setP1}
            lineDragInfo={lineDragInfo} onLineDragStart={(which) => setLineDragInfo({ which })} onLineDragMove={(which) => setLineDragInfo({ which })} onLineDragEnd={() => setLineDragInfo(null)} textScale={textScale} units={units} />
        </div>

        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...sec, marginBottom: desktop ? 15 : 8 }}>
            <span>P–v Diagram <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— interactive</span></span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setAnimating(a => !a)} style={{
                background: animating ? K.accent : "none", border: `1px solid ${animating ? K.accent : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: animating ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>{animating ? "⏸ Pause" : "▶ Animate"}</button>
              <button data-tour="otto-pv-areas" onClick={() => setShowPvAreas(a => !a)} style={{
                background: showPvAreas ? K.workOut : "none", border: `1px solid ${showPvAreas ? K.workOut : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: showPvAreas ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>W areas</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: desktop ? 15 : 8 }}>
            <button onClick={() => { setLockP(l => !l); if (!lockP) { setLockV(false); setLockS(false); setLockT(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockP ? K.accent : K.cardAlt, color: lockP ? "#fff" : K.inkMed, border: `1px solid ${lockP ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockP ? 700 : 400, transition: "all 0.15s" }}>
              {lockP ? "🔒" : "🔓"} Lock P = {fmtP(dragPoint.P, units)}
            </button>
            <button onClick={() => { setLockV(l => !l); if (!lockV) { setLockP(false); setLockS(false); setLockT(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockV ? K.accent : K.cardAlt, color: lockV ? "#fff" : K.inkMed, border: `1px solid ${lockV ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockV ? 700 : 400, transition: "all 0.15s" }}>
              {lockV ? "🔒" : "🔓"} Lock v = {dragPoint.v.toFixed(4)} m³/kg
            </button>
          </div>
          <OttoPvDiagram cycle={cycle} dragPoint={dragPoint} onDrag={handleDrag} lockP={lockP} lockV={lockV} showPvAreas={showPvAreas} onRChange={setR} onP1Change={setP1}
            lineDragInfo={lineDragInfo} onLineDragStart={(which) => setLineDragInfo({ which })} onLineDragMove={(which) => setLineDragInfo({ which })} onLineDragEnd={() => setLineDragInfo(null)} textScale={textScale} units={units} />
        </div>
      </div>
      <OttoEquationsModal open={showEqs} onClose={() => { setShowEqs(false); setEqTopic(null); }} cycle={cycle} initialTopic={eqTopic} units={units} />

      {/* Row: Sliders + Table */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : { ...card, padding: "16px" }}>
          <h3 style={sec}>Cycle Parameters</h3>
          <ParamSlider label="Compression Ratio (r = v₁/v₂)" unit="" color={K.workOut} value={r} min={R_MIN} max={R_MAX} step={0.5} onChange={v => setR(clampR(v))} textScale={textScale} />
          <ParamSlider label="Peak Temperature (T₃)" kind="T" color={K.workOut} value={adjustedT3} min={minT3} max={T3_MAX} step={10} onChange={setT3} textScale={textScale} units={units} />
          <ParamSlider label="Intake Temperature (T₁)" kind="T" color={K.workIn} value={t1} min={T1_MIN} max={T1_MAX} step={1} onChange={setT1} textScale={textScale} units={units} />
          <ParamSlider label="Intake Pressure (P₁)" kind="P" color={K.heatOut} value={p1} min={P1_MIN} max={P1_MAX} step={5} onChange={setP1} textScale={textScale} units={units} />
          <div style={{ marginTop: 6, fontSize: sz(desktop ? 15 : 9), color: K.inkLight, borderTop: `1px solid ${K.gridFine}`, paddingTop: 6, fontStyle: "italic" }}>
            T₂ = {fmtT(cycle.T2, units)} &nbsp;|&nbsp; T₄ = {fmtT(cycle.T4, units)} &nbsp;|&nbsp; P₂ = {fmtP(cycle.p2, units)} &nbsp;|&nbsp; P₃ = {fmtP(cycle.p3, units)}
          </div>
        </div>
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>State Point Properties <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— Table 1</span></h3>
          <OttoStateTable cycle={cycle} onSelectState={handleDrag} textScale={textScale} units={units} />
        </div>
      </div>

      {/* Energy Balance */}
      <div data-tour="otto-energy-balance" style={card}>
        <h3 style={sec}>Energy Balance</h3>
        <div style={{ display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: desktop ? 16 : 8 }}>
          <div>
            <div style={{ fontSize: sz(desktop ? 15 : 9), fontFamily: FM, color: K.inkLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${K.border}`, textAlign: "center" }}>Heat Transfer</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { l: "Q in (Combustion)", v: fmt(cvtH(cycle.qIn, units)), u: lblH(units), c: K.heatIn, topic: "qin" },
                { l: "Q out (Exhaust)", v: "−" + fmt(cvtH(cycle.qOut, units)), u: lblH(units), c: K.heatOut, topic: "qout" },
              ].map((e, i) => (
                <div key={i} onClick={() => { setEqTopic(e.topic); setShowEqs(true); }} style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: desktop ? "16px 18px" : "8px 10px", textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, marginBottom: 4, fontStyle: "italic", letterSpacing: 1, textTransform: "uppercase" }}>{e.l}</div>
                  <div style={{ fontSize: sz(desktop ? 35 : 16), fontFamily: FD, color: e.c }}>{e.v}</div>
                  <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM, marginTop: 2 }}>{e.u}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: sz(desktop ? 15 : 9), fontFamily: FM, color: K.inkLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${K.border}`, textAlign: "center" }}>Work</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { l: "W expansion", v: fmt(cvtH(cycle.wExp, units)), u: lblH(units), c: K.workOut, topic: "wexp" },
                { l: "W compression", v: "−" + fmt(cvtH(cycle.wComp, units)), u: lblH(units), c: K.workIn, topic: "wcomp" },
              ].map((e, i) => (
                <div key={i} onClick={() => { setEqTopic(e.topic); setShowEqs(true); }} style={{ background: K.cardAlt, border: `1px solid ${K.border}`, padding: desktop ? "16px 18px" : "8px 10px", textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, marginBottom: 4, fontStyle: "italic", letterSpacing: 1, textTransform: "uppercase" }}>{e.l}</div>
                  <div style={{ fontSize: sz(desktop ? 35 : 16), fontFamily: FD, color: e.c }}>{e.v}</div>
                  <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM, marginTop: 2 }}>{e.u}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginTop: desktop ? 15 : 8, display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: 8 }}>
          <div style={{ padding: desktop ? "14px 18px" : "8px 10px", background: K.cardAlt, border: `1px solid ${K.border}`, textAlign: "center" }}>
            <div style={{ fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontStyle: "italic", marginBottom: 2 }}>Q_in + Q_out (Q_out &lt; 0)</div>
            <div style={{ fontSize: sz(desktop ? 25 : 12), fontFamily: FD, color: K.accent }}>≈ {fmt(cvtH(cycle.qIn - cycle.qOut, units))} {lblH(units)}</div>
          </div>
          <div style={{ padding: desktop ? "14px 18px" : "8px 10px", background: K.cardAlt, border: `1px solid ${K.border}`, textAlign: "center" }}>
            <div style={{ fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontStyle: "italic", marginBottom: 2 }}>W_net = W_exp + W_comp (W_comp &lt; 0)</div>
            <div style={{ fontSize: sz(desktop ? 25 : 12), fontFamily: FD, color: K.workOut }}>= {fmt(cvtH(cycle.wNet, units))} {lblH(units)}</div>
          </div>
        </div>
      </div>

      <div data-tour="otto-share-solution" style={{ textAlign: "center", padding: desktop ? "20px 12px 12px" : "14px 12px 8px", display: "flex", justifyContent: "center", gap: desktop ? 12 : 8, flexWrap: "wrap" }}>
        <button onClick={() => {
          const url = `${window.location.origin}${window.location.pathname}?view=otto&gas=${gas.id}&r=${r}&p1=${p1}&t1=${t1}&t3=${adjustedT3}`;
          navigator.clipboard.writeText(url).then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); });
        }} style={{
          background: shareCopied ? K.workOut : "none", border: `1px solid ${shareCopied ? K.workOut : K.border}`, padding: desktop ? "8px 20px" : "6px 14px",
          color: shareCopied ? "#fff" : K.inkMed, fontSize: sz(desktop ? 13 : 10), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.2s",
        }}>{shareCopied ? "✓ Link Copied" : "🔗 Share Setup"}</button>
        <button onClick={() => {
          const lT = lblT(units), lP = lblP(units), lH = lblH(units), lS = lblS(units);
          const T_ = (v) => cvtT(v, units).toFixed(2);
          const P_ = (v) => cvtP(v, units).toFixed(units.P === "MPa" ? 3 : units.P === "bar" || units.P === "atm" ? 2 : 0);
          const H_ = (v) => cvtH(v, units).toFixed(2);
          const S_ = (v) => cvtS(v, units).toFixed(4);
          const st = cycle.states;
          const line = (i, name) => `State ${st[i].label} (${name}): T = ${T_(st[i].T)} ${lT}, P = ${P_(st[i].P)} ${lP}, u = ${H_(st[i].u)} ${lH}, s = ${S_(st[i].s)} ${lS}, v = ${st[i].v.toFixed(4)} m3/kg`;
          const text = [
            `OTTO CYCLE (ideal gas, constant c_v) — Solution`,
            `Working gas: ${gas.name} (${gas.formula}), c_p = ${gas.cp} kJ/kg·K, c_v = ${(gas.cp - gas.R).toFixed(4)} kJ/kg·K, R = ${gas.R} kJ/kg·K, k = ${gas.k}`,
            `Inputs: r = ${r}, P_1 = ${P_(p1)} ${lP}, T_1 = ${T_(t1)} ${lT}, T_3 = ${T_(adjustedT3)} ${lT}`,
            ``,
            line(0, "BDC, start of compression"), line(1, "TDC, end of compression, isentropic"), line(2, "TDC, after combustion"), line(3, "BDC, end of expansion, isentropic"),
            ``,
            `Compression:    W_comp = u2 − u1 = ${H_(cycle.wComp)} ${lH}`,
            `Combustion:     Q_in   = u3 − u2 = ${H_(cycle.qIn)} ${lH}`,
            `Expansion:      W_exp  = u3 − u4 = ${H_(cycle.wExp)} ${lH}`,
            `Heat rejection: Q_out  = u4 − u1 = ${H_(cycle.qOut)} ${lH}`,
            ``,
            `W_net = W_exp − W_comp = ${H_(cycle.wNet)} ${lH}`,
            `η_th  = W_net / Q_in   = ${(cycle.eta * 100).toFixed(2)} %   (= 1 − 1/r^(k−1))`,
            `MEP   = W_net / (v1 − v2) = ${P_(cycle.mep)} ${lP}`,
          ].join("\n");
          navigator.clipboard.writeText(text).then(() => { setEqsCopied(true); setTimeout(() => setEqsCopied(false), 2000); });
        }} style={{
          background: eqsCopied ? K.accent : "none", border: `1px solid ${eqsCopied ? K.accent : K.border}`, padding: desktop ? "8px 20px" : "6px 14px",
          color: eqsCopied ? "#fff" : K.inkMed, fontSize: sz(desktop ? 13 : 10), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.2s",
        }}>{eqsCopied ? "✓ Copied" : "📋 Copy Solution"}</button>
      </div>
      <div style={{ textAlign: "center", padding: desktop ? "8px 12px 8px" : "6px 12px 6px", fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontFamily: FM, fontStyle: "italic", letterSpacing: 1 }}>
        Ideal Otto Cycle · {gas.name} ({gas.formula}) · Ideal Gas, Constant c_v
      </div>
      <div style={{ textAlign: "center", padding: desktop ? "8px 12px 36px" : "6px 12px 28px", borderTop: `1px solid ${K.border}`, marginTop: desktop ? 8 : 4, marginLeft: desktop ? 40 : 16, marginRight: desktop ? 40 : 16 }}>
        <div style={{ fontSize: sz(desktop ? 14 : 9), color: K.inkMed, fontFamily: FM, marginBottom: 4 }}>Built by <span style={{ fontWeight: 600, color: K.ink }}>Scott Presbrey</span></div>
        <span onClick={() => { const a = "scottypres", d = "gmail", t = "com"; window.location.href = "mailto:" + a + "@" + d + "." + t; }} style={{ fontSize: sz(desktop ? 13 : 8), color: K.accent, fontFamily: FM, textDecoration: "underline", cursor: "pointer" }}>{"scottypres" + "@" + "gmail.com"}</span>
      </div>
    </div>
  );
}
