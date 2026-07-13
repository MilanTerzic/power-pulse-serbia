import { endOfMonth, format, startOfMonth, startOfYear, subDays, subMonths } from "date-fns";
import { CalendarDays, Clock3 } from "lucide-react";
import { useState } from "react";

import { useDateRange } from "@/lib/date-range";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataStatusBadge } from "@/components/data-status";
import { cn } from "@/lib/utils";

type Preset = "7d" | "30d" | "mtd" | "previousMonth" | "ytd" | "custom";

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "MTD" },
  { key: "previousMonth", label: "Previous month" },
  { key: "ytd", label: "YTD" },
  { key: "custom", label: "Custom" },
];

function iso(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function applyPreset(preset: Preset) {
  const now = new Date();
  if (preset === "7d") return { from: iso(subDays(now, 6)), to: iso(now) };
  if (preset === "30d") return { from: iso(subDays(now, 29)), to: iso(now) };
  if (preset === "mtd") return { from: iso(startOfMonth(now)), to: iso(now) };
  if (preset === "previousMonth") {
    const prev = subMonths(now, 1);
    return { from: iso(startOfMonth(prev)), to: iso(endOfMonth(prev)) };
  }
  if (preset === "ytd") return { from: iso(startOfYear(now)), to: iso(now) };
  return null;
}

export function GlobalAnalysisToolbar({
  lastUpdated,
  coverage,
  className,
}: {
  lastUpdated?: string;
  coverage?: number | null;
  className?: string;
}) {
  const { range, setRange } = useDateRange();
  const [preset, setPreset] = useState<Preset>("custom");
  const [comparison, setComparison] = useState("previous-equivalent");
  const updatedText = lastUpdated
    ? new Date(lastUpdated).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Belgrade",
        timeZoneName: "short",
      })
    : "Not available";
  const coverageStatus =
    coverage == null
      ? "unavailable"
      : coverage >= 99
        ? "complete"
        : coverage >= 80
          ? "partial"
          : "delayed";

  return (
    <section
      className={cn("rounded-xl border border-border bg-surface p-3 shadow-sm", className)}
      aria-label="Global analysis period and data controls"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Period
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant={preset === item.key ? "default" : "outline"}
                className="h-8 px-3 text-xs"
                onClick={() => {
                  setPreset(item.key);
                  const next = applyPreset(item.key);
                  if (next) setRange(next);
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid gap-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              From
            </Label>
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(event) => {
                setPreset("custom");
                setRange({ ...range, from: event.target.value });
              }}
              className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-foreground"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">To</Label>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(event) => {
                setPreset("custom");
                setRange({ ...range, to: event.target.value });
              }}
              className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-foreground"
            />
          </div>
          <div className="grid min-w-[220px] gap-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Compare with
            </Label>
            <Select value={comparison} onValueChange={setComparison}>
              <SelectTrigger className="h-9 bg-surface-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="previous-equivalent">Previous equivalent period</SelectItem>
                <SelectItem value="previous-month">Previous month</SelectItem>
                <SelectItem value="previous-year">Previous year</SelectItem>
                <SelectItem value="none">No comparison</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          Selected:{" "}
          <span className="num text-foreground">
            {range.from} to {range.to}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" />
          Updated: <span className="text-foreground">{updatedText}</span>
        </span>
        <DataStatusBadge status={coverageStatus} />
        {coverage != null && <span className="num">{coverage.toFixed(1)}% coverage</span>}
      </div>
    </section>
  );
}
