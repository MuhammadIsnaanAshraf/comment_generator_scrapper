-- Billing schema for the admin console's Billing screen.
--
-- The project previously had no notion of plans, subscriptions or invoices, so
-- the console's Billing page had nothing real to render. These three tables are
-- the minimum needed to drive it: a plan catalogue an operator edits in place,
-- a subscription per user, and an invoice ledger that surfaces failed payments.
--
-- Payment capture itself is NOT modelled here — `invoices` is a ledger the
-- payment provider (Stripe, etc.) is expected to write into. Nothing in this
-- schema charges anyone.
--
-- Created at: 2024-03-01T00:00:00.000Z

create table if not exists billing_plans (
  id text primary key,
  name text not null,
  price_usd numeric(10, 2) not null default 0,
  user_limit integer,                       -- null = unlimited
  api_requests_per_month integer,           -- null = unlimited
  priority_support boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references billing_plans (id),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled')),
  renewal_date date,
  started_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One live subscription per user; history is kept via canceled rows.
  unique (user_id, plan_id, started_at)
);

create index if not exists subscriptions_user_id_idx on subscriptions (user_id);
create index if not exists subscriptions_status_idx on subscriptions (status);

create table if not exists invoices (
  id text primary key,                      -- provider invoice id, e.g. INV-9021
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid references subscriptions (id) on delete set null,
  amount_usd numeric(10, 2) not null,
  status text not null
    check (status in ('paid', 'open', 'failed', 'dunning', 'refunded', 'void')),
  attempt_count integer not null default 1,
  failure_reason text,
  next_attempt_at timestamptz,
  period_start date,
  period_end date,
  created_at timestamptz not null default now()
);

-- Serves the console's "recent invoices" and "failed payments" panels.
create index if not exists invoices_created_at_idx on invoices (created_at desc);
create index if not exists invoices_status_created_at_idx on invoices (status, created_at desc);

alter table billing_plans enable row level security;
alter table subscriptions enable row level security;
alter table invoices enable row level security;

-- The admin console reads and writes these with the service-role key, which
-- bypasses RLS. These policies only cover a user reading their own billing
-- state with their own session token.
create policy "Anyone authenticated can read the plan catalogue"
  on billing_plans for select
  using (auth.role() = 'authenticated');

create policy "Users can view their own subscription"
  on subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can view their own invoices"
  on invoices for select
  using (auth.uid() = user_id);

-- Seed the catalogue the console's Plan Configuration table edits. Values are
-- placeholders — set real prices before pointing a payment provider at this.
insert into billing_plans (id, name, price_usd, user_limit, api_requests_per_month, priority_support, sort_order)
values
  ('free',       'Free',       0.00,   1,   10000,  false, 0),
  ('pro',        'Pro',        49.00,  10,  500000, true,  1),
  ('enterprise', 'Enterprise', 299.00, 100, null,   true,  2)
on conflict (id) do nothing;
