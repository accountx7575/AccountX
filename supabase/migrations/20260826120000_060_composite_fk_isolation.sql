-- ============================================================================
-- 060 — RELEASE HARDENING: composite-FK cross-business reference rejection
-- ============================================================================
-- T112 release-candidate audit finding (the only isolation gap that survived
-- the full matrix sweep):
--
--   Item/detail tables carry a direct business_id and an RLS INSERT policy
--   checked on THAT column. A member of business A can therefore direct-INSERT
--   (Supabase client / psql) an item row with business_id = A pointing at a
--   parent document owned by business B (invoice_id, bill_id, ...). Reads stay
--   biz-scoped so nothing LEAKS across, but it corrupts referential semantics:
--   the item claims to belong to A while its parent lives in B. Definer RPC
--   paths (017/022/026/030/046/048) already validate cross-business ids in
--   code; this migration closes the raw-DML hole at the schema level so the
--   guarantee no longer depends on every future caller being honest.
--
-- Mechanism (purely ADDITIVE — no constraint is dropped or altered):
--   1. UNIQUE (id, business_id) on each parent (required FK target).
--      id is already PK so the pair adds zero semantic change.
--   2. Composite FK (parent_col, business_id) -> parent(id, business_id)
--      on each child. The pre-existing single-column FK stays in place;
--      both must hold. ON DELETE CASCADE mirrored from the original FKs.
--   3. Pre-flight DO block counts existing mismatched rows per family and
--      FAILS THE MIGRATION LOUDLY if any are found (fail-hard beats silent
--      repair of data we cannot attribute). Fresh release DBs are expected
--      to be clean because all write paths are RPC-only.
--
-- Deliberately OUT OF SCOPE (documented residual risks, see
-- hive/reports/oscar-security-hardening.md §5):
--   - journal_entry_lines.entry_id: clients hold NO DML policies on JE lines
--     since 014/024 (server-write only); RPCs validate biz pairing.
--   - payments.customer/supplier_id + expenses.category_id etc.: nullable
--     party/category refs need per-column composite pairs; low value vs
--     churn this late in RC — flagged for post-release follow-up.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Pre-flight: refuse to proceed on any existing cross-business child row
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad FROM sales_invoice_items i
  JOIN sales_invoices d ON d.id = i.invoice_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz sales_invoice_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM purchase_bill_items i
  JOIN purchase_bills d ON d.id = i.bill_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz purchase_bill_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM credit_note_items i
  JOIN credit_notes d ON d.id = i.credit_note_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz credit_note_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM debit_note_items i
  JOIN debit_notes d ON d.id = i.debit_note_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz debit_note_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM quotation_items i
  JOIN quotations d ON d.id = i.quotation_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz quotation_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM sales_order_items i
  JOIN sales_orders d ON d.id = i.sales_order_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz sales_order_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM purchase_order_items i
  JOIN purchase_orders d ON d.id = i.purchase_order_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz purchase_order_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM stock_transfer_lines l
  JOIN stock_transfers t ON t.id = l.transfer_id WHERE l.business_id <> t.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz stock_transfer_lines', v_bad; END IF;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- Parent unique pairs (FK targets)
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoices_id_business    ON public.sales_invoices   (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_bills_id_business    ON public.purchase_bills   (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_notes_id_business      ON public.credit_notes     (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_debit_notes_id_business       ON public.debit_notes      (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotations_id_business        ON public.quotations       (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_id_business      ON public.sales_orders     (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_id_business   ON public.purchase_orders  (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_transfers_id_business   ON public.stock_transfers  (id, business_id);

-- ----------------------------------------------------------------------------
-- Composite same-business FKs (additive; original single-col FKs untouched)
-- ----------------------------------------------------------------------------
ALTER TABLE public.sales_invoice_items
  ADD CONSTRAINT fk_sii_invoice_samebiz FOREIGN KEY (invoice_id, business_id)
  REFERENCES public.sales_invoices (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.purchase_bill_items
  ADD CONSTRAINT fk_pbi_bill_samebiz FOREIGN KEY (bill_id, business_id)
  REFERENCES public.purchase_bills (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.credit_note_items
  ADD CONSTRAINT fk_cni_credit_note_samebiz FOREIGN KEY (credit_note_id, business_id)
  REFERENCES public.credit_notes (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.debit_note_items
  ADD CONSTRAINT fk_dni_debit_note_samebiz FOREIGN KEY (debit_note_id, business_id)
  REFERENCES public.debit_notes (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.quotation_items
  ADD CONSTRAINT fk_qi_quotation_samebiz FOREIGN KEY (quotation_id, business_id)
  REFERENCES public.quotations (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.sales_order_items
  ADD CONSTRAINT fk_soi_sales_order_samebiz FOREIGN KEY (sales_order_id, business_id)
  REFERENCES public.sales_orders (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.purchase_order_items
  ADD CONSTRAINT fk_poi_purchase_order_samebiz FOREIGN KEY (purchase_order_id, business_id)
  REFERENCES public.purchase_orders (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.stock_transfer_lines
  ADD CONSTRAINT fk_stl_transfer_samebiz FOREIGN KEY (transfer_id, business_id)
  REFERENCES public.stock_transfers (id, business_id) ON DELETE CASCADE;
