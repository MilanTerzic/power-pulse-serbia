# Futures Data Source

## Verified access method

The production integration is designed for the licensed **EEX Group DataSource REST API** or licensed **EEX DataSource File Cloud** products. EEX describes DataSource as a machine-readable data service for market data delivery, while the public Market Data Hub is a web product page and should not be treated as an unrestricted redistribution API.

Server-side environment variables:

```env
EEX_DATASOURCE_API_URL=
EEX_DATASOURCE_ACCESS_TOKEN=
```

Credentials must never be exposed to client-side JavaScript or logs.

## Public Market Data Hub

The Market Data Hub at `https://www.eex.com/en/market-data/market-data-hub` is useful for product discovery and manual inspection. This implementation does not scrape rendered HTML, chart pixels, CSS selectors or browser sessions. A public structured endpoint can be added later only behind the `FuturesDataProvider` interface and only if its permitted use is confirmed.

## Product mapping status

Configured futures markets:

- RS: EEX-PXE Serbian Power Future
- HU: EEX-PXE Hungarian Power Future
- RO: EEX-PXE Romanian Power Future
- BG: EEX-PXE Bulgarian Power Future
- HR: EEX-PXE Croatian Power Future
- SI: EEX-PXE Slovenian Power Future
- GR: EEX Greek Power Future
- IT: EEX Italian Power Future
- AT: EEX Austrian Power Future
- DE_LU: EEX German Power Future

Unsupported until verified:

- ME: No verified EEX power-futures product
- MK: No verified EEX power-futures product
- AL: No verified EEX power-futures product

External product IDs, contract IDs and exact available maturity/load combinations must be populated from licensed EEX DataSource metadata. The app intentionally does not hardcode unverified identifiers.

## Historical strategy

With licensed EEX historical data, use incremental backfill and preserve original trading dates. Without licensed historical access, the app should collect one server-side daily snapshot after EoD publication and label history as locally collected snapshots:

`Historical records available since [first collection date]`

No invented or proxy history is allowed.

## Scheduling

The server function `collectFuturesSnapshots` performs market-level collection and safe upserts. Schedule it in the deployment platform only after EEX credentials and endpoint mappings are configured. A typical schedule is once per business day after EEX settlement publication, with an optional conservative intraday refresh if the licence allows it.

## Licensing note

Before public display, confirm that the EEX licence permits the intended storage, display and redistribution. The UI is built to remain in a disabled/configuration-required state when the necessary data licence is unavailable.
