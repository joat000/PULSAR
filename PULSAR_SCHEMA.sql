-- Run this in your Supabase SQL Editor before starting the app.

create table if not exists price_history (
  id          bigserial primary key,
  stock_id    int not null default 1,
  symbol      text not null default 'SPCX',
  price       numeric(12,2) not null,
  timestamp   timestamptz not null default now()
);

create index if not exists price_history_symbol_ts on price_history (symbol, timestamp desc);

create table if not exists patterns (
  id           bigserial primary key,
  stock_id     int not null default 1,
  pattern_name text not null,
  confidence   int not null,
  level        numeric(12,2),
  detected_at  timestamptz not null default now()
);

create index if not exists patterns_detected_at on patterns (detected_at desc);

-- Public read/write (no auth required for this tracker)
alter table price_history enable row level security;
alter table patterns enable row level security;

create policy "public read price_history"  on price_history for select using (true);
create policy "public insert price_history" on price_history for insert with check (true);

create policy "public read patterns"  on patterns for select using (true);
create policy "public insert patterns" on patterns for insert with check (true);
