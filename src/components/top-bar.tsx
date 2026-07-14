import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDaysISO, belgradeDateISO, useDateRange } from "@/lib/date-range";

function monthStart(dayISO: string) {
  return `${dayISO.slice(0, 7)}-01`;
}

function previousMonthRange(todayISO: string) {
  const date = new Date(`${monthStart(todayISO)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const from = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const toDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
  const to = `${toDate.getUTCFullYear()}-${String(toDate.getUTCMonth() + 1).padStart(2, "0")}-${String(toDate.getUTCDate()).padStart(2, "0")}`;
  return { from, to };
}

export function TopBar({
  title,
  subtitle,
  onRefresh,
  lastRefresh,
  hideRange,
  isRefreshing,
  dataHealth,
  onDataHealthClick,
}: {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  lastRefresh?: string;
  hideRange?: boolean;
  isRefreshing?: boolean;
  dataHealth?: string;
  onDataHealthClick?: () => void;
}) {
  const { range, setRange } = useDateRange();
  const today = belgradeDateISO();
  const presets = [
    { label: "Today", range: { from: today, to: today } },
    { label: "D+1", range: { from: addDaysISO(today, 1), to: addDaysISO(today, 1) } },
    { label: "Last 7 days", range: { from: addDaysISO(today, -6), to: today } },
    { label: "MTD", range: { from: monthStart(today), to: today } },
    { label: "Previous month", range: previousMonthRange(today) },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-border/60 bg-surface/60 backdrop-blur sticky top-0 z-10">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!hideRange && (
          <>
            <div className="flex flex-wrap items-center gap-1">
              {presets.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  size="sm"
                  variant={
                    range.from === preset.range.from && range.to === preset.range.to
                      ? "default"
                      : "ghost"
                  }
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setRange(preset.range)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">From</span>
              <input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
                className="bg-surface-2 border border-border/60 rounded px-2 py-1 num text-foreground"
              />
              <span className="text-muted-foreground">To</span>
              <input
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
                className="bg-surface-2 border border-border/60 rounded px-2 py-1 num text-foreground"
              />
            </div>
          </>
        )}
        {lastRefresh && (
          <span className="text-[11px] text-muted-foreground num">
            Checked{" "}
            {new Date(lastRefresh).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/Belgrade",
            })}
          </span>
        )}
        {dataHealth && (
          <button
            type="button"
            onClick={onDataHealthClick}
            className="rounded border border-border/60 bg-surface-2 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Data health: <span className="text-primary">{dataHealth}</span>
          </button>
        )}
        {onRefresh && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            className="h-8 gap-1.5"
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        )}
      </div>
    </div>
  );
}
