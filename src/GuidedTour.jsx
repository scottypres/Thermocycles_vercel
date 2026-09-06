import { useState, useEffect, useRef } from "react";
import { FD, FM } from "./shared.jsx";

/* ───────── Sizing Preview Panel ───────── */
function SizingPanel({ textScale, onScaleChange, K }) {
  const pct = ((textScale - 0.8) / 0.8) * 100;
  const btnStyle = {
    width: 44, height: 44, fontSize: 20, fontFamily: FM, fontWeight: 700,
    background: K.card, border: `2px solid ${K.border}`, color: K.ink,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 4, flexShrink: 0,
  };
  return (
    <div style={{ textAlign: "left", padding: "14px", background: K.cardAlt, border: `1px solid ${K.border}`, marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontFamily: FM, color: K.inkLight, marginBottom: 10, letterSpacing: 1, textTransform: "uppercase" }}>
        Adjust Display Size — {Math.round(textScale * 100)}%
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => onScaleChange(Math.max(0.8, Math.round((textScale - 0.1) * 100) / 100))} style={btnStyle}>−</button>
        <input type="range" min={0.8} max={1.6} step={0.05} value={textScale}
          className="tour-slider"
          onChange={e => onScaleChange(Number(e.target.value))}
          style={{ flex: 1, height: 6, appearance: "none", WebkitAppearance: "none",
            background: `linear-gradient(to right, ${K.accent} 0%, ${K.accent} ${pct}%, ${K.border} ${pct}%, ${K.border} 100%)`,
            borderRadius: 0, outline: "none", cursor: "pointer", padding: "10px 0" }} />
        <button onClick={() => onScaleChange(Math.min(1.6, Math.round((textScale + 0.1) * 100) / 100))} style={btnStyle}>+</button>
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${K.border}` }}>
        <div style={{ fontSize: 9, fontFamily: FM, color: K.inkLight, marginBottom: 6, fontStyle: "italic" }}>Preview at current size:</div>
        <div style={{ fontSize: 12 * textScale, fontFamily: FD, color: K.ink, marginBottom: 4 }}>Section Header</div>
        <div style={{ fontSize: 8 * textScale, fontFamily: FM, color: K.inkLight, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1, fontStyle: "italic" }}>Label text · units</div>
        <div style={{ fontSize: 16 * textScale, fontFamily: FD, color: K.accent }}>123.4 <span style={{ fontSize: 8 * textScale, fontFamily: FM, color: K.inkLight }}>kJ/kg</span></div>
        <svg viewBox="0 0 220 70" style={{ width: "100%", maxWidth: 220, marginTop: 8 }}>
          {/* Mini schematic preview */}
          <rect x={0} y={0} width={220} height={70} fill={K.cardAlt} rx={2} />
          <circle cx={30} cy={35} r={14 * (1 + (textScale - 1) * 0.4)} fill="none" stroke={K.workIn} strokeWidth={1} />
          <rect x={70} y={10} width={60} height={22} fill="none" stroke={K.heatIn} strokeWidth={1} />
          <text x={100} y={24} fill={K.heatIn} fontSize={7 * (1 + (textScale - 1) * 0.4)} textAnchor="middle" fontFamily={FD}>Boiler</text>
          <path d="M140,10 L162,22 L162,48 L140,60 Z" fill="none" stroke={K.workOut} strokeWidth={1} strokeLinejoin="round" />
          <text x={151} y={39} fill={K.workOut} fontSize={6.5 * (1 + (textScale - 1) * 0.4)} textAnchor="middle" fontFamily={FD}>Turbine</text>
          <rect x={70} y={40} width={60} height={22} fill="none" stroke={K.heatOut} strokeWidth={1} />
          <text x={100} y={54} fill={K.heatOut} fontSize={7 * (1 + (textScale - 1) * 0.4)} textAnchor="middle" fontFamily={FD}>Condenser</text>
          {/* Mini diagram labels */}
          <text x={185} y={20} fill={K.ink} fontSize={7 * textScale} fontFamily={FM}>T</text>
          <text x={195} y={20} fill={K.inkLight} fontSize={5 * textScale} fontFamily={FM}>(°C)</text>
          <text x={185} y={55} fill={K.accent} fontSize={8 * textScale} fontFamily={FD}>456.7</text>
          <text x={185} y={64} fill={K.inkLight} fontSize={5 * textScale} fontFamily={FM}>kJ/kg</text>
        </svg>
      </div>
    </div>
  );
}

/* ───────── Welcome Popup (first-load) ───────── */
export function WelcomePopup({ open, onStart, onDismiss, K, textScale, onScaleChange }) {
  if (!open) return null;
  return (
    <div data-anim-keep="1" style={{
      position: "fixed", inset: 0, zIndex: 10000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.5)",
    }} onClick={onDismiss}>
      <div onClick={e => e.stopPropagation()} style={{
        background: K.card, border: `2px solid ${K.border}`,
        padding: "28px 24px", maxWidth: 360, textAlign: "center",
      }}>
        <h2 style={{ fontFamily: FD, color: K.ink, margin: "0 0 14px", fontSize: 22 }}>Welcome</h2>
        <SizingPanel textScale={textScale} onScaleChange={onScaleChange} K={K} />
        <p style={{ fontFamily: FM, color: K.inkMed, fontSize: 12, lineHeight: 1.5, margin: "0 0 16px" }}>
          Would you like a quick tour of the interactive features?
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button onClick={onStart} style={{
            background: K.accent, border: "none", padding: "10px 24px",
            color: "#fff", fontSize: 14, cursor: "pointer", fontFamily: FD,
          }}>Instructions</button>
          <button onClick={onDismiss} style={{
            background: "none", border: `1px solid ${K.border}`, padding: "10px 24px",
            color: K.inkMed, fontSize: 14, cursor: "pointer", fontFamily: FD,
          }}>Continue</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── Bottom sheet height (fraction of viewport) ───────── */
const SHEET_HEIGHT_VH = 45; // sheet takes up to ~45% of the viewport; its text scrolls, its buttons stay put
const SIDE_SHEET_W = 360;   // width of the sheet when it docks beside an element too tall to fit above or below it

/* The part of the layout viewport actually on screen. Position: fixed pins to the layout viewport, and on iPad
   Safari a programmatic scroll can leave the screen panned inside a taller layout viewport until the user drags,
   so the sheet is pinned to this frame instead. */
const readViewport = () => {
  const v = typeof window !== "undefined" && window.visualViewport;
  return v ? { top: v.offsetTop, left: v.offsetLeft, w: v.width, h: v.height } : { top: 0, left: 0, w: "100%", h: "100%" };
};

/* ───────── Guided Tour ───────── */
export function GuidedTour({ steps, isOpen, onClose, K, textScale, onScaleChange, forced }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const [cursor, setCursor] = useState(null); // demo pointer {x, y, down, fast}
  const [hl, setHl] = useState(null);         // grey box over the element the demo is about to click
  const [dock, setDock] = useState("bottom"); // where the sheet sits for this step: bottom | top | left | right
  const [vv, setVv] = useState(readViewport);
  const measureRef = useRef(null);
  const sheetRef = useRef(null);

  useEffect(() => { if (isOpen) setStepIdx(0); }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const v = window.visualViewport, f = () => setVv(readViewport());
    f();
    v?.addEventListener("resize", f); v?.addEventListener("scroll", f);
    window.addEventListener("resize", f); window.addEventListener("scroll", f);
    return () => { v?.removeEventListener("resize", f); v?.removeEventListener("scroll", f); window.removeEventListener("resize", f); window.removeEventListener("scroll", f); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !steps[stepIdx]) return;

    const step = steps[stepIdx];
    if (!step.target) { setRect(null); return; }

    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) { setRect(null); return; }

    // Scroll so the highlighted element sits in the visible portion of the viewport, away from the sheet
    const v = window.visualViewport;
    const vh = v ? v.height : window.innerHeight, vw = v ? v.width : window.innerWidth;
    const sheetH = sheetRef.current ? sheetRef.current.offsetHeight + 42 : vh * SHEET_HEIGHT_VH / 100; // content + padding: the sheet is content-sized
    const elRect = el.getBoundingClientRect();
    const absTop = elRect.top + window.scrollY - (v ? v.offsetTop : 0); // relative to the top of the screen, not the layout viewport
    let side = step.sheet === "top" ? "top" : "bottom";
    if (elRect.height > vh - sheetH - 40 && vw >= 900) {
      // Too tall to share the screen with a top or bottom sheet (landscape tablet, large display size):
      // dock the sheet beside the element instead, on whichever side has more room
      const freeL = elRect.left, freeR = vw - elRect.right;
      if (Math.max(freeL, freeR) >= SIDE_SHEET_W - 20) side = freeR >= freeL ? "right" : "left";
    }
    setDock(side);

    if (side === "top") {
      // Sheet is at top — element should be in the lower portion
      const safeTop = sheetH + 20; // below the top sheet
      const targetScroll = Math.max(0, absTop - safeTop - Math.max(20, (vh - sheetH - 20 - elRect.height) / 3));
      window.scrollTo({ top: targetScroll, behavior: "smooth" });
    } else if (side === "bottom") {
      // Sheet is at bottom — element should be in the upper portion
      const safeZone = vh - sheetH - 20;
      const topMargin = Math.max(20, (safeZone - elRect.height) / 3);
      const targetScroll = Math.max(0, absTop - topMargin);
      window.scrollTo({ top: targetScroll, behavior: "smooth" });
    } else {
      // Sheet is beside the element — the whole viewport height is free, so centre it
      window.scrollTo({ top: Math.max(0, absTop - Math.max(20, (vh - elRect.height) / 2)), behavior: "smooth" });
    }

    const measure = () => {
      const win = document.querySelector("[data-tour-window]"); // a modal the demo opened takes over the spotlight
      const r = (win || el).getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom, win: !!win });
    };
    measureRef.current = measure;
    const t = setTimeout(measure, 450);

    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [isOpen, stepIdx, steps]);

  /* ── Demo: a pointer glides to the element, clicks it (or drags it) for real, then the step goes on ── */
  useEffect(() => {
    const demo = isOpen && steps[stepIdx]?.demo;
    if (!demo) return;
    let alive = true; const timers = [];
    const wait = ms => new Promise(res => timers.push(setTimeout(res, ms)));
    const sel = demo.click || demo.drag;
    const mouse = (type, el, x, y, extra) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra }));
    (async () => {
      await wait(demo.click ? 1200 : 750); // after the scroll settles
      const el = document.querySelector(sel);
      if (!el || !alive) return;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      setCursor({ x: x + 90, y: y + 70 });
      await wait(60);
      setCursor({ x, y });
      setHl({ left: r.left - 3, top: r.top - 3, width: r.width + 6, height: r.height + 6 });
      await wait(demo.click ? 1500 : 750);
      if (!alive) return;
      if (demo.click) {
        setCursor({ x, y, down: true });
        await wait(260);
        setCursor({ x, y });
        await wait(300);
        mouse("click", el, x, y);
        await wait(700);
        if (!alive) return;
        setHl(null); setCursor(null);
        measureRef.current?.(); timers.push(setTimeout(() => measureRef.current?.(), 500)); // spotlight the window it opened
      } else {
        setCursor({ x, y, down: true, fast: true }); setHl(null);
        mouse("mousedown", el, x, y, { button: 0, buttons: 1 });
        // The page maps the pointer's absolute position to the value, so the motion is centred on the anchor (the line itself) and ends there: the value comes back to where it started
        const ab = document.querySelector(demo.anchor)?.getBoundingClientRect(), y0 = ab ? ab.top + ab.height / 2 : y;
        const A = demo.dy || 25, D = 2600, t0 = performance.now();
        await new Promise(res => { const f = () => { // up, then down past the start, then back: one sine period
          if (!alive) return res();
          const q = Math.min(1, (performance.now() - t0) / D), yy = y0 - A * Math.sin(q * 2 * Math.PI);
          setCursor({ x, y: yy, down: true, fast: true }); mouse("mousemove", el, x, yy, { buttons: 1 });
          q < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
        mouse("mouseup", el, x, y0);
        setCursor({ x, y: y0, fast: true });
        await wait(350);
        setHl(null); setCursor(null);
      }
    })();
    return () => {
      alive = false; timers.forEach(clearTimeout); setCursor(null); setHl(null);
      if (demo.drag) { const el = document.querySelector(demo.drag); if (el) mouse("mouseup", el, 0, 0); }
      if (demo.click) document.querySelector("[data-tour-window] [data-tour-close]")?.click(); // leave the page as we found it
    };
  }, [isOpen, stepIdx, steps]);

  if (!isOpen || !steps[stepIdx]) return null;

  const step = steps[stepIdx];
  const pad = 6;
  const accent = K.accent;
  const isSizing = step.type === "sizing";

  const pct = ((textScale - 0.8) / 0.8) * 100;
  const sliderBtnStyle = {
    width: 38, height: 38, fontSize: 18, fontFamily: FM, fontWeight: 700,
    background: K.card, border: `2px solid ${K.border}`, color: K.ink,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 4, flexShrink: 0,
  };

  /* ── Sizing step: welcome card with semi-transparent backdrop ── */
  if (isSizing) {
    return (
      <>
        <style>{`
          input[type="range"].tour-slider::-webkit-slider-thumb {
            -webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;
            background:${accent};border:2px solid ${K.card};cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15);
          }
          input[type="range"].tour-slider::-moz-range-thumb {
            width:16px;height:16px;border-radius:50%;background:${accent};border:2px solid ${K.card};cursor:pointer;
          }
        `}</style>
        {/* Semi-transparent backdrop — page visible so user sees live changes */}
        <div data-anim-keep="1" style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.25)" }}
          onClick={forced ? undefined : onClose} />
        {/* Welcome card — pinned to top so page elements visible below */}
        <div data-anim-keep="1" onClick={e => e.stopPropagation()} style={{
          position: "fixed", zIndex: 10000,
          top: 16, left: "50%", transform: "translateX(-50%)",
          background: K.card, border: `2px solid ${accent}`,
          padding: "24px 24px 20px", maxWidth: 360, width: "calc(100% - 32px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)", textAlign: "center",
        }}>
          <h2 style={{ fontFamily: FD, color: K.ink, margin: "0 0 6px", fontSize: 22 }}>Welcome</h2>
          <p style={{ fontFamily: FM, color: K.inkMed, fontSize: 12, lineHeight: 1.5, margin: "0 0 16px" }}>
            Adjust the display size to your preference.
            <br /><span style={{ color: K.inkLight, fontSize: 10 }}>The page updates behind this card as you drag.</span>
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <button onClick={() => onScaleChange(Math.max(0.8, Math.round((textScale - 0.1) * 100) / 100))} style={sliderBtnStyle}>−</button>
            <input type="range" min={0.8} max={1.6} step={0.05} value={textScale}
              className="tour-slider"
              onChange={e => onScaleChange(Number(e.target.value))}
              style={{ flex: 1, height: 6, appearance: "none", WebkitAppearance: "none",
                background: `linear-gradient(to right, ${accent} 0%, ${accent} ${pct}%, ${K.border} ${pct}%, ${K.border} 100%)`,
                borderRadius: 0, outline: "none", cursor: "pointer" }} />
            <button onClick={() => onScaleChange(Math.min(1.6, Math.round((textScale + 0.1) * 100) / 100))} style={sliderBtnStyle}>+</button>
            <span style={{ fontFamily: FM, fontSize: 12, color: K.inkMed, minWidth: 36, textAlign: "right" }}>{Math.round(textScale * 100)}%</span>
          </div>
          <button onClick={() => setStepIdx(i => i + 1)} style={{
            background: accent, border: "none", padding: "10px 28px",
            color: "#fff", fontSize: 14, fontFamily: FD, cursor: "pointer", width: "100%",
          }}>Start Tour</button>
          {!forced && <button onClick={onClose} style={{
            background: "none", border: `1px solid ${K.border}`, color: K.inkMed, marginTop: 10,
            fontSize: 11, fontFamily: FM, cursor: "pointer", padding: "6px 16px",
          }}>Skip</button>}
        </div>
      </>
    );
  }

  /* ── Normal tour steps: overlay with cutout + tooltip ── */
  return (
    <>
      <style>{`
        @keyframes tour-blink {
          0%, 100% { box-shadow: 0 0 0 3px ${accent}cc, 0 0 14px ${accent}44; }
          50% { box-shadow: 0 0 0 3px ${accent}22, 0 0 0px ${accent}00; }
        }
        @keyframes tour-ring { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
        ${step.hide ? `${step.hide} { visibility: hidden; }` : ""}
      `}</style>

      <div data-anim-keep="1" style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={forced ? undefined : onClose}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <defs>
            <mask id="tour-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {rect && <rect x={rect.left - pad} y={rect.top - pad}
                width={rect.width + pad * 2} height={rect.height + pad * 2}
                rx="4" fill="black" />}
            </mask>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#tour-mask)" />
        </svg>

        {rect && <div style={{
          position: "fixed", left: rect.left - pad, top: rect.top - pad,
          width: rect.width + pad * 2, height: rect.height + pad * 2,
          borderRadius: 4, animation: "tour-blink 1s ease-in-out infinite",
          pointerEvents: "none", zIndex: 9999,
        }} />}
        {hl && <div style={{ position: "fixed", ...hl, background: "rgba(0,0,0,0.18)", borderRadius: 4, pointerEvents: "none", zIndex: 9999 }} />}
        {cursor?.down && <div style={{ position: "fixed", left: cursor.x - 14, top: cursor.y - 14, width: 28, height: 28, borderRadius: "50%", border: `2px solid ${accent}`, pointerEvents: "none", zIndex: 10001, animation: "tour-ring .5s ease-out forwards" }} />}
        {cursor && <svg viewBox="0 0 24 28" style={{
          position: "fixed", left: cursor.x - 3, top: cursor.y - 2, width: 26, height: 30, zIndex: 10001, pointerEvents: "none",
          transition: cursor.fast ? "transform .12s" : "left 1.1s cubic-bezier(.4,0,.2,1), top 1.1s cubic-bezier(.4,0,.2,1), transform .12s",
          transform: cursor.down ? "scale(.85)" : "scale(1)", transformOrigin: "3px 2px", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.45))",
        }}><path d="M3 2 L3 22 L8.5 17 L12 25 L15.5 23.5 L12 15.5 L19 15.5 Z" fill="#fff" stroke="#111" strokeWidth="1.5" strokeLinejoin="round" /></svg>}
      </div>

      {/* ── Sheet, pinned to an edge of the on-screen frame ── */}
      {(() => { const side = rect?.win ? "bottom" : dock, vertical = side === "top" || side === "bottom"; return (
      <div data-anim-keep="1" style={{
        position: "fixed", zIndex: 10000, pointerEvents: "none",
        top: vv.top, left: vv.left, width: vv.w, height: vv.h,
        display: "flex", flexDirection: vertical ? "column" : "row", justifyContent: side === "bottom" || side === "right" ? "flex-end" : "flex-start",
      }}>
      <div onClick={e => e.stopPropagation()} style={{
        pointerEvents: "auto",
        ...(side === "bottom"
          ? { width: "100%", maxHeight: `${SHEET_HEIGHT_VH}%`, borderTop: `2px solid ${accent}`, boxShadow: "0 -4px 24px rgba(0,0,0,0.25)", padding: "18px 20px 24px" }
          : side === "top"
          ? { width: "100%", maxHeight: `${SHEET_HEIGHT_VH}%`, borderBottom: `2px solid ${accent}`, boxShadow: "0 4px 24px rgba(0,0,0,0.25)", padding: "24px 20px 18px" }
          : { width: SIDE_SHEET_W, height: "100%", justifyContent: "center", [side === "left" ? "borderRight" : "borderLeft"]: `2px solid ${accent}`, boxShadow: "0 0 24px rgba(0,0,0,0.25)", padding: "24px 20px" }),
        background: K.card, boxSizing: "border-box",
        display: "flex", flexDirection: "column",
      }}>
        <div ref={sheetRef} style={{ maxWidth: 480, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ overflowY: "auto", minHeight: 0, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontFamily: FM, color: K.inkLight, marginBottom: 4 }}>
              Step {stepIdx + 1} of {steps.length}
            </div>
            <div style={{ fontSize: 19, fontFamily: FD, color: K.ink, marginBottom: 6 }}>
              {step.title}
            </div>
            <div style={{ fontSize: 14, fontFamily: FM, color: K.inkMed, lineHeight: 1.5 }}>
              {step.description}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {!forced && <button onClick={onClose} style={{
              background: "none", border: `1px solid ${K.border}`, color: K.inkMed,
              fontSize: 12, fontFamily: FM, cursor: "pointer", padding: "6px 14px",
            }}>Exit Tour</button>}
            <div style={{ display: "flex", gap: 8, marginLeft: forced ? "auto" : 0 }}>
              {stepIdx > 0 && <button onClick={() => setStepIdx(i => i - 1)} style={{
                background: "none", border: `1px solid ${K.border}`,
                padding: "6px 14px", color: K.inkMed, fontSize: 13, fontFamily: FM, cursor: "pointer",
              }}>Back</button>}
              {stepIdx < steps.length - 1 ? (
                <button onClick={() => setStepIdx(i => i + 1)} style={{
                  background: accent, border: "none", padding: "6px 14px",
                  color: "#fff", fontSize: 14, fontFamily: FD, cursor: "pointer",
                }}>Next</button>
              ) : (
                <button onClick={onClose} style={{
                  background: accent, border: "none", padding: "6px 14px",
                  color: "#fff", fontSize: 14, fontFamily: FD, cursor: "pointer",
                }}>Finish</button>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
      ); })()}
    </>
  );
}

/* ───────── Tour Steps: Rankine Cycle ───────── */
export const RANKINE_TOUR_STEPS = [
  { target: null, type: "sizing", title: "Display Size", description: "" },
  { target: "theory", title: "Theory", description: "Open the Theory section to learn about ideal Rankine cycle fundamentals, key concepts, and the four thermodynamic processes." },
  { target: "schematic", title: "System Schematic", description: "Click any device — Boiler, Turbine, Condenser, or Pump — to see its thermodynamic process, equations, and live calculated values." },
  { target: "ts-diagram", title: "Drag Labels on T–s", description: "Drag the 'Boiler' or 'Condenser' labels up and down to change the operating pressures, or drag the 'Turbine' label left and right to change the superheat temperature T₃." },
  { target: "fx", title: "Equations Reference", description: "Open the equations modal to see all thermodynamic formulas used in the Rankine cycle analysis." },
  { target: "eta-areas", title: "Efficiency Areas", description: "Toggle shaded areas on the T–s diagram to visualize thermal efficiency as the ratio of net work to heat input." },
  { target: "pv-areas", title: "Work Areas", description: "Toggle shaded areas on the P–v diagram to visualize the boundary work for each process." },
  { target: "lock-buttons", title: "Lock Properties", description: "Lock entropy (s), temperature (T), pressure (P), or specific volume (v) to constrain your drag point on the diagrams." },
  { target: "energy-balance", title: "Energy Balance", description: "Click any energy value — Q in, Q out, W turbine, or W pump — to jump directly to its equation in the reference.", sheet: "top" },
  { target: "settings", title: "Settings", description: "Open the Settings dialog to adjust display size, theme (light/dark), units (T/P/h/s), and animation speed. Preferences persist across sessions." },
  { target: "share-solution", title: "Share & Copy Solution", description: "Share Setup copies a deep link to your current cycle parameters — open it on another device or share with a classmate to land on the same configuration. Copy Solution copies a plain-text dump of every state point and process result in your chosen units, ready to paste into a homework write-up.", sheet: "top" },
];

/* ───────── Tour Steps: Brayton Cycle ───────── */
export const BRAYTON_TOUR_STEPS = [
  { target: null, type: "sizing", title: "Display Size", description: "" },
  { target: "bry-theory", title: "Theory", description: "Open the Theory section to learn about the ideal Brayton (gas-turbine) cycle, the cold-air-standard assumptions, and its four processes." },
  { target: "bry-gas-selector", title: "Working Gas", description: "Switch the working gas — air, nitrogen, helium, argon, or CO₂. The specific-heat ratio k sets efficiency for a given pressure ratio; the Gases button lists every property." },
  { target: "bry-schematic", title: "System Schematic", description: "Click any device — Compressor, Combustor, Turbine, or Heat Exchanger — to see its thermodynamic process, equations, and live calculated values." },
  { target: "bry-visualizer", title: "Volume Visualizer", description: "Air stays a gas throughout the Brayton cycle, so instead of phases this box shows specific volume: its width shrinks as the air is compressed and grows as it expands, while particle speed and colour track temperature." },
  { target: "bry-ts-diagram", title: "Drag Labels on T–s", description: "Drag the 'Combustor' label up and down to change the pressure ratio, or the 'Heat Exchanger' label to change the inlet pressure P₁. Drag the 'Compressor' or 'Turbine' label left and right to change the inlet temperatures T₁ and T₃." },
  { target: "bry-fx", title: "Equations Reference", description: "Open the equations modal to see all thermodynamic formulas used in the Brayton cycle analysis, including the isentropic relations." },
  { target: "bry-eta-areas", title: "Efficiency Areas", description: "Toggle shaded areas on the T–s diagram to visualize thermal efficiency as the ratio of net work to heat input." },
  { target: "bry-pv-areas", title: "Work Areas", description: "Toggle shaded areas on the P–v diagram to visualize compressor work, turbine work, and net work." },
  { target: "bry-lock-buttons", title: "Lock Properties", description: "Lock entropy (s), temperature (T), pressure (P), or specific volume (v) to constrain your drag point on the diagrams." },
  { target: "bry-energy-balance", title: "Energy Balance", description: "Click any energy value — Q in, Q out, W turbine, or W compressor — to jump directly to its equation in the reference.", sheet: "top" },
  { target: "bry-settings", title: "Settings", description: "Open the Settings dialog to adjust display size, theme (light/dark), units (T/P/h/s), and animation speed. Preferences persist across sessions." },
  { target: "bry-share-solution", title: "Share & Copy Solution", description: "Share Setup copies a deep link to your current cycle parameters — open it on another device or share with a classmate to land on the same configuration. Copy Solution copies a plain-text dump of every state point and process result in your chosen units, ready to paste into a homework write-up.", sheet: "top" },
];

/* ───────── Tour Steps: Otto Cycle ───────── */
export const OTTO_TOUR_STEPS = [
  { target: null, type: "sizing", title: "Display Size", description: "" },
  { target: "otto-theory", title: "Theory", description: "Open the Theory section to learn about the ideal Otto (spark-ignition engine) cycle, the closed-system air-standard assumptions, and its four processes." },
  { target: "otto-gas-selector", title: "Working Gas", description: "Switch the working gas — air, nitrogen, helium, argon, or CO₂. The specific-heat ratio k sets efficiency for a given compression ratio; the Gases button lists every property." },
  { target: "otto-schematic", title: "Piston–Cylinder Schematic", description: "The piston follows the drag point's specific volume and the charge colour follows its temperature. Click any process badge — Compression, Combustion, Expansion, or Heat Rejection — for its equations and live values.", demo: { click: "[data-demo='badge-compression']" } },
  { target: "otto-eta-curve", title: "Efficiency vs Compression Ratio", description: "The ideal Otto efficiency depends only on r and the gas's specific-heat ratio k. Every gas is drawn; the selected one is bold. Tap or drag along the curve to set the compression ratio." },
  { target: "otto-ts-diagram", title: "Drag Labels on T–s", description: "Drag the 'Combustion' label up and down to change the compression ratio, or the 'Heat Rejection' label to change the intake pressure P₁. Drag the 'Compression' or 'Expansion' label left and right to change the intake temperature T₁ and peak temperature T₃.", demo: { drag: "[data-demo='ts-combustion']", anchor: "[data-demo='ts-combustion-anchor']", dy: 25 }, hide: ".ts-drag-point" },
  { target: "otto-fx", title: "Equations Reference", description: "Open the equations modal to see every formula used in the Otto cycle analysis, including the isentropic relations and mean effective pressure." },
  { target: "otto-eta-areas", title: "Efficiency Areas", description: "Toggle shaded areas on the T–s diagram to visualize thermal efficiency as the ratio of net work to heat input." },
  { target: "otto-pv-areas", title: "Work Areas", description: "Toggle shaded areas on the P–v diagram to visualize compression work, expansion work, and net work as boundary work ∫P dv." },
  { target: "otto-lock-buttons", title: "Lock Properties", description: "Lock entropy (s), temperature (T), pressure (P), or specific volume (v) to constrain your drag point on the diagrams." },
  { target: "otto-energy-balance", title: "Energy Balance", description: "Click any energy value — Q in, Q out, W expansion, or W compression — to jump directly to its equation in the reference.", sheet: "top", demo: { click: "[data-demo='energy-qin']" } },
  { target: "otto-settings", title: "Settings", description: "Open the Settings dialog to adjust display size, theme (light/dark), units (T/P/h/s), and animation speed. Preferences persist across sessions." },
  { target: "otto-share-solution", title: "Share & Copy Solution", description: "Share Setup copies a deep link to your current cycle parameters — open it on another device or share with a classmate to land on the same configuration. Copy Solution copies a plain-text dump of every state point and process result in your chosen units, ready to paste into a homework write-up.", sheet: "top" },
];

/* ───────── Tour Steps: Refrigeration Cycle ───────── */
export const REF_TOUR_STEPS = [
  { target: null, type: "sizing", title: "Display Size", description: "" },
  { target: "ref-theory", title: "Theory", description: "Open the Theory section to learn about the vapor-compression refrigeration cycle and its four processes." },
  { target: "ref-refrigerants", title: "Refrigerants", description: "Explore different refrigerants — R-134a, R-410A, R-717, and more — with their properties and typical applications." },
  { target: "ref-schematic", title: "System Schematic", description: "Click any device — Compressor, Condenser, Expansion Valve, or Evaporator — to see its thermodynamic details and live values." },
  { target: "ref-ts-diagram", title: "Drag Labels on T–s", description: "Drag the 'Condenser' or 'Evaporator' labels on the T–s diagram to interactively change the operating pressures." },
  { target: "ref-fx", title: "Equations Reference", description: "Open the equations modal for all refrigeration cycle formulas." },
  { target: "ref-cop-areas", title: "COP Areas", description: "Toggle shaded areas on the T–s diagram to visualize the coefficient of performance." },
  { target: "ref-energy-areas", title: "Energy Areas", description: "Toggle shaded areas on the P–h diagram to visualize energy transfer for each process." },
  { target: "ref-lock-buttons", title: "Lock Properties", description: "Lock entropy (s), temperature (T), pressure (P), or enthalpy (h) to constrain your drag point on the diagrams." },
  { target: "ref-energy-balance", title: "Energy Balance", description: "Click any energy value — Q evap, Q cond, or W compressor — to jump directly to its equation.", sheet: "top" },
  { target: "ref-settings", title: "Settings", description: "Open the Settings dialog to adjust display size, theme (light/dark), units (T/P/h/s), and animation speed. Preferences persist across sessions." },
  { target: "ref-share-solution", title: "Share & Copy Solution", description: "Share Setup copies a deep link to your current cycle parameters — open it on another device or share with a classmate to land on the same configuration. Copy Solution copies a plain-text dump of every state point and process result in your chosen units, ready to paste into a homework write-up.", sheet: "top" },
];
