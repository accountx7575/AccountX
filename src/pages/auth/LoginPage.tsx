import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * LoginPage — "Huddle" animated auth screen, ported 1:1 from the reference
 * CodePen (Component 88 · Sign-in).
 *
 * Mechanics, reverse-engineered directly from the source shown on-screen
 * in the reference capture (index.html / app.css / app.js panels):
 *
 *   // one derived word IS the state of all four of them
 *   function moodOf() {
 *     // the secret is on screen — the caret doesn't matter
 *     if (shown && pw.value) return 'exposed';
 *     if (at === pw)          return 'shy';
 *     if (at === mail)        return 'nosy';
 *     return 'idle';
 *   }
 *   auth.dataset.mood = moodOf();
 *
 * IMPORTANT — mood is a discrete 4-value state derived only from *which
 * field has focus* plus the shown/value flags. It is NOT proportional to
 * caret position or how much text has been typed — "the caret doesn't
 * matter" is explicit in the source. An earlier draft of this component
 * animated eyes/lean proportionally to input length; that was inaccurate
 * and has been replaced by the real discrete state machine below.
 *
 * Each character is built from the same face vocabulary the markup uses:
 *   face__eyes.is-open / is-shut / is-peek
 *   face__mouth.is-o / is-grin
 * ("turned around = no face at all" — the black mate has no face at all
 * once it turns fully away in the 'exposed' mood.)
 *
 * Only the tall purple "mate" (`.mate--tall`) carries a real physical
 * lean; it pivots from its own bottom edge so the lean reads as weight
 * shifting rather than floating — the reference achieves the same
 * grounded look via
 *   transform: translateY(calc(var(--dy) * 1%)) rotate(var(--rot)deg);
 *   /* every lean is paid for with the lift it costs:
 *      dy = -(w / 2h) · sin(|rot|) *\/
 * — pivoting at the bottom-center is the equivalent simplification for a
 * plain CSS transform-origin. The other three mates get much smaller,
 * mood-specific tilts of their own (see POSES below); they don't float
 * either, since each pivots from its own base.
 */

type FocusField = 'email' | 'password' | 'name' | null;
type Mood = 'idle' | 'nosy' | 'shy' | 'exposed';
type EyeState = 'open' | 'shut' | 'none';
type MouthState = 'o' | 'grin' | 'none';

interface Pose {
  rot: number; // degrees, pivoted from each character's own base
  eye: EyeState;
  worried: boolean; // reshapes the shut-eye arc for the 'exposed' mood
  pupil: number; // fixed px offset — NOT proportional to typed length
  mouth: MouthState;
}

const POSES: Record<Mood, { purple: Pose; black: Pose; yellow: Pose; orange: Pose }> = {
  idle: {
    purple: { rot: 0, eye: 'open', worried: false, pupil: 0, mouth: 'o' },
    black: { rot: 0, eye: 'open', worried: false, pupil: 0, mouth: 'grin' },
    yellow: { rot: 0, eye: 'open', worried: false, pupil: 0, mouth: 'grin' },
    orange: { rot: 0, eye: 'open', worried: false, pupil: 0, mouth: 'grin' },
  },
  nosy: {
    purple: { rot: 7, eye: 'open', worried: false, pupil: 3, mouth: 'o' },
    black: { rot: -5, eye: 'open', worried: false, pupil: 4, mouth: 'grin' },
    yellow: { rot: 3, eye: 'open', worried: false, pupil: 3, mouth: 'grin' },
    orange: { rot: 0, eye: 'open', worried: false, pupil: 5, mouth: 'grin' },
  },
  shy: {
    purple: { rot: 11, eye: 'shut', worried: false, pupil: 0, mouth: 'none' },
    black: { rot: 0, eye: 'shut', worried: false, pupil: 0, mouth: 'grin' },
    yellow: { rot: 0, eye: 'shut', worried: false, pupil: 0, mouth: 'none' },
    orange: { rot: 0, eye: 'shut', worried: false, pupil: 0, mouth: 'grin' },
  },
  exposed: {
    purple: { rot: 9, eye: 'shut', worried: true, pupil: 0, mouth: 'o' },
    black: { rot: 0, eye: 'none', worried: false, pupil: 0, mouth: 'none' }, // turned around = no face at all
    yellow: { rot: 0, eye: 'shut', worried: true, pupil: 0, mouth: 'o' },
    orange: { rot: 0, eye: 'shut', worried: true, pupil: 0, mouth: 'o' },
  },
};

const INK = 'rgba(20, 12, 46, 0.82)'; // dark marks on purple
const INK_ON_ORANGE = 'rgba(70, 24, 6, 0.82)';
const INK_ON_YELLOW = 'rgba(70, 46, 4, 0.82)';
const LIGHT = 'rgba(244, 244, 245, 0.95)'; // light marks on the black body

