import { Info } from "lucide-react";
import { type ReactNode } from "react";

import { DataStatusBadge, type DataStatus } from "@/components/data-status";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function ChartCard({
  title,
  subtitle,
  methodology,
  actions,
  children,
  source,
  updated,
  status,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  methodology?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  source?: ReactNode;
  updated?: ReactNode;
  status?: DataStatus;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
            {methodology && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label="Methodology"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">{methodology}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-4">{children}</div>
      {(source || updated || status) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          {status && <DataStatusBadge status={status} />}
          {source && <span>Source: {source}</span>}
          {updated && <span>Updated: {updated}</span>}
        </div>
      )}
    </section>
  );
}
