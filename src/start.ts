import { createStart, createMiddleware } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { renderErrorPage } from "./lib/error-page";

function isServerFunctionRequest(request: Request): boolean {
  return (
    request.headers.get("x-tsr-serverFn") === "true" ||
    new URL(request.url).pathname.startsWith("/_serverFn/")
  );
}

function isMissingServerFunction(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid server function id|server function info not found|server function module export not resolved/i.test(
    message,
  );
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    const request = new Request(globalThis.location?.href ?? "http://localhost");
    if (isServerFunctionRequest(request)) {
      const staleClient = isMissingServerFunction(error);
      return new Response(
        JSON.stringify({
          error: staleClient ? "STALE_CLIENT" : "SSR_ERROR",
          fallback: true,
          message: staleClient
            ? "Client bundle is out of date. Please refresh."
            : "Server error. Please try again.",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
