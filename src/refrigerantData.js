/* ───────── Refrigerant Saturation Data ─────────
   Each entry: { P (kPa), T (°C), hf (kJ/kg), hg (kJ/kg), sf (kJ/kg·K), sg (kJ/kg·K), vf (m³/kg), vg (m³/kg) }
   Sources: NIST RefProp / ASHRAE Fundamentals — simplified for educational use
*/

import { lerp } from "./shared.jsx";

// ── R-134a (1,1,1,2-Tetrafluoroethane) ──
const R134A_TABLE = [
  { P: 50,   T: -40.7, hf: 148.4, hg: 374.2, sf: 0.800, sg: 1.763, vf: 0.000706, vg: 0.3612 },
  { P: 100,  T: -26.4, hf: 170.3, hg: 383.5, sf: 0.883, sg: 1.744, vf: 0.000725, vg: 0.1917 },
  { P: 150,  T: -17.1, hf: 184.7, hg: 389.5, sf: 0.934, sg: 1.735, vf: 0.000738, vg: 0.1316 },
  { P: 200,  T: -10.1, hf: 195.8, hg: 394.1, sf: 0.972, sg: 1.729, vf: 0.000749, vg: 0.1001 },
  { P: 300,  T: 0.6,   hf: 213.5, hg: 400.8, sf: 1.031, sg: 1.722, vf: 0.000767, vg: 0.0678 },
  { P: 400,  T: 8.9,   hf: 227.5, hg: 405.7, sf: 1.075, sg: 1.717, vf: 0.000782, vg: 0.0512 },
  { P: 500,  T: 15.7,  hf: 239.2, hg: 409.5, sf: 1.111, sg: 1.714, vf: 0.000795, vg: 0.0411 },
  { P: 600,  T: 21.6,  hf: 249.5, hg: 412.6, sf: 1.142, sg: 1.711, vf: 0.000808, vg: 0.0342 },
  { P: 800,  T: 31.3,  hf: 266.8, hg: 417.3, sf: 1.193, sg: 1.707, vf: 0.000831, vg: 0.0255 },
  { P: 1000, T: 39.4,  hf: 281.5, hg: 420.7, sf: 1.235, sg: 1.703, vf: 0.000854, vg: 0.0202 },
  { P: 1200, T: 46.3,  hf: 294.5, hg: 423.1, sf: 1.272, sg: 1.699, vf: 0.000876, vg: 0.0166 },
  { P: 1400, T: 52.4,  hf: 306.5, hg: 424.8, sf: 1.305, sg: 1.695, vf: 0.000898, vg: 0.0140 },
  { P: 1600, T: 57.9,  hf: 317.6, hg: 425.8, sf: 1.335, sg: 1.690, vf: 0.000921, vg: 0.0120 },
  { P: 2000, T: 67.5,  hf: 338.5, hg: 426.4, sf: 1.390, sg: 1.679, vf: 0.000969, vg: 0.0090 },
  { P: 2500, T: 78.1,  hf: 362.1, hg: 424.4, sf: 1.451, sg: 1.661, vf: 0.001034, vg: 0.0066 },
  { P: 3000, T: 86.6,  hf: 384.6, hg: 419.3, sf: 1.508, sg: 1.638, vf: 0.001112, vg: 0.0048 },
  { P: 4059, T: 101.0, hf: 425.0, hg: 425.0, sf: 1.562, sg: 1.562, vf: 0.001950, vg: 0.001950 },
];

