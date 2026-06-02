import { createContext, useContext, useState, type ReactNode } from "react";

const todayISO = () => new Date().toISOString().slice(0, 10);

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
