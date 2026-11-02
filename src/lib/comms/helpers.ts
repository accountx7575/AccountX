/**
 * Pure helpers for the AccountX communications layer (T96).
 *
 * Single source of truth: imported by the Deno edge functions
 * (supabase/functions/send-notification) via relative path AND unit-tested
 * by vitest. MUST stay dependency-free and runtime-portable (no DOM/node
 * built-ins, no @/ alias imports) so esbuild can bundle it into both worlds.
 */
import type {
  CommAttachment,
  SendNotificationRequest,
  WhatsappRecipient,
} from './types.ts';

/* ------------------------------- templates -------------------------------- */

/**
 * Merges {{variable}} placeholders from a notification_templates row.
 * - Tolerates optional whitespace inside braces: {{ name }} === {{name}}.
 * - Values are stringified (null/undefined -> '').
 * - UNKNOWN placeholders are left verbatim in the output: honest visibility
   beats silent deletion (house no-fake-data rule).
 */
export function mergeTemplate(template: string, vars: Record<string, unknown> = {}): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    const value = vars[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

/* --------------------------------- phone ---------------------------------- */

const E164_MAX_DIGITS = 15;

/**
 * Normalizes free-form phone input toward E.164 (+<countrycode><subscriber>).
 * - Leading '+' kept; '00' international prefix stripped.
 * - A bare 10-digit number is treated as India (+91) per app context when
 *   defaultCountryCode is not overridden.
 * - Returns '' for anything unusable (too short, no digits at all).
 */
export function normalizePhoneE164(input: string, defaultCountryCode = '91'): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2);
  if (!hadPlus && digits.length === 10) digits = `${defaultCountryCode}${digits}`;
  if (digits.length < 8 || digits.length > E164_MAX_DIGITS) return '';
  return `+${digits}`;
}

/** Meta Cloud API wants the number as bare digits (country code, no '+'). */
export function metaDigitsFromE164(e164: string): string {
  return e164.startsWith('+') ? e164.slice(1) : e164.replace(/\D/g, '');
}

/** Extracts the whatsapp recipient's normalized E.164 or '' when invalid. */
export function recipientPhoneE164(recipient: SendNotificationRequest['recipient']): string {
  if (!recipient || !('phone_e164' in recipient)) return '';
  const raw = (recipient as WhatsappRecipient).phone_e164 ?? '';
  // Accept either a pre-normalized +E164 or sloppy human input; same rules.
  return normalizePhoneE164(raw);
}

/* ------------------------------ attachments ------------------------------- */

export const MAX_ATTACHMENT_DECODED_BYTES = 20 * 1024 * 1024; // 20 MB decoded
// base64 inflates by ~4/3 and may contain newlines we ignore for the bound.
export const MAX_ATTACHMENT_BASE64_CHARS = Math.ceil((MAX_ATTACHMENT_DECODED_BYTES * 4) / 3);
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function isValidBase64(contentBase64: string): boolean {
  const compact = contentBase64.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 4 !== 0) return false;
  return BASE64_RE.test(compact);
}

export function decodedSizeBytes(contentBase64: string): number {
  const compact = contentBase64.replace(/\s+/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

/** Returns an error message when the attachment cannot be sent, else ''. */
export function attachmentProblem(attachment?: CommAttachment): string {
  if (!attachment) return '';
  const filename = attachment.filename?.trim() ?? '';
  if (!filename) return 'attachment.filename is required.';
  if (!isValidBase64(attachment.content_base64 ?? '')) {
    return `attachment.content_base64 for "${filename}" is not valid base64.`;
  }
  if (decodedSizeBytes(attachment.content_base64) > MAX_ATTACHMENT_DECODED_BYTES) {
    return (
      `attachment "${filename}" decodes to more than ` +
      `${MAX_ATTACHMENT_DECODED_BYTES} bytes (limit exceeded).`
    );
  }
  return '';
}

/* ---------------------------- payload builders ----------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_RE.test(value.trim()) && value.length <= 320;
}

/** Resend /emails/send REST body. Attachment content = raw base64 string. */
export function buildResendPayload(args: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  attachment?: CommAttachment;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    from: args.from,
    to: args.to.map((t) => t.trim()),
    subject: args.subject,
  };
  if (args.cc && args.cc.length > 0) payload.cc = args.cc.map((t) => t.trim());
  if (args.bcc && args.bcc.length > 0) payload.bcc = args.bcc.map((t) => t.trim());
  if (args.html) payload.html = args.html;
  if (args.text) payload.text = args.text;
  if (args.attachment) {
    payload.attachments = [
      {
        filename: args.attachment.filename.trim(),
        content: args.attachment.content_base64.replace(/\s+/g, ''),
      },
    ];
  }
  return payload;
}

/** Meta Cloud API messages endpoint for a given phone-number id. */
export function buildMetaMessagesUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
}

