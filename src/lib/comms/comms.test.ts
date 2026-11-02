import { describe, it, expect } from 'vitest';
import {
  mergeTemplate,
  normalizePhoneE164,
  metaDigitsFromE164,
  recipientPhoneE164,
  isValidBase64,
  decodedSizeBytes,
  attachmentProblem,
  buildResendPayload,
  buildMetaMessagesUrl,
  buildMetaTextMessage,
  buildMetaTemplateMessage,
  buildMetaDocumentMessage,
  validateSendRequest,
  MAX_ATTACHMENT_DECODED_BYTES,
} from '@/lib/comms/helpers';

describe('mergeTemplate', () => {
  it('replaces simple and repeated variables', () => {
    expect(mergeTemplate('Hi {{name}}, invoice {{doc}} for {{name}}.', { name: 'Sharma', doc: 'INV/1' })).toBe(
      'Hi Sharma, invoice INV/1 for Sharma.'
    );
  });

  it('tolerates whitespace inside braces', () => {
    expect(mergeTemplate('Dear {{ name }}', { name: 'A' })).toBe('Dear A');
    expect(mergeTemplate('Dear {{\tname\t}}', { name: 'A' })).toBe('Dear A');
  });

  it('leaves unknown placeholders verbatim (honest, never silent)', () => {
    expect(mergeTemplate('Hi {{name}} {{missing}}', { name: 'A' })).toBe('Hi A {{missing}}');
  });

  it('stringifies non-string values and blanks null/undefined', () => {
    expect(mergeTemplate('{{n}} {{zero}} {{nil}}', { n: 42, zero: 0, nil: null })).toBe('42 0 ');
  });
});

describe('normalizePhoneE164', () => {
  it('keeps an explicit +E164 and strips formatting', () => {
    expect(normalizePhoneE164('+91 98765-43210')).toBe('+919876543210');
  });

  it('treats a bare 10-digit number as India (+91)', () => {
    expect(normalizePhoneE164('9876543210')).toBe('+919876543210');
    expect(normalizePhoneE164('(98) 76543-210')).toBe('+919876543210');
  });

  it('strips a 00 international prefix', () => {
    expect(normalizePhoneE164('00919876543210')).toBe('+919876543210');
  });

  it('honours a custom default country code', () => {
    expect(normalizePhoneE164('5551234567', '1')).toBe('+15551234567');
  });

  it('returns empty string for unusable input', () => {
    expect(normalizePhoneE164('')).toBe('');
    expect(normalizePhoneE164('   ')).toBe('');
    expect(normalizePhoneE164('abc')).toBe('');
    expect(normalizePhoneE164('12345')).toBe('');
    expect(normalizePhoneE164('+12345678901234567890')).toBe('');
  });

  it('produces Meta digits (no plus)', () => {
    expect(metaDigitsFromE164('+919876543210')).toBe('919876543210');
    expect(metaDigitsFromE164(normalizePhoneE164('9876543210'))).toBe('919876543210');
  });

  it('recipientPhoneE164 normalizes sloppy payload values and rejects wrong shapes', () => {
    expect(recipientPhoneE164({ phone_e164: '+91 98765 43210' })).toBe('+919876543210');
    expect(recipientPhoneE164({ phone_e164: 'nope' })).toBe('');
    expect(recipientPhoneE164({ to: 'a@b.com' } as never)).toBe('');
  });
});

describe('attachment guards', () => {
  const pdfB64 = 'JVBERi0xLjQK'; // "%PDF-1.4\n"

  it('detects valid base64 and rejects broken padding/charset', () => {
    expect(isValidBase64(pdfB64)).toBe(true);
    expect(isValidBase64('abc')).toBe(false); // length % 4
    expect(isValidBase64('ab$cdef')).toBe(false);
    expect(isValidBase64('')).toBe(false);
  });

  it('computes decoded size with padding math', () => {
    expect(decodedSizeBytes('JVBERi0xLjQK')).toBe(9);
    expect(decodedSizeBytes('aGVsbG8=')).toBe(5); // "hello"
    expect(decodedSizeBytes('aGVsbG')).toBe(4); // unpadded "hell"
  });

  it('flags missing filename / bad base64 / oversize content', () => {
    expect(attachmentProblem({ filename: '', content_base64: pdfB64 })).toContain('filename');
    expect(attachmentProblem({ filename: 'x.pdf', content_base64: '!!!' })).toContain('base64');
    const bigLen = Math.ceil((MAX_ATTACHMENT_DECODED_BYTES * 4) / 3 / 4) * 4 + 4;
    const big = 'a'.repeat(bigLen);
    expect(isValidBase64(big)).toBe(true);
    expect(attachmentProblem({ filename: 'big.pdf', content_base64: big })).toContain('limit');
    expect(attachmentProblem(undefined)).toBe('');
    expect(attachmentProblem({ filename: 'ok.pdf', content_base64: pdfB64 })).toBe('');
  });
});

