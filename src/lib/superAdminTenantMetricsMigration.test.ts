import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(process.cwd());
const migrationSql = readFileSync(
  join(projectRoot, 'supabase/migrations/20261022_super_admin_tenant_metrics.sql'),
  'utf8',
);

describe('super_admin_tenant_metrics migration', () => {
  it('is SECURITY DEFINER with a pinned search_path', () => {
    expect(migrationSql).toContain('SECURITY DEFINER');
    expect(migrationSql).toContain('SET search_path = public');
  });

  it('gates on the platform-admin predicate and raises 42501', () => {
    expect(migrationSql).toContain('public.is_super_admin()');
    expect(migrationSql).toMatch(/IF NOT public\.is_super_admin\(\) THEN/);
    expect(migrationSql).toMatch(/RAISE EXCEPTION[\s\S]{0,200}ERRCODE = '42501'/);
  });

  it('never trusts user_metadata (self-service) for the gate', () => {
    // A quoted JWT payload slot (the real spoof vector) must be absent; an
    // explanatory comment mentioning user_metadata is fine.
    expect(migrationSql).not.toMatch(/['\"]user_metadata['\"]/);
  });

  it('revokes PUBLIC and anon and grants authenticated', () => {
    expect(migrationSql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.super_admin_tenant_metrics() FROM PUBLIC;',
    );
    expect(migrationSql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.super_admin_tenant_metrics() FROM anon;',
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.super_admin_tenant_metrics() TO authenticated;',
    );
  });

  it('exposes the exact console contract', () => {
    for (const column of [
      'business_id uuid',
      'business_name text',
      'total_invoices bigint',
      'total_orders bigint',
      'total_billed_amount numeric',
      'latest_invoice_numbers text',
      'last_activity_at timestamptz',
    ]) {
      expect(migrationSql).toContain(column);
    }
  });

  it('returns one row per business, with a tenant that has no documents still present', () => {
    expect(migrationSql).toContain('FROM public.businesses b');
    expect(migrationSql).toContain('LEFT JOIN inv i');
    expect(migrationSql).toContain('LEFT JOIN ord o');
    expect(migrationSql).toContain('LEFT JOIN latest l');
    expect(migrationSql).toMatch(/coalesce\(b\.legal_name, b\.name\)/);
  });

  it('keeps only the five newest documents per tenant with a row_number window', () => {
    expect(migrationSql).toContain('row_number() OVER');
    expect(migrationSql).toContain('PARTITION BY rd.business_id');
    expect(migrationSql).toContain('WHERE r.rn <= 5');
    expect(migrationSql).toContain('string_agg(r.doc_number');
  });

  it('reads the real document columns of both source tables', () => {
    expect(migrationSql).toContain('public.sales_invoices si');
    expect(migrationSql).toContain('si.invoice_number');
    expect(migrationSql).toContain('public.sales_orders so');
    expect(migrationSql).toContain('so.order_number');
    expect(migrationSql).toContain('sum(si.grand_total)');
    expect(migrationSql).not.toMatch(/trade_name/);
  });

  it('excludes cancelled and void invoices from the billed volume but not from the invoice count', () => {
    expect(migrationSql).toContain(
      "sum(si.grand_total) FILTER (WHERE si.status NOT IN ('cancelled','void'))",
    );
    // The document count stays the plain count of every invoice row.
    expect(migrationSql).toContain('count(*)::bigint AS invoice_count');
    expect(migrationSql).not.toMatch(/count\(\*\)[^,\n]*FILTER/);
  });

  it('is idempotent and safe to re-run', () => {
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.super_admin_tenant_metrics()',
    );
  });
});
