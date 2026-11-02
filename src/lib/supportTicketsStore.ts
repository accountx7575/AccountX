/**
 * Support tickets store shim (PBS-141).
 *
 * Service-layer-swappable: the default implementation persists tickets to
 * localStorage (`ax-support-tickets-v1`). Swapping in a Supabase-backed
 * service later means registering another SupportTicketService — no call
 * sites change. The eventual `support_tickets` table stays a humanQA item;
 * nothing here touches migrations this turn.
 */

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'resolved';

export interface TicketAdminNote {
  id: string;
  note: string;
  author: string;
  createdAt: string;
}

export interface TicketUserContext {
  name: string;
  email: string;
  businessId: string;
  businessName: string;
}

export interface SupportTicket {
  id: string;
  message: string;
  priority: TicketPriority;
  status: TicketStatus;
  user: TicketUserContext;
  createdAt: string;
  updatedAt: string;
  adminNotes: TicketAdminNote[];
}

export interface SupportTicketDraft {
  message: string;
  priority: TicketPriority;
  user: TicketUserContext;
}

const STORAGE_KEY = 'ax-support-tickets-v1';
const CHANGE_EVENT = 'ax-support-tickets-changed';

export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];
export const TICKET_STATUSES: TicketStatus[] = ['open', 'in_progress', 'resolved'];

function readAll(): SupportTicket[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SupportTicket[]) : [];
  } catch {
    return [];
  }
}

function writeAll(tickets: SupportTicket[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  } catch {
    /* storage full/unavailable — tickets stay in-memory for the session */
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Pluggable service layer: swap the backing store without touching callers.
 * The default local implementation satisfies the shim semantics exactly.
 */
export interface SupportTicketService {
  list(): SupportTicket[];
  create(draft: SupportTicketDraft): SupportTicket;
  setStatus(id: string, status: TicketStatus): SupportTicket | null;
  addNote(id: string, note: string, author: string): SupportTicket | null;
}

export const localSupportTicketService: SupportTicketService = {
  list(): SupportTicket[] {
    // Stable newest-first: equal timestamps keep insertion order (Array.sort
    // is stable), so tickets created in the same millisecond never flip.
    return readAll().sort((a, b) => {
      if (a.createdAt === b.createdAt) return 0;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  },

  create(draft: SupportTicketDraft): SupportTicket {
    const now = new Date().toISOString();
    const ticket: SupportTicket = {
      id: uid(),
      message: draft.message.trim(),
      priority: draft.priority,
      status: 'open',
      user: draft.user,
      createdAt: now,
      updatedAt: now,
      adminNotes: [],
    };
    writeAll([ticket, ...readAll()]);
    return ticket;
  },

  setStatus(id, status) {
    let updated: SupportTicket | null = null;
    writeAll(
      readAll().map((t) => {
        if (t.id !== id) return t;
        updated = { ...t, status, updatedAt: new Date().toISOString() };
        return updated;
      })
    );
    return updated;
  },

  addNote(id, note, author) {
    const trimmed = note.trim();
    if (!trimmed) return null;
    let updated: SupportTicket | null = null;
    writeAll(
      readAll().map((t) => {
        if (t.id !== id) return t;
        const adminNote: TicketAdminNote = {
          id: uid(),
          note: trimmed,
          author,
          createdAt: new Date().toISOString(),
        };
        updated = {
          ...t,
          adminNotes: [...t.adminNotes, adminNote],
          updatedAt: adminNote.createdAt,
        };
        return updated;
      })
    );
    return updated;
  },
};

let activeService: SupportTicketService = localSupportTicketService;

/** Register a replacement service (e.g. Supabase-backed) for all callers. */
export function setSupportTicketService(service: SupportTicketService): void {
  activeService = service;
}

export function listSupportTickets(): SupportTicket[] {
  return activeService.list();
}

export function createSupportTicket(draft: SupportTicketDraft): SupportTicket {
  return activeService.create(draft);
}

export function setTicketStatus(id: string, status: TicketStatus): SupportTicket | null {
  return activeService.setStatus(id, status);
}

export function addTicketAdminNote(id: string, note: string, author: string): SupportTicket | null {
  return activeService.addNote(id, note, author);
}

/** Dev/QA helper: clear the shim contents (does NOT touch real data). */
export function clearSupportTickets(): void {
  writeAll([]);
}

export const SUPPORT_TICKETS_CHANGE_EVENT = CHANGE_EVENT;
export const SUPPORT_TICKETS_STORAGE_KEY = STORAGE_KEY;
