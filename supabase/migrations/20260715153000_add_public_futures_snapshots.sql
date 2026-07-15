create table if not exists futures_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('eex-public-snapshot', 'manual-import')),
  market_code text not null,
  exchange text not null,
  product_name text not null,
  external_contract_id text,
  contract_name text not null,
  load_type text not null check (load_type in ('base', 'peak')),
  maturity_type text not null check (maturity_type in ('week', 'month', 'quarter', 'year', 'other')),
  delivery_start date,
  delivery_end date,
  trading_date date not null,
  settlement_price numeric,
  close_price numeric,
  last_price numeric,
  bid_price numeric,
  ask_price numeric,
  volume numeric,
  open_interest numeric,
  currency text not null default 'EUR',
  unit text not null default 'MWh',
  source_url text not null,
  source_timestamp timestamptz,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider, market_code, external_contract_id, trading_date)
);

create index if not exists futures_snapshots_market_date_idx
  on futures_snapshots (market_code, trading_date desc, collected_at desc);

create index if not exists futures_snapshots_contract_history_idx
  on futures_snapshots (market_code, external_contract_id, trading_date);

create table if not exists futures_collection_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  attempted_at timestamptz not null default now(),
  status text not null,
  reason text
);

create index if not exists futures_collection_runs_provider_attempt_idx
  on futures_collection_runs (provider, attempted_at desc);
