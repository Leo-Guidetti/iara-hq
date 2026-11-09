
-- AIrton (finanças pessoais do Leo) — schema isolado dentro do projeto ClaudIA.
create schema if not exists airton;
create schema if not exists airton_private;
revoke all on schema airton_private from public, anon, authenticated;

create table airton.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function airton.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from airton.members m where m.user_id = auth.uid())
$$;

create or replace function airton.new_id(prefix text) returns text
language sql volatile set search_path = '' as $$
  select prefix || '_' || replace(gen_random_uuid()::text, '-', '')
$$;

create or replace function airton.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create table airton.settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table airton.accounts (
  id text primary key default airton.new_id('acc'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  institution text not null default 'outros' check (institution in ('xp','nubank','itau','outros')),
  type text not null check (type in ('checking','credit','investment_onshore','investment_offshore','cash')),
  currency text not null default 'BRL' check (currency in ('BRL','USD')),
  balance numeric(14,2) not null default 0,
  balance_at timestamptz,
  credit_limit numeric(14,2),
  closing_day smallint,
  due_day smallint,
  last_four text,
  pluggy_item_id text,
  pluggy_account_id text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, pluggy_account_id)
);

create table airton.categories (
  id text primary key default airton.new_id('cat'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  parent_id text references airton.categories(id) on delete set null,
  icon text,
  color text,
  -- natureza decide como a categoria entra no orçamento do mês
  nature text not null default 'variavel'
    check (nature in ('variavel','fixo','eventual','renda','transferencia','investimento')),
  budget_monthly numeric(14,2),
  valid_from date,
  sort smallint not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table airton.transactions (
  id text primary key default airton.new_id('tx'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id text not null references airton.accounts(id) on delete cascade,
  date date not null,
  amount numeric(14,2) not null,                 -- moeda original, negativo = saída
  currency text not null default 'BRL' check (currency in ('BRL','USD')),
  fx_rate_brl numeric(12,6) not null default 1,
  share_pct numeric(5,4) not null default 1 check (share_pct between 0 and 1),
  amount_brl numeric(14,2) generated always as (round(amount * fx_rate_brl * share_pct, 2)) stored,
  description text not null,
  merchant text,
  category_id text references airton.categories(id) on delete set null,
  -- expense: gasto · income: renda · transfer: entre contas próprias/fatura/aplicação · refund: reembolso (abate gasto)
  kind text not null default 'expense' check (kind in ('expense','income','transfer','refund')),
  installment_n smallint,
  installment_total smallint,
  source text not null default 'manual' check (source in ('csv','ofx','pdf','ocr','manual','openfinance','import')),
  source_ref text,
  cat_source text check (cat_source in ('rule','history','ai','manual','structural')),
  cat_confidence real,
  reviewed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index transactions_source_ref_uq on airton.transactions (user_id, source, source_ref) where source_ref is not null;
create index transactions_user_date on airton.transactions (user_id, date desc);
create index transactions_category on airton.transactions (category_id);
create index transactions_account on airton.transactions (account_id);
create index transactions_review on airton.transactions (user_id, reviewed, date desc);

create table airton.rules (
  id text primary key default airton.new_id('rule'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pattern text not null,
  category_id text not null references airton.categories(id) on delete cascade,
  kind text check (kind in ('expense','income','transfer','refund')),
  priority int not null default 100,
  created_at timestamptz not null default now()
);

create table airton.planned_events (
  id text primary key default airton.new_id('evt'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  label text not null,
  amount numeric(14,2) not null,                  -- positivo = entrada, negativo = saída
  category_id text references airton.categories(id) on delete set null,
  created_at timestamptz not null default now()
);

create table airton.installment_plans (
  id text primary key default airton.new_id('inst'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null,
  category_id text references airton.categories(id) on delete set null,
  total smallint not null check (total > 0),
  installment_amount numeric(14,2) not null check (installment_amount > 0),
  first_date date not null,
  created_at timestamptz not null default now()
);

create table airton.goals (
  id text primary key default airton.new_id('goal'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null,
  target_currency text not null default 'BRL' check (target_currency in ('BRL','USD')),
  target_date date,
  current_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table airton.inv_snapshot (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  ref text,
  patrimonio numeric(16,2),
  source text not null default 'xlsx',
  updated_at timestamptz not null default now(),
  primary key (user_id, mes)
);

create table airton.inv_position (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  produto text not null,
  estrategia text,
  tipo text,
  indexador text,
  saldo numeric(16,2),
  aloc numeric(8,4),
  rent_mes numeric(10,4),
  moeda text not null default 'BRL',
  valor_orig numeric(16,2),
  manual boolean not null default false,
  primary key (user_id, mes, produto)
);

create table airton.inv_product_info (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  produto text not null,
  nome_curto text, classe text, gestora text, descricao text, risco text, fonte text, fonte_url text,
  updated_at timestamptz not null default now(),
  primary key (user_id, produto)
);

create table airton.of_items (
  id text primary key,                              -- id do item na Pluggy
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connector_name text not null default 'Open Finance',
  status text,
  execution_status text,
  pluggy_updated_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  sync_investments boolean not null default true,
  cursors jsonb not null default '{}'::jsonb,       -- pluggy account id -> último dia lido
  created_at timestamptz not null default now()
);

create table airton.sync_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb
);
create index sync_runs_user on airton.sync_runs (user_id, started_at desc);

create table airton.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  label text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures int not null default 0
);

create table airton.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  feature text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10,5) not null default 0
);

create table airton.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table airton.notify_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  local_date date not null,
  title text,
  body text,
  sent int not null default 0,
  failed int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, kind, local_date)
);

create table airton_private.kv (key text primary key, value jsonb not null, updated_at timestamptz not null default now());

create trigger accounts_touch before update on airton.accounts for each row execute function airton.touch_updated_at();
create trigger transactions_touch before update on airton.transactions for each row execute function airton.touch_updated_at();
;
