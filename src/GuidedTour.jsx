import { useState, useEffect } from "react";
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
    <div style={{
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

/* ───────── Tooltip positioning ───────── */
function getTooltipPos(rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.min(320, vw - 16);
  const estH = 180;
  const gap = 12;
  const style = { maxWidth: maxW };

  if (rect.bottom + gap + estH < vh) {
    style.top = rect.bottom + gap;
  } else if (rect.top - gap - estH > 0) {
    style.bottom = vh - rect.top + gap;
  } else {
    style.top = Math.max(8, (vh - estH) / 2);
  }

  const cx = rect.left + rect.width / 2;
  style.left = Math.max(8, Math.min(cx - maxW / 2, vw - maxW - 8));
  return style;
}

/* ───────── Guided Tour ───────── */
export function GuidedTour({ steps, isOpen, onClose, K, textScale, onScaleChange }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState(null);

  useEffect(() => { if (isOpen) setStepIdx(0); }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !steps[stepIdx]) return;

    const step = steps[stepIdx];
    if (!step.target) { setRect(null); return; }

    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) { setRect(null); return; }

    el.scrollIntoView({ behavior: "smooth", block: "center" });

    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    const t = setTimeout(measure, 400);

    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [isOpen, stepIdx, steps]);

  if (!isOpen || !steps[stepIdx]) return null;

  const step = steps[stepIdx];
  const pad = 6;
  const accent = K.accent;
  const isSizing = step.type === "sizing";

  return (
    <>
      <style>{`
        @keyframes tour-blink {
          0%, 100% { box-shadow: 0 0 0 3px ${accent}cc, 0 0 14px ${accent}44; }
          50% { box-shadow: 0 0 0 3px ${accent}22, 0 0 0px ${accent}00; }
        }
        input[type="range"].tour-slider::-webkit-slider-thumb {
          -webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;
          background:${accent};border:2px solid ${K.card};cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15);
        }
        input[type="range"].tour-slider::-moz-range-thumb {
          width:16px;height:16px;border-radius:50%;background:${accent};border:2px solid ${K.card};cursor:pointer;
        }
      `}</style>

      {/* Overlay with cutout (skip for sizing step) */}
      <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={onClose}>
        {!isSizing && (
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
        )}
        {isSizing && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
        )}

        {!isSizing && rect && <div style={{
          position: "fixed", left: rect.left - pad, top: rect.top - pad,
          width: rect.width + pad * 2, height: rect.height + pad * 2,
          borderRadius: 4, animation: "tour-blink 1s ease-in-out infinite",
          pointerEvents: "none", zIndex: 9999,
        }} />}
      </div>

      {/* Tooltip */}
      <div onClick={e => e.stopPropagation()} style={{
        position: "fixed", zIndex: 10000,
        ...(isSizing || !rect
          ? { top: "50%", left: "50%", transform: "translate(-50%,-50%)", maxWidth: 340 }
          : getTooltipPos(rect)),
        background: K.card, border: `2px solid ${accent}`,
        padding: "16px 20px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: 10, fontFamily: FM, color: K.inkLight, marginBottom: 4 }}>
          Step {stepIdx + 1} of {steps.length}
        </div>
        <div style={{ fontSize: 16, fontFamily: FD, color: K.ink, marginBottom: 6 }}>
          {step.title}
        </div>

        {isSizing ? (
          <SizingPanel textScale={textScale} onScaleChange={onScaleChange} K={K} />
        ) : (
          <div style={{ fontSize: 12, fontFamily: FM, color: K.inkMed, lineHeight: 1.5, marginBottom: 14 }}>
            {step.description}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: K.inkLight,
            fontSize: 10, fontFamily: FM, cursor: "pointer", padding: "4px 8px",
          }}>Exit Tour</button>
          <div style={{ display: "flex", gap: 8 }}>
            {stepIdx > 0 && <button onClick={() => setStepIdx(i => i - 1)} style={{
              background: "none", border: `1px solid ${K.border}`,
              padding: "6px 14px", color: K.inkMed, fontSize: 11, fontFamily: FM, cursor: "pointer",
            }}>Back</button>}
            {stepIdx < steps.length - 1 ? (
              <button onClick={() => setStepIdx(i => i + 1)} style={{
                background: K.accent, border: "none", padding: "6px 14px",
                color: "#fff", fontSize: 12, fontFamily: FD, cursor: "pointer",
              }}>Next</button>
            ) : (
              <button onClick={onClose} style={{
                background: K.accent, border: "none", padding: "6px 14px",
                color: "#fff", fontSize: 12, fontFamily: FD, cursor: "pointer",
              }}>Finish</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ───────── Tour Steps: Rankine Cycle ───────── */
export const RANKINE_TOUR_STEPS = [
  { target: null, type: "sizing", title: "Display Size", description: "" },
  { target: "theory", title: "Theory", description: "Open the Theory section to learn about ideal Rankine cycle fundamentals, key concepts, and the four thermodynamic processes." },
  { target: "schematic", title: "System Schematic", description: "Click any device — Boiler, Turbine, Condenser, or Pump — to see its thermodynamic process, equations, and live calculated values." },
  { target: "ts-diagram", title: "Drag Labels on T–s", description: "Drag the 'Boiler' or 'Condenser' labels on the T–s diagram to interactively change the operating pressures." },
  { target: "fx", title: "Equations Reference", description: "Open the equations modal to see all thermodynamic formulas used in the Rankine cycle analysis." },
  { target: "eta-areas", title: "Efficiency Areas", description: "Toggle shaded areas on the T–s diagram to visualize thermal efficiency as the ratio of net work to heat input." },
  { target: "pv-areas", title: "Work Areas", description: "Toggle shaded areas on the P–v diagram to visualize the boundary work for each process." },
  { target: "lock-buttons", title: "Lock Properties", description: "Lock entropy (s), temperature (T), pressure (P), or specific volume (v) to constrain your drag point on the diagrams." },
  { target: "energy-balance", title: "Energy Balance", description: "Click any energy value — Q in, Q out, W turbine, or W pump — to jump directly to its equation in the reference." },
  { target: "dark-mode", title: "Dark Mode", description: "Toggle between light and dark themes. Your preference is saved automatically." },
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
  { target: "ref-energy-balance", title: "Energy Balance", description: "Click any energy value — Q evap, Q cond, or W compressor — to jump directly to its equation." },
  { target: "ref-dark-mode", title: "Dark Mode", description: "Toggle between light and dark themes. Your preference is saved automatically." },
];