export function LoginPage() {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<FocusField>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---- Mood: a single discrete value derived from focus/reveal state,
  // exactly mirroring moodOf() in the reference — never from typed length.
  const mood: Mood = useMemo(() => {
    if (showPassword && password.length > 0) return 'exposed';
    if (focusedField === 'password') return 'shy';
    if (focusedField === 'email' || focusedField === 'name') return 'nosy';
    return 'idle';
  }, [showPassword, password, focusedField]);

  const caption =
    mood === 'exposed'
      ? 'Whoa — no peeking!'
      : mood === 'shy'
      ? "Shh... they're looking away!"
      : mood === 'nosy'
      ? "They're keeping an eye on you..."
      : 'Type your password. Watch them look away.';

  // ---- Peek: the black mate periodically cracks one eye open while shy —
  // a transient third eye pose (is-peek in the reference markup) distinct
  // from open/shut. It's a timed micro-animation, not tied to keystrokes
  // or the caret.
  const [peeking, setPeeking] = useState(false);
  const peekTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mood !== 'shy') {
      setPeeking(false);
      return;
    }
    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const interval = setInterval(() => {
      setPeeking(true);
      peekTimeout.current = setTimeout(() => setPeeking(false), 320);
    }, 2600);

    return () => {
      clearInterval(interval);
      if (peekTimeout.current) clearTimeout(peekTimeout.current);
      setPeeking(false);
    };
  }, [mood]);

  const pose = POSES[mood];

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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app` },
    });
    if (error) setErrorMsg(error.message);
  };

  // ---- Face renderers ---------------------------------------------------
  // Each mirrors one "mate" in the reference markup, where every eye/mouth
  // variant is conceptually always drawn and only the active one shows.

  const purpleEyes = () => {
    if (pose.purple.eye === 'open') {
      return (
        <>
          <ellipse cx={120 + pose.purple.pupil} cy={58} rx={4} ry={5} fill={INK} />
          <ellipse cx={147 + pose.purple.pupil} cy={58} rx={4} ry={5} fill={INK} />
        </>
      );
    }
    // shut — the same arc, reshaped for 'worried' (exposed) vs relaxed (shy)
    return pose.purple.worried ? (
      <>
        <path d="M110,52 L124,58" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        <path d="M144,58 L158,52" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      </>
    ) : (
      <>
        <path d="M112,57 q8,8 16,0" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
        <path d="M140,57 q8,8 16,0" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
      </>
    );
  };

  const purpleMouth = () => {
    if (pose.purple.mouth === 'none') return null;
    // is-o: purple's only mouth shape — a small surprised oval
    return <ellipse cx={133 + pose.purple.pupil} cy={79} rx={2.5} ry={4} fill={INK} />;
  };

  const blackEyes = () => {
    if (peeking) {
      // is-peek: one eye cracked open, one shut — a momentary curiosity glance
      return (
        <>
          <path d="M186,99 q8,8 16,0" stroke={LIGHT} strokeWidth={3} fill="none" strokeLinecap="round" />
          <circle cx={218} cy={100} r={9} fill="#ffffff" />
          <circle cx={218} cy={100} r={4} fill="#0b0d12" />
        </>
      );
    }
    if (pose.black.eye === 'none') return null;
    if (pose.black.eye === 'open') {
      return (
        <>
          <circle cx={194} cy={100} r={9} fill="#ffffff" />
          <circle cx={194 + pose.black.pupil} cy={100} r={4} fill="#0b0d12" />
          <circle cx={218} cy={100} r={9} fill="#ffffff" />
          <circle cx={218 + pose.black.pupil} cy={100} r={4} fill="#0b0d12" />
        </>
      );
    }
    return (
      <>
        <path d="M186,99 q8,8 16,0" stroke={LIGHT} strokeWidth={3} fill="none" strokeLinecap="round" />
        <path d="M210,99 q8,8 16,0" stroke={LIGHT} strokeWidth={3} fill="none" strokeLinecap="round" />
      </>
    );
  };

  const blackMouth = () => {
    if (pose.black.mouth === 'none') return null;
    return <path d="M196,122 q11,8 22,0" stroke={LIGHT} strokeWidth={3} fill="none" strokeLinecap="round" />;
  };

  const yellowEyes = () => {
    if (pose.yellow.eye === 'open') {
      return <circle cx={253 + pose.yellow.pupil} cy={129} r={4} fill={INK_ON_YELLOW} />;
    }
    return pose.yellow.worried ? (
      <path d="M246,122 q7,-6 14,0" stroke={INK_ON_YELLOW} strokeWidth={3} fill="none" strokeLinecap="round" />
    ) : (
      <path d="M247,128 q6,-7 12,0" stroke={INK_ON_YELLOW} strokeWidth={3} fill="none" strokeLinecap="round" />
    );
  };

  const yellowMouth = () => {
    if (pose.yellow.mouth === 'none') return null;
    if (pose.yellow.mouth === 'o') {
      return <ellipse cx={253} cy={151} rx={4} ry={3} fill="none" stroke={INK_ON_YELLOW} strokeWidth={2.5} />;
    }
    return <line x1={246} y1={151} x2={275} y2={151} stroke={INK_ON_YELLOW} strokeWidth={3} strokeLinecap="round" />;
  };

  const orangeEyes = () => {
    if (pose.orange.eye === 'open') {
      return (
        <>
          <circle cx={122 + pose.orange.pupil} cy={150} r={5} fill={INK_ON_ORANGE} />
          <circle cx={162 + pose.orange.pupil} cy={150} r={5} fill={INK_ON_ORANGE} />
        </>
      );
    }
    return pose.orange.worried ? (
      <>
        <path d="M110,142 L126,150" stroke={INK_ON_ORANGE} strokeWidth={3.5} strokeLinecap="round" />
        <path d="M158,150 L174,142" stroke={INK_ON_ORANGE} strokeWidth={3.5} strokeLinecap="round" />
      </>
    ) : (
      <>
        <path d="M112,149 q10,10 20,0" stroke={INK_ON_ORANGE} strokeWidth={3.5} fill="none" strokeLinecap="round" />
        <path d="M152,149 q10,10 20,0" stroke={INK_ON_ORANGE} strokeWidth={3.5} fill="none" strokeLinecap="round" />
      </>
    );
  };

  const orangeMouth = () => {
    if (pose.orange.mouth === 'o') {
      return <ellipse cx={145} cy={171} rx={7} ry={6} fill="none" stroke={INK_ON_ORANGE} strokeWidth={3.5} />;
    }
    if (pose.orange.mouth === 'grin') {
      return pose.orange.eye === 'shut' ? (
        <path d="M120,172 q25,14 50,0" stroke={INK_ON_ORANGE} strokeWidth={3.5} fill="none" strokeLinecap="round" />
      ) : (
        <path d="M108,166 q37,26 74,0" stroke={INK_ON_ORANGE} strokeWidth={4} fill="none" strokeLinecap="round" />
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen w-full bg-[#f6eee3] flex items-center justify-center p-4 sm:p-8 font-sans">
      <style>{`
        .huddle-mate {
          transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .huddle-face path,
        .huddle-face ellipse,
        .huddle-face circle,
        .huddle-face line {
          transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
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
        <div
          className="w-full md:w-[45%] bg-[#eddcc8] relative p-8 flex flex-col items-center justify-end min-h-[380px] md:min-h-[580px] overflow-hidden"
          data-mood={mood}
        >
          {/* Decorative confetti dots */}
          <div className="absolute top-12 left-12 w-8 h-8 rounded-full bg-[#ff5733] opacity-15" />
          <div className="absolute top-24 right-16 w-4 h-4 rounded-full bg-[#5b32e8] opacity-15" />
          <div className="absolute bottom-40 left-8 w-6 h-6 rounded-full bg-[#f59e0b] opacity-15" />

          <div className="relative w-full max-w-[320px] huddle-breathe">
            <svg viewBox="0 0 320 200" className="w-full h-auto select-none" aria-hidden="true">
              {/* ---------------- PURPLE — .mate--tall (the one that really leans) ---------------- */}
              <g
                className="huddle-mate"
                style={{ transform: `rotate(${pose.purple.rot}deg)`, transformOrigin: '130px 186px' }}
              >
                <rect x={95} y={15} width={70} height={171} rx={14} fill="#5b32e8" />
                <rect x={95} y={15} width={70} height={9} rx={4.5} fill="#ffffff" opacity={0.18} />
                <g className="huddle-face">
                  {purpleEyes()}
                  {purpleMouth()}
                </g>
              </g>

              {/* ---------------- BLACK — .mate (subtle nosy tilt; no face when exposed) ---------------- */}
              <g
                className="huddle-mate huddle-face"
                style={{ transform: `rotate(${pose.black.rot}deg)`, transformOrigin: '206px 186px' }}
              >
                <rect x={178} y={62} width={56} height={124} rx={28} fill="#161922" />
                {blackEyes()}
                {blackMouth()}
              </g>

              {/* ---------------- ORANGE — .mate--wide (front-center, planted) ---------------- */}
              <g className="huddle-face">
                <path d="M60,185 A80,80 0 0 1 220,185 Z" fill="#ff5733" />
                {orangeEyes()}
                {orangeMouth()}
              </g>

              {/* ---------------- YELLOW — .mate--short (front-right) ---------------- */}
              <g
                className="huddle-mate huddle-face"
                style={{ transform: `rotate(${pose.yellow.rot}deg)`, transformOrigin: '257px 186px' }}
              >
                <rect x={228} y={96} width={58} height={90} rx={29} fill="#f59e0b" />
                {yellowEyes()}
                {yellowMouth()}
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
                    defaultChecked
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
