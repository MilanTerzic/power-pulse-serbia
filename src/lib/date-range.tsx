import { createContext, useContext, useState, type ReactNode } from "react";

export function belgradeDateISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDaysISO(dayISO: string, days: number) {
  const date = new Date(`${dayISO}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return belgradeDateISO(date);
}

const todayISO = () => belgradeDateISO();

export interface DateRange {
  from: string;
  to: string;
}

interface Ctx {
  range: DateRange;
  setRange: (r: DateRange) => void;
}

const DateRangeCtx = createContext<Ctx | null>(null);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const t = todayISO();
  const [range, setRange] = useState<DateRange>({ from: t, to: t });
  return <DateRangeCtx.Provider value={{ range, setRange }}>{children}</DateRangeCtx.Provider>;
}

export function useDateRange() {
  const v = useContext(DateRangeCtx);
  if (!v) throw new Error("DateRangeProvider missing");
  return v;
}

export function daysInRange(from: string, to: string): string[] {
  const start = new Date(from + "T00:00:00Z").getTime();
  const end = new Date(to + "T00:00:00Z").getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [from];
  const out: string[] = [];
  // cap at 31 days for safety
  const max = Math.min(end, start + 30 * 86400_000);
  for (let t = start; t <= max; t += 86400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
