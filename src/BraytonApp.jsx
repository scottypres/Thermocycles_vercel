import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { K_LIGHT, K_DARK, FD, FM, lerp, ParamSlider, useIsDesktop, SettingsModal, loadUnits, saveUnits, loadAnimSpeed, saveAnimSpeed, fmtT, fmtP, fmtS, cvtT, cvtP, cvtH, cvtS, lblT, lblP, lblH, lblS } from "./shared.jsx";
import { GuidedTour, WelcomePopup, BRAYTON_TOUR_STEPS } from "./GuidedTour.jsx";
let K = K_LIGHT;

/* ───────── Working gases (ideal gas, constant cp — "cold-air standard" for air) ─────────
   h = cp·T(K); s referenced at 300 K, 100 kPa. Air uses the Table A-17 value so
   numbers match the textbook; the others use absolute (third-law) entropies. */
export const GASES = [
  { id: "air", name: "Air", formula: "N₂ / O₂ mix", M: 28.97, cp: 1.005, R: 0.2870, k: 1.400, sRef: 1.70203,
    uses: "Open-cycle gas turbines, jet engines, combined-cycle power plants.",
    note: "The textbook default. Entropy reference matches air Table A-17 (s° = 1.702 kJ/kg·K at 300 K)." },
  { id: "n2", name: "Nitrogen", formula: "N₂", M: 28.013, cp: 1.039, R: 0.2968, k: 1.400, sRef: 6.841,
    uses: "Closed-cycle test loops and inert-atmosphere rigs.",
    note: "Behaves almost identically to air — same k, slightly higher cp and R." },
  { id: "he", name: "Helium", formula: "He", M: 4.003, cp: 5.1926, R: 2.0769, k: 1.667, sRef: 31.52,
    uses: "High-temperature gas-cooled reactors, closed-cycle space power.",
    note: "Monatomic: highest efficiency per pressure ratio, but T₂ climbs fastest and specific volume is ~7× air." },
  { id: "ar", name: "Argon", formula: "Ar", M: 39.948, cp: 0.5203, R: 0.2081, k: 1.667, sRef: 3.876,
    uses: "Closed-cycle laboratory rigs, inert working-fluid studies.",
    note: "Same k as helium with one-tenth the specific volume and cp." },
  { id: "co2", name: "Carbon Dioxide", formula: "CO₂", M: 44.01, cp: 0.846, R: 0.1889, k: 1.289, sRef: 4.860,
    uses: "Closed Brayton studies. Supercritical CO₂ cycles are real-gas cycles and are NOT represented by this model.",
    note: "Lowest k of the set: least efficiency per pressure ratio under the constant-cp assumption." },
];
const T_REF_K = 300, P_REF = 100;
const K2C = 273.15;
const sOf = (g, TK, P) => g.sRef + g.cp * Math.log(TK / T_REF_K) - g.R * Math.log(P / P_REF);
const pOf = (g, TK, s) => P_REF * Math.exp((g.sRef + g.cp * Math.log(TK / T_REF_K) - s) / g.R);
const vOf = (g, TK, P) => g.R * TK / P;
const hOf = (g, TK) => g.cp * TK;
function propsST(g, s, Tc) { const TK = Math.max(1, Tc + K2C); const P = pOf(g, TK, s); return { s, T: Tc, P, v: vOf(g, TK, P), h: hOf(g, TK) }; }
function propsPV(g, P, v) { const TK = Math.max(1, P * v / g.R); return { s: sOf(g, TK, P), T: TK - K2C, P, v, h: hOf(g, TK) }; }

const RP_MIN = 2, RP_MAX = 30, P1_MIN = 50, P1_MAX = 200, T1_MIN = -20, T1_MAX = 60, T3_MAX = 1600;
const clampRp = rp => Math.max(RP_MIN, Math.min(RP_MAX, Math.round(rp * 2) / 2));
const clampP1 = p => Math.max(P1_MIN, Math.min(P1_MAX, Math.round(p / 5) * 5));

