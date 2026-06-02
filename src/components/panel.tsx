import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReactNode } from "react";

export function Panel({
  title, children, actions, dense,
}: { title?: ReactNode; children: ReactNode; actions?: ReactNode; dense?: boolean }) {
  return (
    <Card className="bg-surface border-border/60">
      {title && (
        <CardHeader className={`flex flex-row items-center justify-between space-y-0 ${dense ? "py-2 px-4" : "py-3 px-5"}`}>
          <CardTitle className="text-sm font-medium tracking-tight">{title}</CardTitle>
          {actions}
        </CardHeader>
      )}
      <CardContent className={dense ? "p-3" : "p-4"}>{children}</CardContent>
    </Card>
  );
}
