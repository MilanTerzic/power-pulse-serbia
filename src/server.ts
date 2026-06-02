import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

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
  response: Response,
): Promise<Response> {
  const accept = request.headers.get("accept") ?? "";
  const isDocumentRequest = accept.includes("text/html");

  if (response.status < 400) return response;

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.clone().text().catch(() => "");

  const isH3Swallowed =
    contentType.includes("application/json") &&
    body.includes('"unhandled":true') &&
    body.includes('"message":"HTTPError"');

  const isInvalidServerFn =
    response.status === 404 && /invalid server function id/i.test(body);

  if (!isH3Swallowed && !isInvalidServerFn) return response;

  console.error(
    consumeLastCapturedError() ??
      new Error(
        `SSR error normalized (status ${response.status}): ${body.slice(0, 500)}`,
      ),
  );

  // For RPC / fetch calls from a stale client, return a structured JSON
  // signal so the client can recover (reload) instead of crashing. Only
  // swap the HTML fallback in for actual document navigations.
  if (!isDocumentRequest) {
    return new Response(
      JSON.stringify({
        error: isInvalidServerFn ? "STALE_CLIENT" : "SSR_ERROR",
        fallback: true,
        message:
          isInvalidServerFn
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

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(request, response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
