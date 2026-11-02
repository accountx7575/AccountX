import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ChevronDown, AlertCircle, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAiAssistant } from '@/hooks/useAiAssistant';
import { SUGGESTED_PROMPTS } from '@/lib/ai/prompts';
import { cn } from '@/lib/utils';

const QUICK_PROMPTS = ['business-health', 'total-sales-month', 'top-debtors'];

export function DashboardAssistant() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { status, result, question, ask, ready } = useAiAssistant();

  if (!ready) return null;

  const quick = SUGGESTED_PROMPTS.filter((p) => QUICK_PROMPTS.includes(p.id));
  const defaultPrompt = quick[0];

  return (
    <section className="card p-5 mb-6 print:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 text-left group"
      >
        <span className="rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 p-2.5 text-white shadow-md shadow-indigo-500/25 shrink-0 transition-transform duration-150 group-hover:scale-105">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-secondary-900 dark:text-secondary-100 leading-tight">
            Ask AccountX AI
          </span>
          <span className="block text-[11px] text-secondary-400 mt-0.5">
            Accounting intelligence grounded in your real books — read-only
          </span>
        </span>
        <button
          type="button"
          title="Open full assistant"
          aria-label="Open full assistant"
          onClick={(e) => {
            e.stopPropagation();
            navigate('/app/ai');
          }}
          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-secondary-200 dark:border-secondary-700 text-secondary-400 hover:text-primary-600 hover:border-primary-400 transition-colors"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <Button
          size="sm"
          loading={status === 'loading' && open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
            ask(defaultPrompt.question, { mode: defaultPrompt.mode });
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          How is my business doing?
        </Button>
        <ChevronDown className={cn('h-4 w-4 text-secondary-400 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-secondary-100 dark:border-secondary-800 space-y-4 animate-fade-up">
          {status === 'loading' && (
            <div className="flex items-center gap-1.5 px-1 py-2" aria-busy="true" aria-label="Assistant is thinking">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full bg-primary-400/70 animate-bounce"
                  style={{ animationDelay: `${i * 140}ms` }}
                />
              ))}
              <span className="ml-2 text-xs text-secondary-400">Thinking through your books…</span>
            </div>
          )}

          {status === 'ready' && result?.ok && (
            <div>
              {question && (
                <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-2 truncate">
                  <span className="font-medium text-secondary-600 dark:text-secondary-300">Q:</span> {question}
                </p>
              )}
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="info">AI-generated insight</Badge>
                {result.provider && (
                  <span className="text-[10px] text-secondary-400 figure truncate">
                    {result.provider}
                    {result.model ? ` · ${result.model}` : ''}
                  </span>
                )}
              </div>
              <p className="text-sm text-secondary-700 dark:text-secondary-300 whitespace-pre-wrap leading-relaxed">
                {result.answer}
              </p>
              {result.sources.length > 0 && (
                <p className="mt-2.5 pt-2 border-t border-secondary-100 dark:border-secondary-800 text-[11px] text-secondary-400">
                  Sources: {result.sources.map((s) => s.name).join(', ')}
                </p>
              )}
            </div>
          )}

          {status === 'error' && result && !result.ok && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50/60 dark:bg-warning-900/20 p-3">
              <AlertCircle className="h-4 w-4 text-warning-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-secondary-800 dark:text-secondary-200">{result.message}</p>
                {result.code === 'AI_NOT_CONFIGURED' && (
                  <p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">
                    An admin needs to set the AI provider keys on the server before the assistant can answer.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {quick.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={status === 'loading'}
                onClick={() => ask(p.question, { mode: p.mode })}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  'border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300',
                  'hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-300',
                  status === 'loading' && 'opacity-50 cursor-not-allowed'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