// ── R-410A (R-32/R-125 blend, 50/50) ──
const R410A_TABLE = [
  { P: 100,  T: -51.5, hf: 132.0, hg: 392.8, sf: 0.730, sg: 1.908, vf: 0.000695, vg: 0.2480 },
  { P: 200,  T: -37.0, hf: 159.4, hg: 404.7, sf: 0.838, sg: 1.878, vf: 0.000717, vg: 0.1290 },
  { P: 300,  T: -27.6, hf: 176.5, hg: 411.8, sf: 0.906, sg: 1.863, vf: 0.000733, vg: 0.0872 },
  { P: 500,  T: -13.1, hf: 201.9, hg: 421.0, sf: 1.006, sg: 1.843, vf: 0.000759, vg: 0.0528 },
  { P: 700,  T: -2.5,  hf: 220.5, hg: 427.0, sf: 1.073, sg: 1.830, vf: 0.000781, vg: 0.0377 },
  { P: 1000, T: 9.0,   hf: 241.8, hg: 432.3, sf: 1.141, sg: 1.815, vf: 0.000810, vg: 0.0261 },
  { P: 1200, T: 16.0,  hf: 254.3, hg: 434.9, sf: 1.180, sg: 1.806, vf: 0.000829, vg: 0.0214 },
  { P: 1500, T: 24.8,  hf: 270.8, hg: 437.5, sf: 1.227, sg: 1.794, vf: 0.000855, vg: 0.0167 },
  { P: 2000, T: 36.5,  hf: 294.2, hg: 440.0, sf: 1.289, sg: 1.775, vf: 0.000895, vg: 0.0119 },
  { P: 2500, T: 46.0,  hf: 315.0, hg: 440.0, sf: 1.343, sg: 1.754, vf: 0.000938, vg: 0.0089 },
  { P: 3000, T: 54.0,  hf: 334.8, hg: 437.5, sf: 1.394, sg: 1.730, vf: 0.000988, vg: 0.0067 },
  { P: 3500, T: 61.0,  hf: 354.5, hg: 432.0, sf: 1.445, sg: 1.700, vf: 0.001050, vg: 0.0050 },
  { P: 4000, T: 66.8,  hf: 375.0, hg: 422.0, sf: 1.498, sg: 1.660, vf: 0.001140, vg: 0.0036 },
  { P: 4901, T: 70.3,  hf: 410.0, hg: 410.0, sf: 1.560, sg: 1.560, vf: 0.002200, vg: 0.002200 },
];

// ── R-744 (Carbon Dioxide / CO₂) ──
const R744_TABLE = [
  { P: 1000, T: -40.1, hf: 83.4,  hg: 430.1, sf: 0.530, sg: 2.130, vf: 0.000867, vg: 0.0388 },
  { P: 1500, T: -28.1, hf: 110.2, hg: 436.0, sf: 0.625, sg: 2.077, vf: 0.000903, vg: 0.0256 },
  { P: 2000, T: -19.5, hf: 131.5, hg: 438.7, sf: 0.698, sg: 2.040, vf: 0.000937, vg: 0.0188 },
  { P: 2500, T: -12.4, hf: 150.0, hg: 439.6, sf: 0.758, sg: 2.009, vf: 0.000971, vg: 0.0146 },
  { P: 3000, T: -5.5,  hf: 167.1, hg: 439.1, sf: 0.813, sg: 1.980, vf: 0.001008, vg: 0.0116 },
  { P: 3500, T: 0.6,   hf: 183.5, hg: 437.2, sf: 0.864, sg: 1.951, vf: 0.001048, vg: 0.0094 },
  { P: 4000, T: 5.3,   hf: 199.6, hg: 433.8, sf: 0.913, sg: 1.920, vf: 0.001093, vg: 0.0077 },
  { P: 4500, T: 10.1,  hf: 216.0, hg: 428.5, sf: 0.961, sg: 1.886, vf: 0.001146, vg: 0.0062 },
  { P: 5000, T: 14.3,  hf: 232.8, hg: 421.4, sf: 1.009, sg: 1.847, vf: 0.001209, vg: 0.0050 },
  { P: 5500, T: 18.2,  hf: 250.8, hg: 411.7, sf: 1.060, sg: 1.801, vf: 0.001288, vg: 0.0039 },
  { P: 6000, T: 22.0,  hf: 271.0, hg: 398.1, sf: 1.116, sg: 1.743, vf: 0.001399, vg: 0.0030 },
  { P: 6500, T: 25.5,  hf: 296.0, hg: 377.0, sf: 1.185, sg: 1.664, vf: 0.001580, vg: 0.0022 },
  { P: 7380, T: 31.1,  hf: 350.0, hg: 350.0, sf: 1.430, sg: 1.430, vf: 0.002140, vg: 0.002140 },
];

