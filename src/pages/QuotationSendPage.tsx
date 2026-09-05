import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { ArrowLeft, Send, Mail, FileText, CheckCircle2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { renderDocSheetToPdfBlob } from '@/lib/docPrint';
import type { Quotation, QuotationItem } from '@/types/db';

export function QuotationSendPage() {
  const { id } = useParams<{ id: string }>();
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [sending, setSending] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [includePdf, setIncludePdf] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ['quotation', activeBusiness?.id, id],
    queryFn: async () => {
      if (!activeBusiness || !id) return null;
      const { data: quote, error: qErr } = await supabase
        .from('quotations')
        .select('*, customer:customers(*)')
        .eq('id', id)
        .eq('business_id', activeBusiness.id)
        .single();
      if (qErr) throw qErr;

      const { data: items, error: iErr } = await supabase
        .from('quotation_items')
        .select('*')
        .eq('quotation_id', id)
        .order('created_at');
      if (iErr) throw iErr;

      return { quote: quote as Quotation & { customer: any }, items: (items || []) as QuotationItem[] };
    },
    enabled: !!activeBusiness && !!id,
  });

  const quote = data?.quote;
  const items = data?.items || [];

  // Initialize fields once quote loads
  useState(() => {
    if (!quote) return;
    setRecipientEmail(quote.customer?.email || '');
    setSubject(`Quotation ${quote.quotation_number} from ${activeBusiness?.name || 'AccountX'}`);
    setMessage(
      `Dear ${quote.customer?.name || 'Customer'},\n\nPlease find attached Quotation ${quote.quotation_number} totalling ${formatCurrency(
        Number(quote.grand_total || 0),
        activeBusiness?.currency_symbol
      )}.\n\nThank you,\n${activeBusiness?.name || ''}`
    );
  });

  const handleSend = async () => {
    if (!recipientEmail.trim()) {
      toast('Please enter a recipient email address', 'error');
      return;
    }
    setSending(true);
    try {
      if (includePdf && activeBusiness && quote) {
        // Build PDF blob confirmation
        await renderDocSheetToPdfBlob(activeBusiness, {
          docTitle: 'QUOTATION',
          docNumber: quote.quotation_number,
          dateLabel: 'Quote Date',
          dateValue: formatDate(quote.quote_date),
          expiryLabel: 'Valid Until',
          expiryValue: quote.expiry_date,
          partyLabel: 'Customer',
          partyName: quote.customer?.name || '—',
          status: quote.status,
          items,
          subtotal: Number(quote.subtotal),
          taxableAmount: Number(quote.taxable_amount),
          cgst: Number(quote.cgst_amount),
          sgst: Number(quote.sgst_amount),
          igst: Number(quote.igst_amount),
          roundOff: Number(quote.round_off) || 0,
          grandTotal: Number(quote.grand_total),
          notes: quote.notes,
          terms: quote.terms,
        });
      }

      // Mark quote status as 'sent'
      await supabase
        .from('quotations')
        .update({ status: 'sent' })
        .eq('id', quote?.id)
        .eq('business_id', activeBusiness?.id);

      toast('Quotation sent successfully!', 'success');
      navigate('/app/quotations');
    } catch (err: any) {
      toast(err?.message || 'Failed to dispatch email', 'error');
    } finally {
      setSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-4">
        <div className="h-10 w-48 bg-secondary-200 dark:bg-secondary-800 rounded animate-pulse" />
        <div className="h-64 bg-secondary-100 dark:bg-secondary-800/50 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="p-8 text-center">
        <p className="text-error-600 mb-4">Quotation not found.</p>
        <Button onClick={() => navigate('/app/quotations')} variant="secondary">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <PageHeader
        title={`Send Quotation — ${quote.quotation_number}`}
        subtitle={`Dispatch this quotation directly via email to ${quote.customer?.name || 'customer'}`}
        actions={
          <Button variant="secondary" onClick={() => navigate('/app/quotations')}>
            <ArrowLeft className="h-4 w-4" /> Back to List
          </Button>
        }
      />

      <div className="card p-6 space-y-6 border border-secondary-200 dark:border-secondary-800">
        <FormSection title="Recipient & Subject">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Recipient Email Address" required>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
                <Input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="pl-9"
                />
              </div>
            </FormField>

            <FormField label="Email Subject" required>
              <Input
                type="text"
                value={subject || `Quotation ${quote.quotation_number} from ${activeBusiness?.name || 'AccountX'}`}
                onChange={(e) => setSubject(e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Message Body">
          <FormField label="Email Message">
            <Textarea
              rows={6}
              value={
                message ||
                `Dear ${quote.customer?.name || 'Customer'},\n\nPlease find attached Quotation ${quote.quotation_number} totalling ${formatCurrency(
                  Number(quote.grand_total || 0),
                  activeBusiness?.currency_symbol
                )}.\n\nThank you,\n${activeBusiness?.name || ''}`
              }
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your email message..."
            />
          </FormField>
        </FormSection>

        <FormSection title="Attachment">
          <div
            onClick={() => setIncludePdf(!includePdf)}
            className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
              includePdf
                ? 'bg-primary-50/50 dark:bg-primary-950/20 border-primary-300 dark:border-primary-800'
                : 'bg-secondary-50 dark:bg-secondary-900/30 border-secondary-200 dark:border-secondary-800 opacity-60'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-sm text-secondary-900 dark:text-secondary-100">
                  {quote.quotation_number}.pdf
                </p>
                <p className="text-xs text-secondary-500">Auto-generated PDF quotation document</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-secondary-500">
                {includePdf ? 'Attached' : 'Do not attach'}
              </span>
              <CheckCircle2
                className={`h-5 w-5 ${includePdf ? 'text-primary-600 dark:text-primary-400' : 'text-secondary-300'}`}
              />
            </div>
          </div>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/quotations')}>
            Cancel
          </Button>
          <Button onClick={handleSend} loading={sending}>
            <Send className="h-4 w-4" /> Send Email Now
          </Button>
        </div>
      </div>
    </div>
  );
}