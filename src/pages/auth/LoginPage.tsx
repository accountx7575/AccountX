import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const REMEMBERED_EMAIL_KEY = 'accountx_remembered_email';

function readRememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * LoginPage — "Huddle" style animated auth screen.
 *
 * Four characters (purple / black / yellow / orange) react live to what you
 * do in the form:
 *  - idle    -> nobody's paying attention
 *  - nosy    -> email/name focused: eyes track the caret as you type
 *  - shy     -> password focused: everyone shuts their eyes
 *  - exposed -> password revealed (eye icon) while it has a value: startled
 *
 * Mood priority mirrors the original interaction model:
 *   shown && password.length > 0   -> 'exposed'
 *   focusedField === 'password'    -> 'shy'
 *   focusedField === email|name    -> 'nosy'
 *   otherwise                      -> 'idle'
 */

type FocusField = 'email' | 'password' | 'name' | null;
type Mood = 'idle' | 'nosy' | 'shy' | 'exposed';

const INK = 'rgba(20, 12, 46, 0.82)'; // dark marks on purple
const INK_ON_ORANGE = 'rgba(70, 24, 6, 0.82)';
const INK_ON_YELLOW = 'rgba(70, 46, 4, 0.82)';
const LIGHT = 'rgba(244, 244, 245, 0.95)'; // light marks on the black body

