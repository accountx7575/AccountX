// supabase/functions/report-scheduler/index.ts
//
// AccountX scheduled-report worker (T96): scans scheduled_reports for due
// rows and enqueues notifications per recipient. Scheduling/config/enqueue
// mechanics are REAL; report CONTENT binding is a documented v2 hook
// (see attachReportContent below) - enqueued rows carry template_key +
// schedule metadata and the notification body resolves at send time.
//
// DEPLOYMENT (never claim it runs until this exists):
//   The function must be triggered on a schedule by either
//   (a) the pg_cron extension + pg_net POSTing this URL, e.g.
//       select cron.schedule('accountx-report-scheduler','* * * * *',
//         $$ select net.http_post(
//              url:='https://<project>.supabase.co/functions/v1/report-scheduler',
//              headers:=jsonb_build_object('Authorization','Bearer '||'<SERVICE_ROLE_KEY>')) $$);
//   or (b) an external scheduler (GitHub Action / cron + curl) POSTing with
//   an Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> header.
//   verify_jwt is disabled; the handler itself requires the service-role key.
//
// Response contract:
//   success: { ok:true, due, advanced, enqueued, skipped:[{id,reason}] }
//   failure: { ok:false, code:'FORBIDDEN'|'COMM_NOT_CONFIGURED'|'UPSTREAM_ERROR', message }
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fail(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function succeed(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function buildServiceClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface ScheduledReportRow {
  id: string;
  business_id: string;
  enabled: boolean;
  frequency: string | null;
  next_run_at: string;
  last_run_at: string | null;
  recipients: { channel: string; recipient: Record<string, unknown> }[] | null;
  report_key?: string | null;
  template_key?: string | null;
}

/** Advances a cadence by one period from `fromIso` (UTC). */
export function advanceCadence(fromIso: string, frequency: string): { nextRunAt: string } | { error: string } {
  const d = new Date(fromIso);
  if (isNaN(d.getTime())) return { error: `invalid next_run_at "${fromIso}"` };
  switch (frequency) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      // Clamp to month end when the day-of-month overflows (Jan 31 -> Feb 28).
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 1);
      const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, daysInMonth));
      break;
    default:
      return { error: `unsupported frequency "${frequency}"` };
  }
  return { nextRunAt: d.toISOString() };
}

/**
 * v2 HOOK - REPORT CONTENT BINDING (documented stub):
 * Today a scheduled enqueue carries only schedule metadata; the actual
 * rendered report (PDF/CSV of report_key for the business/period) will be
 * attached here in v2 once per-report snapshot rendering lands. Returning
 * null means "no attachment" and is fully honest in the enqueued row.
 */
function attachReportContent(_row: ScheduledReportRow): Promise<null> {
  return Promise.resolve(null);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return fail("BAD_REQUEST", "Use POST.", 400);
  }

  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!SERVICE_ROLE_KEY) {
    return fail("COMM_NOT_CONFIGURED", "SUPABASE_SERVICE_ROLE_KEY is not configured.", 503);
  }
  if (bearer !== SERVICE_ROLE_KEY) {
    return fail("FORBIDDEN", "Scheduler requires the service-role key as its bearer token.", 403);
  }

  const client = buildServiceClient();
  if (!client) return fail("COMM_NOT_CONFIGURED", "Supabase env incomplete.", 503);

  const nowIso = new Date().toISOString();
  const { data: dueRows, error: scanErr } = await client
    .from("scheduled_reports")
    .select("id, business_id, enabled, frequency, next_run_at, last_run_at, recipients, report_key, template_key")
    .eq("enabled", true)
    .lte("next_run_at", nowIso);
  if (scanErr) {
    return fail("UPSTREAM_ERROR", `scheduled_reports scan failed: ${scanErr.message}`, 500);
  }

  const rows = (dueRows ?? []) as ScheduledReportRow[];
  let advanced = 0;
  let enqueued = 0;
  const skipped: { id: string; reason: string }[] = [];

  for (const row of rows) {
    // Idempotent advance FIRST with an optimistic guard on next_run_at: two
    // concurrent cron firings can only ever win once per schedule slot.
    const step = advanceCadence(row.next_run_at, row.frequency ?? "");
    if ("error" in step) {
      skipped.push({ id: row.id, reason: step.error });
      continue;
    }
    const upd = await client
      .from("scheduled_reports")
      .update({ last_run_at: nowIso, next_run_at: step.nextRunAt })
      .eq("id", row.id)
      .eq("next_run_at", row.next_run_at)
      .select("id");
    if (upd.error || !upd.data || upd.data.length === 0) {
      skipped.push({ id: row.id, reason: upd.error ? upd.error.message : "lost race / already advanced" });
      continue;
    }
    advanced++;

    await attachReportContent(row); // v2 hook: content binding, null today

    const recipients = Array.isArray(row.recipients) ? row.recipients : [];
    if (recipients.length === 0) {
      skipped.push({ id: row.id, reason: "no recipients configured" });
      continue;
    }
    for (const r of recipients) {
      if (!r || typeof r !== "object" || !("channel" in r)) {
        skipped.push({ id: row.id, reason: "malformed recipient entry" });
        continue;
      }
      // Enqueue = pending notification_logs row; send-notification (or any
      // worker) performs the real provider call later. Content stays honest:
      // nothing here pretends a report was rendered.
      const ins = await client.from("notification_logs").insert({
        business_id: row.business_id,
        channel: r.channel === "whatsapp" ? "whatsapp" : "email",
        recipient: JSON.stringify(r.recipient ?? {}),
        template_key: row.template_key ?? null,
        doc_type: "scheduled_report",
        doc_id: row.id,
        idempotency_key: `${row.id}:${row.next_run_at}:${r.channel}`,
        provider: r.channel === "whatsapp" ? "meta_cloud" : "resend",
        status: "pending",
      }).select("id").single();
      if (ins.error) {
        skipped.push({ id: row.id, reason: `enqueue failed: ${ins.error.message}` });
      } else {
        enqueued++;
      }
    }
  }

  return succeed({ ok: true, due: rows.length, advanced, enqueued, skipped });
});
