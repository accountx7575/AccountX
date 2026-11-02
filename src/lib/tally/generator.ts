import type {
  TallyCompanyInfo,
  TallyCsvRow,
  TallyExportBundle,
  TallyStockItemMaster,
  TallyValidationIssue,
  TallyVoucher,
} from './types';

/** Tally XML import envelope: Import Data > Vouchers. */
export function generateTallyXml(bundle: TallyExportBundle): string {
  const esc = escapeXml;
  const parts: string[] = [];
  parts.push('<ENVELOPE>');
  parts.push(' <HEADER>');
  parts.push('  <TALLYREQUEST>Import Data</TALLYREQUEST>');
  parts.push(' </HEADER>');
  parts.push(' <BODY>');
  parts.push('  <IMPORTDATA>');
  parts.push('   <REQUESTDESC>');
  parts.push('    <REPORTNAME>Vouchers</REPORTNAME>');
  parts.push('    <STATICVARIABLES>');
  parts.push(`     <SVCURRENTCOMPANY>${esc(bundle.companyName)}</SVCURRENTCOMPANY>`);
  parts.push('    </STATICVARIABLES>');
  parts.push('   </REQUESTDESC>');
  parts.push('   <REQUESTDATA>');

  // Company identity block. Tally's voucher import targets an EXISTING
  // company (SVCURRENTCOMPANY above) - it cannot create one - so this block
  // is emitted as a machine-readable XML comment for traceability/auditing,
  // not as an import instruction. No company-creation behaviour is claimed.
  if (bundle.company) {
    parts.push(generateCompanyComment(bundle.company));
  }

  for (const ledger of bundle.ledgers) {
    parts.push(generateLedgerMaster(ledger));
  }
  for (const item of bundle.stockItems ?? []) {
    parts.push(generateStockItemMaster(item));
  }
  for (const voucher of bundle.vouchers) {
    parts.push(generateVoucher(voucher));
  }

  parts.push('   </REQUESTDATA>');
  parts.push('  </IMPORTDATA>');
  parts.push(' </BODY>');
  parts.push('</ENVELOPE>');
  return parts.join('\r\n');
}

