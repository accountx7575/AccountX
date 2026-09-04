import { useEffect, useState } from 'react';
import { Check, KeyRound, Loader2, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, FormField } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { can, roleLabel, type Capability } from '@/lib/rbac';
import { supabase } from '@/lib/supabase';

const CAPABILITY_LABELS: Array<{ cap: Capability; label: string }> = [
  { cap: 'settings.edit', label: 'Edit business settings' },
  { cap: 'members.manage', label: 'Manage team members' },
  { cap: 'data.export', label: 'Export business data' },
];

export function UserProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, businesses, activeBusiness, activeRole } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setName(user.user_metadata?.name || '');
    setPhone(user.phone || user.user_metadata?.phone || '');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, [open, user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      const updates: { data: Record<string, string>; phone?: string } = {
        data: { name: name.trim() },
      };
      if (phone.trim() && phone.trim() !== (user.phone || '')) updates.phone = phone.trim();
      const { error } = await supabase.auth.updateUser(updates);
      if (error) throw error;
      toast('Profile updated', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update profile', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePassword = async () => {
    if (!user?.email) return;
    if (!currentPassword) {
      toast('Enter your current password first', 'error');
      return;
    }
    if (newPassword.length < 6) {
      toast('New password must be at least 6 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('New passwords do not match', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      const { error: verifyError } = await supabase.auth
        .signInWithPassword({ email: user.email, password: currentPassword });
      if (verifyError) throw new Error('Current password is incorrect');
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast('Password updated', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update password', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const profileDirty =
    name.trim() !== (user?.user_metadata?.name || '') ||
    (!!phone.trim() && phone.trim() !== (user?.phone || ''));

  return (
    <Modal open={open} onClose={onClose} title="My Profile" size="md">
      <div className="px-6 py-5 space-y-6 overflow-y-auto">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 truncate">
                {user?.user_metadata?.name || 'User'}
              </p>
              <p className="text-xs text-secondary-400 truncate">{user?.email}</p>
            </div>
            <Badge variant="primary">{roleLabel(activeRole)}</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wider text-secondary-400 mb-1">Active Business</p>
              <p className="font-medium text-secondary-900 dark:text-secondary-100 truncate">
                {activeBusiness?.name || 'None selected'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-secondary-400 mb-1">Businesses</p>
              <p className="font-medium text-secondary-900 dark:text-secondary-100">{businesses.length}</p>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-secondary-400 mb-2">Permissions</p>
            <ul className="space-y-1.5">
              {CAPABILITY_LABELS.map(({ cap, label }) => (
                <li key={cap} className="flex items-center gap-2 text-sm">
                  {can(activeRole, cap) ? (
                    <Check className="h-4 w-4 text-success-600 shrink-0" />
                  ) : (
                    <X className="h-4 w-4 text-secondary-300 shrink-0" />
                  )}
                  <span className={can(activeRole, cap)
                    ? 'text-secondary-700 dark:text-secondary-200'
                    : 'text-secondary-400'}
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-secondary-200 dark:border-secondary-800 pt-5 space-y-4">
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Account Details</h3>
          <FormField label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </FormField>
          <FormField label="Email">
            <Input value={user?.email || ''} readOnly disabled />
            <p className="text-xs text-secondary-400 mt-1">Email changes require verification and are disabled here.</p>
          </FormField>
          <FormField label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Add a phone number" />
          </FormField>
          <Button onClick={handleSaveProfile} disabled={!profileDirty || savingProfile} size="sm">
            {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />} Save Profile
          </Button>
        </section>

        <section className="border-t border-secondary-200 dark:border-secondary-800 pt-5 space-y-4">
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Password &amp; Security
          </h3>
          <FormField label="Current password">
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="New password">
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </FormField>
            <FormField label="Confirm new password">
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </FormField>
          </div>
          <Button onClick={handleSavePassword} disabled={savingPassword} size="sm" variant="secondary">
            {savingPassword && <Loader2 className="h-4 w-4 animate-spin" />} Update Password
          </Button>
        </section>
      </div>
    </Modal>
  );
}
