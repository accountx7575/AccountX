/*
# 028 — GST settlement flow (T32)

record_gst_settlement(p_business_id, p_from_date, p_to_date,
                      p_payment_date DEFAULT CURRENT_DATE,
                      p_mode DEFAULT 'bank') RETURNS uuid (JE id)

- ADMIN-GATED; serialized per business via pg_advisory_xact_lock.
- SINGLE SOURCE OF TRUTH FOR THE MATH: calls get_gst_summary() itself and
  works from its rows — the settlement can never disagree with the report
  FE displays. Component classification/naming quirks inherit 025's rules.
- OVERLAP GUARD: RAISES if [from..to] intersects any recorded settlement.
- ZERO-ACTIVITY GUARD: RAISES if both sides are nil (nothing settled).
- POSITIVE NET (liability payable): ONE balanced JE ref_type 'gst_settlement':
    Dr each Output ledger with credit balance (amount = its net)
    Dr each Input ledger with debit-side reversal (negative net rows mirror)
    Cr each Input ledger with credit balance
    Cr Cash|Bank by NET (mode: 'cash' -> Cash, anything else -> Bank)
  Four-arm non-negative build (house pattern, 027-exemplar): reversed-sign
  rows mirror instead of going negative; header totals derived from the
  SAME rounded row sums -> header == sum(lines) to the penny.
- ZERO NET WITH ACTIVITY: offsetting JE only, no cash leg (mode ignored).
- NEGATIVE NET (credit carry-forward): HONEST MEMO — NO journal is posted
  (a cash-free JE that moves nothing is noise and would falsely zero the
  input ledgers whose balances ARE the carried credit). The settlement is
  recorded with carry_forward=true, net stored, audit_logs row written;
  FE surfaces carry-forward from this table (matches 025's labeling).
- Entry number: JE-GSTSET-<from>-<to> (unique by construction: identical
  windows cannot coexist due to the overlap guard).
*/

-- ============================================================================
-- A. SETTLEMENT LEDGER
-- ============================================================================
CREATE TABLE IF NOT EXISTS gst_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  net_liability numeric(14,2) NOT NULL DEFAULT 0,
  output_total numeric(14,2) NOT NULL DEFAULT 0,
  input_total numeric(14,2) NOT NULL DEFAULT 0,
  settle_cgst numeric(14,2) NOT NULL DEFAULT 0,
  settle_sgst numeric(14,2) NOT NULL DEFAULT 0,
  settle_igst numeric(14,2) NOT NULL DEFAULT 0,
  settle_cess numeric(14,2) NOT NULL DEFAULT 0,
  carry_forward boolean NOT NULL DEFAULT false,
  payment_date date,
  mode text,
  je_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE gst_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gst_settlements_select" ON gst_settlements;
CREATE POLICY "gst_settlements_select" ON gst_settlements FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "gst_settlements_insert" ON gst_settlements;
CREATE POLICY "gst_settlements_insert" ON gst_settlements FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_gst_settlements_business ON gst_settlements(business_id, period_from);