// ── R-717 (Ammonia / NH₃) ──
const R717_TABLE = [
  { P: 50,   T: -46.5, hf: -36.0,  hg: 1389.0, sf: -0.091, sg: 5.840, vf: 0.001433, vg: 2.175 },
  { P: 100,  T: -33.6, hf: 10.0,   hg: 1413.0, sf: 0.042,  sg: 5.685, vf: 0.001462, vg: 1.138 },
  { P: 200,  T: -18.9, hf: 73.0,   hg: 1440.0, sf: 0.231,  sg: 5.490, vf: 0.001504, vg: 0.594 },
  { P: 300,  T: -9.2,  hf: 113.4,  hg: 1455.0, sf: 0.352,  sg: 5.388, vf: 0.001536, vg: 0.406 },
  { P: 500,  T: 4.1,   hf: 170.8,  hg: 1473.0, sf: 0.521,  sg: 5.254, vf: 0.001583, vg: 0.250 },
  { P: 700,  T: 14.0,  hf: 213.4,  hg: 1482.0, sf: 0.641,  sg: 5.170, vf: 0.001623, vg: 0.181 },
  { P: 1000, T: 24.9,  hf: 264.7,  hg: 1489.0, sf: 0.778,  sg: 5.075, vf: 0.001672, vg: 0.128 },
  { P: 1500, T: 38.7,  hf: 332.0,  hg: 1492.0, sf: 0.949,  sg: 4.960, vf: 0.001740, vg: 0.085 },
  { P: 2000, T: 49.4,  hf: 387.8,  hg: 1489.0, sf: 1.085,  sg: 4.869, vf: 0.001805, vg: 0.063 },
  { P: 3000, T: 65.3,  hf: 480.0,  hg: 1476.0, sf: 1.306,  sg: 4.718, vf: 0.001935, vg: 0.040 },
  { P: 4000, T: 77.7,  hf: 558.0,  hg: 1453.0, sf: 1.484,  sg: 4.586, vf: 0.002070, vg: 0.028 },
  { P: 5000, T: 88.0,  hf: 630.0,  hg: 1422.0, sf: 1.641,  sg: 4.460, vf: 0.002220, vg: 0.021 },
  { P: 7000, T: 104.3, hf: 764.0,  hg: 1338.0, sf: 1.920,  sg: 4.196, vf: 0.002600, vg: 0.013 },
  { P: 11330,T: 132.3, hf: 1100.0, hg: 1100.0, sf: 2.750,  sg: 2.750, vf: 0.004250, vg: 0.004250 },
];

