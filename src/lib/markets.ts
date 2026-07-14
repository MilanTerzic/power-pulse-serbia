// Central market/zone/border config, ported from market_config.py + cbc_capacity_resale_dashboard.py
export type ZoneCode =
  "RS" | "HU" | "RO" | "BG" | "HR" | "SI" | "BA" | "ME" | "MK" | "AL" | "UA" | "XK";

export interface Zone {
  code: ZoneCode;
  name: string;
  eic: string;
  x: number;
  y: number;
  capital?: { lat: number; lon: number };
}

export const ZONES: Record<ZoneCode, Zone> = {
  RS: {
    code: "RS",
    name: "Serbia",
    eic: "10YCS-SERBIATSOV",
    x: 410,
    y: 285,
    capital: { lat: 44.81, lon: 20.46 },
  },
  HU: {
    code: "HU",
    name: "Hungary",
    eic: "10YHU-MAVIR----U",
    x: 375,
    y: 160,
    capital: { lat: 47.5, lon: 19.04 },
  },
  RO: {
    code: "RO",
    name: "Romania",
    eic: "10YRO-TEL------P",
    x: 575,
    y: 235,
    capital: { lat: 44.43, lon: 26.1 },
  },
  BG: {
    code: "BG",
    name: "Bulgaria",
    eic: "10YCA-BULGARIA-R",
    x: 560,
    y: 335,
    capital: { lat: 42.7, lon: 23.32 },
  },
  HR: {
    code: "HR",
    name: "Croatia",
    eic: "10YHR-HEP------M",
    x: 190,
    y: 245,
    capital: { lat: 45.81, lon: 15.98 },
  },
  SI: {
    code: "SI",
    name: "Slovenia",
    eic: "10YSI-ELES-----O",
    x: 110,
    y: 200,
    capital: { lat: 46.06, lon: 14.51 },
  },
  BA: {
    code: "BA",
    name: "Bosnia and Herzegovina",
    eic: "10YBA-JPCC-----D",
    x: 260,
    y: 290,
    capital: { lat: 43.86, lon: 18.41 },
  },
  ME: {
    code: "ME",
    name: "Montenegro",
    eic: "10YCS-CG-TSO---S",
    x: 320,
    y: 370,
    capital: { lat: 42.44, lon: 19.26 },
  },
  MK: {
    code: "MK",
    name: "North Macedonia",
    eic: "10YMK-MEPSO----8",
    x: 430,
    y: 405,
    capital: { lat: 41.99, lon: 21.43 },
  },
  AL: {
    code: "AL",
    name: "Albania",
    eic: "10YAL-KESH-----5",
    x: 250,
    y: 445,
    capital: { lat: 41.33, lon: 19.82 },
  },
  UA: {
    code: "UA",
    name: "Ukraine",
    eic: "10Y1001C--00003F",
    x: 640,
    y: 110,
    capital: { lat: 50.45, lon: 30.52 },
  },
  XK: {
    code: "XK",
    name: "Kosovo",
    eic: "10Y1001C--00100H",
    x: 380,
    y: 365,
    capital: { lat: 42.66, lon: 21.16 },
  },
};

export const ENTSOE_DOCUMENT_TYPES = {
  day_ahead_prices: "A44",
  physical_flows: "A11",
  explicit_allocations: "A25",
  production_unit_unavailability: "A77",
  generation_unit_unavailability: "A80",
  system_total_load: "A65",
  actual_generation: "A75",
} as const;

export const MARKET_AGREEMENT_TYPES = {
  daily: "A01",
  monthly: "A03",
  annual: "A04",
} as const;
export type ProductType = keyof typeof MARKET_AGREEMENT_TYPES;

// Import routes INTO Serbia. BA excluded — no DA/ID market.
export const IMPORT_ROUTES: Array<{ from: ZoneCode; to: ZoneCode; label: string }> = [
  { from: "HU", to: "RS", label: "HU → RS" },
  { from: "RO", to: "RS", label: "RO → RS" },
  { from: "BG", to: "RS", label: "BG → RS" },
  { from: "HR", to: "RS", label: "HR → RS" },
  { from: "ME", to: "RS", label: "ME → RS" },
  { from: "MK", to: "RS", label: "MK → RS" },
];

export const EXPORT_ROUTES: Array<{ from: ZoneCode; to: ZoneCode; label: string }> = [
  { from: "RS", to: "HU", label: "RS → HU" },
  { from: "RS", to: "RO", label: "RS → RO" },
  { from: "RS", to: "BG", label: "RS → BG" },
  { from: "RS", to: "HR", label: "RS → HR" },
  { from: "RS", to: "ME", label: "RS → ME" },
  { from: "RS", to: "MK", label: "RS → MK" },
];

// CBC borders (undirected, then expanded directed). BA kept for capacity resale only.
export const UNDIRECTED_BORDERS: Array<[ZoneCode, ZoneCode]> = [
  ["RS", "HU"],
  ["RS", "RO"],
  ["RS", "BG"],
  ["RS", "MK"],
  ["RS", "BA"],
  ["RS", "ME"],
  ["RS", "HR"],
  ["BA", "HR"],
  ["BA", "ME"],
  ["ME", "AL"],
  ["ME", "XK"],
];
export const BORDERS: Array<[ZoneCode, ZoneCode]> = [
  ...UNDIRECTED_BORDERS,
  ...UNDIRECTED_BORDERS.map(([a, b]) => [b, a] as [ZoneCode, ZoneCode]),
];

export const borderKey = (from: ZoneCode, to: ZoneCode) => `${from}_${to}`;

// Danube monitoring stations with coordinates for Open-Meteo flood API.
export const DANUBE_STATION_COORDS: Record<string, { lat: number; lon: number }> = {
  Bezdan: { lat: 45.85, lon: 18.96 },
  "Novi Sad": { lat: 45.26, lon: 19.85 },
  Zemun: { lat: 44.84, lon: 20.4 },
  Pancevo: { lat: 44.87, lon: 20.65 },
  Smederevo: { lat: 44.66, lon: 20.93 },
  "Veliko Gradiste": { lat: 44.76, lon: 21.51 },
  Prahovo: { lat: 44.3, lon: 22.6 },
};
export const DANUBE_STATIONS = Object.keys(DANUBE_STATION_COORDS);

// Approximate technical NTC (Net Transfer Capacity) per direction, MW.
// Reference values from ENTSO-E SDAC / SEE CAO yearly capacity calc reports (typical, MW).
// Used as denominator for utilization% when a live A61 value is unavailable.
export const TECHNICAL_NTC_MW: Record<string, number> = {
  HU_RS: 600,
  RS_HU: 600,
  RO_RS: 700,
  RS_RO: 700,
  BG_RS: 350,
  RS_BG: 350,
  HR_RS: 600,
  RS_HR: 600,
  BA_RS: 600,
  RS_BA: 600,
  ME_RS: 450,
  RS_ME: 450,
  MK_RS: 350,
  RS_MK: 350,
  BA_HR: 600,
  HR_BA: 600,
  BA_ME: 450,
  ME_BA: 450,
  ME_AL: 250,
  AL_ME: 250,
  ME_XK: 300,
  XK_ME: 300,
};

export const PRODUCTS: ProductType[] = ["annual", "monthly", "daily"];

export const ROUTE_COLORS = {
  positive: "var(--color-success)",
  negative: "var(--color-destructive)",
  neutral: "var(--color-muted-foreground)",
  warn: "var(--color-warning)",
};
