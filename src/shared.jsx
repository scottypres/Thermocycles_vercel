import { useState, useEffect } from "react";

/* ───────── Palette ───────── */
export const K_LIGHT = {
  bg: "#fafaf7", card: "#ffffff", cardAlt: "#f5f4f0",
  border: "#d4d0c8", ink: "#1a1a2e", inkMed: "#3a3a5c", inkLight: "#8888a0",
  gridFine: "#e8e6e0", gridMajor: "#d4d0c8",
  accent: "#c0392b", accentLight: "#c0392b22",
  heatIn: "#c0392b", heatOut: "#2471a3", workOut: "#1e8449", workIn: "#b7950b",
  dome: "#2471a322", domeLine: "#2471a366",
  stateCircle: "#1a1a2e", stateFill: "#c0392b",
  liquidBlue: "#2471a3", vaporRed: "#c0392b",
};
export const K_DARK = {
  bg: "#0d1117", card: "#161b22", cardAlt: "#1c2128",
  border: "#30363d", ink: "#e6edf3", inkMed: "#b1bac4", inkLight: "#8b949e",
  gridFine: "#1c2128", gridMajor: "#30363d",
  accent: "#e05545", accentLight: "#e0554522",
  heatIn: "#f47067", heatOut: "#58a6ff", workOut: "#3fb950", workIn: "#d29922",
  dome: "#58a6ff22", domeLine: "#58a6ff66",
  stateCircle: "#e6edf3", stateFill: "#e05545",
  liquidBlue: "#58a6ff", vaporRed: "#f47067",
};
export const K = K_LIGHT;
export const FD = "'DM Serif Display',serif";
export const FM = "'DM Mono',monospace";

