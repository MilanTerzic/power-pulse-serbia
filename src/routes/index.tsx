import { createFileRoute, redirect } from "@tanstack/react-router";
import { AUTH_KEY } from "@/routes/login";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(AUTH_KEY) === "1") {
      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