describe('buildResendPayload', () => {
  it('maps to/cc/bcc/subject/html/text onto the Resend REST shape', () => {
    const p = buildResendPayload({
      from: 'Acme <billing@acme.in>',
      to: [' a@b.com '],
      cc: ['c@d.com'],
      bcc: ['e@f.com'],
      subject: 'Invoice',
      html: '<b>Hi</b>',
      text: 'Hi',
    });
    expect(p).toEqual({
      from: 'Acme <billing@acme.in>',
      to: ['a@b.com'],
      cc: ['c@d.com'],
      bcc: ['e@f.com'],
      subject: 'Invoice',
      html: '<b>Hi</b>',
      text: 'Hi',
    });
  });

  it('attaches PDFs as base64 content entries and omits empty cc/bcc', () => {
    const p = buildResendPayload({
      from: 'f@x.com',
      to: ['a@b.com'],
      subject: 's',
      text: 't',
      attachment: { filename: 'inv.pdf', content_base64: 'JVBERi0x LjQK' },
    }) as Record<string, unknown>;
    expect(Array.isArray(p.attachments)).toBe(true);
    expect((p.attachments as { filename: string; content: string }[])[0]).toEqual({
      filename: 'inv.pdf',
      content: 'JVBERi0xLjQK',
    });
    expect(p.cc).toBeUndefined();
    expect(p.bcc).toBeUndefined();
  });
});

describe('meta cloud builders', () => {
  it('targets the v21.0 messages endpoint of the phone number id', () => {
    expect(buildMetaMessagesUrl('PNID123')).toBe('https://graph.facebook.com/v21.0/PNID123/messages');
  });

  it('shapes text messages', () => {
    expect(buildMetaTextMessage('919876543210', 'Hello')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'text',
      text: { preview_url: false, body: 'Hello' },
    });
  });

  it('shapes template messages with body parameters', () => {
    const body = buildMetaTemplateMessage('919876543210', 'invoice_issued', 'en', ['INV/1', '₹500']) as {
      template: { name: string; language: { code: string }; components: { type: string; parameters: unknown[] }[] };
    };
    expect(body.template.name).toBe('invoice_issued');
    expect(body.template.language).toEqual({ code: 'en' });
    expect(body.template.components[0].type).toBe('body');
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: 'INV/1' },
      { type: 'text', text: '₹500' },
    ]);
  });

  it('omits the body component when a template has no parameters', () => {
    const body = buildMetaTemplateMessage('919876543210', 'hello_world', 'en', []) as {
      template: { components: unknown[] };
    };
    expect(body.template.components).toEqual([]);
  });

  it('references uploaded media by id for document messages', () => {
    expect(
      buildMetaDocumentMessage('919876543210', { mediaId: 'MEDIA1', filename: 'inv.pdf', caption: 'Invoice' })
    ).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'document',
      document: { id: 'MEDIA1', filename: 'inv.pdf', caption: 'Invoice' },
    });
  });
});

describe('validateSendRequest', () => {
  const emailOk = {
    business_id: '00000000-0000-4000-8000-000000000001',
    channel: 'email',
    recipient: { to: 'a@b.com' },
    subject: 'S',
    body_text: 'T',
  };

  it('accepts a minimal email request', () => {
    expect(validateSendRequest(emailOk)).toEqual({ ok: true });
  });

  it('rejects malformed business_id / channel / missing recipient', () => {
    expect(validateSendRequest({ ...emailOk, business_id: 'nope' })).toMatchObject({ ok: false });
    expect(validateSendRequest({ ...emailOk, channel: 'sms' })).toMatchObject({ ok: false });
    expect(validateSendRequest({ ...emailOk, recipient: undefined })).toMatchObject({ ok: false });
  });

  it('requires subject and a body when no template_key is given (email)', () => {
    const noSubject = JSON.parse(JSON.stringify(emailOk));
    delete noSubject.subject;
    expect(validateSendRequest(noSubject)).toMatchObject({ ok: false });
    expect(validateSendRequest({ ...emailOk, template_key: 'invoice' })).toEqual({ ok: true });
  });

  it('validates cc/bcc addresses too', () => {
    expect(validateSendRequest({ ...emailOk, recipient: { to: 'a@b.com', cc: ['bad'] } })).toMatchObject({
      ok: false,
    });
  });

  it('requires phone_e164 shape on whatsapp channel', () => {
    const wa = {
      business_id: '00000000-0000-4000-8000-000000000001',
      channel: 'whatsapp',
      recipient: { phone_e164: '+919876543210' },
      body_text: 'Hello',
    };
    expect(validateSendRequest(wa)).toEqual({ ok: true });
    expect(validateSendRequest({ ...wa, recipient: { phone_e164: '12' } })).toMatchObject({ ok: false });
    expect(validateSendRequest({ ...wa, recipient: { to: 'a@b.com' } })).toMatchObject({ ok: false });
    expect(validateSendRequest({ ...wa, body_text: undefined })).toMatchObject({ ok: false });
  });

  it('enforces attachment limits surfaced as validation errors', () => {
    expect(
      validateSendRequest({ ...emailOk, attachment: { filename: 'x.pdf', content_base64: '!!!' } })
    ).toMatchObject({ ok: false });
  });

  it('caps idempotency_key length and requires UUID doc_id when present', () => {
    expect(
      validateSendRequest({ ...emailOk, idempotency_key: 'k'.repeat(201) })
    ).toMatchObject({ ok: false });
    expect(validateSendRequest({ ...emailOk, doc_id: 'not-a-uuid' })).toMatchObject({ ok: false });
    expect(
      validateSendRequest({ ...emailOk, doc_id: '00000000-0000-4000-8000-000000000009' })
    ).toEqual({ ok: true });
  });
});