/* ───────── Utilities ───────── */
export function lerp(x, x0, x1, y0, y1) {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

/* ───────── Unit System ─────────
   Internal calculations stay in SI (°C, kPa, kJ/kg, kJ/kg·K).
   These helpers only convert at the display layer. */
export const UNITS = {
  T: [
    { id: "C", label: "°C", to: v => v },
    { id: "K", label: "K", to: v => v + 273.15 },
    { id: "F", label: "°F", to: v => v * 9 / 5 + 32 },
  ],
  P: [
    { id: "kPa", label: "kPa", to: v => v },
    { id: "bar", label: "bar", to: v => v / 100 },
    { id: "MPa", label: "MPa", to: v => v / 1000 },
    { id: "psi", label: "psi", to: v => v * 0.145038 },
    { id: "atm", label: "atm", to: v => v / 101.325 },
  ],
  h: [
    { id: "kJ/kg", label: "kJ/kg", to: v => v },
    { id: "BTU/lb", label: "BTU/lb", to: v => v * 0.429923 },
  ],
  s: [
    { id: "kJ/kg·K", label: "kJ/kg·K", to: v => v },
    { id: "BTU/lb·°R", label: "BTU/lb·°R", to: v => v * 0.238846 },
  ],
};

export const DEFAULT_UNITS = { T: "C", P: "kPa", h: "kJ/kg", s: "kJ/kg·K" };

export function loadUnits() {
  try {
    const raw = document.cookie.split("; ").find(c => c.startsWith("units="))?.split("=")[1];
    if (!raw) return { ...DEFAULT_UNITS };
    return { ...DEFAULT_UNITS, ...JSON.parse(decodeURIComponent(raw)) };
  } catch { return { ...DEFAULT_UNITS }; }
}

export function saveUnits(units) {
  try { document.cookie = `units=${encodeURIComponent(JSON.stringify(units))};path=/;max-age=31536000`; } catch {}
}

function pick(kind, units) {
  const list = UNITS[kind];
  return list.find(u => u.id === units[kind]) || list[0];
}

const fixed = (v, d) => {
  const a = Math.abs(v);
  if (!isFinite(v)) return String(v);
  return v.toFixed(d ?? (a < 10 ? 2 : a < 1000 ? 1 : 0));
};

export const fmtT = (v, units, d) => `${fixed(pick("T", units).to(v), d ?? 1)} ${pick("T", units).label}`;
export const fmtP = (v, units, d) => `${fixed(pick("P", units).to(v), d ?? (units.P === "kPa" ? 0 : units.P === "MPa" ? 3 : 2))} ${pick("P", units).label}`;
export const fmtH = (v, units, d) => `${fixed(pick("h", units).to(v), d ?? 1)} ${pick("h", units).label}`;
export const fmtS = (v, units, d) => `${fixed(pick("s", units).to(v), d ?? 3)} ${pick("s", units).label}`;
export const cvtT = (v, units) => pick("T", units).to(v);
export const cvtP = (v, units) => pick("P", units).to(v);
export const cvtH = (v, units) => pick("h", units).to(v);
export const cvtS = (v, units) => pick("s", units).to(v);
export const lblT = (units) => pick("T", units).label;
export const lblP = (units) => pick("P", units).label;
export const lblH = (units) => pick("h", units).label;
export const lblS = (units) => pick("s", units).label;

/* ───────── Animation speed cookie helpers ───────── */
export function loadAnimSpeed() {
  try {
    const v = parseFloat(document.cookie.split("; ").find(c => c.startsWith("animSpeed="))?.split("=")[1]);
    return isNaN(v) ? 1 : Math.max(0.25, Math.min(4, v));
  } catch { return 1; }
}
export function saveAnimSpeed(v) {
  try { document.cookie = `animSpeed=${v};path=/;max-age=31536000`; } catch {}
}

/* ───────── Settings modal: display size, theme, units, animation speed ───────── */
export function SettingsModal({ open, onClose, K, FD, FM,
  textScale, onTextScaleChange,
  darkMode, onDarkModeToggle,
  units, onUnitsChange,
  animSpeed, onAnimSpeedChange,
}) {
  if (!open) return null;
  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: FM, fontSize: 11, color: K.inkLight, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${K.border}` }}>{title}</div>
      {children}
    </div>
  );
  const Pill = ({ active, onClick, children, color }) => (
    <button onClick={onClick} style={{
      padding: "5px 12px", fontSize: 12, fontFamily: FM,
      background: active ? (color || K.accent) : K.cardAlt,
      color: active ? "#fff" : K.inkMed,
      border: `1px solid ${active ? (color || K.accent) : K.border}`,
      cursor: "pointer", borderRadius: 3, fontWeight: active ? 700 : 400, transition: "all 0.15s",
    }}>{children}</button>
  );
  const Slider = ({ value, min, max, step, onChange, fmt }) => {
    const pct = ((value - min) / (max - min)) * 100;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(Number(e.target.value))}
            style={{ flex: 1, height: 4, appearance: "none", WebkitAppearance: "none",
              background: `linear-gradient(to right, ${K.accent} 0%, ${K.accent} ${pct}%, ${K.border} ${pct}%, ${K.border} 100%)`,
              borderRadius: 0, outline: "none", cursor: "pointer" }} />
          <span style={{ fontFamily: FM, fontSize: 12, color: K.inkMed, minWidth: 60, textAlign: "right" }}>{fmt(value)}</span>
        </div>
      </div>
    );
  };
  const UnitGroup = ({ kind, label }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: FM, fontSize: 10, color: K.inkLight, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {UNITS[kind].map(u => (
          <Pill key={u.id} active={units[kind] === u.id} onClick={() => onUnitsChange({ ...units, [kind]: u.id })}>{u.label}</Pill>
        ))}
      </div>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 10px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: K.card, border: `1.5px solid ${K.border}`, padding: "22px 24px", maxWidth: 460, width: "100%", color: K.ink, fontFamily: FM }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h3 style={{ margin: 0, fontFamily: FD, fontSize: 22, color: K.ink }}>Settings</h3>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: 11, cursor: "pointer", padding: "4px 14px", fontFamily: FM }}>Close</button>
        </div>
        <Section title={`Display size — ${Math.round(textScale * 100)}%`}>
          <Slider value={textScale} min={0.8} max={1.6} step={0.05} onChange={onTextScaleChange} fmt={v => `${Math.round(v * 100)}%`} />
        </Section>
        <Section title="Theme">
          <div style={{ display: "flex", gap: 6 }}>
            <Pill active={!darkMode} onClick={() => { if (darkMode) onDarkModeToggle(); }}>☀ Light</Pill>
            <Pill active={darkMode} onClick={() => { if (!darkMode) onDarkModeToggle(); }}>☾ Dark</Pill>
          </div>
        </Section>
        <Section title="Units">
          <UnitGroup kind="T" label="Temperature" />
          <UnitGroup kind="P" label="Pressure" />
          <UnitGroup kind="h" label="Specific enthalpy / energy" />
          <UnitGroup kind="s" label="Specific entropy" />
          <button onClick={() => onUnitsChange({ ...DEFAULT_UNITS })} style={{ background: "none", border: `1px solid ${K.border}`, padding: "5px 12px", color: K.inkMed, fontSize: 11, fontFamily: FM, cursor: "pointer", marginTop: 4 }}>Reset to SI</button>
        </Section>
        <Section title={`Animation speed — ${animSpeed.toFixed(2)}×`}>
          <Slider value={animSpeed} min={0.25} max={4} step={0.05} onChange={onAnimSpeedChange} fmt={v => `${v.toFixed(2)}×`} />
          <div style={{ marginTop: 6, fontSize: 10, color: K.inkLight, fontStyle: "italic" }}>Affects the cycle animation toggle on each diagram.</div>
        </Section>
        <button onClick={onClose} style={{ width: "100%", padding: "10px", marginTop: 6, background: K.accent, border: "none", color: "#fff", fontSize: 13, fontWeight: 500, fontFamily: FD, cursor: "pointer" }}>Done</button>
      </div>
    </div>
  );
}

/* Units selector popover (kept for backwards compat / direct use) */
export function UnitsPopover({ open, units, onChange, onClose, anchor, K, FD, FM }) {
  if (!open) return null;
  const Group = ({ kind, label }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: FM, fontSize: 11, color: K.inkLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {UNITS[kind].map(u => {
          const active = units[kind] === u.id;
          return <button key={u.id} onClick={() => onChange({ ...units, [kind]: u.id })} style={{
            padding: "5px 12px", fontSize: 12, fontFamily: FM,
            background: active ? K.accent : K.cardAlt,
            color: active ? "#fff" : K.inkMed,
            border: `1px solid ${active ? K.accent : K.border}`,
            cursor: "pointer", borderRadius: 3, fontWeight: active ? 700 : 400, transition: "all 0.15s",
          }}>{u.label}</button>;
        })}
      </div>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 10px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: K.card, border: `1.5px solid ${K.border}`, padding: "20px 22px", maxWidth: 380, width: "100%", color: K.ink }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, borderBottom: `2px solid ${K.ink}`, paddingBottom: 10 }}>
          <h3 style={{ margin: 0, fontFamily: FD, fontSize: 18, color: K.ink }}>Units</h3>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${K.border}`, color: K.inkMed, fontSize: 11, cursor: "pointer", padding: "3px 12px", fontFamily: FM }}>Close</button>
        </div>
        <Group kind="T" label="Temperature" />
        <Group kind="P" label="Pressure" />
        <Group kind="h" label="Specific Enthalpy / Energy" />
        <Group kind="s" label="Specific Entropy" />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <button onClick={() => onChange({ ...DEFAULT_UNITS })} style={{ background: "none", border: `1px solid ${K.border}`, padding: "6px 14px", color: K.inkMed, fontSize: 11, fontFamily: FM, cursor: "pointer" }}>Reset to SI</button>
          <button onClick={onClose} style={{ background: K.accent, border: "none", padding: "6px 18px", color: "#fff", fontSize: 12, fontFamily: FD, cursor: "pointer" }}>Done</button>
        </div>
        <div style={{ marginTop: 10, fontSize: 10, color: K.inkLight, fontStyle: "italic", lineHeight: 1.5 }}>
          Affects displayed values across performance, state table, lock buttons, drag-point box, energy cards. Sliders and equation modal stay in SI.
        </div>
      </div>
    </div>
  );
}