// ── R-32 (Difluoromethane) ──
const R32_TABLE = [
  { P: 100,  T: -51.7, hf: 109.5, hg: 465.6, sf: 0.600, sg: 2.270, vf: 0.000750, vg: 0.2530 },
  { P: 200,  T: -36.6, hf: 139.8, hg: 479.0, sf: 0.726, sg: 2.220, vf: 0.000775, vg: 0.1310 },
  { P: 300,  T: -26.4, hf: 158.8, hg: 487.0, sf: 0.805, sg: 2.193, vf: 0.000794, vg: 0.0887 },
  { P: 500,  T: -11.2, hf: 187.0, hg: 498.0, sf: 0.924, sg: 2.157, vf: 0.000824, vg: 0.0538 },
  { P: 700,  T: -0.2,  hf: 207.8, hg: 505.2, sf: 1.006, sg: 2.134, vf: 0.000849, vg: 0.0385 },
  { P: 1000, T: 11.6,  hf: 232.5, hg: 512.0, sf: 1.092, sg: 2.108, vf: 0.000882, vg: 0.0267 },
  { P: 1500, T: 26.2,  hf: 265.0, hg: 519.0, sf: 1.193, sg: 2.076, vf: 0.000928, vg: 0.0172 },
  { P: 2000, T: 37.5,  hf: 293.0, hg: 522.5, sf: 1.274, sg: 2.048, vf: 0.000976, vg: 0.0123 },
  { P: 2500, T: 47.0,  hf: 318.5, hg: 523.0, sf: 1.346, sg: 2.020, vf: 0.001030, vg: 0.0093 },
  { P: 3000, T: 55.0,  hf: 343.0, hg: 521.0, sf: 1.412, sg: 1.988, vf: 0.001092, vg: 0.0072 },
  { P: 4000, T: 67.6,  hf: 392.0, hg: 509.0, sf: 1.540, sg: 1.910, vf: 0.001250, vg: 0.0044 },
  { P: 5000, T: 76.0,  hf: 448.0, hg: 480.0, sf: 1.680, sg: 1.800, vf: 0.001550, vg: 0.0028 },
  { P: 5782, T: 78.1,  hf: 480.0, hg: 480.0, sf: 1.750, sg: 1.750, vf: 0.002340, vg: 0.002340 },
];

// ── R-1234yf (2,3,3,3-Tetrafluoroprop-1-ene) ──
const R1234YF_TABLE = [
  { P: 50,   T: -42.1, hf: 143.0, hg: 343.5, sf: 0.780, sg: 1.680, vf: 0.000720, vg: 0.3700 },
  { P: 100,  T: -27.0, hf: 166.0, hg: 354.0, sf: 0.870, sg: 1.665, vf: 0.000740, vg: 0.1950 },
  { P: 200,  T: -11.0, hf: 193.0, hg: 365.0, sf: 0.965, sg: 1.650, vf: 0.000770, vg: 0.1010 },
  { P: 300,  T: -0.5,  hf: 211.0, hg: 372.0, sf: 1.025, sg: 1.642, vf: 0.000792, vg: 0.0686 },
  { P: 400,  T: 7.8,   hf: 225.0, hg: 377.0, sf: 1.070, sg: 1.637, vf: 0.000810, vg: 0.0519 },
  { P: 500,  T: 14.9,  hf: 237.0, hg: 381.0, sf: 1.108, sg: 1.633, vf: 0.000827, vg: 0.0416 },
  { P: 600,  T: 21.0,  hf: 247.5, hg: 384.0, sf: 1.140, sg: 1.630, vf: 0.000843, vg: 0.0347 },
  { P: 800,  T: 31.2,  hf: 265.5, hg: 389.0, sf: 1.195, sg: 1.624, vf: 0.000875, vg: 0.0258 },
  { P: 1000, T: 39.4,  hf: 281.0, hg: 392.0, sf: 1.241, sg: 1.618, vf: 0.000905, vg: 0.0203 },
  { P: 1200, T: 46.5,  hf: 295.0, hg: 394.0, sf: 1.282, sg: 1.612, vf: 0.000937, vg: 0.0164 },
  { P: 1500, T: 55.5,  hf: 314.0, hg: 395.0, sf: 1.335, sg: 1.602, vf: 0.000985, vg: 0.0125 },
  { P: 2000, T: 67.5,  hf: 341.0, hg: 393.0, sf: 1.405, sg: 1.582, vf: 0.001065, vg: 0.0084 },
  { P: 2500, T: 77.5,  hf: 366.0, hg: 386.0, sf: 1.472, sg: 1.551, vf: 0.001175, vg: 0.0056 },
  { P: 3382, T: 94.7,  hf: 395.0, hg: 395.0, sf: 1.560, sg: 1.560, vf: 0.002000, vg: 0.002000 },
];

