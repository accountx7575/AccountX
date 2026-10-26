-- ============================================================================
-- Document-number prefix resync (author-only migration; human applies).
--
-- WHY
--   Documents store the number string they were created with. After Settings
--   changed a prefix (e.g. `QT/26-27/2` -> `QT/ABC/SE/26-27/2`), existing rows
--   kept the old string because only the template/render path changed.
--   This migration rewrites every active document's stored number from the
--   business's CURRENT numbering settings:
--
--       <prefix>/<financial_year>/<trailing sequence>
--
--   Examples:
--       quotations     QT/26-27/2       -> QT/ABC/SE/26-27/2
--       sales_orders   SO/26-27/1       -> SO/ABC/SE/26-27/1
--       sales_invoices INV/26-27/5      -> INV/ABC/SE/26-27/5
--       purchase_orders PO/26-27/3      -> PO/ABC/SE/26-27/3
--       purchase_bills  PB/26-27/4      -> PB/ABC/SE/26-27/4
--
-- SAFETY
--   * Idempotent: rows already carrying the target number are skipped, so the
--     script can be re-run safely.
--   * Sequence digits are preserved exactly (incl. leading zeros).
--   * Cancelled/void documents are never renumbered.
--   * A target that is already used by another document is skipped instead of
--     violating UNIQUE(business_id, <number_column>), and duplicate targets are
--     de-duplicated deterministically (oldest row wins).
--   * Counters (`document_sequences`) and the `document_numbers` registry are
--     NOT touched: the sequence on the document is preserved, and the counter
--     RPC is never called here (PBS-79 / PBS-142 author-only rule).
--
-- BEFORE RUNNING
--   The prefix columns were added by 20261021_business_profile_columns.sql.
--   If that migration was not yet applied, this file adds the columns (idempotent)
--   but they will be NULL. Save Settings once after applying so the client
--   flushes its local prefix stash into the DB, then re-run the UPDATE section
--   below (it is safe to run again). A business with no configured prefix is
--   left untouched — the script never invents a prefix.
-- ============================================================================

-- Ensure the seven Settings prefix columns exist (idempotent; values untouched).
alter table public.businesses
  add column if not exists quotation_prefix text,
  add column if not exists sales_order_prefix text,
  add column if not exists purchase_order_prefix text,
  add column if not exists purchase_bill_prefix text,
  add column if not exists credit_note_prefix text,
  add column if not exists debit_note_prefix text;

-- ---------------------------------------------------------------------------
-- 1. QUOTATIONS -> quotation_number
-- ---------------------------------------------------------------------------
with cfg as (
  select
    b.id as business_id,
    nullif(regexp_replace(btrim(coalesce(b.quotation_prefix, '')), '/+$', ''), '') as prefix,
    case
      when btrim(b.financial_year) ~ '^[0-9]{4}-[0-9]{2}$'
        then right(split_part(btrim(b.financial_year), '-', 1), 2) || '-' || split_part(btrim(b.financial_year), '-', 2)
      when btrim(b.financial_year) ~ '^[0-9]{2}-[0-9]{2}$'
        then btrim(b.financial_year)
    end as fy
  from public.businesses b
),
targets as (
  select
    q.id,
    q.business_id,
    q.created_at,
    c.prefix || '/' || c.fy || '/' || substring(q.quotation_number from '([0-9]+)[[:space:]]*$') as new_number
  from public.quotations q
  join cfg c on c.business_id = q.business_id
  where c.prefix is not null
    and c.fy is not null
    and q.quotation_number ~ '[0-9]+[[:space:]]*$'
    and coalesce(q.status, '') not in ('cancelled')
),
deduped as (
  select t.*, row_number() over (partition by t.business_id, t.new_number order by t.created_at, t.id) as rn
  from targets t
)
update public.quotations q
set quotation_number = d.new_number
from deduped d
where q.id = d.id
  and d.rn = 1
  and q.quotation_number is distinct from d.new_number
  and not exists (
    select 1 from public.quotations other
    where other.business_id = q.business_id
      and other.id <> q.id
      and other.quotation_number = d.new_number
  );

-- ---------------------------------------------------------------------------
-- 2. SALES ORDERS -> order_number
-- ---------------------------------------------------------------------------
with cfg as (
  select
    b.id as business_id,
    nullif(regexp_replace(btrim(coalesce(b.sales_order_prefix, '')), '/+$', ''), '') as prefix,
    case
      when btrim(b.financial_year) ~ '^[0-9]{4}-[0-9]{2}$'
        then right(split_part(btrim(b.financial_year), '-', 1), 2) || '-' || split_part(btrim(b.financial_year), '-', 2)
      when btrim(b.financial_year) ~ '^[0-9]{2}-[0-9]{2}$'
        then btrim(b.financial_year)
    end as fy
  from public.businesses b
),
targets as (
  select
    o.id,
    o.business_id,
    o.created_at,
    c.prefix || '/' || c.fy || '/' || substring(o.order_number from '([0-9]+)[[:space:]]*$') as new_number
  from public.sales_orders o
  join cfg c on c.business_id = o.business_id
  where c.prefix is not null
    and c.fy is not null
    and o.order_number ~ '[0-9]+[[:space:]]*$'
    and coalesce(o.status, '') not in ('cancelled')
),
deduped as (
  select t.*, row_number() over (partition by t.business_id, t.new_number order by t.created_at, t.id) as rn
  from targets t
)
update public.sales_orders o
set order_number = d.new_number
from deduped d
where o.id = d.id
  and d.rn = 1
  and o.order_number is distinct from d.new_number
  and not exists (
    select 1 from public.sales_orders other
    where other.business_id = o.business_id
      and other.id <> o.id
      and other.order_number = d.new_number
  );

