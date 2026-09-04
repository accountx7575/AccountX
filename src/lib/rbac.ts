import { useAuth } from '@/context/AuthContext';

/* ============================================================================
 * RBAC — client-side capability checks over business_members.role.
 * Mirrors migration 024 server policies (is_business_admin etc.). These are
 * UX gates only — the database remains the source of truth; every gated
 * action stays disabled-with-tooltip, never hidden-only.
 * ========================================================================== */

export type Role =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'accountant'
  | 'sales_staff'
  | 'purchase_staff'
  | 'inventory_staff'
  | 'viewer';

export const ALL_ROLES: Role[] = [
  'owner',
  'admin',
  'manager',
  'accountant',
  'sales_staff',
  'purchase_staff',
  'inventory_staff',
  'viewer',
];

export type Capability = 'settings.edit' | 'members.manage' | 'members.view' | 'data.export';

/** Server-aligned: settings update policy = is_business_admin (owner|admin). */
const CAPABILITIES: Record<Capability, Role[]> = {
  'settings.edit': ['owner', 'admin'],
  'members.manage': ['owner', 'admin'],
  'members.view': ALL_ROLES,
  'data.export': ['owner', 'admin', 'manager', 'accountant'],
};

export function can(role: string | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return (CAPABILITIES[capability] as string[]).includes(role);
}

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  accountant: 'Accountant',
  sales_staff: 'Sales Staff',
  purchase_staff: 'Purchase Staff',
  inventory_staff: 'Inventory Staff',
  viewer: 'Viewer',
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'No role';
  return ROLE_LABELS[role as Role] ?? role;
}

/** Honest-disable copy for tooltips on gated controls. */
export function capabilityTooltip(capability: Capability, role: string | null | undefined): string {
  if (can(role, capability)) return '';
  switch (capability) {
    case 'settings.edit':
    case 'members.manage':
      return `Requires owner or admin role (your role: ${roleLabel(role)})`;
    case 'data.export':
      return `Requires manager, accountant, admin or owner role (your role: ${roleLabel(role)})`;
    default:
      return 'Not permitted for your role';
  }
}

/** Convenience hook: can the active role perform this capability? */
export function useCan(capability: Capability): boolean {
  const { activeRole } = useAuth();
  return can(activeRole, capability);
}
