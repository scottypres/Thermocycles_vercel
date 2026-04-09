import { useState, useEffect } from "react";
import { FD, FM } from "./shared.jsx";

/* ───────── Welcome Popup (first-load) ───────── */
export function WelcomePopup({ open, onStart, onDismiss, K }) {
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.5)",
    }} onClick={onDismiss}>
      <div onClick={e => e.stopPropagation()} style={{
        background: K.card, border: `2px solid ${K.border}`,
        padding: "32px 28px", maxWidth: 340, textAlign: "center",
      }}>
        <h2 style={{ fontFamily: FD, color: K.ink, margin: "0 0 8px", fontSize: 24 }}>Welcome</h2>
        <p style={{ fontFamily: FM, color: K.inkMed, fontSize: 13, lineHeight: 1.6, margin: "0 0 24px" }}>
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
export function GuidedTour({ steps, isOpen, onClose, K }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState(null);

  useEffect(() => { if (isOpen) setStepIdx(0); }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !steps[stepIdx]) return;

    const sel = steps[stepIdx].target;
    const el = document.querySelector(`[data-tour="${sel}"]`);
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

  return (
    <>
      <style>{`
        @keyframes tour-blink {
          0%, 100% { box-shadow: 0 0 0 3px ${accent}cc, 0 0 14px ${accent}44; }
          50% { box-shadow: 0 0 0 3px ${accent}22, 0 0 0px ${accent}00; }
        }
      `}</style>

      {/* Overlay with cutout */}
      <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={onClose}>
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
      </div>

      {/* Tooltip */}
      <div onClick={e => e.stopPropagation()} style={{
        position: "fixed", zIndex: 10000,
        ...(rect ? getTooltipPos(rect) : { top: "50%", left: "50%", transform: "translate(-50%,-50%)", maxWidth: 320 }),
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
        <div style={{ fontSize: 12, fontFamily: FM, color: K.inkMed, lineHeight: 1.5, marginBottom: 14 }}>
          {step.description}
        </div>
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
