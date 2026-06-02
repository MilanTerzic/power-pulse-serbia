import { Badge } from "@/components/ui/badge";

const VARIANTS: Record<string, { label: string; className: string }> = {
  live:    { label: "LIVE",    className: "bg-success/15 text-success border-success/30" },
  cache:   { label: "CACHE",   className: "bg-info/15 text-info border-info/30" },
  empty:   { label: "MISSING", className: "bg-warning/15 text-warning border-warning/30" },
  demo:    { label: "DEMO",    className: "bg-warning/15 text-warning border-warning/30" },
  error:   { label: "ERROR",   className: "bg-destructive/15 text-destructive border-destructive/30" },
  ok:      { label: "OK",      className: "bg-success/15 text-success border-success/30" },
  partial: { label: "PARTIAL", className: "bg-warning/15 text-warning border-warning/30" },
};

export function DataBadge({ source }: { source?: string }) {
  const v = VARIANTS[source ?? "empty"] ?? VARIANTS.empty;
  return (
    <Badge variant="outline" className={`${v.className} text-[10px] font-mono tracking-wider px-1.5 py-0`}>
      {v.label}
    </Badge>
  );
}
