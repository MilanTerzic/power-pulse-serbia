import { useState } from "react";

export function useDay() {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [demo, setDemo] = useState(false);
  return { day, setDay, demo, setDemo };
}

export function hourMean(arr: Array<{ price?: number; value?: number; mw?: number }>, field: "price" | "value" | "mw" = "price") {
  const vals = arr.map(a => (a as Record<string, number>)[field]).filter((v): v is number => Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
