import { useMemo, useState } from 'react';
import { useAdminUsers, type DirectoryMember } from '@/hooks/useAdminUsers';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, FormField, Select } from '@/components/ui/Input';
import { Tooltip } from '@/components/ui/Tooltip';
import { ErrorState } from '@/components/ui/ErrorState';
import { capabilityTooltip, roleLabel } from '@/lib/rbac';
import { Users, UserPlus, UserMinus, ArrowLeftRight } from 'lucide-react';

const INVITE_ROLES = ['admin', 'accountant', 'viewer'] as const;
const ROLE_CHANGE_ROLES = ['admin', 'accountant', 'viewer'] as const;

function memberLabel(m: DirectoryMember): string {
  return m.full_name?.trim() || m.email || `member ${m.user_id.slice(0, 8)}`;
}

function memberStatus(m: DirectoryMember): { label: string; variant: 'primary' | 'info' | 'neutral' | 'error' } {
  if (m.is_active === false) return { label: 'Revoked', variant: 'error' };
  if (!m.joined_at && m.invited_at) return { label: 'Invite pending', variant: 'neutral' };
  return { label: 'Active', variant: 'info' };
}

export function TeamPanel() {
  const { user, activeBusiness, activeRole } = useAuth();
  const { toast } = useToast();
  const { members, loading, error, refresh, inviteMember, changeMemberRole, revokeMember, transferOwnership } = useAdminUsers(activeBusiness?.id);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<(typeof INVITE_ROLES)[number]>('accountant');
  const [inviting, setInviting] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<DirectoryMember | null>(null);
  const [revoking, setRevoking] = useState(false);

  const [transferTarget, setTransferTarget] = useState<DirectoryMember | null>(null);
  const [transferGuard, setTransferGuard] = useState('');
  const [transferring, setTransferring] = useState(false);

  const canManage = activeRole === 'owner' || activeRole === 'admin';
  const isOwner = activeRole === 'owner';

  function blockReason(m: DirectoryMember): string | null {
    if (!canManage) return capabilityTooltip('members.manage', activeRole);
    if (m.user_id === user?.id) return "You can't manage your own membership here";
    if (m.role === 'owner') return 'The business owner cannot be changed from this list';
    if (m.is_active === false) return 'This membership is revoked and cannot be modified';
    return null;
  }

  async function handleInvite() {
    const email = inviteEmail.trim();
    if (!email || !email.includes('@')) {
      toast('Enter a valid email address to invite', 'error');
      return;
    }
    setInviting(true);
    try {
      await inviteMember(email, inviteRole);
      toast(`Invite sent to ${email}`, 'success');
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('accountant');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send invite', 'error');
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(m: DirectoryMember) {
    setRevoking(true);
    try {
      await revokeMember(m.membership_id);
      toast(`${memberLabel(m)} no longer has access`, 'success');
      setRevokeTarget(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to revoke member', 'error');
    } finally {
      setRevoking(false);
    }
  }

  async function handleRoleChange(m: DirectoryMember, newRole: string) {
    try {
      await changeMemberRole(m.membership_id, newRole as 'admin' | 'accountant' | 'viewer');
      toast(`${memberLabel(m)} is now ${roleLabel(newRole)}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to change role', 'error');
      void refresh();
    }
  }

  async function handleTransfer(m: DirectoryMember) {
    setTransferring(true);
    try {
      await transferOwnership(m.membership_id);
      toast(`${memberLabel(m)} is now the owner`, 'success');
      setTransferTarget(null);
      setTransferGuard('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to transfer ownership', 'error');
    } finally {
      setTransferring(false);
    }
  }

  const columns = useMemo<DataTableColumn<DirectoryMember>[]>(() => [
    {
      key: 'member',
      label: 'Member',
      render: (m) => {
        const isYou = m.user_id === user?.id;
        return (
          <div className="flex items-center gap-3 min-w-0">
            <div className={
              m.role === 'owner'
                ? 'h-9 w-9 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center text-xs font-semibold text-amber-700 dark:text-amber-400 shrink-0'
                : 'h-9 w-9 rounded-full bg-secondary-200 dark:bg-secondary-700 flex items-center justify-center text-xs font-semibold text-secondary-600 dark:text-secondary-300 shrink-0'
            } aria-hidden="true">
              {m.role === 'owner' ? '★' : roleLabel(m.role).slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate">
                {memberLabel(m)}
                {isYou && <span className="ml-1.5 text-xs font-normal text-primary-500">(you)</span>}
              </p>
              <p className="figure text-xs text-secondary-400 truncate">{m.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'role',
      label: 'Role',
      render: (m) => {
        const reason = blockReason(m);
        const manageable = !reason;
        return (
          <Tooltip label={reason ?? `Change ${memberLabel(m)}'s role`} side="top">
            <Select
              value={m.role}
              disabled={!manageable}
              onChange={(e) => void handleRoleChange(m, e.target.value)}
              className="w-auto py-1 text-xs"
              aria-label={`Change role for ${memberLabel(m)}`}
            >
              {!ROLE_CHANGE_ROLES.includes(m.role as (typeof ROLE_CHANGE_ROLES)[number]) && m.role !== 'owner' && (
                <option value={m.role}>{roleLabel(m.role)}</option>
              )}
              {ROLE_CHANGE_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </Select>
          </Tooltip>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (m) => {
        const s = memberStatus(m);
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    {
      key: 'since',
      label: 'Since',
      render: (m) => (
        <span className="figure text-xs text-secondary-400">
          {formatDate(m.joined_at || m.invited_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (m) => {
        const reason = blockReason(m);
        const actionable = !reason;
        const transferable = isOwner && m.user_id !== user?.id && m.is_active !== false;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Tooltip label={transferable ? `Transfer ownership to ${memberLabel(m)}` : 'Only the owner can transfer ownership'} side="top">
              <Button
                variant="ghost"
                size="sm"
                disabled={!transferable}
                onClick={() => { setTransferTarget(m); setTransferGuard(''); }}
                aria-label={`Transfer ownership to ${memberLabel(m)}`}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" /> Transfer
              </Button>
            </Tooltip>
            <Tooltip label={reason ?? `Revoke access for ${memberLabel(m)}`} side="top">
              <Button
                variant="danger"
                size="sm"
                disabled={!actionable}
                onClick={() => setRevokeTarget(m)}
                aria-label={`Revoke access for ${memberLabel(m)}`}
              >
                <UserMinus className="h-3.5 w-3.5" /> Revoke
              </Button>
            </Tooltip>
          </div>
        );
      },
    },
  ], [user?.id, activeRole, members]);

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
          <Users className="h-5 w-5 text-accent-600 dark:text-accent-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Team</h3>
          <p className="text-xs text-secondary-500 dark:text-secondary-400">People with access to {activeBusiness?.name || 'this business'}</p>
        </div>
        <Tooltip label={canManage ? 'Invite a teammate by email' : capabilityTooltip('members.manage', activeRole)} side="top">
          <Button size="sm" disabled={!canManage} onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" /> Invite
          </Button>
        </Tooltip>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : (
        <DataTable
          columns={columns}
          rows={members}
          rowKey={(m) => m.membership_id}
          loading={loading}
          stickyHeader
          mobileCard={(m) => {
            const s = memberStatus(m);
            return (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate">{memberLabel(m)}</p>
                  <p className="figure text-xs text-secondary-400 truncate">{m.email} · {roleLabel(m.role)}</p>
                </div>
                <Badge variant={s.variant}>{s.label}</Badge>
              </div>
            );
          }}
          emptyState={
            <div className="px-4 py-10 text-center text-sm text-secondary-400">
              No members found for this business yet.
            </div>
          }
        />
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite teammate" size="sm">
        <div className="space-y-4 pt-1">
          <FormField label="Email address" required>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              autoFocus
            />
          </FormField>
          <FormField label="Role">
            <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as (typeof INVITE_ROLES)[number])}>
              {INVITE_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </Select>
          </FormField>
          <p className="text-xs text-secondary-400 -mt-2">Owner role transfers separately via Transfer on a member row.</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleInvite()} loading={inviting}>Send Invite</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!revokeTarget} onClose={() => setRevokeTarget(null)} title="Revoke access" size="sm">
        <p className="text-sm text-secondary-500 dark:text-secondary-400 pt-1">
          <span className="font-medium text-secondary-900 dark:text-secondary-100">{revokeTarget ? memberLabel(revokeTarget) : ''}</span>{' '}
          will lose access immediately. This cannot be undone — re-invite them fresh if they need access again.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setRevokeTarget(null)}>Cancel</Button>
          <Button variant="danger" loading={revoking} onClick={() => revokeTarget && void handleRevoke(revokeTarget)}>
            Revoke Access
          </Button>
        </div>
      </Modal>

      <Modal open={!!transferTarget} onClose={() => { setTransferTarget(null); setTransferGuard(''); }} title="Transfer ownership" size="sm">
        <p className="text-sm text-secondary-500 dark:text-secondary-400 pt-1">
          You will become an admin and{' '}
          <span className="font-medium text-secondary-900 dark:text-secondary-100">{transferTarget ? memberLabel(transferTarget) : ''}</span>{' '}
          becomes the business owner. Type their name or email to confirm.
        </p>
        <div className="mt-4">
          <Input
            value={transferGuard}
            onChange={(e) => setTransferGuard(e.target.value)}
            placeholder={transferTarget ? memberLabel(transferTarget) : ''}
            aria-label="Type member name or email to confirm transfer"
          />
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => { setTransferTarget(null); setTransferGuard(''); }}>Cancel</Button>
          <Button
            variant="danger"
            loading={transferring}
            disabled={!transferTarget || transferGuard.trim().toLowerCase() !== memberLabel(transferTarget).toLowerCase()}
            onClick={() => transferTarget && void handleTransfer(transferTarget)}
          >
            Transfer Ownership
          </Button>
        </div>
      </Modal>
    </section>
  );
}
