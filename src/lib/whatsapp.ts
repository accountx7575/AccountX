export type WhatsAppBankDetails = {
  name?: string | null;
  ifsc?: string | null;
  upi?: string | null;
};

export type WhatsAppShareInput = {
  partyName: string;
  docNumber: string;
  dateDDMMYYYY: string;
  amountInr: string;
  bank?: WhatsAppBankDetails;
  partyPhone?: string | null;
};

const clean = (value: string | null | undefined): string => (value ?? '').trim();

export function buildWhatsAppText(input: WhatsAppShareInput): string {
  const base =
    `Dear ${clean(input.partyName)}, please find attached document ${clean(input.docNumber)}` +
    ` dated ${clean(input.dateDDMMYYYY)} for ${clean(input.amountInr)}.`;
  const parts: string[] = [];
  const name = clean(input.bank?.name);
  const ifsc = clean(input.bank?.ifsc);
  const upi = clean(input.bank?.upi);
  if (name) parts.push(`Bank: ${name}`);
  if (ifsc) parts.push(`IFSC: ${ifsc}`);
  if (upi) parts.push(`UPI: ${upi}`);
  return parts.length > 0 ? `${base} ${parts.join(', ')}.` : base;
}

export function buildWhatsAppLink(input: WhatsAppShareInput): string {
  const params = new URLSearchParams({ text: buildWhatsAppText(input) });
  const digits = clean(input.partyPhone).replace(/\D/g, '');
  const target = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
  return `${target}?${params.toString()}`;
}

export function openWhatsAppShare(input: WhatsAppShareInput): boolean {
  return typeof window !== 'undefined' && !!window.open(buildWhatsAppLink(input), '_blank', 'noopener,noreferrer');
}
