import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";

export function TopBar({
  title, subtitle, onRefresh, lastRefresh, hideRange,
}: {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  lastRefresh?: string;
  hideRange?: boolean;
}) {
  const { range, setRange } = useDateRange();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-border/60 bg-surface/60 backdrop-blur sticky top-0 z-10">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-3">
        {!hideRange && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">From</span>
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={e => setRange({ ...range, from: e.target.value })}
              className="bg-surface-2 border border-border/60 rounded px-2 py-1 num text-foreground"
            />
            <span className="text-muted-foreground">To</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={e => setRange({ ...range, to: e.target.value })}
              className="bg-surface-2 border border-border/60 rounded px-2 py-1 num text-foreground"
            />
          </div>
        )}
        {lastRefresh && (
          <span className="text-[11px] text-muted-foreground num">
            Updated {new Date(lastRefresh).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
        {onRefresh && (
          <Button size="sm" variant="outline" onClick={onRefresh} className="h-8 gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        )}
      </div>
    </div>
  );
}
