
# SEE Electricity Trading Dashboard

Rebuild of the Python Serbia Import Arbitrage + CBC Capacity Resale dashboards as a TanStack Start web app, with Lovable Cloud for persistence and a turquoise-accented dark "Met Group" trading UI.

## Design Direction

- **Palette**: deep graphite background (`#0b1014` / `#11181d`), card surface `#161f25`, primary accent **turquoise** `#1ec8c8` (Met Group style), semantic green `#2bd47d`, red `#ff5b6a`, amber `#f5b14c`, neutral blue `#5aa9e6`.
- **Typography**: Inter for UI, JetBrains Mono for numeric cells / prices.
- **Layout**: left sidebar with section icons, sticky top bar (last refresh, force-refresh, demo badge, max MW setting), tabbed content area with dense KPI cards + Recharts.
- **Data quality badges** everywhere: OK / Partial / Missing / Error / DEMO.

## Tech Stack

- TanStack Start + React 19 + TS + Tailwind v4 (already scaffolded).
- shadcn/ui (Tabs, Card, Table, Dialog, Select, Slider, Badge, Sonner).
- Recharts for time-series and bars.
- Lovable Cloud (Supabase) for: settings, manual CBC positions, capacity overrides, API cache, forecast results, audit log.
- `ENTSOE_API_TOKEN` stored as a Cloud secret; all ENTSO-E calls go through `createServerFn` to avoid CORS and protect the token.
- ARIMA-lite implemented in pure TS server-side (seasonal naive + AR(p) + linreg fallback).

## Backend (Lovable Cloud)

Tables (all RLS on; user-scoped to `auth.uid()` except cache which is service-role only):

```text
user_settings(user_id pk, max_mw, min_margin, history_days,
  selected_borders text[], selected_countries text[], refresh_mode, updated_at)

manual_capacity_positions(id, user_id, position_name, border_from, border_to,
  product_type, booked_mw, annual_booked_price, start_date, end_date, fees,
  preferred_resale_mode, notes, created_at, updated_at)

capacity_price_overrides(id, user_id, border_from, border_to, product_type,
  period_start, period_end, price_eur_mwh, note, created_at)

api_cache(key pk, payload jsonb, fetched_at, ttl_seconds)   -- service role only

forecast_results(id, user_id, run_at, horizon_h, history_days,
  model_used, mae, mape, payload jsonb)

audit_log(id, user_id, action, detail jsonb, created_at)
```

Auth: email/password + Google (Lovable broker). All app pages live under `_authenticated`.

## Server Functions (`src/lib/*.functions.ts`)

Mirrors the Python contracts:

- `entsoe.functions.ts` — `fetchDayAheadPrices`, `fetchPhysicalFlows`, `fetchExplicitAllocation`, `fetchOutages`, `fetchLoad`, `fetchGeneration`. All hit `https://web-api.tp.entsoe.eu/api`, parse XML, cache via `api_cache`.
- `openmeteo.functions.ts` — temperature/wind for Belgrade + neighbour capitals (no key, no cache table needed beyond api_cache).
- `danube.functions.ts` — CSV upload parser + station list from `market_config`.
- `arbitrage.functions.ts` — hourly gross spread, net margin, route ranking using EIC codes from `market_config`.
- `cbc.functions.ts` — comparison (annual/monthly/daily prices via A25 + A01/A03/A04 market types), resale PnL, predictor (seasonality + recent trend + historical spread).
- `forecast.functions.ts` — SEEPEX hourly forecast: seasonal-naive (168h) → AR(p) via least squares → linear regression with temp + lag features. Returns model_used, MAE/MAPE from backtest, point forecast + 80/95% CI from residual std.
- `settings.functions.ts`, `positions.functions.ts` — CRUD for user data.

EIC codes, document types, market agreement types, zones, borders, portfolio defaults all imported verbatim from the uploaded `market_config.py` / `cbc_capacity_resale_dashboard.py`.

## Frontend Routes

```text
src/routes/
  __root.tsx
  index.tsx                       -> redirects to /dashboard or /login
  login.tsx
  _authenticated.tsx              -> layout (sidebar + topbar + Outlet)
  _authenticated/dashboard.tsx    -> Overview
  _authenticated/prices.tsx
  _authenticated/spreads.tsx
  _authenticated/map.tsx          -> SVG SEE map with margin arrows
  _authenticated/capacity.tsx
  _authenticated/flows.tsx
  _authenticated/balance.tsx
  _authenticated/outages.tsx
  _authenticated/weather.tsx
  _authenticated/danube.tsx
  _authenticated/forecast.tsx     -> SEEPEX ARIMA-lite
  _authenticated/cbc.tsx          -> Capacity resale monitor (sub-tabs: Comparison, PnL, Predictor, Manual, Diagnostics)
  _authenticated/settings.tsx
```

