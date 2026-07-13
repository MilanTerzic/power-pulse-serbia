import { AlertCircle, CheckCircle2, Clock3, Database, Info, Radio } from "lucide-react";

import { cn } from "@/lib/utils";

export type DataStatus =
  | "live"
  | "complete"
  | "delayed"
  | "partial"
  | "estimated"
  | "demo"
  | "unavailable";

const STATUS_CONFIG: Record<
  DataStatus,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  live: {
    label: "Live data",
    icon: Radio,
    className: "border-success/30 bg-success/10 text-success",
  },
  complete: {
    label: "Complete data",
    icon: CheckCircle2,
    className: "border-success/30 bg-success/10 text-success",
  },
  delayed: {
    label: "Delayed data",
    icon: Clock3,
    className: "border-info/30 bg-info/10 text-info",
  },
  partial: {
    label: "Partial coverage",
    icon: AlertCircle,
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  estimated: {
    label: "Estimated data",
    icon: Database,
    className: "border-info/30 bg-info/10 text-info",
  },
  demo: {
    label: "Demo data",
    icon: AlertCircle,
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  unavailable: {
    label: "Unavailable",
    icon: Info,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

export function DataStatusBadge({
  status,
  label,
  className,
}: {
  status: DataStatus;
  label?: string;
  className?: string;
}) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        config.className,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label ?? config.label}
    </span>
  );
}

export function DataCoverageIndicator({
  coverage,
  received,
  expected,
}: {
  coverage?: number | null;
  received?: number | null;
  expected?: number | null;
}) {
  const pct = coverage == null ? null : Math.max(0, Math.min(100, coverage));
  const status: DataStatus =
    pct == null ? "unavailable" : pct >= 99 ? "complete" : pct >= 80 ? "partial" : "delayed";
  const detail =
    received != null && expected != null
      ? `${received} of ${expected} observations`
      : pct != null
        ? `${pct.toFixed(1)}% coverage`
        : "Coverage unavailable";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DataStatusBadge status={status} />
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}
