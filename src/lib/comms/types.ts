/**
 * AccountX communications layer - shared contract types (T96).
 * Mirrors the A1 AI sprint pattern: ONE frozen response/error shape consumed
 * by both the edge function (Deno side) and src/lib/comms/client.ts.
 *
 * Wire request (dispatch-frozen, snake_case):
 * {
 *   business_id, channel: 'email'|'whatsapp',
 *   template_key?, context?,
 *   recipient: {to, cc?, bcc?} | {phone_e164},
 *   subject?, body_html?, body_text?,
 *   attachment?: {filename, content_base64},
 *   doc_type?, doc_id?, idempotency_key?
 * }
 */
export type CommChannel = 'email' | 'whatsapp';

export type EmailRecipient = {
  to: string;
  cc?: string[];
  bcc?: string[];
};

export type WhatsappRecipient = {
  phone_e164: string;
};

export type CommAttachment = {
  filename: string;
  content_base64: string;
};

export type SendNotificationRequest = {
  business_id: string;
  channel: CommChannel;
  template_key?: string;
  /** Values merged into a notification_templates row's {{variables}}. */
  context?: Record<string, unknown>;
  recipient: EmailRecipient | WhatsappRecipient;
  subject?: string;
  body_html?: string;
  body_text?: string;
  attachment?: CommAttachment;
  doc_type?: string;
  doc_id?: string;
  idempotency_key?: string;
};

export type CommErrorCode =
  | 'COMM_NOT_CONFIGURED'
  | 'PROVIDER_NOT_LIVE'
  | 'FORBIDDEN'
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'TEMPLATE_NOT_FOUND'
  | 'UPSTREAM_ERROR';

/** Frozen failure body: { ok:false, code, message }. */
export type CommFailure = {
  ok: false;
  code: CommErrorCode;
  message: string;
};

/** Frozen success body. */
export type CommSuccess = {
  ok: true;
  /** notification_logs.id when logging was possible. */
  notification_id: string | null;
  status: 'sent';
  provider: 'resend' | 'smtp' | 'meta_cloud';
  provider_message_id: string;
  /** True when an idempotency_key matched an already-sent notification. */
  duplicate?: boolean;
};

export type CommResponse = CommSuccess | CommFailure;

export const COMM_ERROR_COPY: Record<CommErrorCode, string> = {
  COMM_NOT_CONFIGURED: 'Notifications are not configured yet.',
  PROVIDER_NOT_LIVE: 'The selected provider backend is documented-stub only and was not sent.',
  FORBIDDEN: 'You do not have access to notifications for this business.',
  BAD_REQUEST: 'The notification request could not be processed.',
  VALIDATION_ERROR: 'The notification request failed validation.',
  TEMPLATE_NOT_FOUND: 'The requested notification template does not exist for this business.',
  UPSTREAM_ERROR: 'The notification service is unavailable right now. Please try again later.',
};