/** Meta media-upload endpoint used before sending base64 documents. */
export function buildMetaMediaUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/v21.0/${phoneNumberId}/media`;
}

export type MetaMessageBody = Record<string, unknown>;

export function buildMetaTextMessage(toDigits: string, text: string): MetaMessageBody {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toDigits,
    type: 'text',
    text: { preview_url: false, body: text },
  };
}

export function buildMetaTemplateMessage(
  toDigits: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
): MetaMessageBody {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toDigits,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components:
        bodyParams.length > 0
          ? [
              {
                type: 'body',
                parameters: bodyParams.map((text) => ({ type: 'text', text })),
              },
            ]
          : [],
    },
  };
}

export function buildMetaDocumentMessage(
  toDigits: string,
  doc: { mediaId: string; filename: string; caption?: string },
): MetaMessageBody {
  const document: Record<string, unknown> = { id: doc.mediaId };
  document.filename = doc.filename.trim();
  if (doc.caption) document.caption = doc.caption;
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toDigits,
    type: 'document',
    document,
  };
}

/* ------------------------------- validation ------------------------------- */

export type ValidationResult = { ok: true } | { ok: false; message: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDEMPOTENCY_KEY_CHARS = 200;
const MAX_BODY_CHARS = 200_000;

function hasEmailKeys(rec: Record<string, unknown>): boolean {
  return 'to' in rec;
}

/**
 * Channel-aware request validation shared by the edge function. Returns the
 * first problem found (deterministic order) or ok.
 */
export function validateSendRequest(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'Body must be a JSON object.' };
  }
  const b = body as Partial<SendNotificationRequest> & Record<string, unknown>;

  if (typeof b.business_id !== 'string' || !UUID_RE.test(b.business_id)) {
    return { ok: false, message: 'business_id must be a UUID.' };
  }
  if (b.channel !== 'email' && b.channel !== 'whatsapp') {
    return { ok: false, message: "channel must be 'email' or 'whatsapp'." };
  }
  if (typeof b.recipient !== 'object' || b.recipient === null) {
    return { ok: false, message: 'recipient object is required.' };
  }
  const rec = b.recipient as Record<string, unknown>;

  if (b.channel === 'email') {
    if (!hasEmailKeys(rec)) {
      return { ok: false, message: 'email recipient requires { to, cc?, bcc? }.' };
    }
    const toList = Array.isArray(rec.to) ? rec.to : [rec.to];
    if (!toList.every(isPlausibleEmail)) {
      return { ok: false, message: 'recipient.to must be valid email address(es).' };
    }
    const ccArr = Array.isArray(rec.cc) ? rec.cc : [];
    const bccArr = Array.isArray(rec.bcc) ? rec.bcc : [];
    if (![...ccArr, ...bccArr].every(isPlausibleEmail)) {
      return { ok: false, message: 'recipient.cc/bcc must contain valid email addresses.' };
    }
    if (!b.template_key && !b.subject) {
      return { ok: false, message: 'subject is required when no template_key is given.' };
    }
    if (!b.template_key && !b.body_html && !b.body_text) {
      return { ok: false, message: 'body_html or body_text is required when no template_key is given.' };
    }
  } else {
    if (!('phone_e164' in rec)) {
      return { ok: false, message: 'whatsapp recipient requires { phone_e164 }.' };
    }
    if (!recipientPhoneE164(b.recipient)) {
      return { ok: false, message: 'recipient.phone_e164 must be a usable phone number.' };
    }
    if (!b.template_key && !b.body_text && !b.body_html) {
      return { ok: false, message: 'body_text is required when no template_key is given.' };
    }
  }

  if (b.template_key !== undefined && (typeof b.template_key !== 'string' || b.template_key.trim().length === 0)) {
    return { ok: false, message: 'template_key must be a non-empty string when present.' };
  }
  for (const [field, value] of [['body_html', b.body_html], ['body_text', b.body_text]] as const) {
    if (value !== undefined && typeof value !== 'string') {
      return { ok: false, message: `${field} must be a string.` };
    }
    if (typeof value === 'string' && value.length > MAX_BODY_CHARS) {
      return { ok: false, message: `${field} exceeds ${MAX_BODY_CHARS} characters.` };
    }
  }
  if (b.idempotency_key !== undefined) {
    if (typeof b.idempotency_key !== 'string' || b.idempotency_key.length > MAX_IDEMPOTENCY_KEY_CHARS) {
      return { ok: false, message: `idempotency_key must be a string of at most ${MAX_IDEMPOTENCY_KEY_CHARS} chars.` };
    }
  }
  const attProblem = attachmentProblem(b.attachment);
  if (attProblem) return { ok: false, message: attProblem };

  if (b.doc_type !== undefined && typeof b.doc_type !== 'string') {
    return { ok: false, message: 'doc_type must be a string.' };
  }
  if (b.doc_id !== undefined && (typeof b.doc_id !== 'string' || !UUID_RE.test(b.doc_id))) {
    return { ok: false, message: 'doc_id must be a UUID when present.' };
  }
  return { ok: true };
}
