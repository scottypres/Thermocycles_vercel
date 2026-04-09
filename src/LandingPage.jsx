import { K, FD, FM, FontLoader, AuthorFooter } from "./shared.jsx";

export default function LandingPage({ onNavigate }) {
  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.ink, fontFamily: FM, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <FontLoader />

      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{ fontSize: 11, color: K.inkLight, letterSpacing: 4, marginBottom: 4, textTransform: "uppercase" }}>Thermodynamics</div>
        <h1 style={{ margin: 0, fontSize: 42, fontFamily: FD, color: K.ink, lineHeight: 1.1 }}>
          ThermoCycle <span style={{ color: K.accent, fontStyle: "italic" }}>Studio</span>
        </h1>
        <div style={{ fontSize: 12, color: K.inkLight, letterSpacing: 2, marginTop: 6 }}>Interactive Thermodynamic Cycle Analysis</div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center", padding: "0 20px", maxWidth: 800 }}>
        {/* Rankine Cycle Card */}
        <button
          onClick={() => onNavigate("rankine")}
          style={{
            background: "#fff", border: `1.5px solid ${K.border}`, padding: "34px 38px", cursor: "pointer",
            width: 340, textAlign: "left", transition: "all 0.2s",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = K.accent; e.currentTarget.style.boxShadow = "0 4px 20px rgba(192,57,43,0.12)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = K.border; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)"; }}
        >
          <div style={{ fontSize: 11, color: K.inkLight, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>Power Generation</div>
          <div style={{ fontSize: 24, fontFamily: FD, color: K.ink, marginBottom: 10, lineHeight: 1.2 }}>
            Rankine <span style={{ color: K.accent, fontStyle: "italic" }}>Cycle</span>
          </div>
          <div style={{ fontSize: 13, color: K.inkMed, lineHeight: 1.7 }}>
            Steam power plant analysis with interactive T-s and P-v diagrams. Explore turbine work, boiler heat, and thermal efficiency.
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            {["Turbine", "Boiler", "Pump", "Condenser"].map((c, i) => (
              <span key={i} style={{ fontSize: 10, padding: "3px 8px", background: K.cardAlt, border: `1px solid ${K.border}`, color: K.inkLight }}>{c}</span>
            ))}
          </div>
        </button>

        {/* Refrigeration Cycle Card */}
        <button
          onClick={() => onNavigate("refrigeration")}
          style={{
            background: "#fff", border: `1.5px solid ${K.border}`, padding: "34px 38px", cursor: "pointer",
            width: 340, textAlign: "left", transition: "all 0.2s",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = K.heatOut; e.currentTarget.style.boxShadow = "0 4px 20px rgba(36,113,163,0.12)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = K.border; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)"; }}
        >
          <div style={{ fontSize: 11, color: K.inkLight, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>Cooling & Refrigeration</div>
          <div style={{ fontSize: 24, fontFamily: FD, color: K.ink, marginBottom: 10, lineHeight: 1.2 }}>
            Refrigeration <span style={{ color: K.heatOut, fontStyle: "italic" }}>Cycle</span>
          </div>
          <div style={{ fontSize: 13, color: K.inkMed, lineHeight: 1.7 }}>
            Vapor-compression refrigeration with T-s and P-h diagrams. Compare 7 refrigerants, analyze COP, and explore phase changes.
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            {["Compressor", "Condenser", "Valve", "Evaporator"].map((c, i) => (
              <span key={i} style={{ fontSize: 10, padding: "3px 8px", background: K.cardAlt, border: `1px solid ${K.border}`, color: K.inkLight }}>{c}</span>
            ))}
          </div>
        </button>
      </div>

      <div style={{ textAlign: "center", padding: "48px 12px 28px", fontSize: 10, color: K.inkLight, fontFamily: FM, fontStyle: "italic", letterSpacing: 1 }}>
        Educational Tool · Simplified Properties · <AuthorFooter />
      </div>
    </div>
  );
}
