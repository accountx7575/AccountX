import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input, FormField } from '@/components/ui/Input';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { useToast } from '@/context/ToastContext';
import { Mail, ArrowRight, KeyRound, CheckCircle2 } from 'lucide-react';

export function ForgotPasswordPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      setSent(true);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Could not send reset email. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout
        headline={<>Secure reset,<br />on its way.</>}
        description="The link expires automatically. Didn't receive it? Check spam or request another from the sign-in page."
      >
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
            <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Check your inbox</h1>
          <p className="mt-3 text-sm text-secondary-500 dark:text-secondary-400 leading-relaxed">
            If an account exists for <span className="figure font-medium text-zinc-700 dark:text-zinc-200">{email}</span>,
            a password reset link is on its way. The link takes you back here to set a new password.
          </p>
          <Link to="/login" className="mt-6 inline-block text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      headline={<>Locked out?<br />We&apos;ve got you.</>}
      description="Enter the email tied to your account and we'll send a secure link to reset your password."
      features={['Links expire automatically', 'Works across all your devices', 'Your ledger stays untouched']}
    >
      <div className="flex items-center gap-2 mb-6">
        <div className="rounded-lg bg-primary-50 dark:bg-primary-900/30 p-2">
          <KeyRound className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Reset your password</h1>
      </div>
      <p className="-mt-3 text-sm text-secondary-500 dark:text-secondary-400">
        Enter your account email and we&apos;ll send you a reset link.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <FormField label="Email address" required>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" aria-hidden="true" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="pl-10"
              autoComplete="email"
              required
            />
          </div>
        </FormField>

        <Button type="submit" loading={loading} className="w-full" size="lg">
          Send reset link
          {!loading && <ArrowRight className="ml-1 h-4 w-4" />}
        </Button>
      </form>

      <p className="text-center text-sm text-secondary-500 dark:text-secondary-400 mt-6">
        Remembered it?{' '}
        <Link to="/login" className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
