import type { AiMode } from '@/lib/ai/client';

export type SuggestedPrompt = {
  id: string;
  label: string;
  question: string;
  mode?: AiMode;
  reportId?: string;
};

export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    id: 'business-health',
    label: 'Business health check',
    question: 'How is my business doing?',
    mode: 'summary',
  },
  {
    id: 'total-sales-month',
    label: 'Total sales this month',
    question: 'What were my total sales this month?',
    mode: 'ask',
  },
  {
    id: 'top-debtors',
    label: 'Top debtors',
    question: 'Who are my top 5 debtors and how much does each one owe right now?',
    mode: 'ask',
  },
  {
    id: 'overdue-customers',
    label: 'Overdue customers',
    question: 'Which customers have overdue invoices and how much is overdue for each?',
    mode: 'ask',
  },
  {
    id: 'low-stock',
    label: 'Low stock alerts',
    question: 'Which products are at or below their minimum stock level?',
    mode: 'ask',
  },
  {
    id: 'profit-explanation',
    label: 'Explain my profit',
    question:
      'Explain what drove my profit or loss this financial year, based on my Profit & Loss statement.',
    mode: 'report',
    reportId: 'profit-loss',
  },
  {
    id: 'gst-position',
    label: 'GST position summary',
    question: 'Summarise my GST position for the current period.',
    mode: 'report',
    reportId: 'gst-summary',
  },
  {
    id: 'identify-unusual-transactions',
    label: 'Unusual transactions',
    question:
      'Looking at my recent day-book activity (sales, purchases, expenses, payments), which entries look unusual - e.g. amounts far outside the typical range for their type, duplicate-looking pairs on close dates, or expense spikes in a single category? These are heuristic flags, not proof of errors; list the top outliers with the reason each was flagged.',
    mode: 'ask',
  },
  {
    id: 'suggest-follow-up-actions',
    label: 'Suggest follow-up actions',
    question:
      'Based on my current business snapshot, suggest the most useful follow-up actions this week - e.g. which overdue customer invoices to chase first, which supplier bills are closest to due, and which low-stock products to reorder. Rank them by urgency and keep it practical.',
    mode: 'ask',
  },
];

export function getSuggestedPrompt(id: string): SuggestedPrompt | undefined {
  return SUGGESTED_PROMPTS.find((p) => p.id === id);
}