export function LoginPage() {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState(readRememberedEmail);
  const [rememberMe, setRememberMe] = useState(() => readRememberedEmail() !== '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<FocusField>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---- Mood + gaze state machine -------------------------------------
  const mood: Mood = useMemo(() => {
    if (showPassword && password.length > 0) return 'exposed';
    if (focusedField === 'password') return 'shy';
    if (focusedField === 'email' || focusedField === 'name') return 'nosy';
    return 'idle';
  }, [showPassword, password, focusedField]);

  // 0 -> 1, simulates how far the caret has travelled across the field
  const gaze = useMemo(() => {
    const text = focusedField === 'name' ? fullName : focusedField === 'email' ? email : '';
    if (!text) return 0;
    return Math.min(text.length / 18, 1);
  }, [focusedField, fullName, email]);

  // Only the tall purple "leader" physically leans; everyone else just
  // changes expression, same as the reference component.
  const leanDeg = mood === 'nosy' ? gaze * 7 : mood === 'shy' ? 10 : mood === 'exposed' ? 8 : 0;
  const eyeShift = mood === 'nosy' ? gaze : 0;

  const caption =
    mood === 'exposed'
      ? "Whoa — no peeking!"
      : mood === 'shy'
      ? "Shh... they're looking away!"
      : mood === 'nosy'
      ? "They're keeping an eye on you..."
      : 'Type your password. Watch them look away.';

  // ---- Auth handlers ---------------------------------------------------
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        if (data.session) navigate('/app');
        else setErrorMsg('Registration successful! Check your email.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // "Remember me": persist the email for next visit, or clear it.
        try {
          if (rememberMe && email) localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
          else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
        } catch {
          /* storage unavailable — login still succeeds */
        }

        const isSuperAdmin = data.user?.app_metadata?.is_super_admin;
        if (isSuperAdmin || email === 'acc.x7575@gmail.com') navigate('/super-admin');
        else navigate('/app');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/app` },
      });
      if (error) throw error;
    } catch (err: any) {
      const raw = typeof err?.message === 'string' ? err.message : '';
      if (/unsupported provider|provider is not enabled/i.test(raw)) {
        setErrorMsg(
          'Google Sign-In is not yet enabled in the Supabase Dashboard. Please sign in with email and password.'
        );
      } else {
        setErrorMsg(raw || 'Google sign-in failed. Please try again.');
      }
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#f6eee3] flex items-center justify-center p-4 sm:p-8 font-sans">
      <style>{`
        .huddle-mate {
          transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: 130px 186px;
        }
        .huddle-face path,
        .huddle-face ellipse,
        .huddle-face circle,
        .huddle-face line {
          transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease, d 0.3s ease;
        }
        @keyframes huddle-breathe {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-2.5px); }
        }
        .huddle-breathe {
          animation: huddle-breathe 3.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .huddle-breathe { animation: none; }
          .huddle-mate, .huddle-face * { transition: none !important; }
        }
      `}</style>

      <div className="w-full max-w-[920px] bg-white rounded-[24px] shadow-2xl overflow-hidden flex flex-col md:flex-row">
        {/* Left Side: Huddle character stage */}
        <div className="w-full md:w-[45%] bg-[#eddcc8] relative p-8 flex flex-col items-center justify-end min-h-[380px] md:min-h-[580px] overflow-hidden">
          {/* Decorative confetti dots */}
          <div className="absolute top-12 left-12 w-8 h-8 rounded-full bg-[#ff5733] opacity-15" />
          <div className="absolute top-24 right-16 w-4 h-4 rounded-full bg-[#5b32e8] opacity-15" />
          <div className="absolute bottom-40 left-8 w-6 h-6 rounded-full bg-[#f59e0b] opacity-15" />

          <div className="relative w-full max-w-[320px] huddle-breathe">
            <svg viewBox="0 0 320 200" className="w-full h-auto select-none" aria-hidden="true">
              {/* ---------------- PURPLE (tallest, leans) ---------------- */}
              <g className="huddle-mate" style={{ transform: `rotate(${leanDeg}deg)` }}>
                <rect x={95} y={15} width={70} height={171} rx={14} fill="#5b32e8" />
                <rect x={95} y={15} width={70} height={9} rx={4.5} fill="#ffffff" opacity={0.18} />
                <g className="huddle-face">
                  {(mood === 'idle' || mood === 'nosy') && (
                    <>
                      <ellipse cx={120 + eyeShift * 7} cy={58} rx={4} ry={5} fill={INK} />
                      <ellipse cx={147 + eyeShift * 7} cy={58} rx={4} ry={5} fill={INK} />
                      <ellipse cx={133 + eyeShift * 7} cy={79} rx={2.5} ry={4} fill={INK} />
                    </>
                  )}
                  {mood === 'shy' && (
                    <>
                      <path d="M112,57 q8,8 16,0" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
                      <path d="M140,57 q8,8 16,0" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
                    </>
                  )}
                  {mood === 'exposed' && (
                    <>
                      <path d="M110,51 L124,58" stroke={INK} strokeWidth={3} strokeLinecap="round" />
                      <path d="M144,58 L158,51" stroke={INK} strokeWidth={3} strokeLinecap="round" />
                      <path d="M120,80 q5,-7 10,0 q5,7 10,0" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
                    </>
                  )}
                </g>
              </g>

              {/* ---------------- BLACK (doesn't lean) ---------------- */}
              <g className="huddle-face">
                <rect x={178} y={62} width={56} height={124} rx={28} fill="#161922" />
                {(mood === 'idle' || mood === 'nosy') && (
                  <>
                    <circle cx={194} cy={100} r={9} fill="#ffffff" />
                    <circle cx={194 + eyeShift * 4} cy={100} r={4} fill="#0b0d12" />
                    <circle cx={218} cy={100} r={9} fill="#ffffff" />
                    <circle cx={218 + eyeShift * 4} cy={100} r={4} fill="#0b0d12" />
                  </>
                )}
                {mood === 'shy' && (
                  <>
                    <path d="M186,99 q8,8 16,0" stroke={LIGHT} strokeWidth={3} fill="none" strokeLinecap="round" />
                    <path d="M210,99 q8,8 16,0" stroke={LIGHT} strokeWidth={3} fill="none" strokeLinecap="round" />
                    <path d="M196,122 q11,8 22,0" stroke={LIGHT} strokeWidth={3} fill="none" strokeLinecap="round" />
                  </>
                )}
                {/* exposed: black turns fully away, no face shown */}
              </g>

              {/* ---------------- ORANGE (front-center, doesn't lean) ---------------- */}
              <g className="huddle-face">
                <path d="M60,185 A80,80 0 0 1 220,185 Z" fill="#ff5733" />
                {(mood === 'idle' || mood === 'nosy') && (
                  <>
                    <circle cx={122 + eyeShift * 6} cy={150} r={5} fill={INK_ON_ORANGE} />
                    <circle cx={162 + eyeShift * 6} cy={150} r={5} fill={INK_ON_ORANGE} />
                    <path d="M108,166 q37,26 74,0" stroke={INK_ON_ORANGE} strokeWidth={4} fill="none" strokeLinecap="round" />
                  </>
                )}
                {mood === 'shy' && (
                  <>
                    <path d="M112,149 q10,10 20,0" stroke={INK_ON_ORANGE} strokeWidth={3.5} fill="none" strokeLinecap="round" />
                    <path d="M152,149 q10,10 20,0" stroke={INK_ON_ORANGE} strokeWidth={3.5} fill="none" strokeLinecap="round" />
                    <path d="M120,172 q25,14 50,0" stroke={INK_ON_ORANGE} strokeWidth={3.5} fill="none" strokeLinecap="round" />
                  </>
                )}
                {mood === 'exposed' && (
                  <>
                    <path d="M110,142 L126,150" stroke={INK_ON_ORANGE} strokeWidth={3.5} strokeLinecap="round" />
                    <path d="M158,150 L174,142" stroke={INK_ON_ORANGE} strokeWidth={3.5} strokeLinecap="round" />
                    <path d="M124,172 q9,-9 18,0 q9,9 18,0" stroke={INK_ON_ORANGE} strokeWidth={3.5} fill="none" strokeLinecap="round" />
                  </>
                )}
              </g>

              {/* ---------------- YELLOW (front-right, doesn't lean) ---------------- */}
              <g className="huddle-face">
                <rect x={228} y={96} width={58} height={90} rx={29} fill="#f59e0b" />
                {(mood === 'idle' || mood === 'nosy') && (
                  <>
                    <circle cx={253 + eyeShift * 4} cy={129} r={4} fill={INK_ON_YELLOW} />
                    <line x1={246} y1={151} x2={275} y2={151} stroke={INK_ON_YELLOW} strokeWidth={3} strokeLinecap="round" />
                  </>
                )}
                {mood === 'shy' && (
                  <path d="M247,128 q6,-7 12,0" stroke={INK_ON_YELLOW} strokeWidth={3} fill="none" strokeLinecap="round" />
                )}
                {mood === 'exposed' && (
                  <>
                    <path d="M246,122 q7,-6 14,0" stroke={INK_ON_YELLOW} strokeWidth={3} fill="none" strokeLinecap="round" />
                    <path d="M243,151 q4,-5 8,0 q4,5 8,0" stroke={INK_ON_YELLOW} strokeWidth={3} fill="none" strokeLinecap="round" />
                  </>
                )}
              </g>
            </svg>
          </div>

          <p className="text-[13px] text-stone-600 mt-6 font-medium text-center max-w-[220px] leading-snug">
            {caption}
          </p>
        </div>

        {/* Right Side: Auth Form */}
        <div className="w-full md:w-[55%] p-8 sm:p-12 lg:p-16 flex flex-col justify-center bg-white">
          <div className="mb-8">
            <h1 className="text-[28px] font-extrabold text-stone-900 tracking-tight">
              {isSignUp ? 'Create account' : 'Welcome back'}
            </h1>
            <p className="text-[14px] text-stone-500 mt-1.5 font-medium">
              Please enter your details to continue.
            </p>
          </div>

          {errorMsg && (
            <div className="mb-6 p-3.5 rounded-xl bg-red-50 border border-red-100 text-[13px] text-red-600 font-medium">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-5">
            {isSignUp && (
              <div>
                <label className="block text-[13px] font-bold text-stone-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={fullName}
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 text-[14px] focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition-all font-medium placeholder:text-stone-400"
                />
              </div>
            )}

            <div>
              <label className="block text-[13px] font-bold text-stone-700 mb-1.5">Email</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 text-[14px] focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition-all font-medium placeholder:text-stone-400"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[13px] font-bold text-stone-700">Password</label>
                {!isSignUp && (
                  <a href="#" className="text-[13px] font-medium text-stone-500 hover:text-stone-900 transition-colors">
                    Forgot password?
                  </a>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-11 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 text-[14px] focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition-all font-medium placeholder:text-stone-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!isSignUp && (
              <div className="flex items-center justify-between pt-1 pb-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setRememberMe(checked);
                      try {
                        if (!checked) localStorage.removeItem(REMEMBERED_EMAIL_KEY);
                        else if (email) localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
                      } catch {
                        /* ignore storage failures */
                      }
                    }}
                    className="w-4 h-4 rounded-[4px] border-stone-300 text-stone-900 focus:ring-stone-900"
                  />
                  <span className="text-[13px] font-medium text-stone-600">Remember me</span>
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-[#111111] hover:bg-[#222222] text-white font-bold rounded-xl text-[14px] transition-all flex items-center justify-center gap-2 disabled:opacity-70 active:scale-[0.98]"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSignUp ? 'Create account' : 'Log in'}
            </button>
          </form>

          <div className="relative flex items-center py-6">
            <div className="flex-grow border-t border-stone-200" />
            <span className="flex-shrink-0 mx-4 text-stone-400 text-[12px] font-medium uppercase tracking-wider">
              or
            </span>
            <div className="flex-grow border-t border-stone-200" />
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full py-3 px-4 bg-white hover:bg-stone-50 border-2 border-stone-200 rounded-xl text-[14px] font-bold text-stone-700 flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Log in with Google
          </button>

          <p className="text-center text-[14px] text-stone-500 mt-8 font-medium">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUp((v) => !v);
                setErrorMsg(null);
              }}
              className="font-bold text-stone-900 hover:underline ml-1"
            >
              {isSignUp ? 'Log in' : 'Sign up'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