// ── R-290 (Propane) ──
const R290_TABLE = [
  { P: 50,   T: -56.2, hf: 75.0,  hg: 504.0, sf: 0.400, sg: 2.580, vf: 0.001550, vg: 0.7900 },
  { P: 100,  T: -42.1, hf: 108.0, hg: 520.0, sf: 0.540, sg: 2.500, vf: 0.001590, vg: 0.4120 },
  { P: 200,  T: -25.4, hf: 152.0, hg: 539.0, sf: 0.710, sg: 2.410, vf: 0.001650, vg: 0.2150 },
  { P: 300,  T: -14.3, hf: 181.0, hg: 550.0, sf: 0.820, sg: 2.363, vf: 0.001700, vg: 0.1470 },
  { P: 500,  T: 1.7,   hf: 225.0, hg: 567.0, sf: 0.980, sg: 2.300, vf: 0.001780, vg: 0.0892 },
  { P: 700,  T: 13.5,  hf: 258.0, hg: 577.0, sf: 1.090, sg: 2.261, vf: 0.001845, vg: 0.0638 },
  { P: 1000, T: 26.9,  hf: 298.0, hg: 586.0, sf: 1.210, sg: 2.218, vf: 0.001930, vg: 0.0443 },
  { P: 1500, T: 43.3,  hf: 350.0, hg: 594.0, sf: 1.360, sg: 2.167, vf: 0.002050, vg: 0.0285 },
  { P: 2000, T: 55.9,  hf: 395.0, hg: 596.0, sf: 1.480, sg: 2.120, vf: 0.002180, vg: 0.0201 },
  { P: 2500, T: 66.2,  hf: 436.0, hg: 593.0, sf: 1.585, sg: 2.073, vf: 0.002330, vg: 0.0147 },
  { P: 3000, T: 74.8,  hf: 476.0, hg: 585.0, sf: 1.685, sg: 2.020, vf: 0.002520, vg: 0.0106 },
  { P: 3500, T: 82.1,  hf: 518.0, hg: 571.0, sf: 1.785, sg: 1.958, vf: 0.002790, vg: 0.0073 },
  { P: 4247, T: 96.7,  hf: 560.0, hg: 560.0, sf: 1.940, sg: 1.940, vf: 0.004500, vg: 0.004500 },
];

