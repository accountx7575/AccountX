-- 068 — Database-level trigger to cascade payment deletions to journal & ledger
-- Automatically cleans up journal_entries and journal_entry_lines whenever a payment is deleted

CREATE OR REPLACE FUNCTION trg_sync_payment_received_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete matching parent journal entries directly;
  -- journal_entry_lines cascades automatically via foreign key (entry_id FK).
  DELETE FROM journal_entries
  WHERE reference_id = OLD.id
     OR (OLD.payment_number IS NOT NULL AND narration ILIKE '%' || OLD.payment_number || '%');

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION trg_cleanup_deleted_payment_ledger()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM journal_entries
  WHERE reference_id = OLD.id
     OR (OLD.payment_number IS NOT NULL AND narration ILIKE '%' || OLD.payment_number || '%');

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on primary payments table
DROP TRIGGER IF EXISTS trg_payment_received_delete_sync ON payments;
CREATE TRIGGER trg_payment_received_delete_sync
AFTER DELETE ON payments
FOR EACH ROW
EXECUTE FUNCTION trg_sync_payment_received_delete();

DROP TRIGGER IF EXISTS trg_payment_delete_ledger ON payments;
CREATE TRIGGER trg_payment_delete_ledger
AFTER DELETE ON payments
FOR EACH ROW
EXECUTE FUNCTION trg_cleanup_deleted_payment_ledger();

-- Defensively support payments_received table if present in any environment
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payments_received'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_payment_received_delete_ledger ON payments_received;';
    EXECUTE 'CREATE TRIGGER trg_payment_received_delete_ledger AFTER DELETE ON payments_received FOR EACH ROW EXECUTE FUNCTION trg_cleanup_deleted_payment_ledger();';
  END IF;
END $$;
