// supabase/functions/send-notification/index.ts
//
// AccountX notifications - one-shot sender for email + WhatsApp (T96).
// Provider keys live ONLY in Deno.env secrets. Honest failure everywhere:
// nothing is ever logged as sent unless the provider actually accepted it,
// and an unset backend returns 503 COMM_NOT_CONFIGURED instead of faking.
//
// Request (dispatch-frozen):
//   { business_id, channel:'email'|'whatsapp', template_key?, context?,
//     recipient:{to,cc?,bcc?}|{phone_e164}, subject?, body_html?, body_text?,
//     attachment?:{filename,content_base64}, doc_type?, doc_id?, idempotency_key? }
// Response contract (frozen):
//   success: { ok:true, notification_id, status:'sent', provider, provider_message_id, duplicate? }
//   failure: { ok:false, code:'COMM_NOT_CONFIGURED'|'PROVIDER_NOT_LIVE'|'FORBIDDEN'
//                    |'BAD_REQUEST'|'VALIDATION_ERROR'|'TEMPLATE_NOT_FOUND'|'UPSTREAM_ERROR',
//              message }
// HTTP mapping: 200 ok | 400 malformed | 401 bad JWT | 403 not a member
//               | 404 template | 422 validation | 503 not configured | 502 upstream
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  validateSendRequest,
  mergeTemplate,
  normalizePhoneE164,
  metaDigitsFromE164,
  recipientPhoneE164,
  attachmentProblem,
  buildResendPayload,
  buildMetaMessagesUrl,
  buildMetaMediaUrl,
  buildMetaTextMessage,
  buildMetaTemplateMessage,
  buildMetaDocumentMessage,
} from "../../src/lib/comms/helpers.ts";
import type {
  CommErrorCode,
  SendNotificationRequest,
  EmailRecipient,
} from "../../src/lib/comms/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const UPSTREAM_TIMEOUT_MS = 30_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fail(code: CommErrorCode, message: string, status: number): Response {
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

async function safeErrorDetail(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t ? `: ${t.slice(0, 300).replace(/\s+/g, " ")}` : "";
  } catch {
    return "";
  }
}

function buildUserClient(authHeader: string | null): SupabaseClient | null {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ------------------------------ providers ---------------------------------- */

type EmailProvider = { name: "resend"; apiKey: string; from: string } | {
  name: "smtp";
};

/**
 * LIVE vs DOCUMENTED-STUB:
 *  - resend: LIVE (production REST call incl. PDF attachments).
 *  - smtp:   DOCUMENTED-STUB ONLY -> explicit PROVIDER_NOT_LIVE, never a fake send.
 */
function resolveEmailProvider(): { provider: EmailProvider; from: string } | { error: string; code: CommErrorCode } {
  const kind = (Deno.env.get("EMAIL_PROVIDER") ?? "").toLowerCase();
  const from =
    Deno.env.get("NOTIFICATIONS_FROM")?.trim() ||
    Deno.env.get("SMTP_FROM")?.trim() ||
    "";
  if (!kind) {
    return { error: "EMAIL_PROVIDER secret is not configured.", code: "COMM_NOT_CONFIGURED" };
  }
  if (kind === "resend") {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) {
      return { error: "RESEND_API_KEY secret is not configured.", code: "COMM_NOT_CONFIGURED" };
    }
    if (!from) {
      return {
        error: "No FROM address configured (set NOTIFICATIONS_FROM or SMTP_FROM).",
        code: "COMM_NOT_CONFIGURED",
      };
    }
    return { provider: { name: "resend", apiKey: key, from }, from };
  }
  if (kind === "smtp") {
    // DOCUMENTED-STUB: SMTP delivery is not implemented in this build.
    return {
      error:
        "EMAIL_PROVIDER=smtp is a documented stub in this build; configure EMAIL_PROVIDER=resend for live delivery.",
      code: "PROVIDER_NOT_LIVE",
    };
  }
  return { error: `Unsupported EMAIL_PROVIDER "${kind}" (use resend or smtp).`, code: "BAD_REQUEST" };
}

