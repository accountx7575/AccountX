import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { askAiAssistant, type AiResponse, type AiMode } from '@/lib/ai/client';

export type AiAssistantStatus = 'idle' | 'loading' | 'ready' | 'error';

type AskOptions = {
  mode?: AiMode;
  reportId?: string;
};

export function useAiAssistant() {
  const { activeBusiness } = useAuth();
  const [status, setStatus] = useState<AiAssistantStatus>('idle');
  const [result, setResult] = useState<AiResponse | null>(null);
  const [question, setQuestion] = useState('');
  const seqRef = useRef(0);

  const ask = useCallback(
    async (q: string, opts?: AskOptions): Promise<void> => {
      if (!activeBusiness || !q.trim()) return;
      const seq = ++seqRef.current;
      setQuestion(q);
      setStatus('loading');
      const res = await askAiAssistant({
        businessId: activeBusiness.id,
        question: q,
        mode: opts?.mode,
        reportId: opts?.reportId,
      });
      if (seq !== seqRef.current) return;
      setResult(res);
      setStatus(res.ok ? 'ready' : 'error');
    },
    [activeBusiness]
  );

  const reset = useCallback(() => {
    seqRef.current += 1;
    setStatus('idle');
    setResult(null);
    setQuestion('');
  }, []);

  return { status, result, question, ask, reset, ready: !!activeBusiness };
}
