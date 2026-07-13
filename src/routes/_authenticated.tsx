import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { hasSimpleAuth } from "@/lib/auth";
import { DateRangeProvider } from "@/lib/date-range";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: () => {
    if (!hasSimpleAuth()) {
      throw redirect({ to: "/login" });
    }
  },
  component: Layout,
});

function Layout() {
  return (
    <DateRangeProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </DateRangeProvider>
  );
}
