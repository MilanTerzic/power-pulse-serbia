// Client-safe types + config for the CBC capacity resale dashboard.
// Ported from cbc_capacity_resale_dashboard.py
import type { ZoneCode } from "./markets";

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

export const DIRECTIONAL_BORDERS: Array<[ZoneCode, ZoneCode]> = [
  ...UNDIRECTED_BORDERS,
  ...UNDIRECTED_BORDERS.map(([a, b]) => [b, a] as [ZoneCode, ZoneCode]),
];

export interface CbcPosition {
  id: string;
  label: string;
  from: ZoneCode;
  to: ZoneCode;
  mw: number;
  annual_booked_price: number | null; // null => use market annual price
}

export const DEFAULT_POSITIONS: CbcPosition[] = [
  { id: "HR_BA", label: "HR→BA annual", from: "HR", to: "BA", mw: 15, annual_booked_price: null },
  { id: "BA_ME", label: "BA→MNE annual", from: "BA", to: "ME", mw: 5, annual_booked_price: null },
];

export type ResaleMode = "monthly" | "daily";

export interface MonthWindow {
  month: string; // YYYY-MM
  start: string;
  end: string;
  hours: number;
}

export interface BorderCompareRow {
  key: string;
  from: ZoneCode;
  to: ZoneCode;
  border: string;
  annual_price: number | null;
  monthly_price: number | null;
  daily_price: number | null;
  offered_mw: number | null;
  allocated_mw: number | null;
  monthly_resale_spread: number | null;
  daily_resale_spread: number | null;
  monthly_series: Array<{ month: string; monthly: number | null; daily: number | null }>;
  status: "ok" | "partial" | "missing";
  source: string;
  message: string;
}

export interface PnlRow {
  position_id: string;
  label: string;
  border: string;
  month: string;
  mw: number;
  hours: number;
  annual_price: number | null;
  monthly_price: number | null;
  daily_price: number | null;
  mode: ResaleMode;
  resale_price: number | null;
  pnl: number | null;
  best_mode: ResaleMode | null;
  best_pnl: number | null;
}

export interface RecommendationRow {
  position_id: string;
  label: string;
  border: string;
  month: string;
  mw: number;
  hours: number;
  annual_price: number | null;
  monthly_fc: number | null;
  daily_fc: number | null;
  recommendation: ResaleMode | "missing";
  probability: number | null;
  confidence: number | null;
  expected_pnl: number | null;
  incremental_vs_other: number | null;
  reason: string;
}

export function monthWindows(startISO: string, endISO: string): MonthWindow[] {
  const out: MonthWindow[] = [];
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start)
    return out;
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth() + 1)) {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const last = new Date(Date.UTC(y, m, 1) - 86400_000);
    const s = first < start ? start : first;
    const e = last > end ? end : last;
    const days = Math.round((e.getTime() - s.getTime()) / 86400_000) + 1;
    out.push({
      month: `${y}-${String(m).padStart(2, "0")}`,
      start: s.toISOString().slice(0, 10),
      end: e.toISOString().slice(0, 10),
      hours: days * 24,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[Number(m) - 1] ?? m} ${y}`;
}
