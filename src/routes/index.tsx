import { createFileRoute, redirect } from "@tanstack/react-router";
import { hasSupabaseSession } from "@/lib/auth";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (await hasSupabaseSession()) {
      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
