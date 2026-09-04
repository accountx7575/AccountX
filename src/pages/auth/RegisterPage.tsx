import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input, FormField } from '@/components/ui/Input';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { useToast } from '@/context/ToastContext';
import { User, Mail, Phone, Lock, Eye, EyeOff, CheckCircle2, MailCheck } from 'lucide-react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clearError = (field: string) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Full name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!EMAIL_REGEX.test(form.email.trim())) e.email = 'Enter a valid email address';
    if (!form.phone.trim()) e.phone = 'Phone number is required';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 6) e.password = 'Password must be at least 6 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitted(true);
    if (!validate()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { name: form.name.trim(), phone: form.phone.trim() } },
      });
      if (error) throw error;
      if (data.user && data.session) {
        toast('Account created! Set up your business to get started.', 'success');
        navigate('/setup-business');
      } else if (data.user) {
        setConfirmPending(true);
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Registration failed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (confirmPending) {
    return (
      <AuthLayout
        headline={<>One click away<br />from your new ledger.</>}
        description="Confirm your email to activate your account, then set up your business profile."
      >
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
            <MailCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Confirm your email</h2>
          <p className="mt-3 text-sm text-secondary-500 dark:text-secondary-400 leading-relaxed">
            We sent a confirmation link to <span className="figure font-medium text-zinc-700 dark:text-zinc-200">{form.email}</span>.
            Click it, then sign in to set up your business.
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
      headline={<>Set up your books<br />in minutes, not weekends.</>}
      description="Create a free account and get professional billing, inventory, and compliance tools built for Indian businesses."
      features={[
        'No accounting expertise needed',
        'Multi-business support from day one',
        'GST-compliant invoices by default',
        'Your data stays yours — export anytime',
      ]}
    >
      <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Create your account</h2>
      <p className="mt-1.5 text-sm text-secondary-500 dark:text-secondary-400">Get started with AccountX in minutes</p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate>
        <FormField label="Full name" required error={submitted ? errors.name : undefined}>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" aria-hidden="true" />
            <Input
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                clearError('name');
              }}
              placeholder="Rahul Sharma"
              className="pl-10"
              autoComplete="name"
            />
          </div>
        </FormField>

        <FormField label="Email address" required error={submitted ? errors.email : undefined}>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" aria-hidden="true" />
            <Input
              type="email"
              value={form.email}
              onChange={(e) => {
                setForm({ ...form, email: e.target.value });
                clearError('email');
              }}
              placeholder="you@example.com"
              className="pl-10"
              autoComplete="email"
            />
          </div>
        </FormField>

        <FormField label="Phone number" required error={submitted ? errors.phone : undefined}>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" aria-hidden="true" />
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => {
                setForm({ ...form, phone: e.target.value });
                clearError('phone');
              }}
              placeholder="+91 98765 43210"
              className="pl-10"
              autoComplete="tel"
            />
          </div>
        </FormField>

        <FormField label="Password" required error={submitted ? errors.password : undefined}>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" aria-hidden="true" />
            <Input
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => {
                setForm({ ...form, password: e.target.value });
                clearError('password');
              }}
              placeholder="At least 6 characters"
              className="pl-10 pr-10"
              autoComplete="new-password"
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

        <Button type="submit" loading={loading} className="w-full" size="lg">
          Create Account
        </Button>
      </form>

      <p className="text-center text-sm text-secondary-500 dark:text-secondary-400 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
