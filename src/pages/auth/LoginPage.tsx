import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * LoginPage — pixel-faithful "Huddle" animated auth screen.
 *
 * Cream canvas (#f6eee3) + centered split card: warm beige visual stage
 * (#eddcc8) on the left, clean white form stage on the right.
 *
 * Character hierarchy (left → right):
 *  - Orange Arch (#ff5733): dome with circular eyes + small mouth; two paws
 *    slide up to cover both eyes during password focus.
 *  - Purple Pillar (#5b32e8): tallest pill; pupils track the email caret;
 *    rotates 180° (blank back of head) during password focus.
 *  - Black Peek Monster (#14171d): slim pill with glowing yellow eyes
 *    (#facc15); drops fully beneath the stage floor line on password focus.
 *  - Yellow Blob (#f59e0b): low wide half-dome with dark eyes; tilts
 *    inquisitively on password entry.
 *
 * Mood engine: idle → nosy (email/name focused, caret-tracked pupils) →
 * shy (password focused) → exposed (password revealed, dilated shock).
 */

type FocusField = 'email' | 'password' | 'name' | null;
type Mood = 'idle' | 'nosy' | 'shy' | 'exposed';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OWNER_EMAIL = 'acc.x7575@gmail.com';
const MAX_GAZE = 6; // px of pupil travel

/** Measure the caret's viewport position inside a text input. */
function measureCaret(input: HTMLInputElement): { x: number; y: number } {
  const pos = input.selectionStart ?? input.value.length;
  const upto = input.value.slice(0, Math.max(0, pos));
  const cs = getComputedStyle(input);
  let canvas: HTMLCanvasElement | null = (measureCaret as { _cv?: HTMLCanvasElement })._cv ?? null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    (measureCaret as { _cv?: HTMLCanvasElement })._cv = canvas;
  }
  const ctx = canvas.getContext('2d');
  const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const w = ctx ? (ctx.font = font, ctx.measureText(upto).width) : upto.length * 8;
  const r = input.getBoundingClientRect();
  return {
    x: r.left + parseFloat(cs.paddingLeft || '0') + w - input.scrollLeft,
    y: r.top + r.height / 2,
  };
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [focusedField, setFocusedField] = useState<FocusField>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<{ x: number; y: number } | null>(null);
  const focusedRef = useRef<FocusField>(null);
  focusedRef.current = focusedField;

  // ---- Mood state machine ------------------------------------------------
  const mood: Mood = useMemo(() => {
    if (showPassword && password.length > 0) return 'exposed';
    if (focusedField === 'password') return 'shy';
    if (focusedField === 'email' || focusedField === 'name') return 'nosy';
    return 'idle';
  }, [showPassword, password, focusedField]);
  const moodRef = useRef<Mood>('idle');
  moodRef.current = mood;

  // ---- Caret-tracked gaze (rAF loop writes --gx/--gy, no re-renders) -----
  useEffect(() => {
    let raf = 0;
    let cx = 0;
    let cy = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const stage = stageRef.current;
      if (!stage) return;
      const m = moodRef.current;
      let tx = 0;
      let ty = 0;
      if (m === 'nosy' && caretRef.current) {
        const r = stage.getBoundingClientRect();
        const dx = caretRef.current.x - (r.left + r.width / 2);
        const dy = caretRef.current.y - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        const mag = Math.min(MAX_GAZE, dist / 40);
        tx = (dx / dist) * mag;
        ty = (dy / dist) * mag;
      } else if (m === 'shy') {
        ty = 2.5;
      }
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      stage.style.setProperty('--gx', `${cx.toFixed(2)}px`);
      stage.style.setProperty('--gy', `${cy.toFixed(2)}px`);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const trackCaret = (input: HTMLInputElement | null) => {
    if (input) {
      try {
        caretRef.current = measureCaret(input);
      } catch {
        caretRef.current = null;
      }
    }
  };

  // "Remember for 30 days" off → end session when the tab closes.
  useEffect(() => {
    if (remember) return;
    const onUnload = () => {
      void supabase.auth.signOut();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [remember]);

  const caption =
    mood === 'exposed'
      ? 'Whoa — no peeking!'
      : mood === 'shy'
        ? "Shh... they're looking away!"
        : mood === 'nosy'
          ? "They're keeping an eye on you..."
          : 'Type your password. Watch them look away.';

  // ---- Auth ---------------------------------------------------------------
  const destinationFor = (userEmail: string | undefined, isSuper: unknown): string => {
    if (isSuper || userEmail === OWNER_EMAIL) return '/super-admin';
    const next = searchParams.get('next');
    return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
  };

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const cleanEmail = email.trim();
    if (!cleanEmail) return setErrorMsg('Email is required.');
    if (!EMAIL_REGEX.test(cleanEmail)) return setErrorMsg('Enter a valid email address.');
    if (!password) return setErrorMsg('Password is required.');
    if (isSignUp) {
      if (!fullName.trim()) return setErrorMsg('Full name is required.');
      if (password.length < 6) return setErrorMsg('Password must be at least 6 characters.');
    }
    setLoading(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        if (data.session) {
          navigate(destinationFor(data.user?.email, data.user?.app_metadata?.is_super_admin));
        } else {
          setErrorMsg('Account created! Check your email to confirm, then log in.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw error;
        navigate(destinationFor(data.user?.email, data.user?.app_metadata?.is_super_admin));
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app` },
    });
    if (error) setErrorMsg(error.message);
  };

  const shy = mood === 'shy';
  const exposed = mood === 'exposed';
  const awake = !shy; // eyes open states: idle / nosy / exposed

  return (
    <div className="min-h-screen w-full bg-[#f6eee3] flex items-center justify-center p-4 sm:p-8 font-sans">
      <style>{`
        .huddle-move { transition: transform 0.55s cubic-bezier(0.34, 1.3, 0.64, 1); }
        .huddle-pupil { transform: translate(var(--gx, 0px), var(--gy, 0px)); }
        @keyframes huddle-breathe {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-2.5px); }
        }
        .huddle-breathe { animation: huddle-breathe 3.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .huddle-breathe { animation: none; }
          .huddle-move { transition: none !important; }
        }
      `}</style>

      <div className="w-full max-w-[920px] bg-white rounded-[24px] shadow-2xl overflow-hidden flex flex-col md:flex-row">
        {/* Left stage: beige, 4-character huddle, floor-clipped */}
        <div
          ref={stageRef}
          className="w-full md:w-[45%] bg-[#eddcc8] relative p-8 flex flex-col items-center justify-end min-h-[380px] md:min-h-[580px] overflow-hidden"
        >
          <div className="absolute top-12 left-12 w-8 h-8 rounded-full bg-[#ff5733] opacity-15" aria-hidden="true" />
          <div className="absolute top-24 right-16 w-4 h-4 rounded-full bg-[#5b32e8] opacity-15" aria-hidden="true" />
          <div className="absolute bottom-40 left-8 w-6 h-6 rounded-full bg-[#f59e0b] opacity-15" aria-hidden="true" />

          <div className="relative w-full max-w-[330px] huddle-breathe">
            <svg viewBox="0 0 360 210" className="w-full h-auto select-none" role="img" aria-label={caption} style={{ perspective: '700px' }}>
              {/* ground shadow + floor line */}
              <ellipse cx={182} cy={196} rx={142} ry={8} fill="rgba(60,40,20,0.10)" />
              <line x1={16} y1={192} x2={344} y2={192} stroke="rgba(60,40,20,0.18)" strokeWidth={2} strokeLinecap="round" />

              {/* ============ ORANGE ARCH (left, paws cover eyes when shy) ============ */}
              <g>
                <path d="M35,192 C35,118 68,94 92,94 C116,94 149,118 149,192 Z" fill="#ff5733" />
                {awake && (
                  <>
                    <circle cx={72} cy={148} r={12} fill="#ffffff" />
                    <circle cx={112} cy={148} r={12} fill="#ffffff" />
                    <g className="huddle-pupil">
                      <circle cx={72} cy={148} r={exposed ? 8 : 5.5} fill="#3d1503" />
                      <circle cx={112} cy={148} r={exposed ? 8 : 5.5} fill="#3d1503" />
                    </g>
                    {exposed ? (
                      <ellipse cx={92} cy={170} rx={7} ry={9} fill="#3d1503" />
                    ) : (
                      <path d="M82,168 q10,8 20,0" stroke="#3d1503" strokeWidth={4} fill="none" strokeLinecap="round" />
                    )}
                  </>
                )}
                {!awake && (
                  <path d="M78,168 q14,8 28,0" stroke="#3d1503" strokeWidth={4} fill="none" strokeLinecap="round" />
                )}
                {/* paws: rest at the cheeks, slide up over the eyes when shy */}
                <g className="huddle-move" style={{ transform: shy ? 'translate(26px, -16px)' : 'translate(0px, 0px)' }}>
                  <rect x={28} y={150} width={22} height={38} rx={11} fill="#d9481f" />
                  <line x1={39} y1={162} x2={39} y2={176} stroke="#a82f0e" strokeWidth={2} strokeLinecap="round" />
                </g>
                <g className="huddle-move" style={{ transform: shy ? 'translate(-26px, -16px)' : 'translate(0px, 0px)' }}>
                  <rect x={134} y={150} width={22} height={38} rx={11} fill="#d9481f" />
                  <line x1={145} y1={162} x2={145} y2={176} stroke="#a82f0e" strokeWidth={2} strokeLinecap="round" />
                </g>
              </g>

              {/* ============ PURPLE PILLAR (tallest, flips 180° when shy) ============ */}
              <g
                className="huddle-move"
                style={{
                  transform: shy ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                  transformStyle: 'preserve-3d',
                }}
              >
                {/* front face */}
                <g style={{ backfaceVisibility: 'hidden' }}>
                  <rect x={160} y={18} width={64} height={174} rx={30} fill="#5b32e8" />
                  <rect x={168} y={24} width={10} height={160} rx={5} fill="#ffffff" opacity={0.14} />
                  {awake && (
                    <>
                      <ellipse cx={181} cy={66} rx={exposed ? 11 : 9} ry={exposed ? 13 : 11} fill="#ffffff" />
                      <ellipse cx={203} cy={66} rx={exposed ? 11 : 9} ry={exposed ? 13 : 11} fill="#ffffff" />
                      <g className="huddle-pupil">
                        <circle cx={181} cy={67} r={exposed ? 6.5 : 4.5} fill="#1c0b45" />
                        <circle cx={203} cy={67} r={exposed ? 6.5 : 4.5} fill="#1c0b45" />
                      </g>
                      {exposed ? (
                        <>
                          <path d="M170,46 L190,50" stroke="#1c0b45" strokeWidth={3.5} strokeLinecap="round" />
                          <path d="M214,46 L194,50" stroke="#1c0b45" strokeWidth={3.5} strokeLinecap="round" />
                          <ellipse cx={192} cy={96} rx={7} ry={9} fill="#1c0b45" />
                        </>
                      ) : (
                        <path d="M184,94 q8,7 16,0" stroke="#1c0b45" strokeWidth={3.5} fill="none" strokeLinecap="round" />
                      )}
                    </>
                  )}
                  {!awake && (
                    <path d="M182,120 q10,7 20,0" stroke="#1c0b45" strokeWidth={3.5} fill="none" strokeLinecap="round" />
                  )}
                </g>
                {/* back of head: blank */}
                <g
                  style={{
                    backfaceVisibility: 'hidden',
                    transformBox: 'fill-box',
                    transformOrigin: 'center',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <rect x={160} y={18} width={64} height={174} rx={30} fill="#4a28c4" />
                  <rect x={206} y={24} width={10} height={160} rx={5} fill="#000000" opacity={0.12} />
                </g>
              </g>

              {/* ============ BLACK PEEK MONSTER (drops below floor when shy) ============ */}
              <g className="huddle-move" style={{ transform: shy ? 'translateY(140px)' : 'translateY(0px)' }}>
                <rect x={236} y={66} width={44} height={126} rx={22} fill="#14171d" />
                {awake && (
                  <>
                    <circle cx={249} cy={102} r={exposed ? 9.5 : 7} fill="#facc15" style={{ filter: 'drop-shadow(0 0 6px #facc15)' }} />
                    <circle cx={267} cy={102} r={exposed ? 9.5 : 7} fill="#facc15" style={{ filter: 'drop-shadow(0 0 6px #facc15)' }} />
                    {!exposed && (
                      <g className="huddle-pupil">
                        <circle cx={249} cy={102} r={2.6} fill="#14171d" />
                        <circle cx={267} cy={102} r={2.6} fill="#14171d" />
                      </g>
                    )}
                    {exposed ? (
                      <ellipse cx={258} cy={132} rx={6} ry={8} fill="none" stroke="#facc15" strokeWidth={3} />
                    ) : (
                      <path d="M250,130 q8,6 16,0" stroke="#facc15" strokeWidth={3} fill="none" strokeLinecap="round" />
                    )}
                  </>
                )}
                {!awake && (
                  <path d="M247,120 q11,7 22,0" stroke="#facc15" strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.8} />
                )}
              </g>

              {/* ============ YELLOW BLOB (tilts inquisitively when shy) ============ */}
              <g
                className="huddle-move"
                style={{
                  transform: shy ? 'rotate(-9deg)' : 'rotate(0deg)',
                  transformBox: 'fill-box',
                  transformOrigin: '50% 100%',
                }}
              >
                <path d="M284,192 C284,150 300,140 317,140 C334,140 350,150 350,192 Z" fill="#f59e0b" />
                {awake && (
                  <>
                    <g className="huddle-pupil">
                      <circle cx={306} cy={166} r={exposed ? 7.5 : 5} fill="#46290a" />
                      <circle cx={328} cy={166} r={exposed ? 7.5 : 5} fill="#46290a" />
                    </g>
                    {exposed ? (
                      <ellipse cx={317} cy={181} rx={5} ry={6.5} fill="#46290a" />
                    ) : (
                      <line x1={309} y1={181} x2={325} y2={181} stroke="#46290a" strokeWidth={3} strokeLinecap="round" />
                    )}
                  </>
                )}
                {!awake && (
                  <path d="M307,165 q4,-5 8,0 M321,165 q4,-5 8,0" stroke="#46290a" strokeWidth={2.5} fill="none" strokeLinecap="round" />
                )}
              </g>
            </svg>
          </div>

          <p className="text-[13px] text-stone-600 mt-6 font-medium text-center max-w-[230px] leading-snug">
            {caption}
          </p>
        </div>

        {/* Right stage: minimal white auth form */}
        <div className="w-full md:w-[55%] p-8 sm:p-12 lg:p-14 flex flex-col justify-center bg-white">
          <div className="mb-8">
            <h1 className="text-[28px] font-extrabold text-stone-900 tracking-tight">
              {isSignUp ? 'Create account' : 'Welcome back'}
            </h1>
            <p className="text-[14px] text-stone-500 mt-1.5 font-medium">
              Please enter your details to continue.
            </p>
          </div>

          {errorMsg && (
            <div className="mb-6 p-3.5 rounded-xl bg-red-50 border border-red-100 text-[13px] text-red-600 font-medium" role="alert">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-5" noValidate>
            {isSignUp && (
              <div>
                <label htmlFor="huddle-name" className="block text-[13px] font-bold text-stone-700 mb-1.5">Full Name</label>
                <input
                  id="huddle-name"
                  ref={nameRef}
                  type="text"
                  placeholder="e.g. Rahul Sharma"
                  value={fullName}
                  autoComplete="name"
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  onClick={(e) => trackCaret(e.currentTarget)}
                  onKeyUp={(e) => trackCaret(e.currentTarget)}
                  onSelect={(e) => trackCaret(e.currentTarget)}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    requestAnimationFrame(() => trackCaret(nameRef.current));
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 text-[14px] focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition-all font-medium placeholder:text-stone-400"
                />
              </div>
            )}

            <div>
              <label htmlFor="huddle-email" className="block text-[13px] font-bold text-stone-700 mb-1.5">Email</label>
              <input
                id="huddle-email"
                ref={emailRef}
                type="email"
                placeholder="you@example.com"
                value={email}
                autoComplete="email"
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                onClick={(e) => trackCaret(e.currentTarget)}
                onKeyUp={(e) => trackCaret(e.currentTarget)}
                onSelect={(e) => trackCaret(e.currentTarget)}
                onChange={(e) => {
                  setEmail(e.target.value);
                  requestAnimationFrame(() => trackCaret(emailRef.current));
                }}
                className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 text-[14px] focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition-all font-medium placeholder:text-stone-400"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="huddle-password" className="text-[13px] font-bold text-stone-700">Password</label>
                {!isSignUp && (
                  <Link to="/forgot-password" className="text-[13px] font-medium text-stone-500 hover:text-stone-900 transition-colors">
                    Forgot password?
                  </Link>
                )}
              </div>
              <div className="relative">
                <input
                  id="huddle-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
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
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="w-4 h-4 rounded-[4px] border-stone-300 text-stone-900 focus:ring-stone-900"
                  />
                  <span className="text-[13px] font-medium text-stone-600">Remember for 30 days</span>
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
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            {isSignUp ? 'Sign up with Google' : 'Log in with Google'}
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