function calculateBrayton(gas, rp, p1, t1c, t3c) {
  const x = (gas.k - 1) / gas.k;
  const T1 = t1c + K2C, P1 = p1;
  const P2 = rp * p1, T2 = T1 * Math.pow(rp, x);
  const T3 = t3c + K2C, P3 = P2;
  const T4 = T3 / Math.pow(rp, x), P4 = p1;
  const mk = (label, TK, P, desc) => ({ label, T: TK - K2C, P, s: sOf(gas, TK, P), h: hOf(gas, TK), v: vOf(gas, TK, P), desc });
  const states = [mk("1", T1, P1, "Compressor In"), mk("2", T2, P2, "Combustor In"), mk("3", T3, P3, "Turbine In"), mk("4", T4, P4, "Turbine Out")];
  const [s1, s2, s3, s4] = states.map(s => s.s);
  const [h1, h2, h3, h4] = states.map(s => s.h);
  const wComp = h2 - h1, wTurb = h3 - h4, qIn = h3 - h2, qOut = h4 - h1;
  const wNet = wTurb - wComp, eta = wNet / qIn, bwr = wComp / wTurb;
  const N = 24;
  const combustorPath = Array.from({ length: N + 1 }, (_, i) => { const s = lerp(i / N, 0, 1, s2, s3); return { s, T: T2 * Math.exp((s - s2) / gas.cp) - K2C }; });
  const exhaustPath = Array.from({ length: N + 1 }, (_, i) => { const s = lerp(i / N, 0, 1, s4, s1); return { s, T: T4 * Math.exp((s - s4) / gas.cp) - K2C }; });
  const iso = (Pa, va, vb) => Array.from({ length: N + 1 }, (_, i) => { const v = lerp(i / N, 0, 1, va, vb); return { v, P: Pa * Math.pow(va / v, gas.k) }; });
  const compPvPath = iso(P1, states[0].v, states[1].v);
  const turbPvPath = iso(P3, states[2].v, states[3].v);
  return {
    gas, states, rp, p1, p2: P2, wComp, wTurb, qIn, qOut, wNet, eta, bwr,
    vMin: Math.min(...states.map(s => s.v)), vMax: Math.max(...states.map(s => s.v)),
    // Axis ranges for both diagrams.
    tsMin: -100, tsMax: Math.ceil((t3c + 120) / 100) * 100,
    // s padding scales with the cycle's entropy spread (argon at r_p = 30 spans < 0.1 kJ/kg·K; helium spans > 4)
    // so the cycle fills the plot and labels beside states 1–4 stay on the SVG for every gas
    ...(() => { const sp = s3 - s1, pad = Math.max(0.04, 0.15 * sp), q = sp < 0.5 ? 100 : 10;
      return { sAxisMin: Math.floor((s1 - pad) * q) / q, sAxisMax: Math.ceil((s3 + pad * 1.25) * q) / q }; })(),
    h1, h2, h3, h4, s1, s2, s3, s4, T1: t1c, T2: T2 - K2C, T3: t3c, T4: T4 - K2C,
    combustorPath, exhaustPath, compPvPath, turbPvPath,
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
   A fixed mass of air in a box whose width tracks specific volume. Particle
   speed and colour track temperature. Replaces the phase visualizer (no phase
   change in a gas cycle). */
const NUM_PARTICLES = 320;
const W_CANVAS = 680, H_CANVAS = 480;
const BOX_PAD = 6; // px of clearance between the readout overlay and the smallest box

/* Box side runs from "just larger than the readout" at the cycle's smallest
   specific volume to the full frame at its largest, interpolated in log(v) so
   the intermediate states spread out visibly. */
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
  const speedF = 0.4 + 7 * Math.pow(Math.min(1, TK / 1600), 0.75);

  // Positions are stored normalised (u, w ∈ [0,1]) so the fixed mass of particles
  // compresses with the box instead of piling up against a moving wall.
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
      {/* Fixed-footprint frame: its only children are absolutely positioned, so the box
          can shrink or grow without ever changing the page layout. */}
      <div ref={frameRef} style={fillHeight ? { flex: 1, minHeight: 0, position: "relative" } : { width: "100%", aspectRatio: `${W_CANVAS} / ${H_CANVAS}`, position: "relative" }}>
        {/* No CSS transition while animating: a transition restarted every frame never gets to move in some browsers */}
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
          <span style={{ fontSize: (fillHeight ? 18 : 10) * ts, fontFamily: FM, color: K.inkLight }}>Box width ∝ v</span>
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

function BryTsDiagram({ cycle, dragPoint, onDrag, lockS, lockT, showAreas, onRpChange, onP1Drag, lineDragInfo, onLineDragStart, onLineDragMove, onLineDragEnd, textScale, units }) {
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
  const cp = cycle.gas.cp;
  const combMidS = (st[1].s + st[2].s) / 2;
  const combMidT = (st[1].T + K2C) * Math.exp((combMidS - st[1].s) / cp) - K2C;
  const combTextX = mapS(combMidS), combTextY = mapT(combMidT) - 9;
  const hxMidS = st[0].s + 0.65 * (st[3].s - st[0].s); // biased toward state 4 so it clears the state-1 value box
  const hxMidT = (st[3].T + K2C) * Math.exp((hxMidS - st[3].s) / cp) - K2C;
  const hxTextX = mapS(hxMidS), hxTextY = mapT(hxMidT) + 13;

  const handleStart = useCallback((e) => {
    if (e.touches && e.touches.length === 0) return;
    if (e.preventDefault) e.preventDefault();
    const r = getSvgXY(e);
    if (r) {
      if (Math.abs(r.px - combTextX) < 28 && Math.abs(r.py - combTextY) < 10) {
        lineDragRef.current = "combustor";
        if (onLineDragStart) onLineDragStart("combustor");
        return;
      }
      if (Math.abs(r.px - hxTextX) < 38 && Math.abs(r.py - hxTextY) < 10) {
        lineDragRef.current = "hx";
        if (onLineDragStart) onLineDragStart("hx");
        return;
      }
    }
    draggingRef.current = true;
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, combTextX, combTextY, hxTextX, hxTextY, onLineDragStart]);

  const handleMove = useCallback((e) => {
    if (lineDragRef.current) {
      e.preventDefault();
      const r = getSvgXY(e);
      if (!r) return;
      const TK = Math.max(150, unmapT(r.py) + K2C);
      if (lineDragRef.current === "combustor") {
        const TKlower = (st[0].T + K2C) * Math.exp((combMidS - st[0].s) / cp);
        const rp = clampRp(Math.pow(TK / TKlower, cp / cycle.gas.R));
        if (onRpChange) onRpChange(rp);
        if (onLineDragMove) onLineDragMove("combustor");
      } else {
        const p1 = clampP1(pOf(cycle.gas, TK, hxMidS));
        if (onP1Drag) onP1Drag(p1);
        if (onLineDragMove) onLineDragMove("hx");
      }
      return;
    }
    if (!draggingRef.current) return;
    if (e.touches && e.touches.length === 0) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, onRpChange, onP1Drag, onLineDragMove, st, combMidS, hxMidS, cp, cycle.gas]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnd = useCallback(() => {
    draggingRef.current = false;
    if (lineDragRef.current) { lineDragRef.current = null; if (onLineDragEnd) onLineDragEnd(); }
  }, [onLineDragEnd]);

  const toD = (pts) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${mapS(p.s).toFixed(1)},${mapT(p.T).toFixed(1)}`).join(" ");
  const combD = toD(cycle.combustorPath);
  const exhD = toD(cycle.exhaustPath);
  const cycleFillD = [`M${mapS(st[0].s).toFixed(1)},${mapT(st[0].T).toFixed(1)}`, `L${mapS(st[1].s).toFixed(1)},${mapT(st[1].T).toFixed(1)}`, combD.replace(/^M/, "L"), `L${mapS(st[3].s).toFixed(1)},${mapT(st[3].T).toFixed(1)}`, exhD.replace(/^M/, "L"), "Z"].join(" ");
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
        const qOutD = [`M${mapS(st[3].s).toFixed(1)},${axisY.toFixed(1)}`, `L${mapS(st[3].s).toFixed(1)},${mapT(st[3].T).toFixed(1)}`, exhD.replace(/^M/, "L"), `L${mapS(st[0].s).toFixed(1)},${axisY.toFixed(1)}`, "Z"].join(" ");
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
      <path d={exhD} fill="none" stroke={K.heatOut} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      {lineDragInfo && (() => {
        const isComb = lineDragInfo.which === "combustor";
        const color = isComb ? K.heatIn : K.heatOut;
        const valueText = isComb ? `r_p = P₂/P₁ = ${cycle.rp.toFixed(1)}` : `P₁ = ${fmtP(cycle.p1, u)}`;
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
        <rect x={mapS(st[0].s) - sz(58)} y={(mapT(st[0].T) + mapT(st[1].T)) / 2 - sz(8)} width={sz(52)} height={sz(11)} rx={2} fill={K.card} />
        <text x={mapS(st[0].s) - sz(8)} y={(mapT(st[0].T) + mapT(st[1].T)) / 2} fill={K.workIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="end">Compressor</text>
        <rect x={combTextX - sz(24)} y={combTextY - sz(8)} width={sz(48)} height={sz(11)} rx={2} fill={K.card} />
        <text x={combTextX} y={combTextY} fill={K.heatIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "ns-resize" }}>Combustor</text>
        <rect x={mapS(st[2].s) + sz(6)} y={(mapT(st[2].T) + mapT(st[3].T)) / 2 - sz(8)} width={sz(36)} height={sz(11)} rx={2} fill={K.card} />
        <text x={mapS(st[2].s) + sz(8)} y={(mapT(st[2].T) + mapT(st[3].T)) / 2} fill={K.workOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500">Turbine</text>
        <rect x={hxTextX - sz(36)} y={hxTextY - sz(8)} width={sz(72)} height={sz(11)} rx={2} fill={K.card} />
        <text x={hxTextX} y={hxTextY} fill={K.heatOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "ns-resize" }}>Heat Exchanger</text>
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
        <text x={TS_W - 8} y={TS_PLOT.y + 10} fill={K.inkLight} fontSize={sz(7)} fontFamily={FM} textAnchor="end" fontStyle="italic">{lockS ? "s locked" : lockT ? "T locked" : "tap & drag"}</text>
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

/* ───────── P-v Diagram (linear axes) ───────── */
const PV_W = 360, PV_H = 285;
const PV_PAD = { l: 38, r: 6, t: 14, b: 28 };
const PV_PLOT = { x: PV_PAD.l, y: PV_PAD.t, w: PV_W - PV_PAD.l - PV_PAD.r, h: PV_H - PV_PAD.t - PV_PAD.b };

function BryPvDiagram({ cycle, dragPoint, onDrag, lockP, lockV, showPvAreas, onRpChange, onP1Drag, lineDragInfo, onLineDragStart, onLineDragMove, onLineDragEnd, textScale, units }) {
  const sz = px => px * (textScale || 1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const lineDragRef = useRef(null);
  const [activeArea, setActiveArea] = useState("wTurb");

  const st = cycle.states;
  // Log–log axes (as on the Rankine page): isentropes become straight lines and the cycle stays legible at r_p = 30
  const lvLo = Math.log10(cycle.vMin / 1.7), lvHi = Math.log10(cycle.vMax * 1.7);
  const lpLo = Math.log10(cycle.p1 / 1.7), lpHi = Math.log10(cycle.p2 * 1.7);
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

  const combTextX = (mapV(st[1].v) + mapV(st[2].v)) / 2, combTextY = mapP(cycle.p2) - 7;
  const hxTextX = (mapV(st[3].v) + mapV(st[0].v)) / 2, hxTextY = mapP(cycle.p1) + 13;

  const handleStart = useCallback((e) => {
    if (e.touches && e.touches.length === 0) return;
    if (e.preventDefault) e.preventDefault();
    const r = getSvgXY(e);
    if (r) {
      if (Math.abs(r.px - combTextX) < 28 && Math.abs(r.py - combTextY) < 10) {
        lineDragRef.current = "combustor";
        if (onLineDragStart) onLineDragStart("combustor");
        return;
      }
      if (Math.abs(r.px - hxTextX) < 38 && Math.abs(r.py - hxTextY) < 10) {
        lineDragRef.current = "hx";
        if (onLineDragStart) onLineDragStart("hx");
        return;
      }
    }
    draggingRef.current = true;
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, combTextX, combTextY, hxTextX, hxTextY, onLineDragStart]);

  const handleMove = useCallback((e) => {
    if (lineDragRef.current) {
      e.preventDefault();
      const r = getSvgXY(e);
      if (!r) return;
      const P = unmapP(r.py);
      if (lineDragRef.current === "combustor") {
        if (onRpChange) onRpChange(clampRp(P / cycle.p1));
        if (onLineDragMove) onLineDragMove("combustor");
      } else {
        if (onP1Drag) onP1Drag(clampP1(P));
        if (onLineDragMove) onLineDragMove("hx");
      }
      return;
    }
    if (!draggingRef.current) return;
    if (e.touches && e.touches.length === 0) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (pt) onDrag(pt);
  }, [getSvgXY, getSvgPoint, onDrag, onRpChange, onP1Drag, onLineDragMove, cycle.p1]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnd = useCallback(() => {
    draggingRef.current = false;
    if (lineDragRef.current) { lineDragRef.current = null; if (onLineDragEnd) onLineDragEnd(); }
  }, [onLineDragEnd]);

  const toD = pts => pts.map((p, i) => `${i === 0 ? "M" : "L"}${mapV(p.v).toFixed(1)},${mapP(p.P).toFixed(1)}`).join(" ");
  const compD = toD(cycle.compPvPath), turbD = toD(cycle.turbPvPath);
  const cycleFillD = [compD, `L${mapV(st[2].v).toFixed(1)},${mapP(st[2].P).toFixed(1)}`, turbD.replace(/^M/, "L"), `L${mapV(st[0].v).toFixed(1)},${mapP(st[0].P).toFixed(1)}`, "Z"].join(" ");
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
        const x0 = PV_PLOT.x.toFixed(1);
        // Steady-flow work = −∫v dP: region between the isentrope and the P axis
        const wTurbD = [`M${x0},${mapP(st[2].P).toFixed(1)}`, `L${mapV(st[2].v).toFixed(1)},${mapP(st[2].P).toFixed(1)}`, turbD.replace(/^M/, "L"), `L${x0},${mapP(st[3].P).toFixed(1)}`, "Z"].join(" ");
        const wCompD = [`M${x0},${mapP(st[0].P).toFixed(1)}`, `L${mapV(st[0].v).toFixed(1)},${mapP(st[0].P).toFixed(1)}`, compD.replace(/^M/, "L"), `L${x0},${mapP(st[1].P).toFixed(1)}`, "Z"].join(" ");
        return (<>
          {activeArea === "wTurb" && <path d={wTurbD} fill={`${K.workOut}28`} stroke="none" />}
          {activeArea === "wComp" && <path d={wCompD} fill={`${K.workIn}28`} stroke="none" />}
          {activeArea === "wNet" && <path d={cycleFillD} fill={`${K.workOut}30`} stroke="none" />}
        </>);
      })()}
      {!showPvAreas && <path d={cycleFillD} fill={K.accentLight} stroke="none" />}
      <path d={compD} fill="none" stroke={K.workIn} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={mapV(st[1].v)} y1={mapP(st[1].P)} x2={mapV(st[2].v)} y2={mapP(st[2].P)} stroke={K.heatIn} strokeWidth={2.2} strokeLinecap="round" />
      <path d={turbD} fill="none" stroke={K.workOut} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={mapV(st[3].v)} y1={mapP(st[3].P)} x2={mapV(st[0].v)} y2={mapP(st[0].P)} stroke={K.heatOut} strokeWidth={2.2} strokeLinecap="round" />
      {lineDragInfo && (() => {
        const isComb = lineDragInfo.which === "combustor";
        const lineY = isComb ? mapP(cycle.p2) : mapP(cycle.p1);
        const color = isComb ? K.heatIn : K.heatOut;
        const valueText = isComb ? `P₂ = ${fmtP(cycle.p2, u)} (r_p = ${cycle.rp.toFixed(1)})` : `P₁ = ${fmtP(cycle.p1, u)}`;
        const boxW = Math.max(sz(96), valueText.length * sz(5.7) + sz(16));
        const boxY = PV_PLOT.y + 2;
        return (<>
          <line x1={PV_PLOT.x} y1={lineY} x2={PV_PLOT.x + PV_PLOT.w} y2={lineY} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
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
        const off = [{ dx: sz(10), dy: sz(-8) }, { dx: sz(-12), dy: sz(-8) }, { dx: sz(10), dy: sz(-8) }, { dx: sz(10), dy: sz(-8) }];
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
          const mid = cycle.compPvPath[12];
          const x = mapV(mid.v) - sz(6), y = mapP(mid.P) - sz(4);
          return <><rect x={x - sz(50)} y={y - sz(8)} width={sz(52)} height={sz(11)} rx={2} fill={K.card} /><text x={x} y={y} fill={K.workIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="end">Compressor</text></>;
        })()}
        <rect x={combTextX - sz(24)} y={combTextY - sz(8)} width={sz(48)} height={sz(11)} rx={2} fill={K.card} />
        <text x={combTextX} y={combTextY} fill={K.heatIn} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "ns-resize" }}>Combustor</text>
        {(() => {
          const mid = cycle.turbPvPath[10];
          const x = mapV(mid.v) + sz(8), y = mapP(mid.P) - sz(2);
          return <><rect x={x - sz(2)} y={y - sz(8)} width={sz(36)} height={sz(11)} rx={2} fill={K.card} /><text x={x} y={y} fill={K.workOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500">Turbine</text></>;
        })()}
        <rect x={hxTextX - sz(36)} y={hxTextY - sz(8)} width={sz(72)} height={sz(11)} rx={2} fill={K.card} />
        <text x={hxTextX} y={hxTextY} fill={K.heatOut} fontSize={sz(7)} fontFamily={FM} fontWeight="500" textAnchor="middle" style={{ cursor: "ns-resize" }}>Heat Exchanger</text>
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
          <g onClick={() => setActiveArea("wTurb")} style={{ cursor: "pointer" }} opacity={dot("wTurb")}>
            <rect x={lx + sz(5)} y={ly + sz(5)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.workOut}30`} stroke={K.workOut} strokeWidth={activeArea === "wTurb" ? 1.4 : 0.6} />
            <text x={lx + sz(17)} y={ly + sz(12)} fill={K.workOut} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "wTurb" ? 700 : 400}>W_turbine (3→4) = {fmt(cycle.wTurb)} kJ/kg</text>
          </g>
          <g onClick={() => setActiveArea("wComp")} style={{ cursor: "pointer" }} opacity={dot("wComp")}>
            <rect x={lx + sz(5)} y={ly + sz(18)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.workIn}30`} stroke={K.workIn} strokeWidth={activeArea === "wComp" ? 1.4 : 0.6} />
            <text x={lx + sz(17)} y={ly + sz(25)} fill={K.workIn} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "wComp" ? 700 : 400}>W_comp (1→2) = −{fmt(cycle.wComp)} kJ/kg</text>
          </g>
          <g onClick={() => setActiveArea("wNet")} style={{ cursor: "pointer" }} opacity={dot("wNet")}>
            <rect x={lx + sz(5)} y={ly + sz(31)} width={sz(8)} height={sz(8)} rx={1} fill={`${K.workOut}40`} stroke={K.workOut} strokeWidth={activeArea === "wNet" ? 1.4 : 0.6} />
            <text x={lx + sz(17)} y={ly + sz(38)} fill={K.workOut} fontSize={sz(8)} fontFamily={FM} fontWeight={activeArea === "wNet" ? 700 : 400}>W_net = {fmt(cycle.wNet)} kJ/kg</text>
          </g>
          <text x={lx + sz(5)} y={ly + sz(49)} fill={K.ink} fontSize={sz(8)} fontFamily={FD} fontWeight="bold">BWR = {(cycle.bwr * 100).toFixed(1)}%</text>
        </>);
      })()}
    </svg>
  );
}

/* ───────── Component Detail Modal ───────── */
const BRY_COMPONENT_INFO = {
  compressor: {
    title: "Compressor", color: () => K.workIn, process: "1 → 2", type: "Isentropic Compression",
    purpose: "The compressor draws in ambient air and raises its pressure by the pressure ratio r_p. Because a gas is being compressed rather than a liquid, this takes a large fraction of the turbine output — the defining feature of gas power cycles. The ideal process is isentropic, so temperature rises with pressure even though no heat is added.",
    keyPoints: [
      "Ideal process is isentropic (s₁ = s₂)",
      "Pressure rises from P₁ to P₂ = r_p · P₁",
      "Temperature rises: T₂ = T₁ · r_p^((k−1)/k)",
      "Consumes 40–80% of turbine output (high back work ratio)",
      "Driven directly by the turbine through a shared shaft",
    ],
    equations: [
      { label: "First Law (steady-state, adiabatic)", eq: "w_comp = h₂ − h₁ = c_p (T₂ − T₁)" },
      { label: "Isentropic relation", eq: "T₂ / T₁ = (P₂ / P₁)^((k−1)/k) = r_p^((k−1)/k)" },
      { label: "Power input", eq: "Ẇ_comp = ṁ · c_p · (T₂ − T₁)" },
    ],
    insight: "A Rankine pump moves liquid at ~0.001 m³/kg; a Brayton compressor moves air at ~0.85 m³/kg — roughly 800× the volume per kilogram. That is why steady-flow work (−∫v dP) is so much larger here, and why compressor efficiency dominates real gas-turbine performance.",
  },
  combustor: {
    title: "Combustor (Heat Addition)", color: () => K.heatIn, process: "2 → 3", type: "Constant-Pressure Heat Addition",
    purpose: "Compressed air enters the combustor where fuel is burned (open cycle) or heat is supplied through a heat exchanger (closed cycle) at essentially constant pressure. The gas temperature rises to the turbine inlet temperature T₃, which is capped by turbine blade materials and cooling technology.",
    keyPoints: [
      "Operates at constant high pressure (P₂ = P₃)",
      "No work is done",
      "Specific volume increases as the gas heats (v ∝ T at constant P)",
      "T₃ is limited by blade metallurgy (~1200–1600 °C in modern engines)",
      "Higher T₃ → more net work per kg of air",
    ],
    equations: [
      { label: "First Law (open system, steady state)", eq: "q_in = h₃ − h₂ = c_p (T₃ − T₂)" },
      { label: "Since no work is done", eq: "w_combustor = 0" },
      { label: "Entropy change", eq: "s₃ − s₂ = c_p · ln(T₃ / T₂)" },
    ],
    insight: "On the T–s diagram the combustor follows an isobar, an exponential curve T = T₂·exp((s − s₂)/c_p). Isobars diverge at higher entropy, which is why heat added at high pressure is worth more than the same heat rejected at low pressure.",
  },
  turbine: {
    title: "Turbine", color: () => K.workOut, process: "3 → 4", type: "Isentropic Expansion",
    purpose: "Hot, high-pressure gas expands through the turbine back to ambient pressure, producing shaft work. Part of that work drives the compressor; the remainder is the net output that turns a generator or produces thrust. In the ideal cycle the expansion is isentropic.",
    keyPoints: [
      "Primary work-producing device",
      "Ideal process is isentropic (s₃ = s₄)",
      "Pressure drops from P₂ back to P₁",
      "Exit temperature T₄ is still hot — exhaust energy is large",
      "Same pressure ratio as the compressor, so T₄/T₃ = T₁/T₂",
    ],
    equations: [
      { label: "First Law (steady-state, adiabatic)", eq: "w_turb = h₃ − h₄ = c_p (T₃ − T₄)" },
      { label: "Isentropic relation", eq: "T₄ = T₃ / r_p^((k−1)/k)" },
      { label: "Power output", eq: "Ẇ_turb = ṁ · c_p · (T₃ − T₄)" },
    ],
    insight: "Because T₃ ≫ T₁, the turbine's temperature drop exceeds the compressor's temperature rise by the same ratio, so w_turb > w_comp and the cycle produces net work. The hot exhaust (T₄) is why combined cycles add a Rankine bottoming cycle.",
  },
  hx: {
    title: "Heat Exchanger (Exhaust)", color: () => K.heatOut, process: "4 → 1", type: "Constant-Pressure Heat Rejection",
    purpose: "The working fluid is cooled back to the compressor inlet temperature at constant low pressure. In a closed cycle this is a heat exchanger; in an open cycle (jet engine, power-plant gas turbine) the hot exhaust is simply discharged and fresh air is drawn in, which is thermodynamically equivalent.",
    keyPoints: [
      "Operates at constant low pressure (P₄ = P₁)",
      "No work is done",
      "Heat rejected Q_out = h₄ − h₁",
      "Specific volume falls as the gas cools",
      "Open cycles replace this device with the atmosphere",
    ],
    equations: [
      { label: "First Law (open system, steady state)", eq: "q_out = h₄ − h₁ = c_p (T₄ − T₁)" },
      { label: "Since no work is done", eq: "w_hx = 0" },
      { label: "Entropy change", eq: "s₁ − s₄ = c_p · ln(T₁ / T₄) < 0" },
    ],
    insight: "Regeneration uses this hot exhaust to preheat compressed air before the combustor, cutting fuel use. It only pays off when T₄ > T₂, i.e. at low pressure ratios — a nice thing to verify with the sliders.",
  },
};

function BryComponentModal({ component, cycle, onClose, units }) {
  const isWide = useIsDesktop();
  if (!component) return null;
  const info = BRY_COMPONENT_INFO[component];
  const color = info.color();
  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const cH = (v) => f(cvtH(v, u)); const lH = lblH(u);
  const cT = (v) => f(cvtT(v, u)); const lT = lblT(u);
  const liveValues = {
    compressor: { main: `W_comp = −${cH(cycle.wComp)} ${lH}`, detail: `h₂ − h₁ = ${cH(cycle.h2)} − ${cH(cycle.h1)}; T₂ = ${cT(cycle.T2)} ${lT}` },
    combustor: { main: `Q_in = ${cH(cycle.qIn)} ${lH}`, detail: `h₃ − h₂ = ${cH(cycle.h3)} − ${cH(cycle.h2)}` },
    turbine: { main: `W_turb = ${cH(cycle.wTurb)} ${lH}`, detail: `h₃ − h₄ = ${cH(cycle.h3)} − ${cH(cycle.h4)}; T₄ = ${cT(cycle.T4)} ${lT}` },
    hx: { main: `Q_out = −${cH(cycle.qOut)} ${lH}`, detail: `−(h₄ − h₁) = −(${cH(cycle.h4)} − ${cH(cycle.h1)})` },
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

/* ───────── Schematic ───────── */
function BrySchematicDiagram({ cycle, textScale, units, animating, animProgress }) {
  const sz = px => px * (1 + ((textScale || 1) - 1) * 0.4);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const fmt = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const [activeComponent, setActiveComponent] = useState(null);
  const SEGMENTS = [
    [{ x: 85, y: 273 }, { x: 85, y: 200 }, { x: 85, y: 144 }, { x: 85, y: 82 }],
    [{ x: 85, y: 82 }, { x: 110, y: 57 }, { x: 250, y: 57 }, { x: 290, y: 57 }],
    [{ x: 290, y: 57 }, { x: 290, y: 127 }, { x: 290, y: 219 }, { x: 290, y: 273 }],
    [{ x: 290, y: 273 }, { x: 250, y: 273 }, { x: 110, y: 273 }, { x: 85, y: 273 }],
  ];
  let spriteX = 85, spriteY = 273;
  if (animating != null) {
    const p = ((animProgress || 0) % 1 + 1) % 1;
    const segIdx = Math.min(3, Math.floor(p * 4));
    const pt = walkPath(SEGMENTS[segIdx], (p * 4) - segIdx, "x", "y");
    spriteX = pt.x; spriteY = pt.y;
  }
  const mk = [{ id: "bO", c: K.heatIn }, { id: "bB", c: K.heatOut }, { id: "bG", c: K.workOut }, { id: "bY", c: K.workIn }, { id: "bK", c: K.ink }];
  return (<>
    <svg viewBox="-8 -2 381 330" style={{ width: "100%" }}>
      <defs>
        {mk.map(m => (
          <marker key={m.id} id={m.id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={7} markerHeight={7} orient="auto">
            <path d="M0,1 L9,5 L0,9" fill="none" stroke={m.c} strokeWidth={1.5} />
          </marker>
        ))}
      </defs>
      {Array.from({ length: 21 }, (_, i) => Array.from({ length: 17 }, (_, j) => (
        <circle key={`${i}-${j}`} cx={i * 20 - 10} cy={j * 20} r={0.6} fill={K.gridMajor} />
      )))}
      {/* Shaft between compressor and turbine */}
      <line x1={113} y1={172} x2={267} y2={172} stroke={K.inkLight} strokeWidth={2.5} strokeDasharray="6 4" opacity={0.55} />
      <rect x={190 - sz(16)} y={166 - sz(8)} width={sz(32)} height={sz(11)} fill={K.card} />
      <text x={190} y={166} fill={K.inkLight} fontSize={sz(6.5)} textAnchor="middle" fontFamily={FM} fontStyle="italic">shaft</text>
      {/* COMBUSTOR */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("combustor")}>
        <rect x={110} y={32} width={140} height={50} fill="rgba(255,255,255,0.01)" stroke={K.heatIn} strokeWidth={1.5} />
        {[135, 160, 185, 210, 235].map(x => (
          <path key={x} d={`M${x - 5},74 Q${x - 6},62 ${x},56 Q${x + 6},62 ${x + 5},74 Z`} fill="none" stroke={K.heatIn} strokeWidth={0.5} />
        ))}
        <rect x={180 - sz(34)} y={53 - sz(13)} width={sz(68)} height={sz(16)} fill={K.card} />
        <text x={180} y={53} fill={K.heatIn} fontSize={sz(11)} textAnchor="middle" fontFamily={FD}>Combustor</text>
        <rect x={180 - sz(32)} y={67 - sz(9)} width={sz(64)} height={sz(12)} fill={K.card} />
        <text x={180} y={67} fill={K.inkLight} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic">const. pressure</text>
      </g>
      {/* TURBINE */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("turbine")}>
        <path d="M267,115 L313,138 L313,207 L267,230 Z" fill="rgba(255,255,255,0.01)" stroke={K.workOut} strokeWidth={1.5} strokeLinejoin="round" />
        {[127, 143, 157, 172, 187, 201, 217].map(y => {
          const xr = y < 138 ? 267 + (y - 115) / 23 * 46 : y > 207 ? 313 - (y - 207) / 23 * 46 : 313;
          return <line key={y} x1={271} y1={y} x2={xr - 4} y2={y} stroke={K.workOut} strokeWidth={0.3} />;
        })}
        <rect x={290 - sz(20)} y={170 - sz(12)} width={sz(40)} height={sz(16)} fill={K.card} />
        <text x={290} y={170} fill={K.workOut} fontSize={sz(10)} textAnchor="middle" fontFamily={FD}>Turbine</text>
        <rect x={290 - sz(20)} y={181 - sz(8)} width={sz(40)} height={sz(12)} fill={K.card} />
        <text x={290} y={181} fill={K.inkLight} fontSize={sz(6)} textAnchor="middle" fontFamily={FM} fontStyle="italic">isentropic</text>
      </g>
      {/* HEAT EXCHANGER */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("hx")}>
        <rect x={110} y={248} width={140} height={50} fill="rgba(255,255,255,0.01)" stroke={K.heatOut} strokeWidth={1.5} strokeDasharray="5 3" />
        <path d="M125,275 Q135,265 145,275 Q155,285 165,275 Q175,265 185,275 Q195,285 205,275 Q215,265 225,275 Q235,285 240,278" fill="none" stroke={K.heatOut} strokeWidth={0.7} />
        <rect x={180 - sz(46)} y={265 - sz(11)} width={sz(92)} height={sz(14)} fill={K.card} />
        <text x={180} y={265} fill={K.heatOut} fontSize={sz(11)} textAnchor="middle" fontFamily={FD}>Heat Exchanger</text>
        <rect x={180 - sz(46)} y={292 - sz(8)} width={sz(92)} height={sz(11)} fill={K.card} />
        <text x={180} y={292} fill={K.inkLight} fontSize={sz(7)} textAnchor="middle" fontFamily={FM} fontStyle="italic">const. pressure · exhaust</text>
      </g>
      {/* COMPRESSOR */}
      <g style={{ cursor: "pointer" }} onClick={() => setActiveComponent("compressor")}>
        <path d="M57,127 L113,144 L113,200 L57,217 Z" fill="rgba(255,255,255,0.01)" stroke={K.workIn} strokeWidth={1.5} strokeLinejoin="round" />
        {[139, 152, 165, 178, 191, 205].map(y => {
          const xl = y < 144 ? 113 - (y - 127) / 17 * 56 : y > 200 ? 57 + (y - 200) / 17 * 56 : 57;
          return <line key={y} x1={xl + 4} y1={y} x2={109} y2={y} stroke={K.workIn} strokeWidth={0.3} />;
        })}
        <rect x={85 - sz(30)} y={170 - sz(11)} width={sz(60)} height={sz(14)} fill={K.card} />
        <text x={85} y={170} fill={K.workIn} fontSize={sz(9.5)} textAnchor="middle" fontFamily={FD}>Compressor</text>
        <rect x={85 - sz(20)} y={181 - sz(8)} width={sz(40)} height={sz(12)} fill={K.card} />
        <text x={85} y={181} fill={K.inkLight} fontSize={sz(6)} textAnchor="middle" fontFamily={FM} fontStyle="italic">isentropic</text>
      </g>
      {/* Pipes */}
      <polyline points="85,127 85,82 110,57" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#bK)" />
      <polyline points="250,57 290,57 290,127" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#bK)" />
      <polyline points="290,219 290,273 250,273" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#bK)" />
      <polyline points="110,273 85,273 85,217" fill="none" stroke={K.ink} strokeWidth={1.2} markerEnd="url(#bK)" />
      {[{ n: "2", x: 85, y: 82 }, { n: "3", x: 290, y: 57 }, { n: "4", x: 290, y: 273 }, { n: "1", x: 85, y: 273 }].map((p, i) => (
        <g key={i}><circle cx={p.x} cy={p.y} r={11} fill={K.card} stroke={K.stateCircle} strokeWidth={1.2} /><text x={p.x} y={p.y + 4} fill={K.accent} fontSize={sz(12)} textAnchor="middle" fontFamily={FD}>{p.n}</text></g>
      ))}
      {/* Energy */}
      <line x1={180} y1={10} x2={180} y2={30} stroke={K.heatIn} strokeWidth={1.8} markerEnd="url(#bO)" />
      <text x={180} y={8} fill={K.heatIn} fontSize={sz(8)} textAnchor="middle" fontFamily={FM} fontWeight="700">Q_in = {fmt(cvtH(cycle.qIn, u))} {lblH(u)}</text>
      <line x1={180} y1={298} x2={180} y2={312} stroke={K.heatOut} strokeWidth={1.8} markerEnd="url(#bB)" />
      <text x={180} y={324} fill={K.heatOut} fontSize={sz(8)} textAnchor="middle" fontFamily={FM} fontWeight="700">Q_out = −{fmt(cvtH(cycle.qOut, u))} {lblH(u)}</text>
      <line x1={314} y1={172} x2={331} y2={172} stroke={K.workOut} strokeWidth={1.8} markerEnd="url(#bG)" />
      <text x={336} y={166} fill={K.workOut} fontSize={sz(7.5)} textAnchor="start" fontFamily={FM} fontWeight="700">W_t</text>
      <text x={336} y={177} fill={K.workOut} fontSize={sz(7)} textAnchor="start" fontFamily={FM} fontWeight="700">{fmt(cvtH(cycle.wTurb, u))}</text>
      <text x={336} y={187} fill={K.workOut} fontSize={sz(6)} textAnchor="start" fontFamily={FM} fontWeight="700">{lblH(u)}</text>
      <line x1={53} y1={172} x2={33} y2={172} stroke={K.workIn} strokeWidth={1.8} markerEnd="url(#bY)" />
      <text x={29} y={162} fill={K.workIn} fontSize={sz(7.5)} textAnchor="end" fontFamily={FM} fontWeight="700">W_c</text>
      <text x={29} y={173} fill={K.workIn} fontSize={sz(7)} textAnchor="end" fontFamily={FM} fontWeight="700">−{fmt(cvtH(cycle.wComp, u))}</text>
      <text x={29} y={183} fill={K.workIn} fontSize={sz(6)} textAnchor="end" fontFamily={FM} fontWeight="700">{lblH(u)}</text>
      {animating && <>
        <circle cx={spriteX} cy={spriteY} r={7} fill={K.accent} opacity={0.9} />
        <circle cx={spriteX} cy={spriteY} r={12} fill="none" stroke={K.accent} strokeWidth={1.5} opacity={0.5}>
          <animate attributeName="r" values="7;14;7" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.2s" repeatCount="indefinite" />
        </circle>
      </>}
    </svg>
    <BryComponentModal component={activeComponent} cycle={cycle} onClose={() => setActiveComponent(null)} units={u} />
  </>);
}

/* ───────── Info Modal (Theory) ───────── */
function BryInfoModal({ open, onClose }) {
  const isWide = useIsDesktop();
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 10px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: K.card, border: `1.5px solid ${K.border}`, maxWidth: isWide ? 780 : 420, width: "100%", padding: isWide ? "36px 40px" : "24px 18px", color: K.ink, fontFamily: FM, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginTop: isWide ? 60 : 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isWide ? 20 : 16, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: isWide ? 28 : 18, fontFamily: FD, color: K.ink }}>The Brayton Cycle</h2>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: isWide ? 14 : 11, cursor: "pointer", padding: isWide ? "5px 16px" : "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <p style={{ fontSize: isWide ? 16 : 11, lineHeight: 1.9, color: K.inkMed, marginBottom: isWide ? 20 : 16 }}>
          The Brayton cycle is the ideal cycle for gas-turbine engines — jet engines, power-plant gas turbines, and the topping cycle of combined-cycle plants. The working fluid stays a gas throughout, so there is no phase change; instead, specific volume swings by an order of magnitude as the gas is compressed, heated, and expanded. This tool uses ideal-gas, constant-specific-heat assumptions (the "cold-air standard" when the gas is air). Pick the working gas in the header: the specific-heat ratio k sets the efficiency for a given pressure ratio, and R sets the specific volume.
        </p>
        <div style={isWide ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 } : {}}>
          <div style={{ borderLeft: `3px solid ${K.workIn}`, paddingLeft: 12, marginBottom: isWide ? 0 : 16 }}>
            <div style={{ fontFamily: FD, fontSize: isWide ? 18 : 13, marginBottom: 10, color: K.ink }}>Four Processes</div>
            {[
              { r: "1 → 2", l: "Compressor — Isentropic Compression", c: K.workIn, d: "Ambient air is compressed to P₂ = r_p·P₁. Temperature rises with no heat added." },
              { r: "2 → 3", l: "Combustor — Const-P Heat Addition", c: K.heatIn, d: "Fuel burns (or heat is added) at constant pressure, raising the gas to the turbine inlet temperature T₃." },
              { r: "3 → 4", l: "Turbine — Isentropic Expansion", c: K.workOut, d: "Hot gas expands back to P₁, producing work. Part drives the compressor; the rest is net output." },
              { r: "4 → 1", l: "Heat Exchanger — Const-P Heat Rejection", c: K.heatOut, d: "Exhaust is cooled to T₁ (closed cycle) or discharged to atmosphere (open cycle)." },
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
              <div>{"η_th = W_net / Q_in = 1 − 1 / r_p^((k−1)/k)"}</div>
              <div style={{ color: K.workIn }}>{"W_comp = −c_p (T₂ − T₁)  (−, work in)"}</div>
              <div style={{ color: K.heatIn }}>{"Q_in = c_p (T₃ − T₂)  (+, heat in)"}</div>
              <div style={{ color: K.workOut }}>{"W_turb = c_p (T₃ − T₄)  (+, work out)"}</div>
              <div style={{ color: K.heatOut }}>{"Q_out = −c_p (T₄ − T₁)  (−, heat out)"}</div>
              <div>BWR = |W_comp| / W_turb</div>
              <div style={{ borderTop: `1px solid ${K.border}`, marginTop: 6, paddingTop: 6, color: K.inkLight }}>Isentropic relations:</div>
              <div>{"T₂/T₁ = T₃/T₄ = r_p^((k−1)/k)"}</div>
              <div>{"P·v^k = const,  v = R·T / P"}</div>
            </div>
            <div style={{ borderLeft: `3px solid ${K.workOut}`, paddingLeft: 12, marginBottom: isWide ? 0 : 16 }}>
              <div style={{ fontFamily: FD, fontSize: isWide ? 18 : 13, marginBottom: 6, color: K.ink }}>Improving Performance</div>
              {["Raise pressure ratio — efficiency depends only on r_p (ideal)", "Raise turbine inlet temperature — more net work per kg of air", "Regeneration — preheat compressed air with exhaust (when T₄ > T₂)", "Intercooling & reheat — reduce compressor work, add turbine work", "Combined cycle — recover exhaust heat in a Rankine bottoming cycle"].map((t, i) => (
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
function BryGasInfoModal({ open, onClose, currentGas }) {
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
            const eta8 = (1 - Math.pow(8, -(g.k - 1) / g.k)) * 100;
            return (
              <div key={g.id} style={{ padding: "12px", border: `1.5px solid ${isCurrent ? K.workIn : K.border}`, background: isCurrent ? `${K.workIn}12` : K.cardAlt }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontFamily: FD, fontSize: 14, color: isCurrent ? K.workIn : K.ink }}>{g.name}</span>
                  <span style={{ fontSize: 9, color: K.inkLight, fontFamily: FM }}>{g.formula}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, fontSize: 9, marginBottom: 6 }}>
                  <div><span style={{ color: K.inkLight }}>c_p:</span> {g.cp} kJ/kg·K</div>
                  <div><span style={{ color: K.inkLight }}>R:</span> {g.R} kJ/kg·K</div>
                  <div><span style={{ color: K.inkLight }}>k:</span> <span style={{ fontWeight: 600 }}>{g.k}</span></div>
                  <div><span style={{ color: K.inkLight }}>M:</span> {g.M} kg/kmol</div>
                  <div style={{ gridColumn: "1 / -1" }}><span style={{ color: K.inkLight }}>η at r_p = 8:</span> <span style={{ color: K.accent, fontWeight: 600 }}>{eta8.toFixed(1)}%</span></div>
                </div>
                <div style={{ fontSize: 9, color: K.inkMed, lineHeight: 1.6, marginBottom: 4 }}>{g.uses}</div>
                <div style={{ fontSize: 8, color: K.inkLight, fontStyle: "italic", lineHeight: 1.5 }}>{g.note}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, padding: "10px", background: K.cardAlt, border: `1px solid ${K.border}`, fontSize: 9, lineHeight: 1.8 }}>
          <div style={{ fontFamily: FD, fontSize: 11, marginBottom: 4, color: K.ink }}>Why the gas matters</div>
          <div><strong>k = c_p / c_v</strong> sets η = 1 − r_p^(−(k−1)/k): monatomic gases (k = 1.667) beat diatomic (k = 1.4) at every pressure ratio, but their T₂ rises faster, which raises the minimum turbine inlet temperature.</div>
          <div><strong>R = R_u / M</strong> sets specific volume v = R·T/P: light gases occupy far more volume per kilogram, which drives compressor and duct sizing.</div>
          <div style={{ color: K.inkLight, marginTop: 4, fontStyle: "italic" }}>All properties are constant-specific-heat values near 300 K. Real gases at high T₃ have larger c_p and lower k; supercritical CO₂ is a real-gas cycle outside this model.</div>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: "10px", marginTop: 12, background: K.accent, border: "none", color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: FD, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

/* ───────── Equations Solver Modal ───────── */
const BRY_EQ_TOPICS = [
  { id: "wt", label: "W_turbine", title: "Turbine Work Output", color: () => K.workOut },
  { id: "wc", label: "W_comp", title: "Compressor Work Input", color: () => K.workIn },
  { id: "qin", label: "Q_in", title: "Combustor Heat Input", color: () => K.heatIn },
  { id: "qout", label: "Q_out", title: "Heat Rejection", color: () => K.heatOut },
  { id: "eta", label: "η_th", title: "Thermal Efficiency", color: () => K.accent },
  { id: "wnet", label: "W_net", title: "Net Work Output", color: () => K.workOut },
  { id: "bwr", label: "BWR", title: "Back Work Ratio", color: () => K.workIn },
  { id: "states", label: "States", title: "Finding State Point Properties", color: () => K.ink },
];

function BryEquationsModal({ open, onClose, cycle, initialTopic, units }) {
  const [topic, setTopic] = useState("wt");
  useEffect(() => { if (initialTopic && open) setTopic(initialTopic); }, [initialTopic, open]);
  const isWide = useIsDesktop();
  if (!open) return null;
  const f = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const u = units || { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };
  const cT = (v) => f(cvtT(v, u)); const cP = (v) => f(cvtP(v, u)); const cH = (v) => f(cvtH(v, u));
  const cS = (v) => { const x = cvtS(v, u); return Math.abs(x) < 10 ? x.toFixed(3) : x.toFixed(2); };
  const lT = lblT(u), lP = lblP(u), lH = lblH(u), lS = lblS(u);
  const sel = BRY_EQ_TOPICS.find(t => t.id === topic);
  const selColor = sel.color();
  const g = cycle.gas;
  const x = ((g.k - 1) / g.k).toFixed(4);
  const rpx = Math.pow(cycle.rp, (g.k - 1) / g.k);
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
      case "wt": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>W_turbine = h₃ − h₄ = c_p (T₃ − T₄)</div>
          <div style={noteStyle}>Isentropic expansion from P₂ to P₁. With constant c_p, enthalpy differences are just c_p·ΔT (temperatures in kelvin).</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 1 — T₄ from the isentropic relation</div>
          <div>T₄ = T₃ / r_p^((k−1)/k) = {TK(cycle.T3)} K / {cycle.rp.toFixed(1)}^{x} = {TK(cycle.T3)} / {rpx.toFixed(4)}</div>
          <div>T₄ = <span style={numStyle}>{TK(cycle.T4)}</span> K = <span style={numStyle}>{cT(cycle.T4)}</span> {lT}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 2 — Enthalpies</div>
          <div>h₃ = c_p·T₃ = {g.cp} × {TK(cycle.T3)} = <span style={numStyle}>{cH(cycle.h3)}</span> {lH}</div>
          <div>h₄ = c_p·T₄ = {g.cp} × {TK(cycle.T4)} = <span style={numStyle}>{cH(cycle.h4)}</span> {lH}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>W_turbine = {cH(cycle.h3)} − {cH(cycle.h4)} = <strong>{cH(cycle.wTurb)}</strong> {lH}</div>
        </div>
      </>);
      case "wc": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA (sign convention: work in is negative)</div>
          <div>W_comp = −(h₂ − h₁) = −c_p (T₂ − T₁)</div>
          <div style={noteStyle}>Isentropic compression of air. Unlike a Rankine pump, compressing a gas consumes a large share of the turbine output.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 1 — T₂ from the isentropic relation</div>
          <div>T₂ = T₁ · r_p^((k−1)/k) = {TK(cycle.T1)} K × {cycle.rp.toFixed(1)}^{x} = {TK(cycle.T1)} × {rpx.toFixed(4)}</div>
          <div>T₂ = <span style={numStyle}>{TK(cycle.T2)}</span> K = <span style={numStyle}>{cT(cycle.T2)}</span> {lT}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STEP 2 — Enthalpies</div>
          <div>h₁ = c_p·T₁ = <span style={numStyle}>{cH(cycle.h1)}</span> {lH}</div>
          <div>h₂ = c_p·T₂ = <span style={numStyle}>{cH(cycle.h2)}</span> {lH}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>W_comp = −({cH(cycle.h2)} − {cH(cycle.h1)}) = <strong>−{cH(cycle.wComp)}</strong> {lH}</div>
        </div>
      </>);
      case "qin": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>Q_in = h₃ − h₂ = c_p (T₃ − T₂)</div>
          <div style={noteStyle}>Heat is added at constant pressure in the combustor, raising the gas from the compressor exit temperature to the turbine inlet temperature.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>VALUES</div>
          <div>h₂ = <span style={numStyle}>{cH(cycle.h2)}</span> {lH} (compressed air entering combustor, T₂ = {cT(cycle.T2)} {lT})</div>
          <div>h₃ = <span style={numStyle}>{cH(cycle.h3)}</span> {lH} (hot gas leaving combustor, T₃ = {cT(cycle.T3)} {lT})</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>Q_in = {cH(cycle.h3)} − {cH(cycle.h2)} = <strong>{cH(cycle.qIn)}</strong> {lH}</div>
        </div>
      </>);
      case "qout": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA (sign convention: heat out is negative)</div>
          <div>Q_out = −(h₄ − h₁) = −c_p (T₄ − T₁)</div>
          <div style={noteStyle}>Heat rejected at constant low pressure, either through a heat exchanger (closed cycle) or by discharging exhaust (open cycle).</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>VALUES</div>
          <div>h₄ = <span style={numStyle}>{cH(cycle.h4)}</span> {lH} (turbine exhaust, T₄ = {cT(cycle.T4)} {lT})</div>
          <div>h₁ = <span style={numStyle}>{cH(cycle.h1)}</span> {lH} (compressor inlet, T₁ = {cT(cycle.T1)} {lT})</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>Q_out = −({cH(cycle.h4)} − {cH(cycle.h1)}) = <strong>−{cH(cycle.qOut)}</strong> {lH}</div>
        </div>
      </>);
      case "eta": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>η_th = W_net / Q_in = (W_t + W_c) / Q_in</div>
          <div style={noteStyle}>For the ideal constant-c_p Brayton cycle this reduces to η_th = 1 − 1 / r_p^((k−1)/k): efficiency depends only on the pressure ratio and the gas's k = {g.k} ({g.name}), not on T₃.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>METHOD 1 — From energy terms</div>
          <div>W_net = {cH(cycle.wTurb)} + (−{cH(cycle.wComp)}) = <span style={numStyle}>{cH(cycle.wNet)}</span> {lH}</div>
          <div>η_th = {cH(cycle.wNet)} / {cH(cycle.qIn)} = <span style={numStyle}>{(cycle.eta * 100).toFixed(2)}%</span></div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>METHOD 2 — From pressure ratio (verify)</div>
          <div>η_th = 1 − 1 / {cycle.rp.toFixed(1)}^{x} = 1 − 1 / {rpx.toFixed(4)} = <span style={numStyle}>{((1 - 1 / rpx) * 100).toFixed(2)}%</span></div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>η_th = <strong>{(cycle.eta * 100).toFixed(2)}%</strong></div>
        </div>
      </>);
      case "wnet": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>W_net = W_turbine + W_comp  (W_comp is negative)</div>
          <div style={noteStyle}>Also: W_net = Q_in + Q_out  (Q_out is negative, energy balance)</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>METHOD 1 — From work terms</div>
          <div>W_net = {cH(cycle.wTurb)} + (−{cH(cycle.wComp)}) = <span style={numStyle}>{cH(cycle.wNet)}</span> {lH}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>METHOD 2 — From heat terms (verify)</div>
          <div>W_net = {cH(cycle.qIn)} + (−{cH(cycle.qOut)}) = <span style={numStyle}>{cH(cycle.qIn - cycle.qOut)}</span> {lH}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>W_net = <strong>{cH(cycle.wNet)}</strong> {lH}</div>
        </div>
      </>);
      case "bwr": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>FORMULA</div>
          <div>BWR = |W_comp| / W_turbine</div>
          <div style={noteStyle}>The back work ratio is the fraction of turbine output consumed by the compressor. Gas turbines typically run 40–80%, versus 1–3% for steam plants — the price of compressing a gas.</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>CALCULATION</div>
          <div>BWR = {cH(cycle.wComp)} / {cH(cycle.wTurb)}</div>
          <div style={{ color: K.inkLight, marginTop: 4 }}>For an ideal cycle BWR = (T₂ − T₁) / (T₃ − T₄) = T₁·r_p^((k−1)/k) / T₃ = {TK(cycle.T1)} × {rpx.toFixed(4)} / {TK(cycle.T3)}</div>
        </div>
        <div style={resultStyle}>
          <div style={resultLabelStyle}>RESULT</div>
          <div style={resultValueStyle}>BWR = <strong>{(cycle.bwr * 100).toFixed(2)}%</strong></div>
        </div>
      </>);
      case "states": return (<>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 1 — Compressor Inlet (given)</div>
          <div>T₁ = <span style={numStyle}>{cT(cycle.T1)}</span> {lT} = {TK(cycle.T1)} K, P₁ = <span style={numStyle}>{cP(cycle.p1)}</span> {lP}</div>
          <div>h₁ = c_p·T₁ = <span style={numStyle}>{cH(cycle.h1)}</span> {lH}, v₁ = R·T₁/P₁ = <span style={numStyle}>{cycle.states[0].v.toFixed(4)}</span> m³/kg, s₁ = <span style={numStyle}>{cS(cycle.s1)}</span> {lS}</div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 2 — Compressor Exit (isentropic, P₂ = r_p·P₁)</div>
          <div>P₂ = {cycle.rp.toFixed(1)} × {cP(cycle.p1)} = <span style={numStyle}>{cP(cycle.p2)}</span> {lP}; T₂ = T₁·r_p^((k−1)/k) = <span style={numStyle}>{cT(cycle.T2)}</span> {lT}</div>
          <div>h₂ = <span style={numStyle}>{cH(cycle.h2)}</span> {lH}, v₂ = <span style={numStyle}>{cycle.states[1].v.toFixed(4)}</span> m³/kg, s₂ = s₁ = <span style={numStyle}>{cS(cycle.s2)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 3 — Turbine Inlet (given T₃, P₃ = P₂)</div>
          <div>T₃ = <span style={numStyle}>{cT(cycle.T3)}</span> {lT}, P₃ = <span style={numStyle}>{cP(cycle.p2)}</span> {lP}</div>
          <div>h₃ = <span style={numStyle}>{cH(cycle.h3)}</span> {lH}, v₃ = <span style={numStyle}>{cycle.states[2].v.toFixed(4)}</span> m³/kg, s₃ = s₂ + c_p·ln(T₃/T₂) = <span style={numStyle}>{cS(cycle.s3)}</span></div>
        </div>
        <div style={stepStyle}>
          <div style={labelStyle}>STATE 4 — Turbine Exit (isentropic, P₄ = P₁)</div>
          <div>T₄ = T₃ / r_p^((k−1)/k) = <span style={numStyle}>{cT(cycle.T4)}</span> {lT}, P₄ = <span style={numStyle}>{cP(cycle.p1)}</span> {lP}</div>
          <div>h₄ = <span style={numStyle}>{cH(cycle.h4)}</span> {lH}, v₄ = <span style={numStyle}>{cycle.states[3].v.toFixed(4)}</span> m³/kg, s₄ = s₃ = <span style={numStyle}>{cS(cycle.s4)}</span></div>
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
          {BRY_EQ_TOPICS.map(t => {
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
function BryStateTable({ cycle, onSelectState, textScale, units }) {
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
            {["State", "Desc", `T (${lblT(u)})`, `P (${lblP(u)})`, `h (${lblH(u)})`, `s (${lblS(u)})`, "v (m³/kg)"].map(h => (
              <th key={h} style={{ padding: isWide ? "8px 4px" : "6px 3px", color: K.inkMed, fontWeight: 400, textAlign: "center", fontSize: sz(isWide ? 14 : 9), fontStyle: "italic" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cycle.states.map((s, i) => (
            <tr key={i}
              onClick={() => onSelectState({ s: s.s, T: s.T, P: s.P, v: s.v, h: s.h })}
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
              <td style={{ padding: isWide ? "10px 4px" : "6px 3px", textAlign: "center", color: K.ink }}>{fmt(cvtH(s.h, u))}</td>
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

/* ───────── Main Brayton Page ───────── */
export default function BraytonPage({ onBack }) {
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
  const [rp, setRp] = useState(() => clampRp(initNum("rp", 8)));
  const [p1, setP1] = useState(() => clampP1(initNum("p1", 100)));
  const [t1, setT1] = useState(() => Math.max(T1_MIN, Math.min(T1_MAX, initNum("t1", 25))));
  const [t3, setT3] = useState(() => Math.max(300, Math.min(T3_MAX, initNum("t3", 1100))));
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
  const t2c = (t1 + K2C) * Math.pow(rp, (gas.k - 1) / gas.k) - K2C;
  const minT3 = Math.ceil((t2c + 100) / 10) * 10;
  const adjustedT3 = Math.max(t3, minT3);
  const cycle = useMemo(() => calculateBrayton(gas, rp, p1, t1, adjustedT3), [gas, rp, p1, t1, adjustedT3]);
  const fmt = v => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);

  const [dragPoint, setDragPoint] = useState(() => ({ ...cycle.states[0] }));
  const handleDrag = useCallback((pt) => setDragPoint({ s: pt.s, T: pt.T, P: pt.P, v: pt.v, h: pt.h }), []);
  // Dragging the low-pressure isobar sets P₁ but keeps P₂ where it is (like Rankine's condenser drag)
  const handleP1Drag = useCallback((p) => { const P2 = rp * p1; setP1(p); setRp(clampRp(P2 / p)); }, [rp, p1]);

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
      if (segIdx === 1) pt = walkPath(cycle.combustorPath, frac, "s", "T");
      else if (segIdx === 3) pt = walkPath(cycle.exhaustPath, frac, "s", "T");
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
                Brayton <span style={{ color: K.workIn, fontStyle: "italic" }}>Cycle</span>
              </h1>
              <div style={{ fontSize: sz(desktop ? 13.75 : 8), color: K.inkLight, fontFamily: FM, letterSpacing: 2, marginTop: 2 }}>Ideal Gas-Turbine Cycle Analysis</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button data-tour="bry-theory" onClick={() => setShowInfo(true)} style={{ background: K.accent, border: "none", padding: desktop ? "10px 20px" : "7px 14px", color: "#fff", fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>Theory</button>
            <button data-tour="bry-gases" onClick={() => setShowGasInfo(true)} style={{ background: K.workIn, border: "none", padding: desktop ? "10px 20px" : "7px 14px", color: "#fff", fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>Gases</button>
            <button data-tour="bry-settings" onClick={() => setShowSettings(true)} style={{ background: "none", border: `1px solid ${K.border}`, padding: desktop ? "10px 20px" : "7px 14px", color: K.inkMed, fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>⚙ Settings</button>
            <button onClick={() => { setForcedTour(false); setShowTour(true); }} style={{ background: "none", border: `1px solid ${K.border}`, padding: desktop ? "10px 20px" : "7px 14px", color: K.inkMed, fontSize: sz(desktop ? 17.50 : 11), cursor: "pointer", fontFamily: FD }}>Instructions</button>
          </div>
        </div>
        {/* Working-gas selector */}
        <div data-tour="bry-gas-selector" style={{ display: "flex", flexWrap: "wrap", gap: desktop ? 8 : 5 }}>
          {GASES.map((g, i) => (
            <button key={g.id} onClick={() => setGasIdx(i)} style={{
              padding: desktop ? "6px 14px" : "4px 10px", fontSize: sz(desktop ? 13 : 9), fontFamily: FM,
              background: i === gasIdx ? K.workIn : K.cardAlt, color: i === gasIdx ? "#fff" : K.inkMed,
              border: `1px solid ${i === gasIdx ? K.workIn : K.border}`, cursor: "pointer", borderRadius: 3, fontWeight: i === gasIdx ? 700 : 400, transition: "all 0.15s",
            }}>{g.name} <span style={{ opacity: 0.75 }}>k={g.k}</span></button>
          ))}
        </div>
      </div>
      <BryInfoModal open={showInfo} onClose={() => setShowInfo(false)} />
      <BryGasInfoModal open={showGasInfo} onClose={() => setShowGasInfo(false)} currentGas={gas} />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} K={K} FD={FD} FM={FM}
        textScale={textScale} onTextScaleChange={handleScaleChange}
        darkMode={darkMode} onDarkModeToggle={toggleDarkMode}
        units={units} onUnitsChange={handleUnitsChange}
        animSpeed={animSpeed} onAnimSpeedChange={handleAnimSpeedChange} />
      <WelcomePopup open={showWelcome} K={K} textScale={textScale} onScaleChange={handleScaleChange} onStart={() => { localStorage.setItem("tourSeen", "1"); setShowTour(true); }} onDismiss={() => { localStorage.setItem("tourSeen", "1"); }} />
      <GuidedTour steps={BRAYTON_TOUR_STEPS} isOpen={showTour} forced={forcedTour} onClose={() => { setShowTour(false); setForcedTour(false); localStorage.setItem("tourSeen", "1"); }} K={K} textScale={textScale} onScaleChange={handleScaleChange} />

      {/* Performance */}
      <div style={{ margin: `${gap}px ${gap}px 0`, padding: desktop ? "16px" : "12px", background: K.card, border: `1px solid ${K.border}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { l: "η thermal", v: `${(cycle.eta * 100).toFixed(1)}%`, c: K.accent },
          { l: "W net", v: fmt(cvtH(cycle.wNet, units)), c: K.workOut, s: lblH(units) },
          { l: "BWR", v: `${(cycle.bwr * 100).toFixed(1)}%`, c: K.workIn },
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
          <h3 style={sec}>System Schematic <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— {gas.name}</span></h3>
          <div data-tour="bry-schematic"><BrySchematicDiagram cycle={cycle} textScale={textScale} units={units} animating={animating} animProgress={animProgress} /></div>
        </div>
        <div data-tour="bry-visualizer" style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}`, display: "flex", flexDirection: "column" } : card}>
          <h3 style={sec}>Volume Visualizer <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— drag a point on the diagrams below</span></h3>
          <VolumeBoxVisualizer T={dragPoint.T} P={dragPoint.P} v={dragPoint.v} vMin={cycle.vMin} vMax={cycle.vMax} tLow={cycle.T1} tHigh={cycle.T3} fillHeight={desktop} textScale={textScale} units={units} smooth={!animating} />
        </div>
      </div>

      {/* Row: T-s + P-v Diagrams */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div data-tour="bry-ts-diagram" style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...sec, marginBottom: desktop ? 15 : 8 }}>
            <span>T–s Diagram <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— interactive</span></span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setAnimating(a => !a)} style={{
                background: animating ? K.accent : "none", border: `1px solid ${animating ? K.accent : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: animating ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>{animating ? "⏸ Pause" : "▶ Animate"}</button>
              <button data-tour="bry-eta-areas" onClick={() => setShowAreas(a => !a)} style={{
                background: showAreas ? K.workOut : "none", border: `1px solid ${showAreas ? K.workOut : K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: showAreas ? "#fff" : K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.15s",
              }}>η areas</button>
              <button data-tour="bry-fx" onClick={() => setShowEqs(true)} style={{
                background: "none", border: `1px solid ${K.border}`, padding: desktop ? "5px 12px" : "3px 8px",
                color: K.inkMed, fontSize: sz(desktop ? 15 : 9), fontFamily: FM, cursor: "pointer", borderRadius: 4,
              }}>f(x)</button>
            </div>
          </div>
          <div data-tour="bry-lock-buttons" style={{ display: "flex", gap: 8, marginBottom: desktop ? 15 : 8 }}>
            <button onClick={() => { setLockS(l => !l); if (!lockS) { setLockT(false); setLockP(false); setLockV(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockS ? K.accent : K.cardAlt, color: lockS ? "#fff" : K.inkMed, border: `1px solid ${lockS ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockS ? 700 : 400, transition: "all 0.15s" }}>
              {lockS ? "🔒" : "🔓"} Lock s = {cvtS(dragPoint.s, units).toFixed(2)} {lblS(units)}
            </button>
            <button onClick={() => { setLockT(l => !l); if (!lockT) { setLockS(false); setLockP(false); setLockV(false); } }}
              style={{ flex: 1, padding: desktop ? "7px 0" : "5px 0", fontSize: sz(desktop ? 15 : 9), fontFamily: FM, background: lockT ? K.accent : K.cardAlt, color: lockT ? "#fff" : K.inkMed, border: `1px solid ${lockT ? K.accent : K.border}`, cursor: "pointer", borderRadius: 4, fontWeight: lockT ? 700 : 400, transition: "all 0.15s" }}>
              {lockT ? "🔒" : "🔓"} Lock T = {fmtT(dragPoint.T, units, 0)}
            </button>
          </div>
          <BryTsDiagram cycle={cycle} dragPoint={dragPoint} onDrag={handleDrag} lockS={lockS} lockT={lockT} showAreas={showAreas} onRpChange={setRp} onP1Drag={handleP1Drag}
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
              <button data-tour="bry-pv-areas" onClick={() => setShowPvAreas(a => !a)} style={{
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
          <BryPvDiagram cycle={cycle} dragPoint={dragPoint} onDrag={handleDrag} lockP={lockP} lockV={lockV} showPvAreas={showPvAreas} onRpChange={setRp} onP1Drag={handleP1Drag}
            lineDragInfo={lineDragInfo} onLineDragStart={(which) => setLineDragInfo({ which })} onLineDragMove={(which) => setLineDragInfo({ which })} onLineDragEnd={() => setLineDragInfo(null)} textScale={textScale} units={units} />
        </div>
      </div>
      <BryEquationsModal open={showEqs} onClose={() => { setShowEqs(false); setEqTopic(null); }} cycle={cycle} initialTopic={eqTopic} units={units} />

      {/* Row: Sliders + Table */}
      <div style={desktop ? { display: "grid", gridTemplateColumns: "1fr 1fr", margin: `${gap}px ${gap}px 0`, gap } : {}}>
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : { ...card, padding: "16px" }}>
          <h3 style={sec}>Cycle Parameters</h3>
          <ParamSlider label="Pressure Ratio (r_p = P₂/P₁)" unit="" color={K.heatIn} value={rp} min={RP_MIN} max={RP_MAX} step={0.5} onChange={v => setRp(clampRp(v))} textScale={textScale} />
          <ParamSlider label="Turbine Inlet Temperature (T₃)" kind="T" color={K.workOut} value={adjustedT3} min={minT3} max={T3_MAX} step={10} onChange={setT3} textScale={textScale} units={units} />
          <ParamSlider label="Compressor Inlet Temperature (T₁)" kind="T" color={K.workIn} value={t1} min={T1_MIN} max={T1_MAX} step={1} onChange={setT1} textScale={textScale} units={units} />
          <ParamSlider label="Inlet Pressure (P₁)" kind="P" color={K.heatOut} value={p1} min={P1_MIN} max={P1_MAX} step={5} onChange={setP1} textScale={textScale} units={units} />
          <div style={{ marginTop: 6, fontSize: sz(desktop ? 15 : 9), color: K.inkLight, borderTop: `1px solid ${K.gridFine}`, paddingTop: 6, fontStyle: "italic" }}>
            T₂ = {fmtT(cycle.T2, units)} &nbsp;|&nbsp; T₄ = {fmtT(cycle.T4, units)} &nbsp;|&nbsp; P₂ = {fmtP(cycle.p2, units)}
          </div>
        </div>
        <div style={desktop ? { padding: "24px", background: K.card, border: `1px solid ${K.border}` } : card}>
          <h3 style={sec}>State Point Properties <span style={{ fontFamily: FM, fontSize: desktop ? 15 : 9, color: K.inkLight, fontStyle: "italic" }}>— Table 1</span></h3>
          <BryStateTable cycle={cycle} onSelectState={handleDrag} textScale={textScale} units={units} />
        </div>
      </div>

      {/* Energy Balance */}
      <div data-tour="bry-energy-balance" style={card}>
        <h3 style={sec}>Energy Balance</h3>
        <div style={{ display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: desktop ? 16 : 8 }}>
          <div>
            <div style={{ fontSize: sz(desktop ? 15 : 9), fontFamily: FM, color: K.inkLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${K.border}`, textAlign: "center" }}>Heat Transfer</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { l: "Q in (Combustor)", v: fmt(cvtH(cycle.qIn, units)), u: lblH(units), c: K.heatIn, topic: "qin" },
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
                { l: "W turbine", v: fmt(cvtH(cycle.wTurb, units)), u: lblH(units), c: K.workOut, topic: "wt" },
                { l: "W compressor", v: "−" + fmt(cvtH(cycle.wComp, units)), u: lblH(units), c: K.workIn, topic: "wc" },
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
            <div style={{ fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontStyle: "italic", marginBottom: 2 }}>W_net = W_t + W_c (W_c &lt; 0)</div>
            <div style={{ fontSize: sz(desktop ? 25 : 12), fontFamily: FD, color: K.workOut }}>= {fmt(cvtH(cycle.wNet, units))} {lblH(units)}</div>
          </div>
        </div>
      </div>

      <div data-tour="bry-share-solution" style={{ textAlign: "center", padding: desktop ? "20px 12px 12px" : "14px 12px 8px", display: "flex", justifyContent: "center", gap: desktop ? 12 : 8, flexWrap: "wrap" }}>
        <button onClick={() => {
          const url = `${window.location.origin}${window.location.pathname}?view=brayton&gas=${gas.id}&rp=${rp}&p1=${p1}&t1=${t1}&t3=${adjustedT3}`;
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
          const line = (i, name) => `State ${st[i].label} (${name}): T = ${T_(st[i].T)} ${lT}, P = ${P_(st[i].P)} ${lP}, h = ${H_(st[i].h)} ${lH}, s = ${S_(st[i].s)} ${lS}, v = ${st[i].v.toFixed(4)} m3/kg`;
          const text = [
            `BRAYTON CYCLE (ideal gas, constant c_p) — Solution`,
            `Working gas: ${gas.name} (${gas.formula}), c_p = ${gas.cp} kJ/kg·K, R = ${gas.R} kJ/kg·K, k = ${gas.k}`,
            `Inputs: r_p = ${rp}, P_1 = ${P_(p1)} ${lP}, T_1 = ${T_(t1)} ${lT}, T_3 = ${T_(adjustedT3)} ${lT}`,
            ``,
            line(0, "compressor inlet"), line(1, "compressor exit, isentropic"), line(2, "turbine inlet"), line(3, "turbine exit, isentropic"),
            ``,
            `Compressor:     W_comp = h2 − h1 = ${H_(cycle.wComp)} ${lH}`,
            `Combustor:      Q_in   = h3 − h2 = ${H_(cycle.qIn)} ${lH}`,
            `Turbine:        W_turb = h3 − h4 = ${H_(cycle.wTurb)} ${lH}`,
            `Heat exchanger: Q_out  = h4 − h1 = ${H_(cycle.qOut)} ${lH}`,
            ``,
            `W_net = W_turb − W_comp = ${H_(cycle.wNet)} ${lH}`,
            `η_th  = W_net / Q_in    = ${(cycle.eta * 100).toFixed(2)} %   (= 1 − r_p^(−(k−1)/k))`,
            `BWR   = W_comp / W_turb = ${(cycle.bwr * 100).toFixed(2)} %`,
          ].join("\n");
          navigator.clipboard.writeText(text).then(() => { setEqsCopied(true); setTimeout(() => setEqsCopied(false), 2000); });
        }} style={{
          background: eqsCopied ? K.accent : "none", border: `1px solid ${eqsCopied ? K.accent : K.border}`, padding: desktop ? "8px 20px" : "6px 14px",
          color: eqsCopied ? "#fff" : K.inkMed, fontSize: sz(desktop ? 13 : 10), fontFamily: FM, cursor: "pointer", borderRadius: 4, transition: "all 0.2s",
        }}>{eqsCopied ? "✓ Copied" : "📋 Copy Solution"}</button>
      </div>
      <div style={{ textAlign: "center", padding: desktop ? "8px 12px 8px" : "6px 12px 6px", fontSize: sz(desktop ? 15 : 9), color: K.inkLight, fontFamily: FM, fontStyle: "italic", letterSpacing: 1 }}>
        Ideal Brayton Cycle · {gas.name} ({gas.formula}) · Ideal Gas, Constant c_p
      </div>
      <div style={{ textAlign: "center", padding: desktop ? "8px 12px 36px" : "6px 12px 28px", borderTop: `1px solid ${K.border}`, marginTop: desktop ? 8 : 4, marginLeft: desktop ? 40 : 16, marginRight: desktop ? 40 : 16 }}>
        <div style={{ fontSize: sz(desktop ? 14 : 9), color: K.inkMed, fontFamily: FM, marginBottom: 4 }}>Built by <span style={{ fontWeight: 600, color: K.ink }}>Scott Presbrey</span></div>
        <span onClick={() => { const a = "scottypres", d = "gmail", t = "com"; window.location.href = "mailto:" + a + "@" + d + "." + t; }} style={{ fontSize: sz(desktop ? 13 : 8), color: K.accent, fontFamily: FM, textDecoration: "underline", cursor: "pointer" }}>{"scottypres" + "@" + "gmail.com"}</span>
      </div>
    </div>
  );
}
