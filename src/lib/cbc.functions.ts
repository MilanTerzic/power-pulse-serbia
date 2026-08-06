// Thin server-function wrappers for the CBC capacity resale dashboard.
import { createServerFn } from "@tanstack/react-start";
import { buildComparison, buildPnl, buildRecommendations } from "./cbc.server";
import type { CbcPosition, ResaleMode } from "./cbc-types";

export const getCbcComparison = createServerFn({ method: "GET" })
  .inputValidator((data: { start: string; end: string; border?: string }) => data)
  .handler(async ({ data }) => buildComparison(data.start, data.end, data.border));

export const getCbcPnl = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      start: string;
      end: string;
      positions: CbcPosition[];
      modes: Record<string, ResaleMode>;
    }) => data,
  )
  .handler(async ({ data }) =>
    buildPnl(data.positions.slice(0, 6), data.start, data.end, data.modes ?? {}),
  );

export const getCbcRecommendations = createServerFn({ method: "GET" })
  .inputValidator((data: { start: string; end: string; positions: CbcPosition[] }) => data)
  .handler(async ({ data }) => buildRecommendations(data.positions.slice(0, 4), data.start, data.end));