/* ───────── Refrigerant Registry ───────── */
export const REFRIGERANTS = [
  {
    id: "R134a", name: "R-134a", formula: "CH₂FCF₃", type: "HFC",
    table: R134A_TABLE, criticalT: 101.0, criticalP: 4059,
    gwp: 1430, odp: 0,
    applications: "Automotive AC, commercial refrigeration, chillers",
    notes: "Most widely studied; being phased down under Kigali Amendment",
    status: "Current (phase-down)",
  },
  {
    id: "R410A", name: "R-410A", formula: "R-32/R-125 (50/50)", type: "HFC Blend",
    table: R410A_TABLE, criticalT: 70.3, criticalP: 4901,
    gwp: 2088, odp: 0,
    applications: "Residential & commercial HVAC, heat pumps",
    notes: "Current standard for residential AC; being replaced by R-32",
    status: "Current (being replaced)",
  },
  {
    id: "R744", name: "R-744", formula: "CO₂", type: "Natural",
    table: R744_TABLE, criticalT: 31.1, criticalP: 7380,
    gwp: 1, odp: 0,
    applications: "Transcritical heat pumps, cascade systems, automotive AC",
    notes: "Very low critical temperature; operates at very high pressures; environmentally ideal",
    status: "Emerging",
  },
  {
    id: "R717", name: "R-717", formula: "NH₃", type: "Natural",
    table: R717_TABLE, criticalT: 132.3, criticalP: 11330,
    gwp: 0, odp: 0,
    applications: "Industrial refrigeration, cold storage, ice production",
    notes: "Excellent thermodynamic properties; toxic and flammable; not for residential use",
    status: "Established (industrial)",
  },
  {
    id: "R32", name: "R-32", formula: "CH₂F₂", type: "HFC",
    table: R32_TABLE, criticalT: 78.1, criticalP: 5782,
    gwp: 675, odp: 0,
    applications: "Residential AC, heat pumps (next-gen replacement for R-410A)",
    notes: "Lower GWP than R-410A; mildly flammable (A2L); higher efficiency",
    status: "Emerging",
  },
  {
    id: "R1234yf", name: "R-1234yf", formula: "CF₃CF=CH₂", type: "HFO",
    table: R1234YF_TABLE, criticalT: 94.7, criticalP: 3382,
    gwp: 4, odp: 0,
    applications: "Automotive AC (replacement for R-134a)",
    notes: "Ultra-low GWP; mandated in EU vehicles since 2017; mildly flammable",
    status: "Current (automotive)",
  },
  {
    id: "R290", name: "R-290", formula: "C₃H₈", type: "Natural (HC)",
    table: R290_TABLE, criticalT: 96.7, criticalP: 4247,
    gwp: 3, odp: 0,
    applications: "Commercial display cases, small AC units, heat pumps",
    notes: "Excellent thermodynamic performance; flammable (A3); charge limits apply",
    status: "Emerging",
  },
];

/* ───────── Interpolation ───────── */
export function interpRefrigerant(table, P, prop) {
  if (P <= table[0].P) return table[0][prop];
  if (P >= table[table.length - 1].P) return table[table.length - 1][prop];
  for (let i = 0; i < table.length - 1; i++) {
    if (P >= table[i].P && P <= table[i + 1].P)
      return lerp(P, table[i].P, table[i + 1].P, table[i][prop], table[i + 1][prop]);
  }
  return table[table.length - 1][prop];
}

/* ───────── Dome bounds by temperature ───────── */
export function getRefrigerantDomeBounds(table, T) {
  const critRow = table[table.length - 1];
  if (T <= table[0].T || T >= critRow.T) return null;
  for (let i = 0; i < table.length - 1; i++) {
    if (T >= table[i].T && T <= table[i + 1].T) {
      const sf = lerp(T, table[i].T, table[i + 1].T, table[i].sf, table[i + 1].sf);
      const sg = lerp(T, table[i].T, table[i + 1].T, table[i].sg, table[i + 1].sg);
      return { sf, sg };
    }
  }
  return null;
}

/* ───────── Phase info for refrigerant ───────── */
export function getRefrigerantPhaseInfo(table, s, T) {
  const critRow = table[table.length - 1];
  const bounds = getRefrigerantDomeBounds(table, T);
  if (!bounds) {
    if (T >= critRow.T) return { phase: "supercritical", quality: null };
    return { phase: "subcooled", quality: 0 };
  }
  if (s < bounds.sf) return { phase: "subcooled", quality: 0 };
  if (s > bounds.sg) return { phase: "superheated", quality: 1 };
  const x = (s - bounds.sf) / (bounds.sg - bounds.sf);
  return { phase: "two-phase", quality: Math.max(0, Math.min(1, x)) };
}

/* ───────── Default pressure ranges for each refrigerant ───────── */
export function getDefaultPressures(ref) {
  const table = ref.table;
  // Evaporator: ~20% into the table range, Condenser: ~60% into range
  const pMin = table[0].P;
  const pMax = table[table.length - 2].P; // exclude critical point row
  const pLow = Math.round(pMin + (pMax - pMin) * 0.15);
  const pHigh = Math.round(pMin + (pMax - pMin) * 0.55);
  return { pLow, pHigh, pMin: Math.round(pMin), pMax: Math.round(pMax) };
}
