import { describe, it, expect, beforeEach } from 'vitest';
import {
  addTicketAdminNote,
  clearSupportTickets,
  createSupportTicket,
  listSupportTickets,
  setTicketStatus,
  type SupportTicketDraft,
} from '@/lib/supportTicketsStore';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const draft = (overrides: Partial<SupportTicketDraft> = {}): SupportTicketDraft => ({
  message: 'Invoice PDF download fails for GSTIN with special characters',
  priority: 'normal',
  user: {
    name: 'Aarav Sharma',
    email: 'aarav@example.in',
    businessId: 'biz-1',
    businessName: 'Sharma Traders',
  },
  ...overrides,
});

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  clearSupportTickets();
});

describe('supportTicketsStore — ticket lifecycle', () => {
  it('creates a ticket with open status and captured user context', () => {
    const ticket = createSupportTicket(draft());
    expect(ticket.status).toBe('open');
    expect(ticket.priority).toBe('normal');
    expect(ticket.user.email).toBe('aarav@example.in');
    expect(ticket.user.businessName).toBe('Sharma Traders');
    expect(ticket.adminNotes).toHaveLength(0);
  });

  it('lists created tickets newest first', () => {
    createSupportTicket(draft({ message: 'First issue reported by the user' }));
    createSupportTicket(draft({ message: 'Second issue reported by the user' }));
    const list = listSupportTickets();
    expect(list).toHaveLength(2);
    expect(list[0].message).toBe('Second issue reported by the user');
  });

  it('changes status across Open / In-Progress / Resolved', () => {
    const ticket = createSupportTicket(draft());
    expect(setTicketStatus(ticket.id, 'in_progress')!.status).toBe('in_progress');
    expect(setTicketStatus(ticket.id, 'resolved')!.status).toBe('resolved');
    expect(listSupportTickets()[0].status).toBe('resolved');
  });

  it('logs admin notes against a ticket', () => {
    const ticket = createSupportTicket(draft());
    const updated = addTicketAdminNote(ticket.id, 'Replied on WhatsApp, awaiting screenshots', 'Super Admin');
    expect(updated!.adminNotes).toHaveLength(1);
    expect(updated!.adminNotes[0].author).toBe('Super Admin');
    expect(updated!.adminNotes[0].note).toContain('WhatsApp');
  });

  it('ignores blank admin notes', () => {
    const ticket = createSupportTicket(draft());
    expect(addTicketAdminNote(ticket.id, '   ', 'Super Admin')).toBeNull();
    expect(listSupportTickets()[0].adminNotes).toHaveLength(0);
  });

  it('keeps priority values intact end to end', () => {
    const ticket = createSupportTicket(draft({ priority: 'urgent' }));
    expect(listSupportTickets()[0].priority).toBe('urgent');
    expect(ticket.priority).toBe('urgent');
  });
});