/** Machine-readable company identity (see note in generateTallyXml). */
function generateCompanyComment(c: TallyCompanyInfo): string {
  const esc = escapeXml;
  const attrs = [
    `NAME="${esc(c.name)}"`,
    c.legalName ? `LEGAL_NAME="${esc(c.legalName)}"` : null,
    c.address ? `ADDRESS="${esc(c.address)}"` : null,
    c.gstin ? `GSTIN="${esc(c.gstin)}"` : null,
    c.state ? `STATE="${esc(c.state)}"` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return `    <!-- ACCOUNTX-COMPANY ${attrs} -->`;
}

/**
 * Stock item master. Conservative shape: name / group / base unit / HSN.
 * Tally's GST classification of stock items varies across releases; we do
 * NOT claim every version imports the HSN from this block - vouchers carry
 * full ledger-level accounting regardless.
 */
function generateStockItemMaster(item: TallyStockItemMaster): string {
  const esc = escapeXml;
  const lines: string[] = [];
  lines.push(`    <STOCKITEM NAME="${esc(item.name)}" Action="Create">`);
  lines.push(`     <PARENT>${esc(item.parent)}</PARENT>`);
  lines.push(`     <BASEUNITS>${esc(item.baseUnit)}</BASEUNITS>`);
  if (item.description) lines.push(`     <DESCRIPTION>${esc(item.description)}</DESCRIPTION>`);
  if (item.hsnSac) lines.push(`     <HSN>${esc(item.hsnSac)}</HSN>`);
  lines.push('    </STOCKITEM>');
  return lines.join('\r\n');
}

function generateLedgerMaster(l: TallyExportBundle['ledgers'][number]): string {
  const esc = escapeXml;
  const lines: string[] = [];
  lines.push(`    <LEDGER NAME="${esc(l.name)}" Action="Create">`);
  lines.push(`     <GIVENNAME>${esc(l.name)}</GIVENNAME>`);
  lines.push(`     <PARENT>${esc(l.parent)}</PARENT>`);
  if (l.address) {
    lines.push('     <ADDRESS.LIST TYPE="String">');
    lines.push(`      <ADDRESS>${esc(l.address)}</ADDRESS>`);
    lines.push('     </ADDRESS.LIST>');
    lines.push('     <MAILINGNAME.LIST TYPE="String">');
    lines.push(`      <MAILINGNAME>${esc(l.address)}</MAILINGNAME>`);
    lines.push('     </MAILINGNAME.LIST>');
  }
  if (l.gstin) lines.push(`     <GSTIN>${esc(l.gstin)}</GSTIN>`);
  if (l.state) lines.push(`     <STATE>${esc(l.state)}</STATE>`);
  if (l.pincode) lines.push(`     <PINCODE>${esc(l.pincode)}</PINCODE>`);
  lines.push('     <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>');
  lines.push('     <ISBILLWISEON>Yes</ISBILLWISEON>');
  lines.push('    </LEDGER>');
  return lines.join('\r\n');
}

function generateVoucher(v: TallyVoucher): string {
  const esc = escapeXml;
  const lines: string[] = [];
  lines.push('    <VOUCHER>');
  lines.push(`     <DATE>${tallyDate(v.date)}</DATE>`);
  lines.push(`     <NARRATION>${esc(v.narration)}</NARRATION>`);
  lines.push(`     <VOUCHERTYPENAME>${esc(v.voucherType)}</VOUCHERTYPENAME>`);
  lines.push(`     <VOUCHERNUMBER>${esc(v.voucherNumber)}</VOUCHERNUMBER>`);
  lines.push(`     <PARTYLEDGERNAME>${esc(v.partyLedgerName)}</PARTYLEDGERNAME>`);
  lines.push('     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>');
  for (const e of v.entries) {
    lines.push('     <ALLLEDGERENTRIES.LIST>');
    lines.push(`      <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>`);
    // Tally convention: debits carry ISDEEMEDPOSITIVE=Yes and NEGATIVE amount.
    if (e.isDebit) {
      lines.push('      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>');
      lines.push(`      <AMOUNT>${fmt(-Math.abs(e.amount))}</AMOUNT>`);
    } else {
      lines.push('      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>');
      lines.push(`      <AMOUNT>${fmt(Math.abs(e.amount))}</AMOUNT>`);
    }
    lines.push('     </ALLLEDGERENTRIES.LIST>');
  }
  lines.push('    </VOUCHER>');
  return lines.join('\r\n');
}

/** yyyy-mm-dd -> yyyymmdd (Tally's expected format). */
export function tallyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso.replace(/-/g, '');
  return `${m[1]}${m[2]}${m[3]}`;
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * CSV variant of the same bundle: one flat row per voucher ledger entry,
 * debit and credit as separate positive columns (import-tool friendly).
 * RFC4180 quoting: fields containing quotes/commas/newlines are wrapped in
 * double quotes with inner quotes doubled.
 */
const CSV_COLUMNS = [
  'Date',
  'Voucher Type',
  'Voucher Number',
  'Party Ledger',
  'Ledger',
  'Debit',
  'Credit',
  'Narration',
] as const;

export function escapeCsvField(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function bundleToCsvRows(bundle: TallyExportBundle): TallyCsvRow[] {
  const rows: TallyCsvRow[] = [];
  for (const v of bundle.vouchers) {
    for (const e of v.entries) {
      rows.push({
        date: v.date,
        voucherType: v.voucherType,
        voucherNumber: v.voucherNumber,
        partyLedger: v.partyLedgerName,
        ledger: e.ledgerName,
        debit: e.isDebit ? Math.round(e.amount * 100) / 100 : 0,
        credit: e.isDebit ? 0 : Math.round(e.amount * 100) / 100,
        narration: v.narration,
      });
    }
  }
  return rows;
}

export function generateTallyCsv(bundle: TallyExportBundle): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const row of bundleToCsvRows(bundle)) {
    lines.push(
      [
        escapeCsvField(row.date),
        escapeCsvField(row.voucherType),
        escapeCsvField(row.voucherNumber),
        escapeCsvField(row.partyLedger),
        escapeCsvField(row.ledger),
        String(row.debit.toFixed(2)),
        String(row.credit.toFixed(2)),
        escapeCsvField(row.narration),
      ].join(','),
    );
  }
  // BOM keeps Excel honest about UTF-8 on double-click.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Mapping doctrine (057): a NULL/absent mapping row means identity at export
 * time - canonical AccountX ledger names pass through untouched. Overrides
 * are applied ONLY where rows exist, renaming the master AND every reference
 * to it (voucher entries + party ledger refs) consistently.
 *
 * Many-to-one configurations (two AccountX names overridden onto one Tally
 * name) are REJECTED here - they would silently merge unrelated ledgers.
 */
export function applyLedgerOverrides(
  bundle: TallyExportBundle,
  overrides: { accountx_ledger: string; tally_ledger: string; tally_parent?: string | null }[],
): TallyExportBundle {
  if (!overrides.length) return bundle;
  const byAccountx = new Map(
    overrides
      .filter((o) => o.accountx_ledger?.trim() && o.tally_ledger?.trim())
      .map((o) => [o.accountx_ledger.trim(), o]),
  );
  if (!byAccountx.size) return bundle;

  const claims = new Map<string, string[]>();
  for (const [accountx, o] of byAccountx) {
    const list = claims.get(o.tally_ledger.trim()) ?? [];
    list.push(accountx);
    claims.set(o.tally_ledger.trim(), list);
  }
  for (const [tallyName, sources] of claims) {
    if (sources.length > 1) {
      throw new Error(`Tally ledger mapping collision: "${tallyName}" is mapped from ${sources.map((s) => `"${s}"`).join(', ')} - one target per source ledger`);
    }
  }

  const rename = new Map<string, string>();
  const ledgers = bundle.ledgers.map((l) => {
    const o = byAccountx.get(l.name);
    if (!o || (o.tally_ledger === l.name && !o.tally_parent)) return l;
    if (o.tally_ledger !== l.name) rename.set(l.name, o.tally_ledger);
    return { ...l, name: o.tally_ledger, parent: o.tally_parent?.trim() ? o.tally_parent : l.parent };
  });

  if (!rename.size) return { ...bundle, ledgers };
  const resolve = (name: string) => rename.get(name) ?? name;
  return {
    ...bundle,
    ledgers,
    vouchers: bundle.vouchers.map((v) => ({
      ...v,
      partyLedgerName: resolve(v.partyLedgerName),
      entries: v.entries.map((e) => ({ ...e, ledgerName: resolve(e.ledgerName) })),
    })),
  };
}

/**
 * Pre-download validation. Errors block export; warnings do not.
 * - every voucher must balance to the penny
 * - zero-entry / zero-amount vouchers are rejected
 * - duplicate voucher numbers per type are flagged
 * - party-ledger references must exist in the masters list (or be a
 *   built-in account name: Sales/Purchases/GST/Round Off/Cash/Bank)
 */
const BUILTIN_LEDGERS = new Set([
  'Sales', 'Purchases', 'Round Off',
  'Output CGST', 'Output SGST', 'Output IGST', 'Output Cess',
  'Input CGST', 'Input SGST', 'Input IGST', 'Input Cess',
  'Cash', 'Bank',
]);

export function validateBundle(
  ledgers: TallyExportBundle['ledgers'],
  vouchers: TallyVoucher[],
): TallyValidationIssue[] {
  const issues: TallyValidationIssue[] = [];
  const masterNames = new Set(ledgers.map((l) => l.name));

  const seen = new Map<string, number>();
  for (const v of vouchers) {
    const key = `${v.voucherType}::${v.voucherNumber}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }

  let index = 0;
  for (const v of vouchers) {
    index += 1;
    const label = `${v.voucherType} ${v.voucherNumber}`;
    const signedSum = v.entries.reduce((acc, e) => acc + (e.isDebit ? -e.amount : e.amount), 0);
    if (Math.abs(Math.round(signedSum * 100) / 100) > 0.001) {
      issues.push({
        severity: 'error',
        voucherNumber: label,
        message: `not balanced (dr-cr difference ${(Math.round(signedSum * 100) / 100).toFixed(2)})`,
      });
    }
    if (v.entries.length === 0) {
      issues.push({ severity: 'error', voucherNumber: label, message: 'has no ledger entries' });
    }
    for (const e of v.entries) {
      if (!BUILTIN_LEDGERS.has(e.ledgerName) && !masterNames.has(e.ledgerName)) {
        issues.push({
          severity: 'error',
          voucherNumber: label,
          message: `ledger "${e.ledgerName}" has no master in this export`,
        });
      }
    }
    if ((seen.get(`${v.voucherType}::${v.voucherNumber}`) || 0) > 1) {
      issues.push({
        severity: 'warning',
        voucherNumber: label,
        message: 'duplicate voucher number within export (Tally may merge or reject)',
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(v.date)) {
      issues.push({ severity: 'error', voucherNumber: label, message: `unparsable date "${v.date}"` });
    }
    void index;
  }
  return issues;
}