Each tab: KPI cards row, main chart(s), sortable table with CSV export, data-quality badges, last-refresh + force-refresh.

## Tabs — Key Specs

1. **Overview** — SEEPEX today/tomorrow avg, neighbour prices, best import/export route, top 3 opportunities, data-status grid.
2. **Prices** — hourly DA for RS + neighbours, baseload/peakload, negative-hour count, volatility (stdev/mean).
3. **Spreads** — `gross = RS - source`, `net = gross - capacity_cost`, `value = net * min(user_max_mw, available)`. Hourly chart + ranking table, import + export views.
4. **Route Map** — SVG with zone coordinates from CBC file, arrows colored/weighted by net margin; click → side panel with price/capacity/flow/PnL.
5. **Capacity** — A25 daily/monthly/annual prices per border with direction, offered/allocated MW, unit-source warnings.
6. **Flows** — A11 hourly flows, avg/max/min, congestion highlight when flow ≥ 95% of allocated.
7. **Balance** — A65 load vs A75 generation, hourly deficit/surplus bar.
8. **Outages** — A77/A80 unavailable MW, timeline, planned vs forced.
9. **Weather** — Open-Meteo for Belgrade + neighbour capitals, demand signals.
10. **Danube** — CSV upload, per-station chart, persisted in Cloud Storage.
11. **SEEPEX Forecast** — horizon 1/3/7/14d, history 30/60/90/180/365d. Model cascade: SARIMA-lite (AR + seasonal diff) → seasonal naive → regression on temp/load/weekday/lags. Chart: actual + forecast + CI band; diagnostics card with model name, training period, MAE/MAPE, warnings.
12. **CBC Resale** — sub-tabs Comparison / PnL / Predictor / Manual / Diagnostics. Default portfolio seeds: HR→BA 15 MW, BA→ME 5 MW. Full CRUD on positions. Recommendation: resell-monthly / resell-daily / keep / manual review.
13. **Settings** — max MW, min margin, history days, border/country multi-select, refresh mode.

## Data Flow & Caching

- Server fns check `api_cache` first (TTL 30 min default, overridable in settings), else fetch from ENTSO-E and store.
- TanStack Query on client with `useSuspenseQuery` per loader.
- Force-refresh button busts cache for the active tab.
- Demo mode: env flag OR auto-fallback when token missing — every cell badged `DEMO`, synthetic data generated from realistic distributions seeded by date.

## Error Handling

- Wrap every ENTSO-E call: handle 400 (no data → return empty + reason), 429 (backoff + cache stale), 503 (retry once), missing token (return `{error:"token_missing"}`).
- Each tab has `errorComponent` + per-section error cards so one failing dataset doesn't blank the page.
- No data is ever silently faked; missing → amber badge + explanatory text.

## Implementation Order (single batch but ordered for build)

1. Enable Lovable Cloud, add `ENTSOE_API_TOKEN` secret, configure email + Google auth.
2. Run schema migration (tables + RLS + grants + seed of default portfolio per new user via trigger).
3. Install design tokens (turquoise palette in `styles.css`), build sidebar + topbar layout + login.
4. Build ENTSO-E + Open-Meteo + cache server fns with XML parser.
5. Build all 11 page routes with loaders, charts, tables, CSV export.
6. Implement ARIMA-lite forecast module + backtest.
7. Implement CBC resale tab with predictor + manual CRUD.
8. Settings + audit log + demo-mode toggle.
9. Polish, empty states, badges, last-refresh timers.

## Out of Scope (call out)

- True statsmodels ARIMA / SARIMAX — replaced by JS AR(p) + seasonal naive + regression cascade, clearly labeled.
- Real-time websocket feeds — polling + cache only.
- Ukraine routes only added if user later confirms (kept in zone map but no default routes).

## Notes

- ENTSO-E token will be requested via the secrets tool right after Cloud is enabled.
- Default portfolio + zone coordinates + border lists copied verbatim from your CBC file.
- All units displayed (EUR/MWh, MW, EUR), monospaced numerics, sortable/filterable tables, CSV export per table.

