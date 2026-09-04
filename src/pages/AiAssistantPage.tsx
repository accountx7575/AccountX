import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, Send, AlertCircle, Building2, ShieldQuestion, RotateCcw, CalendarRange, TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { askAiAssistant, AI_ERROR_COPY, type AiResponse, type AiMode } from '@/lib/ai/client';
import { AnswerKeyFigures } from '@/components/ai/AnswerKeyFigures';
import { SUGGESTED_PROMPTS } from '@/lib/ai/prompts';
import { cn } from '@/lib/utils';
import { PageMotion } from '@/lib/motion';

type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; response: AiResponse; question: string };

/** Honest deep-links only: keyword -> a real module route. Navigation aid, not content. */
const MODULE_LINKS: Array<{ match: RegExp; to: string; label: string }> = [
  { match: /receivable|debtor|collect\b|overdue/i, to: '/app/receivables', label: 'Receivables' },
  { match: /payable|creditor|supplier due/i, to: '/app/payables', label: 'Payables' },
  { match: /\bsales?\b|revenue|turnover|invoice/i, to: '/app/sales-invoices', label: 'Sales Invoices' },
  { match: /purchase|\bbills?\b/i, to: '/app/purchase-bills', label: 'Purchase Bills' },
  { match: /stock|inventory|product/i, to: '/app/stock', label: 'Stock' },
  { match: /\bgst\b|\btax\b/i, to: '/app/gst', label: 'GST' },
  { match: /cash|\bbank\b|payment/i, to: '/app/cash-bank', label: 'Cash & Bank' },
  { match: /profit|loss|p&l|balance sheet/i, to: '/app/reports/profit-loss', label: 'P&L Report' },
];

function relatedModules(text: string): Array<{ to: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ to: string; label: string }> = [];
  for (const m of MODULE_LINKS) {
    if (m.match.test(text) && !seen.has(m.to)) {
      seen.add(m.to);
      out.push({ to: m.to, label: m.label });
      if (out.length === 3) break;
    }
  }
  return out;
}

function TypingIndicator() {
  return (
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
  );
}

function AnswerSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[92, 78, 60].map((w, i) => (
        <div
          key={i}
          className="h-3 rounded bg-secondary-100 dark:bg-secondary-700/70 animate-pulse"
          style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

function KeyFigureCard({ label, value, delta, countLine, actionLabel, actionTo, periodLabel }: {
  label: string;
  value: string;
  delta?: { pct: number; dir: 'up' | 'down' | 'flat' } | null;
  countLine?: string | null;
  actionLabel?: string;
  actionTo?: string;
  periodLabel?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-secondary-100 dark:border-secondary-800 bg-secondary-50/60 dark:bg-secondary-800/40 p-4">
      <p className="text-caption font-medium uppercase tracking-[0.06em] text-secondary-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-2 flex-wrap">
        <span className="font-sans font-semibold text-2xl tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
          {value}
        </span>
        {delta && delta.dir !== 'flat' && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
            delta.dir === 'up'
              ? 'bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-400'
              : 'bg-error-50 text-error-600 dark:bg-error-900/30 dark:text-error-400'
          )}>
            {delta.dir === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span>{delta.pct > 0 ? '+' : ''}{delta.pct}%</span>
          </span>
        )}
        {delta && delta.dir === 'flat' && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-400">
            <Minus className="h-3 w-3" /> 0%
          </span>
        )}
      </div>
      {countLine && <p className="mt-1 text-[11px] text-secondary-400">{countLine}</p>}
      {periodLabel && <p className="mt-0.5 text-[10px] text-secondary-400">{periodLabel}</p>}
      {actionLabel && actionTo && (
        <Button variant="secondary" size="sm" className="mt-2 shrink-0" onClick={() => navigate(actionTo)}>
          {actionLabel}
          <ExternalLink className="h-3.5 w-3.5 ml-1" />
        </Button>
      )}
    </div>
  );
}

