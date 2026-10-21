-- PBS-149: the business-profile columns the live DB is still missing.
--
-- The "Business Profile / PIN" save sent every column in one PATCH, so a
-- single unmigrated column turned the whole save into a 400
-- (42703 "column ... does not exist" / PGRST204 "could not find the column
-- in the schema cache").
--
-- The client (src/lib/businessSchema.ts) now discovers the columns
-- public.businesses really has and sends only those, stashing the rest
-- locally. Applying this migration makes the values persist server-side: the
-- local stash is flushed back on the next save.
--
-- Idempotent: every column is added with IF NOT EXISTS, so it can be applied
-- on top of the partially-migrated DB and on top of
-- 20261020_business_tnc_defaults.sql / 20261002_business_profile_extras.sql.

alter table public.businesses
  -- document number prefixes (the numbering work; only invoice_prefix existed)
  add column if not exists quotation_prefix text default null,
  add column if not exists sales_order_prefix text default null,
  add column if not exists purchase_order_prefix text default null,
  add column if not exists purchase_bill_prefix text default null,
  add column if not exists credit_note_prefix text default null,
  add column if not exists debit_note_prefix text default null,
  -- terms & conditions per document type
  add column if not exists tnc_invoice text default null,
  add column if not exists tnc_quotation text default null,
  add column if not exists tnc_sales_order text default null,
  add column if not exists tnc_purchase text default null,
  -- profile / print extras
  add column if not exists registered_address text default null,
  add column if not exists signature_name text default null,
  add column if not exists pincode text default null,
  add column if not exists upi_qr_url text default null,
  add column if not exists account_name text default null,
  -- business status + plan tier (Super Admin dashboard PBS-140, plans tier
  -- enforcement PBS-141 - the Starter tier's 50-bills cap counts against
  -- monthly_invoice_quota)
  add column if not exists is_active boolean not null default true,
  add column if not exists plan_type text default 'early-adopter-beta',
  add column if not exists monthly_invoice_quota integer default null;

-- PBS-153: unify plan_type on the canonical tier ids
-- ('early-adopter-beta' | 'starter' | 'pro-business'). The column used to
-- carry the legacy console spellings ('Free', 'Starter', 'Pro',
-- 'Enterprise'), the migration default spelling ('early_adopter_beta') and
-- the plansConfig ids mixed in one column.
-- Backfill: null / '' / 'early_adopter_beta' / 'Free' -> 'early-adopter-beta',
-- 'Starter' -> 'starter', 'Pro' and 'Enterprise' -> 'pro-business'.
-- Idempotent: only rows whose value differs from the canonical one are
-- touched, so re-running the script is a no-op.
with normalized as (
  select
    id,
    case
      when plan_type is null
        or btrim(plan_type) = ''
        or lower(btrim(plan_type)) in ('early_adopter_beta', 'earlyadopterbeta', 'free')
        then 'early-adopter-beta'
      when lower(btrim(plan_type)) = 'starter'
        then 'starter'
      when lower(btrim(plan_type)) in ('pro', 'enterprise')
        then 'pro-business'
      else plan_type
    end as canonical
  from public.businesses
)
update public.businesses b
set plan_type = n.canonical
from normalized n
where b.id = n.id
  and b.plan_type is distinct from n.canonical;

-- Guarded block: public.business_profiles does not exist yet. A bare ALTER
-- against a missing table aborts the whole script, so the existence check has
-- to come first. When the table does exist, the same profile columns are added
-- there with IF NOT EXISTS.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'business_profiles'
  ) then
    alter table public.business_profiles
      add column if not exists pincode text default null,
      add column if not exists upi_qr_url text default null,
      add column if not exists account_name text default null,
      add column if not exists registered_address text default null,
      add column if not exists signature_name text default null,
      add column if not exists quotation_prefix text default null,
      add column if not exists sales_order_prefix text default null,
      add column if not exists purchase_order_prefix text default null,
      add column if not exists purchase_bill_prefix text default null,
      add column if not exists credit_note_prefix text default null,
      add column if not exists debit_note_prefix text default null,
      add column if not exists tnc_invoice text default null,
      add column if not exists tnc_quotation text default null,
      add column if not exists tnc_sales_order text default null,
      add column if not exists tnc_purchase text default null;
  end if;
end
$$;