type WhatsappProvider = { name: "meta_cloud"; accessToken: string; phoneNumberId: string } | null;

function resolveWhatsappProvider(): { provider: WhatsappProvider } | { error: string; code: CommErrorCode } {
  const kind = (Deno.env.get("WHATSAPP_PROVIDER") ?? "").toLowerCase();
  if (!kind) {
    return { error: "WHATSAPP_PROVIDER secret is not configured.", code: "COMM_NOT_CONFIGURED" };
  }
  if (kind !== "meta_cloud") {
    return { error: `Unsupported WHATSAPP_PROVIDER "${kind}" (use meta_cloud).`, code: "BAD_REQUEST" };
  }
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    return {
      error: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID secrets are not configured.",
      code: "COMM_NOT_CONFIGURED",
    };
  }
  return { provider: { name: "meta_cloud", accessToken: token, phoneNumberId } };
}

/* ------------------------------- sending ----------------------------------- */

type SendOutcome = { ok: true; providerMessageId: string } | { ok: false; message: string };

async function sendViaResend(
  provider: { apiKey: string },
  args: {
    from: string;
    recipient: EmailRecipient;
    subject: string;
    html?: string;
    text?: string;
    attachment?: SendNotificationRequest["attachment"];
  },
): Promise<SendOutcome> {
  const payload = buildResendPayload({
    from: args.from,
    to: Array.isArray(args.recipient.to) ? args.recipient.to : [args.recipient.to],
    cc: args.recipient.cc,
    bcc: args.recipient.bcc,
    subject: args.subject,
    html: args.html,
    text: args.text,
    attachment: args.attachment,
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { ok: false, message: `Resend request failed (${res.status})${await safeErrorDetail(res)}` };
  }
  const json = await res.json().catch(() => null);
  const id = typeof json?.id === "string" ? json.id : "";
  if (!id) return { ok: false, message: "Resend accepted the request but returned no message id." };
  return { ok: true, providerMessageId: id };
}

async function base64ToBytes(contentBase64: string): Promise<Uint8Array> {
  const compact = contentBase64.replace(/\s+/g, "");
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sendViaMetaCloud(
  provider: { accessToken: string; phoneNumberId: string },
  args: {
    phoneDigits: string;
    text?: string;
    templateKey?: string;
    templateRow?: Record<string, unknown> | null;
    attachment?: SendNotificationRequest["attachment"];
  },
): Promise<SendOutcome> {
  const headers = {
    "Authorization": `Bearer ${provider.accessToken}`,
    "Content-Type": "application/json",
  };

  let body: Record<string, unknown>;
  if (args.attachment) {
    // Two-phase document send: upload media, then reference its id.
    const bytes = await base64ToBytes(args.attachment.content_base64);
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }), args.attachment.filename.trim());
    const upRes = await fetch(buildMetaMediaUrl(provider.phoneNumberId), {
      method: "POST",
      headers: { "Authorization": `Bearer ${provider.accessToken}` },
      body: form,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upRes.ok) {
      return {
        ok: false,
        message: `WhatsApp media upload failed (${upRes.status})${await safeErrorDetail(upRes)}`,
      };
    }
    const upJson = await upRes.json().catch(() => null);
    const mediaId = typeof upJson?.id === "string" ? upJson.id : "";
    if (!mediaId) return { ok: false, message: "WhatsApp media upload returned no media id." };
    body = buildMetaDocumentMessage(args.phoneDigits, {
      mediaId,
      filename: args.attachment.filename,
      caption: args.text?.slice(0, 1024),
    });
  } else if (args.templateKey && args.templateRow) {
    // Provider-native template when the business template row declares one
    // (whatsapp_template_name / whatsapp_language_code columns, T95 schema).
    const nativeName = typeof args.templateRow.whatsapp_template_name === "string"
      ? args.templateRow.whatsapp_template_name.trim()
      : "";
    const language = typeof args.templateRow.whatsapp_language_code === "string"
      && args.templateRow.whatsapp_language_code.trim()
      ? args.templateRow.whatsapp_language_code.trim()
      : "en";
    if (nativeName) {
      const params = [args.text ?? ""].filter((p) => p.length > 0);
      body = buildMetaTemplateMessage(args.phoneDigits, nativeName, language, params);
    } else {
      body = buildMetaTextMessage(args.phoneDigits, args.text ?? "");
    }
  } else {
    body = buildMetaTextMessage(args.phoneDigits, args.text ?? "");
  }

  const res = await fetch(buildMetaMessagesUrl(provider.phoneNumberId), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    return {
      ok: false,
      message: `WhatsApp Cloud API request failed (${res.status})${await safeErrorDetail(res)}`,
    };
  }
  const json = await res.json().catch(() => null);
  const msgs = Array.isArray(json?.messages) ? json.messages : [];
  const messageId = typeof msgs[0]?.id === "string" ? (msgs[0].id as string) : "";
  if (!json || typeof json !== "object" || !("messages" in json)) {
    return { ok: false, message: "WhatsApp Cloud API returned an unexpected response." };
  }
  return { ok: true, providerMessageId: messageId };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------ entrypoint --------------------------------- */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return fail("BAD_REQUEST", "Use POST.", 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_REQUEST", "Body must be valid JSON.", 400);
  }

  const validation = validateSendRequest(body);
  if (!validation.ok) {
    return fail("VALIDATION_ERROR", validation.message, 422);
  }
  const payload = body as SendNotificationRequest;
  const businessId = payload.business_id;

  // 1) Verify caller JWT (house pattern: user-scoped anon-key client).
  const client = buildUserClient(req.headers.get("Authorization"));
  if (!client) {
    return fail("FORBIDDEN", "Missing or malformed Authorization bearer token.", 401);
  }
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData?.user) {
    return fail("FORBIDDEN", "Invalid or expired session token.", 401);
  }

  // 2) Business-membership enforcement (RLS-backed helper, house pattern).
  const { data: isMember, error: memberErr } = await client.rpc("is_business_member", {
    b_id: businessId,
  });
  if (memberErr) {
    return fail("UPSTREAM_ERROR", "Membership lookup failed.", 500);
  }
  if (isMember !== true) {
    return fail("FORBIDDEN", "You do not have access to this business.", 403);
  }

  // 3) Idempotency: an already-logged send with the same key is never repeated.
  const idempotencyKey = payload.idempotency_key?.trim() || "";
  if (idempotencyKey) {
    const { data: dupe } = await client
      .from("notification_logs")
      .select("id")
      .eq("business_id", businessId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const dupeId = typeof (dupe as { id?: unknown } | null)?.id === "string"
      ? (dupe as { id: string }).id
      : "";
    if (dupeId) {
      return succeed({
        ok: true,
        notification_id: dupeId,
        status: "sent",
        duplicate: true,
        provider: payload.channel === "email" ? "resend" : "meta_cloud",
        provider_message_id: "",
      });
    }
  }

  // 4) Optional business-scoped template lookup + {{variable}} merge.
  let templateRow: Record<string, unknown> | null = null;
  let subject = payload.subject?.trim() ?? "";
  let bodyHtml = payload.body_html;
  let bodyText = payload.body_text;
  if (payload.template_key) {
    const key = payload.template_key.trim();
    const { data: tpl, error: tplErr } = await client
      .from("notification_templates")
      .select("*")
      .eq("business_id", businessId)
      .eq("template_key", key)
      .maybeSingle();
    if (tplErr) {
      return fail("UPSTREAM_ERROR", "Template lookup failed.", 500);
    }
    if (!tpl) {
      return fail("TEMPLATE_NOT_FOUND", `Template "${key}" does not exist for this business.`, 404);
    }
    templateRow = tpl;
    const ctx = payload.context ?? {};
    if (!subject && typeof tpl.subject === "string") subject = mergeTemplate(tpl.subject, ctx);
    if (!bodyHtml && typeof tpl.body_html === "string") bodyHtml = mergeTemplate(tpl.body_html, ctx);
    if (!bodyText && typeof tpl.body_text === "string") bodyText = mergeTemplate(tpl.body_text, ctx);
  }

  // 5) Resolve provider BEFORE any log write: unset backend = honest 503,
  //    nothing recorded as sent.
  let providerName: "resend" | "meta_cloud";
  let emailProvider: { name: "resend"; apiKey: string; from: string } | null = null;
  let whatsappProvider: { accessToken: string; phoneNumberId: string } | null = null;
  if (payload.channel === "email") {
    const picked = resolveEmailProvider();
    if ("error" in picked) return fail(picked.code, picked.error, 503);
    emailProvider = picked.provider as { name: "resend"; apiKey: string; from: string };
    providerName = "resend";
  } else {
    const picked = resolveWhatsappProvider();
    if ("error" in picked) return fail(picked.code, picked.error, 503);
    whatsappProvider = picked.provider!;
    providerName = "meta_cloud";
  }

  // 6) Audit-first logging: pending -> processing -> sent|failed.
  const recipientLabel =
    payload.channel === "email"
      ? (payload.recipient as EmailRecipient).to
      : recipientPhoneE164(payload.recipient);
  const baseRow = {
    business_id: businessId,
    channel: payload.channel,
    recipient: recipientLabel,
    template_key: payload.template_key?.trim() || null,
    doc_type: payload.doc_type ?? null,
    doc_id: payload.doc_id ?? null,
    idempotency_key: idempotencyKey || null,
    provider: providerName,
  };
  const inserted = await client
    .from("notification_logs")
    .insert({ ...baseRow, status: "pending" })
    .select("id")
    .single();
  if (inserted.error || typeof (inserted.data as { id?: unknown } | null)?.id !== "string") {
    // Never send an unlogged notification.
    return fail(
      "UPSTREAM_ERROR",
      `Could not open notification_logs row: ${inserted.error?.message ?? "unknown"}`,
      500,
    );
  }
  const notificationId = (inserted.data as { id: string }).id;
  await client.from("notification_logs").update({ status: "processing" }).eq("id", notificationId);

  // 7) Real provider call.
  const outcome: SendOutcome = (() => {
    const attProblem = attachmentProblem(payload.attachment);
    if (attProblem) return { ok: false as const, message: attProblem };
    if (payload.channel === "email" && emailProvider) {
      if (!subject) return { ok: false as const, message: "Resolved subject is empty." };
      return sendViaResend({ apiKey: emailProvider.apiKey }, {
        from: emailProvider.from,
        recipient: payload.recipient as EmailRecipient,
        subject,
        html: bodyHtml ?? undefined,
        text: bodyText ?? undefined,
        attachment: payload.attachment,
      }).then((r) => r);
    }
    if (payload.channel === "whatsapp" && whatsappProvider) {
      const e164 = recipientPhoneE164(payload.recipient) || normalizePhoneE164(recipientPhoneE164(payload.recipient));
      if (!e164) return Promise.resolve({ ok: false as const, message: "recipient.phone_e164 is not usable." });
      const text = bodyText ?? (bodyHtml ? htmlToText(bodyHtml) : "");
      return sendViaMetaCloud(whatsappProvider, {
        phoneDigits: metaDigitsFromE164(e164),
        text,
        templateKey: payload.template_key?.trim(),
        templateRow,
        attachment: payload.attachment,
      });
    }
    return Promise.resolve({ ok: false as const, message: "Provider unavailable." });
  })();

  const result = await outcome;
  if (!result.ok) {
    await client
      .from("notification_logs")
      .update({ status: "failed", error_message: result.message.slice(0, 1000) })
      .eq("id", notificationId);
    return fail("UPSTREAM_ERROR", result.message, 502);
  }

  await client
    .from("notification_logs")
    .update({ status: "sent", provider_message_id: result.providerMessageId })
    .eq("id", notificationId);

  return succeed({
    ok: true,
    notification_id: notificationId,
    status: "sent",
    provider: providerName,
    provider_message_id: result.providerMessageId,
  });
});
