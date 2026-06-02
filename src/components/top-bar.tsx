import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function TopBar({
  title, subtitle, demo, onRefresh, lastRefresh,
}: {
  title: string;
  subtitle?: string;
  demo?: boolean;
  onRefresh?: () => void;
  lastRefresh?: string;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border/60 bg-surface/60 backdrop-blur sticky top-0 z-10">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {demo && <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 text-[10px]">DEMO MODE</Badge>}
        </div>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-3">
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