/* ───────── Slider ─────────
   value/min/max are stored in SI; if `kind` and `units` are provided, the
   readout, unit label, and min/max ticks display in the user's chosen units.
   The native slider input stays in SI so step/handle behave consistently. */
export function ParamSlider({ label, unit, kind, value, min, max, step, onChange, color, textScale, units }) {
  const sc = textScale || 1;
  const sz = (px) => Math.round(px * sc);
  const desktop = useIsDesktop();
  const pct = ((value - min) / (max - min)) * 100;
  const conv = kind && units ? pick(kind, units) : null;
  const dispVal = conv ? conv.to(value) : value;
  const dispMin = conv ? conv.to(min) : min;
  const dispMax = conv ? conv.to(max) : max;
  const dispUnit = conv ? conv.label : unit;
  const dispDigits = (v) => {
    if (!conv) return 0;
    const a = Math.abs(v);
    if (kind === "P") return units.P === "MPa" ? 3 : units.P === "bar" || units.P === "atm" ? 2 : 0;
    if (kind === "T") return 0;
    return a < 10 ? 2 : 1;
  };
  const fmtTick = (v) => conv ? v.toFixed(dispDigits(v)) : String(v);
  return (
    <div style={{ marginBottom: desktop ? 24 : 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: desktop ? 8 : 5 }}>
        <span style={{ fontSize: sz(desktop ? 16 : 10), fontFamily: FM, color: K.inkMed }}>{label}</span>
        <span style={{ fontSize: sz(desktop ? 22 : 14), fontFamily: FD, color: color || K.accent }}>{dispVal.toFixed(dispDigits(dispVal))} <span style={{ fontSize: sz(desktop ? 14 : 10), fontFamily: FM, color: K.inkLight }}>{dispUnit}</span></span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", height: desktop ? 4 : 3, appearance: "none", WebkitAppearance: "none", background: `linear-gradient(to right, ${color || K.accent} 0%, ${color || K.accent} ${pct}%, ${K.border} ${pct}%, ${K.border} 100%)`, borderRadius: 0, outline: "none", cursor: "pointer" }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: desktop ? 5 : 3 }}>
        <span style={{ fontSize: sz(desktop ? 13 : 8), color: K.inkLight, fontFamily: FM }}>{fmtTick(dispMin)}</span>
        <span style={{ fontSize: sz(desktop ? 13 : 8), color: K.inkLight, fontFamily: FM }}>{fmtTick(dispMax)}</span>
      </div>
    </div>
  );
}

/* ───────── Desktop detection ───────── */
export function useIsDesktop(breakpoint = 840) {
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.innerWidth >= breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isDesktop;
}

/* ───────── Font loader ───────── */
export function FontLoader() {
  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;
          background:${K.accent};border:2px solid #fff;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15);
        }
        input[type="range"]::-moz-range-thumb { width:16px;height:16px;border-radius:50%;background:${K.accent};border:2px solid #fff;cursor:pointer; }
        *{box-sizing:border-box}body{margin:0;background:${K.bg}}
      `}</style>
    </>
  );
}

/* ───────── Author attribution ───────── */
export function AuthorFooter() {
  const handleEmail = () => {
    const parts = ["scottypres", "gmail", "com"];
    window.location.href = "mailto:" + parts[0] + "\u0040" + parts[1] + "." + parts[2];
  };
  return (
    <span
      onClick={handleEmail}
      style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}
    >
      scottypres
    </span>
  );
}
