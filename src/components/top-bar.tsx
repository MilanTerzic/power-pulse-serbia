import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobalAnalysisToolbar } from "@/components/global-analysis-toolbar";
import { PageHeader } from "@/components/page-header";

export function TopBar({
  title,
  subtitle,
  onRefresh,
  lastRefresh,
  hideRange,
}: {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  lastRefresh?: string;
  hideRange?: boolean;
}) {
  return (
    <div className="sticky top-16 z-30 border-b border-border bg-background/95 px-4 py-4 backdrop-blur sm:px-6">
      <div className="space-y-4">
        <PageHeader
          eyebrow="CEA Power Dashboard"
          title={title}
          description={subtitle}
          actions={
            onRefresh ? (
              <Button size="sm" variant="outline" onClick={onRefresh} className="h-9 gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            ) : undefined
          }
        />
        {!hideRange && <GlobalAnalysisToolbar lastUpdated={lastRefresh} />}
      </div>
    </div>
  );
}