-- ============================================================================
-- B. SETTLEMENT RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION record_gst_settlement(
  p_business_id uuid,
  p_from_date date,
  p_to_date date,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_mode text DEFAULT 'bank'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_out numeric(14,2);
  v_in numeric(14,2);
  v_net numeric(14,2);
  v_dr_sum numeric(14,2);
  v_cr_sum numeric(14,2);
  v_je uuid;
  v_cash uuid;
  v_acct uuid;
  v_grp text;
  v_carry boolean;
  v_sgid uuid;
  v_cg numeric(14,2);
  v_sg numeric(14,2);
  v_ig numeric(14,2);
  v_ce numeric(14,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can record GST settlements';
  END IF;

  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Settlement window is inverted';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('gst_settle:' || p_business_id::text));

  IF EXISTS (
    SELECT 1 FROM gst_settlements
    WHERE business_id = p_business_id
      AND period_from <= p_to_date
      AND period_to >= p_from_date
  ) THEN
    RAISE EXCEPTION 'Settlement window overlaps an existing settlement';
  END IF;

  -- Single source of truth: the summary RPC's own numbers
  SELECT
    COALESCE(SUM(net_amount) FILTER (WHERE section = 'Outward'), 0),
    COALESCE(SUM(net_amount) FILTER (WHERE section = 'Inward'), 0),
    COALESCE(MAX(cgst) FILTER (WHERE section = 'Summary'), 0),
    COALESCE(MAX(sgst) FILTER (WHERE section = 'Summary'), 0),
    COALESCE(MAX(igst) FILTER (WHERE section = 'Summary'), 0),
    COALESCE(MAX(cess) FILTER (WHERE section = 'Summary'), 0)
  INTO v_out, v_in, v_cg, v_sg, v_ig, v_ce
  FROM get_gst_summary(p_business_id, p_from_date, p_to_date);

  v_net := round(v_out - v_in, 2);

  IF v_out = 0 AND v_in = 0 THEN
    RAISE EXCEPTION 'No GST activity in the selected window';
  END IF;

  v_carry := v_net < 0;

  IF NOT v_carry THEN
    -- Pre-compute header totals from the same rounded row sums
    v_dr_sum := 0;
    v_cr_sum := 0;
    FOR r IN
      SELECT section, net_amount
      FROM get_gst_summary(p_business_id, p_from_date, p_to_date)
      WHERE section IN ('Outward', 'Inward')
    LOOP
      IF r.section = 'Outward' THEN
        IF r.net_amount > 0 THEN v_dr_sum := v_dr_sum + round(r.net_amount, 2);
        ELSE v_cr_sum := v_cr_sum + round(-r.net_amount, 2); END IF;
      ELSE
        IF r.net_amount > 0 THEN v_cr_sum := v_cr_sum + round(r.net_amount, 2);
        ELSE v_dr_sum := v_dr_sum + round(-r.net_amount, 2); END IF;
      END IF;
    END LOOP;

    IF v_net > 0 THEN
      v_cr_sum := v_cr_sum + v_net;
      IF p_mode = 'cash' THEN
        v_cash := find_or_create_account(p_business_id, 'Cash', 'Cash & Bank');
      ELSE
        v_cash := find_or_create_account(p_business_id, 'Bank', 'Cash & Bank');
      END IF;
    END IF;

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    VALUES (p_business_id,
      'JE-GSTSET-' || to_char(p_from_date, 'YYMMDD') || '-' || to_char(p_to_date, 'YYMMDD'),
      COALESCE(p_payment_date, CURRENT_DATE),
      'GST settlement ' || p_from_date || ' to ' || p_to_date ||
        CASE WHEN v_net > 0 THEN ' (paid)' ELSE ' (offset)' END,
      v_dr_sum, v_cr_sum,
      'posted', 'gst_settlement', NULL, auth.uid())
    RETURNING id INTO v_je;

    FOR r IN
      SELECT section, ledger_name, net_amount
      FROM get_gst_summary(p_business_id, p_from_date, p_to_date)
      WHERE section IN ('Outward', 'Inward')
    LOOP
      IF r.section = 'Outward' THEN v_grp := 'GST Payable'; ELSE v_grp := 'GST Receivable'; END IF;
      v_acct := find_or_create_account(p_business_id, r.ledger_name, v_grp);

      IF r.section = 'Outward' AND r.net_amount > 0 THEN
        INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
        VALUES (p_business_id, v_je, v_acct, round(r.net_amount, 2), 0);
      ELSIF r.section = 'Outward' THEN
        INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
        VALUES (p_business_id, v_je, v_acct, 0, round(-r.net_amount, 2));
      ELSIF r.net_amount > 0 THEN
        INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
        VALUES (p_business_id, v_je, v_acct, 0, round(r.net_amount, 2));
      ELSE
        INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
        VALUES (p_business_id, v_je, v_acct, round(-r.net_amount, 2), 0);
      END IF;
    END LOOP;

    IF v_net > 0 THEN
      INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
      VALUES (p_business_id, v_je, v_cash, 0, v_net);
    END IF;
  END IF;

  INSERT INTO gst_settlements (business_id, period_from, period_to,
    net_liability, output_total, input_total,
    settle_cgst, settle_sgst, settle_igst, settle_cess,
    carry_forward, payment_date, mode, je_id, created_by)
  VALUES (p_business_id, p_from_date, p_to_date,
    v_net, round(v_out, 2), round(v_in, 2),
    round(v_cg, 2), round(v_sg, 2), round(v_ig, 2), round(v_ce, 2),
    v_carry,
    CASE WHEN v_carry OR v_net <= 0 THEN NULL ELSE COALESCE(p_payment_date, CURRENT_DATE) END,
    CASE WHEN v_carry OR v_net <= 0 THEN NULL ELSE p_mode END,
    v_je, auth.uid())
  RETURNING id INTO v_sgid;

  IF v_je IS NOT NULL THEN
    UPDATE gst_settlements SET je_id = v_je WHERE id = v_sgid;
  END IF;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(), 'gst_settlement_recorded', 'gst_settlement', v_sgid,
          CASE WHEN v_carry
            THEN 'Credit carry-forward ' || (-v_net)::text || ' recorded for ' || p_from_date || '..' || p_to_date
            ELSE 'GST settled net ' || v_net::text || ' for ' || p_from_date || '..' || p_to_date
          END);

  RETURN COALESCE(v_je, v_sgid);
END;
$$;

REVOKE EXECUTE ON FUNCTION record_gst_settlement(uuid, date, date, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_gst_settlement(uuid, date, date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION record_gst_settlement(uuid, date, date, date, text) TO authenticated;
