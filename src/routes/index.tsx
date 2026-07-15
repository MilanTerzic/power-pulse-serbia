import { createFileRoute, redirect } from "@tanstack/react-router";
import { hasAppSession } from "@/lib/auth";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (hasAppSession()) {
      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
