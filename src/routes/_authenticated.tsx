import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "@/components/sidebar";
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
      <div className="min-h-screen flex bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col">
          <Outlet />
        </main>
      </div>
    </DateRangeProvider>
  );
}
