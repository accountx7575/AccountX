import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input, FormField } from '@/components/ui/Input';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { useToast } from '@/context/ToastContext';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  useEffect(() => {
    if (remember) return;
    const onUnload = () => {
      void supabase.auth.signOut();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [remember]);

  function validate(): boolean {
    const e: { email?: string; password?: string } = {};
    if (!email.trim()) e.email = 'Email is required';
    else if (!EMAIL_REGEX.test(email.trim())) e.email = 'Enter a valid email address';
    if (!password) e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitted(true);
    if (!validate()) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      toast('Welcome back to AccountX!', 'success');
      const next = searchParams.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/app');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Login failed. Check your credentials.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      headline={<>Indian business accounting,<br />minus the spreadsheet chaos.</>}
      description="GST-ready invoicing, real-time inventory, and a double-entry engine that keeps every rupee accounted for — in one workspace."
      features={[
        'Invoices with CGST / SGST / IGST breakdown',
        'Stock movements reconciled against the ledger',
        'P&L, Balance Sheet & Cash Flow out of the box',
        'Tally-compatible CSV export',
      ]}
    >
      <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Sign in</h2>
      <p className="mt-1.5 text-sm text-secondary-500 dark:text-secondary-400">Enter your credentials to access your dashboard</p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate>
        <FormField label="Email address" required error={submitted ? errors.email : undefined}>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" aria-hidden="true" />
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
              }}
              placeholder="you@example.com"
              className="pl-10"
              autoComplete="email"
              autoFocus
            />
          </div>
        </FormField>

        <FormField label="Password" required error={submitted ? errors.password : undefined}>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" aria-hidden="true" />
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
              }}
              placeholder="••••••••"
              className="pl-10 pr-10"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded accent-primary-600"
            />
            Keep me signed in
          </label>
          <Link to="/forgot-password" className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" loading={loading} className="w-full" size="lg">
          Sign In
        </Button>
      </form>

      <p className="text-center text-sm text-secondary-500 dark:text-secondary-400 mt-6">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
          Create one
        </Link>
      </p>
    </AuthLayout>
  );
}
