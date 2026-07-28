import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DataBadge } from "./data-badge";
import type { ReactNode } from "react";

export function KpiSkeleton() {
  return (
    <Card className="bg-surface border-border/60">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="mt-3 h-7 w-28" />
        <Skeleton className="mt-2 h-3 w-40" />
      </CardContent>
    </Card>
  );
}


export function KPI({
  label, value, sub, source, accent = "primary",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  source?: string;
  accent?: "primary" | "success" | "destructive" | "warning" | "info" | "muted";
}) {
  const colorMap: Record<string, string> = {
    primary: "text-primary",
    success: "text-success",
    destructive: "text-destructive",
    warning: "text-warning",
    info: "text-info",
    muted: "text-foreground",
  };
  return (
    <Card className="bg-surface border-border/60">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
          {source && <DataBadge source={source} />}
        </div>
        <div className={`mt-2 num text-2xl font-semibold ${colorMap[accent]}`}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
