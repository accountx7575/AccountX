import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  COMM_ERROR_COPY,
  type CommErrorCode,
  type CommResponse,
  type SendNotificationRequest,
} from './types';

export type {
  CommChannel,
  CommAttachment,
  CommErrorCode,
  CommResponse,
  EmailRecipient,
  SendNotificationRequest,
  WhatsappRecipient,
} from './types';
export { COMM_ERROR_COPY } from './types';
export {
  mergeTemplate,
  normalizePhoneE164,
  metaDigitsFromE164,
} from './helpers';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalize(raw: unknown): CommResponse {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    return { ok: false, code: 'UPSTREAM_ERROR', message: COMM_ERROR_COPY.UPSTREAM_ERROR };
  }
  if (raw.ok === false) {
    const code = (
      typeof raw.code === 'string' && raw.code in COMM_ERROR_COPY ? raw.code : 'UPSTREAM_ERROR'
    ) as CommErrorCode;
    return {
      ok: false,
      code,
      message:
        typeof raw.message === 'string' && raw.message.length > 0
          ? raw.message
          : COMM_ERROR_COPY[code],
    };
  }
  return {
    ok: true,
    notification_id: typeof raw.notification_id === 'string' ? raw.notification_id : null,
    status: 'sent',
    provider: typeof raw.provider === 'string' ? (raw.provider as 'resend') : 'resend',
    provider_message_id: typeof raw.provider_message_id === 'string' ? raw.provider_message_id : '',
    duplicate: raw.duplicate === true,
  };
}

/** Sends one notification through the send-notification edge function. */
export async function sendNotification(
  payload: SendNotificationRequest,
): Promise<CommResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('send-notification', { body: payload });
    if (error) {
      if (error instanceof FunctionsHttpError && error.context) {
        const contractBody: unknown = await error.context.json().catch(() => null);
        if (isRecord(contractBody) && typeof contractBody.ok === 'boolean') {
          return normalize(contractBody);
        }
      }
      return { ok: false, code: 'UPSTREAM_ERROR', message: COMM_ERROR_COPY.UPSTREAM_ERROR };
    }
    return normalize(data);
  } catch {
    return { ok: false, code: 'UPSTREAM_ERROR', message: COMM_ERROR_COPY.UPSTREAM_ERROR };
  }
}
