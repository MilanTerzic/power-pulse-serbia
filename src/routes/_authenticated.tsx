import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "@/components/sidebar";
import { AUTH_KEY } from "@/routes/login";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(AUTH_KEY) !== "1") {
      throw redirect({ to: "/login" });
    }
  },
  component: Layout,
});

function Layout() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
