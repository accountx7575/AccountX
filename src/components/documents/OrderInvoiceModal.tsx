import React, { useState } from 'react';
import { X, Printer, FileDown, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  UniversalDocumentTemplate,
  type UniversalDocumentData,
  printElementInIframe,
  getDocumentTitles,
} from './UniversalDocumentTemplate';
import { captureElementToPdf } from '@/lib/pdfCapture';

export interface OrderInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  data: UniversalDocumentData | null;
  title?: string;
}

export const OrderInvoiceModal: React.FC<OrderInvoiceModalProps> = ({
  open,
  onClose,
  data,
  title,
}) => {
  const [downloading, setDownloading] = useState(false);

  if (!open || !data) return null;

  const docTitles = getDocumentTitles(data.documentType);
  const displayTitle = title || `${docTitles.header} - ${data.documentNumber}`;

  const handlePrint = () => {
    printElementInIframe('order-invoice-printable-container', data.documentNumber);
  };

  const handleDownload = async () => {
    const el = document.getElementById('order-invoice-printable-container');
    if (!el) return;
    setDownloading(true);
    try {
      await captureElementToPdf(el, `${data.documentNumber}.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 md:p-6 print:hidden"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-5xl bg-slate-100 dark:bg-zinc-950 rounded-2xl shadow-2xl flex flex-col max-h-[94vh] overflow-hidden border border-slate-200 dark:border-zinc-800">
        {/* Modal Toolbar Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                {displayTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                GST Compliant Standard Format
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handlePrint}
              className="flex items-center gap-1.5 font-medium"
              title="Print document in clean A4 format"
            >
              <Printer className="h-4 w-4 text-violet-700" />
              <span>Print A4</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownload}
              loading={downloading}
              className="flex items-center gap-1.5 font-medium"
              title="Save document as high-resolution PDF"
            >
              <FileDown className="h-4 w-4 text-emerald-600" />
              <span>Save PDF</span>
            </Button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Document Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex justify-center bg-slate-100/70 dark:bg-zinc-950/70">
          <div className="w-full max-w-[210mm]">
            <UniversalDocumentTemplate
              data={data}
              id="order-invoice-printable-container"
              className="shadow-xl"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
