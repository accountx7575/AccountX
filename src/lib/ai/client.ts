import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AiErrorCode, AiResponse, AiSource } from '@/types/ai';

// Shared response/error/source shapes live in @/types/ai (A1 frozen contract).
export type { AiErrorCode, AiSource, AiResponse } from '@/types/ai';

/** Client-only concern: which presentation mode the request targets. */
export type AiMode = 'ask' | 'report' | 'summary';

export const AI_ERROR_COPY: Record<AiErrorCode, string> = {
  AI_NOT_CONFIGURED: 'AI is not configured yet.',
  FORBIDDEN: 'You do not have access to the AI assistant for this business.',
  BAD_REQUEST: 'The assistant request could not be processed.',
  UPSTREAM_ERROR: 'The AI service is unavailable right now. Please try again later.',
};

type AiRequestPayload = {
  businessId: string;
  question: string;
  mode?: AiMode;
  reportId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalize(raw: unknown): AiResponse {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    return { ok: false, code: 'UPSTREAM_ERROR', message: AI_ERROR_COPY.UPSTREAM_ERROR };
  }
  if (raw.ok === false) {
    const code = (
      typeof raw.code === 'string' && raw.code in AI_ERROR_COPY ? raw.code : 'UPSTREAM_ERROR'
    ) as AiErrorCode;
    return {
      ok: false,
      code,
      message: typeof raw.message === 'string' && raw.message.length > 0 ? raw.message : AI_ERROR_COPY[code],
    };
  }
  if (typeof raw.answer !== 'string') {
    return { ok: false, code: 'UPSTREAM_ERROR', message: AI_ERROR_COPY.UPSTREAM_ERROR };
  }
  const sources = Array.isArray(raw.sources)
    ? raw.sources
        .filter(isRecord)
        .filter((s): s is { kind: string; name: string } => typeof s.name === 'string')
        // Kind passes through verbatim from our own backend; only a missing
        // value is defaulted (server always emits rpc|view|table).
        .map((s) => ({ kind: typeof s.kind === 'string' ? s.kind : 'rpc', name: s.name }) as AiSource)
    : [];
  return {
    ok: true,
    answer: raw.answer,
    sources,
    provider: typeof raw.provider === 'string' ? raw.provider : '',
    model: typeof raw.model === 'string' ? raw.model : '',
    period: typeof raw.period === 'string' ? raw.period : undefined,
    keyFigures: Array.isArray(raw.keyFigures) ? raw.keyFigures : undefined,
  };
}

export async function askAiAssistant(payload: AiRequestPayload): Promise<AiResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-assistant', { body: payload });
    if (error) {
      if (error instanceof FunctionsHttpError && error.context) {
        const contractBody: unknown = await error.context.json().catch(() => null);
        if (isRecord(contractBody) && typeof contractBody.ok === 'boolean') {
          return normalize(contractBody);
        }
      }
      return { ok: false, code: 'UPSTREAM_ERROR', message: AI_ERROR_COPY.UPSTREAM_ERROR };
    }
    return normalize(data);
  } catch {
    return { ok: false, code: 'UPSTREAM_ERROR', message: AI_ERROR_COPY.UPSTREAM_ERROR };
  }
}
