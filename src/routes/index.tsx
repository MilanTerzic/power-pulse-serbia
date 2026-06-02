import { createFileRoute, redirect } from "@tanstack/react-router";
import { hasSimpleAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (hasSimpleAuth()) {
      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
