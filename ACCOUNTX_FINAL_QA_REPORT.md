# ACCOUNTX — FINAL QA & PRODUCTION READINESS REPORT

> **REPORTING COMPLETION UPDATE (2026-08-25, financial-reports block):**
> Five report families ADDED to the registry-driven system (`reportsAdapter.ts` + `ReportDetailPage.tsx`), all reading live accounting data with DB-level date/status filtering and the existing CSV-export + print pipeline extended to cover them:
> - **Sales Register** — issued invoices only, GST split columns + document totals footer.
> - **Purchase Register** — confirmed bills only, same grammar.
> - **Receivables Detail** — `v_receivables_aging_base`, outstanding>0 only, per-invoice ageing bucket (Current/1-30/31-60/61-90/90+), billed/paid/outstanding totals.
> - **Payables Detail** — mirror on `v_payables_aging_base`.
> - **Cash & Bank Movements** — NEW family distinct from the daily cash-flow grid: posted journal lines on 'Cash & Bank' group accounts only (accounting source of truth, not the payments table), per-ledger Opening/Inflow/Outflow/Net/Closing with period totals; Cash vs Bank naturally separated as their own ledger rows.
> ReportDetailPage's Tally button now routes users to the real Settings exporter (false "coming soon" toast removed).
> P&L / Balance Sheet / TB / Ledger / GST Summary / Day Book / AR-AP Aging were already WORKING on real RPCs — intentionally NOT rebuilt.

> **RESOLUTION UPDATE (2026-08-25, post-audit implementation slice):**
> The following findings have been FIXED and verified (build ✅ / typecheck 0 / vitest 68/68 / route smokes 200):
>
> | Finding | Status | Resolution |
> |---|---|---|
> | C1 stock not restored on cancel | **FIXED** | Migration `20260825160000_036_cancel_stock_integrity.sql`: cancel RPCs now insert per-item compensating movements (`sale_return`/`purchase_return`, reference-tagged `*_cancel` for idempotency); recompute trigger keeps stock canonical |
> | C2 FE bypasses atomic cancel RPCs | **FIXED** | SalesInvoicesPage/PurchaseBillsPage now call `cancel_sales_invoice`/`cancel_purchase_bill`; raw UPDATE + RLS-denied audit insert removed; paid-doc guard now actually enforced in live flow |
> | C3 forgot-password missing | **FIXED** | New `ForgotPasswordPage.tsx` (split-screen, sent-state), `/forgot-password` route wired, "Forgot password?" link on login |
> | C4 adjustment orphaning | **FIXED** | New atomic RPC `post_stock_adjustment_atomic` (movement+journal one transaction; JE failure rolls back movement); StockAdjustmentPage rewired; impossible delete-compensation and racy client RMW removed |
> | P1 duplicate-JE race | **FIXED** | Partial UNIQUE index `uq_je_idempotency(business_id, reference_type, reference_id)` |
> | P1 admin→owner self-promotion | **FIXED** | members_insert/members_update policies now forbid `role='owner'`; `admin_change_member_role` rejects owner targets (transfer-only) |
> | P1 signup email-confirm bounce | **FIXED** | RegisterPage shows confirmation-pending state when session is null |
> | P1 Tally export vaporware | **FOUNDATION SHIPPED** | Modular exporter `src/lib/tally/` (types/mapping/generator + 11 structure tests): party ledger masters, Sales/Purchase/Receipt/Payment/Journal vouchers, Tally sign conventions, validation layer; working export panel in Settings (period + type selection, validation-gated download). See §9 note on real-Tally validation limits |
>
> Remaining open: P1 stale `accounts.current_balance` (deferred — touches four writer bodies), P1 server-side GST recompute (deferred), all P2/P3 items.

Audit date: 2026-08-25 · Scope: post-UI-redesign regression + production readiness
Project: `project-bolt-sb1-AccountXbolt\project` · Reference `C:\Users\Saad\AccountX` NOT touched.
Method: full build/lint/typecheck runs, 43-route smoke matrix, three deep code-trace audits (auth/RLS, accounting/GST/inventory through migration SQL, reports/Tally), UI state-coverage scans.

---

## 1. BUILD STATUS — ✅ GREEN

