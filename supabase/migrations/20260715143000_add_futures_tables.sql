create table if not exists futures_contracts (
  id uuid primary key default gen_random_uuid(),
  market_code text not null,
  exchange text not null,
  product_name text not null,
  external_product_id text,
  external_contract_id text not null,
  contract_name text not null,
  load_type text not null,
  maturity_type text not null,
  delivery_start date not null,
  delivery_end date not null,
  currency text not null default 'EUR',
  unit text not null default 'MWh',
  created_at timestamptz not null default now(),
  unique(exchange, external_contract_id)
);

create table if not exists futures_eod_prices (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references futures_contracts(id),
  trading_date date not null,
  settlement_price numeric,
  close_price numeric,
  last_price numeric,
  bid_price numeric,
  ask_price numeric,
  volume numeric,
  open_interest numeric,
  source text not null,
  source_timestamp timestamptz,
  fetched_at timestamptz not null default now(),
  corrected_at timestamptz,
  unique(contract_id, trading_date)
);

create index if not exists futures_contracts_market_idx
  on futures_contracts (market_code, load_type, maturity_type, delivery_start);

create index if not exists futures_eod_prices_contract_date_idx
  on futures_eod_prices (contract_id, trading_date desc);
