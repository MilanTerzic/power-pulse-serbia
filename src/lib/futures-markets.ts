export type FuturesMarketCode =
  "RS" | "HU" | "RO" | "BG" | "HR" | "SI" | "GR" | "IT" | "AT" | "DE_LU" | "ME" | "MK" | "AL";

export type FuturesLoadType = "base" | "peak";
export type FuturesMaturityType =
  "day" | "weekend" | "week" | "month" | "quarter" | "year" | "other";
export type FuturesSourceStatus =
  | "live"
  | "current-eod"
  | "cached"
  | "stale"
  | "partial"
  | "unavailable"
  | "authentication-required"
  | "subscription-required"
  | "unsupported-product"
  | "configuration-required"
  | "public-extraction-unavailable"
  | "manual-import";

export interface FuturesMarket {
  code: FuturesMarketCode;
  country: string;
  flag: string;
  exchange: string;
  eexProductName: string;
  eexProductId?: string;
  marketDataHubSnippet?: string;
  available: boolean;
  status?: string;
  priority: number;
  defaultVisible: boolean;
  supportedLoadTypes: FuturesLoadType[];
  supportedMaturityTypes: FuturesMaturityType[];
}

const STANDARD_MATURITIES: FuturesMaturityType[] = ["month", "quarter", "year"];
const STANDARD_LOAD_TYPES: FuturesLoadType[] = ["base", "peak"];

export const FUTURES_MARKETS: Record<FuturesMarketCode, FuturesMarket> = {
  RS: {
    code: "RS",
    country: "Serbia",
    flag: "🇷🇸",
    exchange: "EEX/PXE",
    eexProductName: "EEX-PXE Serbian Power Future",
    available: true,
    priority: 1,
    defaultVisible: true,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  HU: {
    code: "HU",
    country: "Hungary",
    flag: "🇭🇺",
    exchange: "EEX/PXE",
    eexProductName: "EEX-PXE Hungarian Power Future",
    available: true,
    priority: 2,
    defaultVisible: true,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  RO: {
    code: "RO",
    country: "Romania",
    flag: "🇷🇴",
    exchange: "EEX/PXE",
    eexProductName: "EEX-PXE Romanian Power Future",
    available: true,
    priority: 3,
    defaultVisible: true,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  BG: {
    code: "BG",
    country: "Bulgaria",
    flag: "🇧🇬",
    exchange: "EEX/PXE",
    eexProductName: "EEX-PXE Bulgarian Power Future",
    available: true,
    priority: 4,
    defaultVisible: true,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  HR: {
    code: "HR",
    country: "Croatia",
    flag: "🇭🇷",
    exchange: "EEX/PXE",
    eexProductName: "EEX-PXE Croatian Power Future",
    available: true,
    priority: 5,
    defaultVisible: false,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  SI: {
    code: "SI",
    country: "Slovenia",
    flag: "🇸🇮",
    exchange: "EEX/PXE",
    eexProductName: "EEX-PXE Slovenian Power Future",
    available: true,
    priority: 6,
    defaultVisible: false,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  GR: {
    code: "GR",
    country: "Greece",
    flag: "🇬🇷",
    exchange: "EEX",
    eexProductName: "EEX Greek Power Future",
    available: true,
    priority: 7,
    defaultVisible: false,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  IT: {
    code: "IT",
    country: "Italy",
    flag: "🇮🇹",
    exchange: "EEX",
    eexProductName: "EEX Italian Power Future",
    available: true,
    priority: 8,
    defaultVisible: false,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  AT: {
    code: "AT",
    country: "Austria",
    flag: "🇦🇹",
    exchange: "EEX",
    eexProductName: "EEX Austrian Power Future",
    available: true,
    priority: 9,
    defaultVisible: false,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  DE_LU: {
    code: "DE_LU",
    country: "Germany/Luxembourg",
    flag: "🇩🇪🇱🇺",
    exchange: "EEX",
    eexProductName: "EEX German Power Future",
    available: true,
    priority: 10,
    defaultVisible: true,
    supportedLoadTypes: STANDARD_LOAD_TYPES,
    supportedMaturityTypes: STANDARD_MATURITIES,
  },
  ME: {
    code: "ME",
    country: "Montenegro",
    flag: "🇲🇪",
    exchange: "EEX",
    eexProductName: "No verified EEX power-futures product",
    available: false,
    status: "No EEX futures contract available",
    priority: 11,
    defaultVisible: false,
    supportedLoadTypes: [],
    supportedMaturityTypes: [],
  },
  MK: {
    code: "MK",
    country: "North Macedonia",
    flag: "🇲🇰",
    exchange: "EEX",
    eexProductName: "No verified EEX power-futures product",
    available: false,
    status: "No EEX futures contract available",
    priority: 12,
    defaultVisible: false,
    supportedLoadTypes: [],
    supportedMaturityTypes: [],
  },
  AL: {
    code: "AL",
    country: "Albania",
    flag: "🇦🇱",
    exchange: "EEX",
    eexProductName: "No verified EEX power-futures product",
    available: false,
    status: "No EEX futures contract available",
    priority: 13,
    defaultVisible: false,
    supportedLoadTypes: [],
    supportedMaturityTypes: [],
  },
};

export const FUTURES_MARKET_LIST = Object.values(FUTURES_MARKETS).sort(
  (a, b) => a.priority - b.priority,
);

export const AVAILABLE_FUTURES_MARKETS = FUTURES_MARKET_LIST.filter((market) => market.available);

export const FUTURES_PRESETS: Record<string, FuturesMarketCode[]> = {
  serbiaOnly: ["RS"],
  directRegion: ["RS", "HU", "RO", "BG", "HR"],
  southeastEurope: ["RS", "HU", "RO", "BG", "HR", "SI", "GR"],
  europeanBenchmarks: ["RS", "HU", "AT", "DE_LU", "IT"],
  allAvailable: AVAILABLE_FUTURES_MARKETS.map((market) => market.code),
};
