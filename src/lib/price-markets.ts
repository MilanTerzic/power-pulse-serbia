export type PriceMarketCode =
  "RS" | "HU" | "RO" | "BG" | "HR" | "ME" | "MK" | "SI" | "GR" | "IT_CSUD" | "AT" | "DE_LU" | "AL";

export type PriceMarketGroup = "serbia" | "direct-neighbour" | "regional" | "european-benchmark";

export interface PriceMarket {
  code: PriceMarketCode;
  country: string;
  marketName: string;
  exchange: string;
  eic: string;
  flag: string;
  label: string;
  displayLabel: string;
  chartColor: string;
  analysisPriority: number;
  group: PriceMarketGroup;
  directSerbianNeighbour: boolean;
}

export const PRICE_MARKETS: Record<PriceMarketCode, PriceMarket> = {
  RS: {
    code: "RS",
    country: "Serbia",
    marketName: "Serbia",
    exchange: "SEEPEX",
    eic: "10YCS-SERBIATSOV",
    flag: "🇷🇸",
    label: "Serbia",
    displayLabel: "🇷🇸 Serbia · SEEPEX",
    chartColor: "#1ec8c8",
    analysisPriority: 1,
    group: "serbia",
    directSerbianNeighbour: false,
  },
  HU: {
    code: "HU",
    country: "Hungary",
    marketName: "Hungary",
    exchange: "HUPX",
    eic: "10YHU-MAVIR----U",
    flag: "🇭🇺",
    label: "Hungary",
    displayLabel: "🇭🇺 Hungary · HUPX",
    chartColor: "#5aa9e6",
    analysisPriority: 2,
    group: "direct-neighbour",
    directSerbianNeighbour: true,
  },
  RO: {
    code: "RO",
    country: "Romania",
    marketName: "Romania",
    exchange: "OPCOM",
    eic: "10YRO-TEL------P",
    flag: "🇷🇴",
    label: "Romania",
    displayLabel: "🇷🇴 Romania · OPCOM",
    chartColor: "#f5b14c",
    analysisPriority: 3,
    group: "direct-neighbour",
    directSerbianNeighbour: true,
  },
  BG: {
    code: "BG",
    country: "Bulgaria",
    marketName: "Bulgaria",
    exchange: "IBEX",
    eic: "10YCA-BULGARIA-R",
    flag: "🇧🇬",
    label: "Bulgaria",
    displayLabel: "🇧🇬 Bulgaria · IBEX",
    chartColor: "#a78bfa",
    analysisPriority: 4,
    group: "direct-neighbour",
    directSerbianNeighbour: true,
  },
  HR: {
    code: "HR",
    country: "Croatia",
    marketName: "Croatia",
    exchange: "CROPEX",
    eic: "10YHR-HEP------M",
    flag: "🇭🇷",
    label: "Croatia",
    displayLabel: "🇭🇷 Croatia · CROPEX",
    chartColor: "#34d399",
    analysisPriority: 5,
    group: "direct-neighbour",
    directSerbianNeighbour: true,
  },
  ME: {
    code: "ME",
    country: "Montenegro",
    marketName: "Montenegro",
    exchange: "MEPX/BELEN",
    eic: "10YCS-CG-TSO---S",
    flag: "🇲🇪",
    label: "Montenegro",
    displayLabel: "🇲🇪 Montenegro · MEPX/BELEN",
    chartColor: "#22d3ee",
    analysisPriority: 6,
    group: "direct-neighbour",
    directSerbianNeighbour: true,
  },
  MK: {
    code: "MK",
    country: "North Macedonia",
    marketName: "North Macedonia",
    exchange: "MEMO",
    eic: "10YMK-MEPSO----8",
    flag: "🇲🇰",
    label: "North Macedonia",
    displayLabel: "🇲🇰 North Macedonia · MEMO",
    chartColor: "#fbbf24",
    analysisPriority: 7,
    group: "direct-neighbour",
    directSerbianNeighbour: true,
  },
  SI: {
    code: "SI",
    country: "Slovenia",
    marketName: "Slovenia",
    exchange: "BSP SouthPool",
    eic: "10YSI-ELES-----O",
    flag: "🇸🇮",
    label: "Slovenia",
    displayLabel: "🇸🇮 Slovenia · BSP SouthPool",
    chartColor: "#94a3b8",
    analysisPriority: 8,
    group: "regional",
    directSerbianNeighbour: false,
  },
  GR: {
    code: "GR",
    country: "Greece",
    marketName: "Greece",
    exchange: "HEnEx",
    eic: "10YGR-HTSO-----Y",
    flag: "🇬🇷",
    label: "Greece",
    displayLabel: "🇬🇷 Greece · HEnEx",
    chartColor: "#fb7185",
    analysisPriority: 9,
    group: "regional",
    directSerbianNeighbour: false,
  },
  IT_CSUD: {
    code: "IT_CSUD",
    country: "Italy CSUD",
    marketName: "Italy Centre-South",
    exchange: "GME",
    eic: "10Y1001A1001A71M",
    flag: "🇮🇹",
    label: "Italy CSUD",
    displayLabel: "🇮🇹 Italy CSUD · GME",
    chartColor: "#f97316",
    analysisPriority: 10,
    group: "european-benchmark",
    directSerbianNeighbour: false,
  },
  AT: {
    code: "AT",
    country: "Austria",
    marketName: "Austria",
    exchange: "EPEX SPOT",
    eic: "10YAT-APG------L",
    flag: "🇦🇹",
    label: "Austria",
    displayLabel: "🇦🇹 Austria · EPEX SPOT",
    chartColor: "#60a5fa",
    analysisPriority: 11,
    group: "european-benchmark",
    directSerbianNeighbour: false,
  },
  DE_LU: {
    code: "DE_LU",
    country: "Germany/Luxembourg",
    marketName: "DE-LU",
    exchange: "EPEX SPOT",
    eic: "10Y1001A1001A82H",
    flag: "🇩🇪🇱🇺",
    label: "DE-LU",
    displayLabel: "🇩🇪🇱🇺 DE-LU · EPEX SPOT",
    chartColor: "#64748b",
    analysisPriority: 12,
    group: "european-benchmark",
    directSerbianNeighbour: false,
  },
  AL: {
    code: "AL",
    country: "Albania",
    marketName: "Albania",
    exchange: "ALPEX",
    eic: "10YAL-KESH-----5",
    flag: "🇦🇱",
    label: "Albania",
    displayLabel: "🇦🇱 Albania · ALPEX",
    chartColor: "#e879f9",
    analysisPriority: 13,
    group: "regional",
    directSerbianNeighbour: false,
  },
};

export const PRICE_MARKET_LIST = Object.values(PRICE_MARKETS).sort(
  (a, b) => a.analysisPriority - b.analysisPriority,
);

export const PRICE_MARKET_CODES = PRICE_MARKET_LIST.map((market) => market.code);

export const MARKET_PRESETS: Record<string, PriceMarketCode[]> = {
  core: ["RS", "HU", "RO", "BG", "HR"],
  directNeighbours: ["RS", "HU", "RO", "BG", "HR", "ME", "MK"],
  regional: ["RS", "HU", "RO", "BG", "HR", "ME", "MK", "SI", "GR", "AL"],
  europeanBenchmarks: ["RS", "AT", "DE_LU", "IT_CSUD"],
  all: PRICE_MARKET_CODES,
  serbiaOnly: ["RS"],
};

export function isPriceMarketCode(value: string): value is PriceMarketCode {
  return value in PRICE_MARKETS;
}
