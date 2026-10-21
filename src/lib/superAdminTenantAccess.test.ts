import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(process.cwd());
const migrationPath = join(
  projectRoot,
  'supabase/migrations/20261022_super_admin_tenant_access.sql',
);

const migration = readFileSync(migrationPath, 'utf8');
const migrationSql = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('super admin tenant access migration', () => {
  it('gates the policy on the canonical platform-admin predicate', () => {
    expect(migration).toContain('public.is_super_admin()');
  });

  it('does not use a profiles.role lookup (public.profiles has no role column)', () => {
    expect(migrationSql).not.toMatch(/profiles\s*\.\s*role/i);
    expect(migrationSql).not.toMatch(/role\s*=\s*'super_admin'/i);
  });

  it('grants every business-scoped table', () => {
    expect(migration).toContain('super_admin_all_access');
    expect(migration).toContain("a.attname = 'business_id'");
  });

  it('keeps business_members read-only for the platform admin', () => {
    expect(migration).toContain("r.table_name = 'business_members'");
    expect(migration).toContain('super_admin_select_access');
  });

  it('is idempotent', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS');
  });
});

describe('tenant list queries are scoped to the active business', () => {
  const listPages = [
    'src/pages/SalesOrdersPage.tsx',
    'src/pages/SalesInvoiceCreatePage.tsx',
    'src/pages/QuotationsPage.tsx',
    'src/pages/PurchaseOrdersPage.tsx',
    'src/pages/PurchaseBillsPage.tsx',
    'src/pages/CustomersPage.tsx',
    'src/pages/SuppliersPage.tsx',
  ];

  it.each(listPages)('%s filters by business_id', (file) => {
    const text = readFileSync(join(projectRoot, file), 'utf8');
    expect(text).toMatch(/\.eq\('business_id',\s*(activeBusiness|biz|activeBusiness!\.id|b)\b/);
  });
});
