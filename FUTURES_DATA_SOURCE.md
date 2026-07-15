# Futures Data Source

## Access methods

The preferred production integration remains the licensed **EEX Group DataSource REST API** or licensed **EEX DataSource File Cloud** products. EEX describes DataSource as a machine-readable data service for market data delivery.

Server-side environment variables:

```env
EEX_DATASOURCE_API_URL=
EEX_DATASOURCE_ACCESS_TOKEN=
```

Credentials must never be exposed to client-side JavaScript or logs.

When these variables are absent, the Futures tab runs in **Public EEX Snapshot Mode** instead of blocking.

## Public EEX Snapshot Mode

The Market Data Hub at `https://www.eex.com/en/market-data/market-data-hub` is used as the public source reference. The collector runs server-side, at low frequency, and attempts to parse only structured or visibly rendered table information available to a normal public visitor.

The implementation does not:

- scrape chart images;
- use OCR;
- bypass authentication, subscriptions, CAPTCHA, rate limits or access restrictions;
- fabricate missing prices;
- substitute proxy markets.

If the public page cannot be parsed safely, the app keeps the latest successful stored snapshot and marks the current attempt as `public-extraction-unavailable`.

Configuration:

```env
FUTURES_PUBLIC_SNAPSHOT_MODE=true
FUTURES_PUBLIC_DISPLAY_ENABLED=false
```

Public snapshot mode is enabled by default. Public display of the full stored dataset should remain disabled unless the deployment's data-use policy permits it.

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

External product IDs, contract IDs and exact available maturity/load combinations are stored only when they are supplied by the source or manual import. The app intentionally does not hardcode unverified identifiers.

## Historical strategy

With licensed EEX historical data, use incremental backfill and preserve original trading dates. Without licensed historical access, the app collects server-side daily snapshots and labels history as locally collected snapshots:

`Historical futures prices are based on public EEX snapshots collected by this application.`

No invented or proxy history is allowed.

Manual CSV/paste imports are stored as `manual-import` and displayed as manually imported futures reference data, not as live EEX data.

## Scheduling

The public collector enforces a minimum 12-hour interval between collection attempts. Schedule `refreshPublicFuturesSnapshots` or `collectFuturesSnapshots` at most once per business day after EEX settlement publication. The page normally reads from Supabase and does not fetch EEX on every filter change.

## Licensing note

Before public display, confirm that EEX terms permit the intended storage, display and redistribution. The UI includes the notice:

`For information and analytical purposes. Verify prices through an authorised market-data source before trading or commercial use.`