-- ---------------------------------------------------------------------------
-- 3. SALES INVOICES -> invoice_number
-- ---------------------------------------------------------------------------
with cfg as (
  select
    b.id as business_id,
    nullif(regexp_replace(btrim(coalesce(b.invoice_prefix, '')), '/+$', ''), '') as prefix,
    case
      when btrim(b.financial_year) ~ '^[0-9]{4}-[0-9]{2}$'
        then right(split_part(btrim(b.financial_year), '-', 1), 2) || '-' || split_part(btrim(b.financial_year), '-', 2)
      when btrim(b.financial_year) ~ '^[0-9]{2}-[0-9]{2}$'
        then btrim(b.financial_year)
    end as fy
  from public.businesses b
),
targets as (
  select
    i.id,
    i.business_id,
    i.created_at,
    c.prefix || '/' || c.fy || '/' || substring(i.invoice_number from '([0-9]+)[[:space:]]*$') as new_number
  from public.sales_invoices i
  join cfg c on c.business_id = i.business_id
  where c.prefix is not null
    and c.fy is not null
    and i.invoice_number ~ '[0-9]+[[:space:]]*$'
    and coalesce(i.status, '') not in ('cancelled', 'void')
),
deduped as (
  select t.*, row_number() over (partition by t.business_id, t.new_number order by t.created_at, t.id) as rn
  from targets t
)
update public.sales_invoices i
set invoice_number = d.new_number
from deduped d
where i.id = d.id
  and d.rn = 1
  and i.invoice_number is distinct from d.new_number
  and not exists (
    select 1 from public.sales_invoices other
    where other.business_id = i.business_id
      and other.id <> i.id
      and other.invoice_number = d.new_number
  );

-- ---------------------------------------------------------------------------
-- 4. PURCHASE ORDERS -> order_number
--    (the live column is order_number; some UI code calls it po_number)
-- ---------------------------------------------------------------------------
with cfg as (
  select
    b.id as business_id,
    nullif(regexp_replace(btrim(coalesce(b.purchase_order_prefix, '')), '/+$', ''), '') as prefix,
    case
      when btrim(b.financial_year) ~ '^[0-9]{4}-[0-9]{2}$'
        then right(split_part(btrim(b.financial_year), '-', 1), 2) || '-' || split_part(btrim(b.financial_year), '-', 2)
      when btrim(b.financial_year) ~ '^[0-9]{2}-[0-9]{2}$'
        then btrim(b.financial_year)
    end as fy
  from public.businesses b
),
targets as (
  select
    o.id,
    o.business_id,
    o.created_at,
    c.prefix || '/' || c.fy || '/' || substring(o.order_number from '([0-9]+)[[:space:]]*$') as new_number
  from public.purchase_orders o
  join cfg c on c.business_id = o.business_id
  where c.prefix is not null
    and c.fy is not null
    and o.order_number ~ '[0-9]+[[:space:]]*$'
    and coalesce(o.status, '') not in ('cancelled')
),
deduped as (
  select t.*, row_number() over (partition by t.business_id, t.new_number order by t.created_at, t.id) as rn
  from targets t
)
update public.purchase_orders o
set order_number = d.new_number
from deduped d
where o.id = d.id
  and d.rn = 1
  and o.order_number is distinct from d.new_number
  and not exists (
    select 1 from public.purchase_orders other
    where other.business_id = o.business_id
      and other.id <> o.id
      and other.order_number = d.new_number
  );

-- ---------------------------------------------------------------------------
-- 5. PURCHASE BILLS -> bill_number
-- ---------------------------------------------------------------------------
with cfg as (
  select
    b.id as business_id,
    nullif(regexp_replace(btrim(coalesce(b.purchase_bill_prefix, '')), '/+$', ''), '') as prefix,
    case
      when btrim(b.financial_year) ~ '^[0-9]{4}-[0-9]{2}$'
        then right(split_part(btrim(b.financial_year), '-', 1), 2) || '-' || split_part(btrim(b.financial_year), '-', 2)
      when btrim(b.financial_year) ~ '^[0-9]{2}-[0-9]{2}$'
        then btrim(b.financial_year)
    end as fy
  from public.businesses b
),
targets as (
  select
    pb.id,
    pb.business_id,
    pb.created_at,
    c.prefix || '/' || c.fy || '/' || substring(pb.bill_number from '([0-9]+)[[:space:]]*$') as new_number
  from public.purchase_bills pb
  join cfg c on c.business_id = pb.business_id
  where c.prefix is not null
    and c.fy is not null
    and pb.bill_number ~ '[0-9]+[[:space:]]*$'
    and coalesce(pb.status, '') not in ('cancelled')
),
deduped as (
  select t.*, row_number() over (partition by t.business_id, t.new_number order by t.created_at, t.id) as rn
  from targets t
)
update public.purchase_bills pb
set bill_number = d.new_number
from deduped d
where pb.id = d.id
  and d.rn = 1
  and pb.bill_number is distinct from d.new_number
  and not exists (
    select 1 from public.purchase_bills other
    where other.business_id = pb.business_id
      and other.id <> pb.id
      and other.bill_number = d.new_number
  );