function ErrorPanel({
  code,
  message,
  onRetry,
}: {
  code: keyof typeof AI_ERROR_COPY;
  message: string;
  onRetry?: () => void;
}) {
  const unconfigured = code === 'AI_NOT_CONFIGURED';
  return (
    <div className="rounded-xl border border-warning-300 dark:border-warning-700 bg-warning-50/60 dark:bg-warning-900/20 p-3.5">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="h-4 w-4 text-warning-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-secondary-800 dark:text-secondary-200">
            {unconfigured ? 'AI is not configured for this business yet.' : message || AI_ERROR_COPY[code]}
          </p>
          {(unconfigured || code === 'UPSTREAM_ERROR') && (
            <p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">Check AI configuration.</p>
          )}
          {unconfigured && (
            <p className="text-xs text-secondary-500 dark:text-secondary-400 mt-0.5">
              An admin needs to set the AI provider keys on the server before the assistant can answer.
            </p>
          )}
          {onRetry && !unconfigured && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SourcePeriodChip({ period }: { period?: string }) {
  if (!period) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-secondary-100 dark:bg-secondary-800 text-secondary-600 dark:text-secondary-300 border border-secondary-200 dark:border-secondary-700">
      <CalendarRange className="h-3 w-3" />
      {period}
    </span>
  );
}

export function AiAssistantPage() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pending]);

  const send = async (raw: string, opts?: { mode?: AiMode; reportId?: string }) => {
    const q = raw.trim();
    if (!q || !activeBusiness || pending) return;
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', text: q }]);
    setInput('');
    setPending(true);
    const response = await askAiAssistant({
      businessId: activeBusiness.id,
      question: q,
      mode: opts?.mode,
      reportId: opts?.reportId,
    });
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', response, question: q }]);
    setPending(false);
  };

  useEffect(() => {
    if (bootstrapped.current) return;
    const q = searchParams.get('q');
    if (q) {
      bootstrapped.current = true;
      setSearchParams({}, { replace: true });
      void send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastAnswerIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i;
    return -1;
  }, [messages]);

  const followUps = useMemo(() => {
    if (lastAnswerIdx < 0) return [];
    const asked = new Set(messages.map((m) => m.question.toLowerCase()));
    return SUGGESTED_PROMPTS.filter((p) => !asked.has(p.question.toLowerCase())).slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAnswerIdx]);

  const disabled = !activeBusiness;
  const showChips = messages.length === 0 && !pending;

  return (
    <PageMotion>
      <PageHeader
        title="AccountX AI"
        subtitle="Accounting intelligence grounded in your real books — read-only, always for your active business"
        meta={
          activeBusiness ? (
            <span className="badge bg-secondary-100 text-secondary-600 dark:bg-zinc-800 dark:text-zinc-300 border-transparent">
              <Building2 className="h-3 w-3 mr-1 inline" />
              {activeBusiness.name}
            </span>
          ) : undefined
        }
      />

      <div className="card flex flex-col h-[calc(100vh-13rem)] min-h-[28rem] overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-secondary-100 dark:border-secondary-800 bg-secondary-50/60 dark:bg-secondary-800/40 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-success-500 shrink-0" />
          <p className="text-xs text-secondary-500 dark:text-secondary-400 truncate">
            Context: <span className="font-medium text-secondary-700 dark:text-secondary-300">{activeBusiness ? activeBusiness.name : 'no business selected'}</span> · all answers come from this business's data only
          </p>
          {activeBusiness?.financial_year && (
            <SourcePeriodChip period={activeBusiness.financial_year} />
          )}
          <span className="text-[10px] uppercase tracking-wide text-secondary-400 ml-auto hidden sm:inline">Based on AccountX data</span>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
          {showChips && (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <span className="rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-3 text-white shadow-md shadow-indigo-500/25 mb-4">
                <Sparkles className="h-6 w-6" />
              </span>
              <h2 className="text-base font-semibold text-secondary-900 dark:text-secondary-100">Ask your books anything</h2>
              <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-1 mb-5 max-w-md">
                Sales, receivables, stock, GST — answered from live accounting data with sources cited.
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void send(p.question, { mode: p.mode, reportId: p.reportId })}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-300 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) =>
            msg.role === 'user' ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] sm:max-w-[70%] rounded-2xl rounded-br-md bg-indigo-600 text-white px-4 py-2.5 text-sm leading-relaxed shadow-sm">
                  {msg.text}
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[90%] sm:max-w-[80%] rounded-2xl rounded-bl-md border border-secondary-200/80 dark:border-secondary-700/80 bg-white dark:bg-secondary-800/60 px-4 py-3 shadow-sm w-fit min-w-[60%]">
                  {!msg.response.ok ? (
                    <ErrorPanel
                      code={msg.response.code}
                      message={msg.response.message}
                      onRetry={pending ? undefined : () => void send(msg.question)}
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="info">AI-generated insight</Badge>
                        {msg.response.provider && (
                          <span className="text-[10px] text-secondary-400 figure truncate">
                            {msg.response.provider}
                            {msg.response.model ? ` · ${msg.response.model}` : ''}
                          </span>
                        )}
                        <SourcePeriodChip period={msg.response.period} />
                      </div>
                      {pending && idx === messages.length - 1 ? (
                        <AnswerSkeleton />
                      ) : (
                        <>
                          <p className="text-sm text-secondary-700 dark:text-secondary-300 whitespace-pre-wrap leading-relaxed">
                            {msg.response.answer}
                          </p>
                          {activeBusiness && <AnswerKeyFigures businessId={activeBusiness.id} />}
                          {msg.response.keyFigures && msg.response.keyFigures.length > 0 && (
                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                              {msg.response.keyFigures.map((kf, kfi) => (
                                <KeyFigureCard
                                  key={kfi}
                                  label={kf.label}
                                  value={kf.value}
                                  delta={kf.delta ?? null}
                                  countLine={kf.countLine ?? null}
                                  actionLabel={kf.actionLabel}
                                  actionTo={kf.actionTo}
                                  periodLabel={kf.periodLabel}
                                />
                              ))}
                            </div>
                          )}
                          {relatedModules(msg.question + ' ' + msg.response.answer).length > 0 && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-secondary-400">Related module:</span>
                              {relatedModules(msg.question + ' ' + msg.response.answer).map((l) => (
                                <button
                                  key={l.to}
                                  type="button"
                                  onClick={() => navigate(l.to)}
                                  className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                                >
                                  View {l.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      {msg.response.sources.length > 0 && (
                        <p className="mt-2.5 pt-2 border-t border-secondary-100 dark:border-secondary-800 text-[11px] text-secondary-400">
                          Sources: {msg.response.sources.map((s) => s.name).join(', ')}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          )}

          {!showChips && followUps.length > 0 && !pending && (
            <div className="flex flex-wrap gap-2 pl-1">
              {followUps.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void send(p.question, { mode: p.mode, reportId: p.reportId })}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-[11px] font-medium border border-secondary-200 dark:border-secondary-700',
                    'text-secondary-500 dark:text-secondary-400 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-300 transition-colors'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {pending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-secondary-200/80 dark:border-secondary-700/80 bg-white dark:bg-secondary-800/60 px-3 py-2 shadow-sm">
                <TypingIndicator />
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>

        <form
          className="border-t border-secondary-100 dark:border-secondary-800 p-3 shrink-0"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={disabled ? 'Select a business to start asking' : 'Ask about sales, receivables, stock, GST…'}
              disabled={disabled || pending}
              aria-label="Ask AccountX AI"
            />
            <Button
              type="submit"
              disabled={disabled || pending || !input.trim()}
              loading={pending}
              className="shrink-0"
              aria-label="Send question"
            >
              {!pending && <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-secondary-400 flex items-center gap-1">
            <ShieldQuestion className="h-3 w-3" />
            Read-only analysis of real accounting data — verify critical figures against reports before acting.
          </p>
        </form>
      </div>
    </PageMotion>
  );
}