| Check | Result |
|---|---|
| `npm run build` | ✅ PASS (~13–29s, no warnings of consequence) |
| TypeScript (`tsc --noEmit`) | ✅ EXIT 0 |
| Vitest | ✅ 57/57 across 6 files |
| ESLint | ⚠️ 98 style-level errors: 57× `no-explicit-any`, 39× unused-vars, 2 misc. **Zero blocking/compile issues**; concentrated in auth pages + older list pages. |

No broken imports found. No route-level compile errors.

## 2. ROUTE STATUS — ✅ 42/42 SMOKE 200

All routes render HTTP 200 with correct layout shell (AppLayout, sidebar, header):
login, register, setup-business, customers(+new), suppliers(+new), products(+new), sales-invoices(+new, :id view), purchase-bills(+new), payments-received/made(+new), credit-notes/debit-notes(+new), quotations/sales-orders/purchase-orders(+new), expenses(+new), stock, stock-adjustment, ledger, chart-of-accounts, journal-entries(+new), trial-balance, reports(+detail), settings + 6 ComingSoon placeholders. Wildcard fallbacks correct (→ /app inside shell, → /login outside).

State coverage: loading skeletons present on all data lists; empty states on all lists (create forms don't need them); error states via ErrorState pattern on report/list fetch failures.
**Route gap:** `/forgot-password` has NO route (page doesn't exist either — see §3).

## 3. AUTH STATUS — ⚠️ MOSTLY SOLID, TWO REAL GAPS

| Item | Verdict |
|---|---|
| Login (`signInWithPassword`) | ✅ works, toast errors, redirects /app (business-existence handled by ProtectedRoute bounce) |
| Signup (`signUp`) | ⚠️ works when email-confirm OFF; **breaks when ON** (null session → protected-route bounce, no "check inbox" state) |
| **Forgot password** | ❌ **DOES NOT EXIST** — no page, no route, no link, no `resetPasswordForEmail` call anywhere live |
| Logout | ✅ Header signOut + full state/localStorage cleanup + `onAuthStateChange` backstop |
| Session persistence | ✅ `persistSession:true, autoRefreshToken:true` |
| Protected routes | ✅ inline `ProtectedRoute` checks session AND business membership; direct URL access bounces correctly |
| Business creation | ✅ `create_business_with_owner` (SECURITY DEFINER): business + owner membership + default warehouse + 7 seed accounts + 9 expense categories |
| Business switching | ✅ multi-business, localStorage-backed, validated against memberships |
| Note | `useAuth.ts` hook + `AuthGuard.tsx` are DEAD CODE (never imported); live app uses `AuthContext` + inline guard. Two divergent auth layers = maintenance hazard. |

## 4. BUSINESS FLOW STATUS — ✅ CORE FLOWS SOUND; CANCELLATION BROKEN

Traced frontend → RPC → SQL for every flow:

| Flow | Status |
|---|---|
| Customer create→edit→view→invoice→payment | ✅ WORKING (payloads via law-layer builders; numbering atomic) |
| Supplier create→edit→bill→payment | ✅ WORKING (mirror-correct) |
| Product create→stock→sale→reduction | ✅ WORKING on issue (drafts skip stock+journal correctly) |
| Purchase→stock increase→accounting | ✅ WORKING |
| Sales invoice→stock reduction→accounting | ✅ WORKING (single transaction: doc+items+stock+JE+audit) |
| Payment received/made→allocation→ledger→accounting | ✅ EXEMPLARY — oldest-first exact-consumption walk, over-allocation impossible, deadlock-safe lock order, balanced JE |
| **Cancellation** | ❌ **BROKEN END-TO-END** — see Critical #1/#2 |

## 5. ACCOUNTING STATUS — ✅ ENGINE STRONG; ONE LIVE-PATH DEFECT

- **Double-entry balance**: enforced at THREE layers — RPC assertion (`post_journal_entry` raises on imbalance/nonzero), statement-level transition-table triggers on `journal_entry_lines` (abort any unbalanced INSERT/UPDATE/DELETE even from definer code), client DML closed (RLS policies dropped — RPC is the only door). **PASS.**
- **Reversal immutability**: cancels INSERT mirror-image reversing JEs (`reverse_sales/purchase_bill_journal`); original entries never mutated (no definer function UPDATEs/DELETEs posted journals). **PASS by design…**
- **…but the live frontend doesn't use the atomic cancel RPCs.** Invoice/bill pages do raw client `UPDATE status='cancelled'` → reversal RPC → client audit insert (now RLS-denied → error toast AFTER commit). Non-atomic, bypasses the paid-document guard, and the hardened `cancel_sales_invoice`/`cancel_purchase_bill` RPCs have ZERO callers.
- **Duplicate prevention**: check-then-insert idempotency per `(business_id, reference_type, reference_id)` in every wrapper + advisory-lock-serialized gapless numbering + table UNIQUEs on doc numbers. Sequential flows safe; **concurrency race has no DB backstop** (no UNIQUE index on the idempotency triple).
- **Allocation integrity** (015/029): strict amount=allocations, LEAST() clamps, FOR UPDATE ordering. Exemplary.

## 6. GST STATUS — ✅ MECHANICALLY CORRECT; SERVER TRUSTS CLIENT MATH

Working: intra/inter-state split decided by place-of-supply comparison (client-side), six canonical GST ledgers auto-provisioned (Output CGST/SGST/IGST → 'GST Payable'; Input trio → 'GST Receivable'), cess ledgers legalized, round-off identity holds to the penny, settlement engine (admin-gated, overlap-guarded, negative-net carry-forward honesty), CN/DN mirror-direction GST treatment with refund routing.
Gaps: server persists client-computed splits verbatim (`calculate_gst` exists but never called in save paths — a buggy/malicious client books wrong-but-balanced liability); **GSTR-1 and GSTR-3B MISSING** (plus fake "GSTR-1 due soon" toast string in Header); reverse-charge/exempt/nil-rated not modeled; CN/DN emit paired zero-amount Round Off lines (harmless but would fail `post_journal_entry` rules if ever rerouted).

## 7. INVENTORY STATUS — ❌ CANCEL PATH CORRUPTS STOCK

Working: movements append-only (hard trigger), `current_stock` recomputed canonically FROM movements, issue-only stock effects, FIFO cost capture on purchase receipts + `get_stock_valuation` head-pointer walk, product delete guard with archive guidance, low-stock rule (`minimum_stock > 0 && current_stock <= minimum_stock`).
**CRITICAL: cancelling an invoice/bill does NOT restore stock** — neither the server cancel RPCs nor the FE handlers write compensating movements; the recompute trigger then canonizes the wrong figure indefinitely.
**CRITICAL: stock-adjustment failure path** tries to DELETE its movement when the journal RPC fails — blocked by append-only trigger → orphaned un-journaled movement; plus client-side RMW/balance computation racing the recompute trigger.
Valuation inconsistency (medium): adjustments value at SELLING price, reports at FIFO cost, ledger has no COGS/Inventory pairing (periodic model) — three different "inventory truths".

## 8. REPORTS STATUS

| Report | Status | Basis |
|---|---|---|
| Dashboard KPIs | WORKING | client-side aggregates (stock value at retail, not cost — noted) |
| Sales vs Purchases chart | WORKING | 14-day document buckets |
| Cashflow chart | PARTIAL | payments-only daily grid (kept; see Cash & Bank family for ledger-truth movements) |
| **Cash & Bank Movements** | **WORKING (NEW)** | posted journal lines on 'Cash & Bank' group; per-ledger Opening/Inflow/Outflow/Net/Closing + totals |
| AR / AP aging | WORKING | `get_receivables_aging` / `get_payables_aging` bucket reports |
| **Receivables Detail** | **WORKING (NEW)** | invoice-level outstanding from `v_receivables_aging_base`, ageing buckets, party-scoped totals |
| **Payables Detail** | **WORKING (NEW)** | mirror on `v_payables_aging_base` |
| Trial Balance | WORKING | `get_trial_balance` + honest balanced badge |
| General Ledger | WORKING | line-level query + running balance |
| P&L | WORKING | `get_profit_and_loss` w/ Net Profit terminal row (gross/net structure from account groups) |
| Balance Sheet | WORKING | `get_balance_sheet` w/ retained-earnings synthetic row |
| Cash Flow statement | PARTIAL | not O/I/F classified — documented limitation; ledger-level movement truth lives in the new Cash & Bank family |
| GST summary | WORKING | `get_gst_summary` Outward/Inward/Net |
| Party statements | WORKING | customer/supplier statement RPCs |
| Stock valuation | WORKING | `get_stock_valuation` FIFO (Stock page) |
| Day book | WORKING | `v_day_book` |
| **Sales Register** | **WORKING (NEW)** | issued invoices only, GST split columns, totals footer, CSV/print wired |
| **Purchase Register** | **WORKING (NEW)** | confirmed bills only, same grammar |
| GSTR-1 / GSTR-3B | MISSING | nothing implemented |
| Tally export | FOUNDATION | Settings XML exporter shipped this block (see Resolution Update); real-Tally validation pending |
| All registry families | real data | 12 families bound to live RPCs/views/tables |

## 9. TALLY EXPORT STATUS — ❌ DOES NOT EXIST (vaporware)

- Codebase search for Tally/XML/VCHTYPE/ENVELOPE/etc: **zero implementation**.
- What exists: a "Tally" button in ReportDetailPage whose handler is `toast('Tally XML export is coming soon')`; a permanently disabled Settings button; **marketing copy on the login screen claiming "Tally-compatible data export"** — currently false advertising.
- Every actual download produces plain CSV. **CSV is NOT Tally-import compatible** (Tally imports Tally XML via Gateway of Tally, or via Excel-to-Tally converters).
- Required for compliance: party ledger masters (customers/suppliers w/ GSTIN/state/opening) + `<VOUCHER>` generation for Sales/Purchase/Receipt/Payment/Journal/Credit Note/Debit Note voucher types with `ALLLEDGERENTRIES.LIST` legs, GST duty-ledger split by place of supply, yyyymmdd dates, envelope structure, and import-result parsing. Source data (GST columns, statements, journals) is fully adequate — only the writer is missing.

## 10. UI REGRESSION STATUS — ✅ NO CLEAR REGRESSIONS FOUND

Post-redesign sweep: all 8 dashboard StatCards clean sans typography (JetBrains ₹ distortion fixed); tables scroll-contained (`overflow-x-auto` + mobile card fallbacks); sticky footers on all create pages; double-submit protection verified on ALL create pages (`saving/isPending` + `loading` props — PB/SI included); remaining drawers are intentional edit-flows (customers/suppliers/products/CN/DN) + CoA; dark-mode tone pairs consistent; empty/loading/error states present where applicable. No clipped content, overflow, or broken-button patterns detected in static analysis.

## 11. SECURITY STATUS — ✅ STRONG ISOLATION; ONE ESCALATION GAP

- **RLS: 34/34 tables enabled + policied**, every policy scoped by `business_id` + active-membership helpers; helpers require `status='active'`.
- Views: ALL invoker-scoped (`security_invoker=on`) — v_member_directory, v_draft_documents, dashboard/daybook/aging views.
- Definer functions: pinned `search_path` everywhere, anon/PUBLIC revoked, admin RPCs gated per-business + audited, last-owner guards on demote/revoke/transfer.
- No cross-tenant read/write path found via tables, views, or RPCs.
- `.env` gitignored; anon key public-by-design under RLS; no secrets in code.
- **Gap:** role-grant policies/RPC don't restrict granting 'owner' — an admin can self-promote within their own business (owner-only *demotion* is guarded; *promotion* is not). Contained blast radius (own business only) but violates privilege model.

## 12. CRITICAL BUGS (P0)

| # | Bug | Evidence |
|---|---|---|
| C1 | **Stock never restored on invoice/bill cancellation** — cancelled sales keep stock reduced forever; recompute trigger canonizes the error | `cancel_sales_invoice`/`cancel_purchase_bill` (017:367-472) contain zero movement writes; FE handlers none either |
| C2 | **FE cancel bypasses atomic RPCs** — raw client UPDATE flips status without paid-doc guard (paid invoices cancellable while payment JEs stand), non-atomic sequence, trailing audit insert RLS-denied → misleading error after commit | `SalesInvoicesPage.tsx:126-142`, `PurchaseBillsPage.tsx:96-112`; `audit_logs_insert` dropped in 024 |
| C3 | **Forgot-password flow absent** — no page/route/link/live call; users cannot self-recover accounts | glob `*orgot*` = ∅; `useAuth.ts:108-111` dead |
| C4 | **Stock-adjustment failure compensation impossible** — orphaned movement retained when journal RPC fails (append-only trigger blocks the delete), plus client RMW race vs recompute trigger | `StockAdjustmentPage.tsx:55-80` vs `trg_stock_append_only` (023:65-68) |

## 13. HIGH PRIORITY ISSUES (P1)

1. Signup breaks when Supabase email-confirmation is ON (sessionless redirect loop, no messaging).
2. Admin→Owner self-promotion possible (direct write + sanctioned RPC path).
3. Tally export promised in UI/marketing but entirely unimplemented (stub toast + disabled button).
4. No DB UNIQUE backstop on `(business_id, reference_type, reference_id)` — duplicate-JE race under concurrency.
5. `accounts.current_balance` goes stale — direct-INSERT writers (payments 029, CN/DN 022, settlement 028, FY close 027) never maintain it; dashboard liquid-cash reads this column.
6. Server trusts client GST math verbatim (`calculate_gst` never invoked in save paths).
7. Dead-code auth layer shipped (`useAuth.ts`, `AuthGuard.tsx`) encoding better behavior than live app (remember-me, ?next=, email-confirm handling) — wire-or-delete decision needed.
8. `/app/admin` hub never built (invite modal, role-change, transfer-ownership, activity log UI all absent; Settings members covers removal only). Admin hooks `useAdminUsers`/`useAuditLogs` dead code.
9. Full-ledger JSON backup built (`buildFullLedgerJson`) but unwired; Settings backup button disabled stub.

## 14. MEDIUM PRIORITY ISSUES (P2)

1. No COGS/Inventory perpetual legs; adjustment values at selling price vs reports' FIFO cost vs expense-model purchases (three truths).
2. FY-lock coverage gaps: payments/expenses/CN-DN/orders/stock accept dates inside closed years; conversely new payment JEs can be spuriously blocked by journal-date trigger.
3. FIFO cost capture `LIMIT 1` ambiguity when one bill has multiple lines per product.
4. Cash Flow chart/statement is payments-grid, not O/I/F method.
5. Sales/Purchase registers missing as first-class reports.
6. Remember-Me toggle not on live login page.
7. GSTR-1 fake notification string in Header.

## 15. LOW PRIORITY / POLISH (P3)

Lint debt (57 `any`, 39 unused-vars); zero-amount Round Off line pairs from CN/DN writers; unconstrained header total_debit/credit columns; localStorage business-id key not user-namespaced; SettingsPage duplicates CSV helpers instead of importing `exportLedger.ts`.

## 16. COMPLETED FEATURES

Double-entry core (assertion+trigger+closed DML) · GST engine w/ settlement · payment allocation engine · gapless document numbering · draft lifecycle · quotes/SO/PO · CN/DN w/ refunds · fiscal year close/reopen · aging/statements · P&L/BS/TB/Ledger/day-book · FIFO stock valuation · product delete guard · member directory + RBAC capability matrix · admin RPC suite (034) + FY locks (035) · complete premium UI redesign (dashboard centerpiece, 12 full-page create forms replacing drawers, design system w/ 6 shared components, dark mode) · auth (login/register/session/guards/business-switching) · 53→57 test suite incl. hostile payload-property tests.

## 17. REMAINING FEATURES

Forgot-password flow · Tally XML exporter (+ remove false marketing copy meanwhile) · /app/admin hub (invites, role mgmt, transfer, audit trail UI, backups wiring) · GSTR-1/3B · sales/purchase registers · true cash-flow statement · COGS perpetual inventory · server-side GST recomputation · email-confirmation UX · remember-me toggle.

## 18. PRODUCTION READINESS ESTIMATE

**PROJECT COMPLETION: 78%**

Core accounting engine ≈95% · UI/UX ≈95% · Auth ≈75% (no recovery flow, email-confirm trap) · Admin module ≈40% (DB+hooks done, UI absent) · Reports ≈85% · Tally 0% · Inventory integrity ≈80% (cancel hole).

Production-blockers before ANY real books run: C1+C2 (cancel integrity — silent data corruption), C4 (adjustment orphaning), C3 (account recovery), #5 above (stale balances mislead dashboard).
