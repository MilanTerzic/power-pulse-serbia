import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function PageLoadingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border bg-surface p-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-4 h-8 w-36" />
            <Skeleton className="mt-3 h-3 w-44" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border bg-surface p-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mt-5 h-72 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DataUnavailableState({
  title = "No data available for the selected period.",
  description = "Try selecting a longer date range or retry live data.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-warning" />
      <h2 className="mt-3 text-base font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button type="button" variant="outline" className="mt-4 gap-2" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Retry live data
        </Button>
      )}
    </div>
  );
}
