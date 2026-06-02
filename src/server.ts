import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

function isDocumentRequest(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  const mode = request.headers.get("sec-fetch-mode") ?? "";
  return accept.includes("text/html") || mode === "navigate";
}

function fallbackResponse(request: Request, error: "STALE_CLIENT" | "SSR_ERROR"): Response {
  if (!isDocumentRequest(request)) {
    return new Response(
      JSON.stringify({
        error,
        fallback: true,
        message:
          error === "STALE_CLIENT"
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

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
// Stale client bundles also call removed server fn IDs and get a 404 like
// "Invalid server function id ...". Both cases should show the fallback page
// for HTML document requests (not for the RPC fetch itself).
async function normalizeCatastrophicSsrResponse(
  request: Request,
  response: Response | undefined,
): Promise<Response> {
  if (!(response instanceof Response)) {
    console.error(
      consumeLastCapturedError() ?? new Error("SSR handler returned no Response"),
    );
    return fallbackResponse(request, "SSR_ERROR");
  }

  if (response.status < 400) return response;

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.clone().text().catch(() => "");

  const isH3Swallowed =
    contentType.includes("application/json") &&
    body.includes('"unhandled":true') &&
    body.includes('"message":"HTTPError"');

  const isInvalidServerFn = /invalid server function id/i.test(body);

  if (!isH3Swallowed && !isInvalidServerFn) return response;

  console.error(
    consumeLastCapturedError() ??
      new Error(
        `SSR error normalized (status ${response.status}): ${body.slice(0, 500)}`,
      ),
  );

  return fallbackResponse(request, isInvalidServerFn ? "STALE_CLIENT" : "SSR_ERROR");
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(request, response);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      return fallbackResponse(
        request,
        /invalid server function id/i.test(message) ? "STALE_CLIENT" : "SSR_ERROR",
      );
    }
  },
};
