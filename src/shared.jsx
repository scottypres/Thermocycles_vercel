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

/* ───────── Slider ───────── */
export function ParamSlider({ label, unit, value, min, max, step, onChange, color, textScale }) {
  const sc = textScale || 1;
  const sz = (px) => Math.round(px * sc);
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: sz(10), fontFamily: FM, color: K.inkMed }}>{label}</span>
        <span style={{ fontSize: sz(14), fontFamily: FD, color: color || K.accent }}>{value.toFixed(0)} <span style={{ fontSize: sz(10), fontFamily: FM, color: K.inkLight }}>{unit}</span></span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", height: 3, appearance: "none", WebkitAppearance: "none", background: `linear-gradient(to right, ${color || K.accent} 0%, ${color || K.accent} ${pct}%, ${K.border} ${pct}%, ${K.border} 100%)`, borderRadius: 0, outline: "none", cursor: "pointer" }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: sz(8), color: K.inkLight, fontFamily: FM }}>{min}</span>
        <span style={{ fontSize: sz(8), color: K.inkLight, fontFamily: FM }}>{max}</span>
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
