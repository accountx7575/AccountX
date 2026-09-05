import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function LoginPage() {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | 'name' | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Dynamic eye tracking calculated from caret index
  const caretRatio = Math.min(Math.max(email.length / 26, 0), 1);
  const pupilX = (caretRatio - 0.5) * 12; // -6px to +6px tracking
  const isPw = focusedField === 'password';

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
        if (data.session) {
          navigate('/app');
        } else {
          setErrorMsg('Registration successful! Please check your email inbox.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;

        const isSuperAdmin = data.user?.app_metadata?.is_super_admin;
        if (isSuperAdmin || email === 'acc.x7575@gmail.com') {
          navigate('/super-admin');
        } else {
          navigate('/app');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#f6eee3] dark:bg-[#111317] flex items-center justify-center p-4 sm:p-6 font-sans">
      <style>{`
        .huddle-purple-face {
          transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
        }
        .huddle-hand {
          transition: transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.2);
        }
        .huddle-monster {
          transition: transform 0.35s ease, opacity 0.3s ease;
        }
      `}</style>

      <div className="w-full max-w-[880px] bg-white dark:bg-[#181c24] rounded-[28px] shadow-2xl border border-stone-200/90 dark:border-zinc-800 overflow-hidden grid grid-cols-1 md:grid-cols-[1.08fr_1fr]">
        
        {/* Left Stage: Huddle Interactive Character Suite */}
        <div className="bg-[#eddcc8] dark:bg-[#151922] p-6 sm:p-8 flex flex-col items-center justify-end relative min-h-[360px] md:min-h-[500px] select-none overflow-hidden border-b md:border-b-0 md:border-r border-stone-200/80 dark:border-zinc-800">
          
          {/* Ground Shadow */}
          <div className="absolute bottom-6 w-64 sm:w-72 h-4 bg-stone-900/10 dark:bg-black/30 rounded-full blur-sm" />

          {/* SVG Stage */}
          <div className="relative w-full max-w-[310px] h-[260px] flex items-end justify-center">
            
            {/* 1. ORANGE ARCH CHARACTER (Left) */}
            <div 
              className={`absolute left-4 bottom-0 w-[84px] h-[142px] bg-[#ff5733] rounded-t-full flex flex-col items-center pt-8 shadow-sm transition-transform duration-300 ${
                isPw ? 'translate-y-2' : ''
              }`}
            >
              {/* Eyes */}
              <div className="flex gap-2.5 z-0">
                <div className="w-3.5 h-3.5 bg-white rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="w-2 h-2 bg-[#1c2024] rounded-full absolute transition-all duration-100"
                    style={{ transform: isPw ? 'translateY(3px)' : `translate(${pupilX * 0.45}px, ${focusedField ? 2 : 0}px)` }}
                  />
                </div>
                <div className="w-3.5 h-3.5 bg-white rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="w-2 h-2 bg-[#1c2024] rounded-full absolute transition-all duration-100"
                    style={{ transform: isPw ? 'translateY(3px)' : `translate(${pupilX * 0.45}px, ${focusedField ? 2 : 0}px)` }}
                  />
                </div>
              </div>
              <div className="w-2.5 h-1 bg-[#b32b0e] rounded-full mt-3" />

              {/* Paws Covering Eyes on Password Mode */}
              <div 
                className={`huddle-hand absolute -left-2 top-7 w-7 h-7 bg-[#ff5733] border-2 border-[#ff704d] rounded-full z-20 ${
                  isPw ? 'translate-x-4 -translate-y-1' : '-translate-x-4 opacity-0'
                }`} 
              />
              <div 
                className={`huddle-hand absolute -right-2 top-7 w-7 h-7 bg-[#ff5733] border-2 border-[#ff704d] rounded-full z-20 ${
                  isPw ? '-translate-x-4 -translate-y-1' : 'translate-x-4 opacity-0'
                }`} 
              />
            </div>

            {/* 2. PURPLE TALL CHARACTER (Center Pillar) */}
            <div 
              className={`absolute left-[78px] bottom-0 w-[96px] h-[210px] bg-[#5b32e8] rounded-t-[48px] flex flex-col items-center pt-10 shadow-lg z-10 transition-transform duration-300 ${
                isPw ? 'rotate-[-3deg]' : ''
              }`}
            >
              {/* If password focused -> Head turns around (back of head), Else front eyes */}
              <div 
                className={`huddle-purple-face flex flex-col items-center ${
                  isPw ? 'rotate-[180deg] scale-x-[-1] opacity-0' : 'opacity-100'
                }`}
              >
                <div className="flex gap-3">
                  <div className="w-5 h-5 bg-white rounded-full relative overflow-hidden flex items-center justify-center shadow-inner">
                    <div 
                      className="w-2.5 h-2.5 bg-[#0f1115] rounded-full absolute transition-all duration-100"
                      style={{ transform: `translate(${pupilX * 0.7}px, ${focusedField ? 3 : 0}px)` }}
                    />
                  </div>
                  <div className="w-5 h-5 bg-white rounded-full relative overflow-hidden flex items-center justify-center shadow-inner">
                    <div 
                      className="w-2.5 h-2.5 bg-[#0f1115] rounded-full absolute transition-all duration-100"
                      style={{ transform: `translate(${pupilX * 0.7}px, ${focusedField ? 3 : 0}px)` }}
                    />
                  </div>
                </div>
                <div className="w-2 h-1 bg-[#3a1d9e] rounded-full mt-4" />
              </div>

              {/* Back of Head Details when turned away */}
              {isPw && (
                <div className="flex flex-col items-center mt-3">
                  <div className="w-6 h-1 bg-[#4722c2] rounded-full opacity-60" />
                  <div className="w-8 h-1 bg-[#4722c2] rounded-full mt-1.5 opacity-40" />
                </div>
              )}
            </div>

            {/* 3. BLACK PEEK MONSTER (Center-Right) */}
            <div 
              className={`huddle-monster absolute right-[68px] bottom-0 w-[72px] h-[130px] bg-[#161922] rounded-t-full flex flex-col items-center pt-6 shadow-md z-20 ${
                isPw ? 'translate-y-[85px] opacity-70' : 'translate-y-0 opacity-100'
              }`}
            >
              <div className="flex gap-2">
                <div className="w-3.5 h-3.5 bg-[#facc15] rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="w-2 h-2 bg-black rounded-full absolute transition-all duration-100"
                    style={{ transform: isPw ? 'translateY(3px)' : `translate(${pupilX * 0.4}px, ${focusedField ? 2 : 0}px)` }}
                  />
                </div>
                <div className="w-3.5 h-3.5 bg-[#facc15] rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="w-2 h-2 bg-black rounded-full absolute transition-all duration-100"
                    style={{ transform: isPw ? 'translateY(3px)' : `translate(${pupilX * 0.4}px, ${focusedField ? 2 : 0}px)` }}
                  />
                </div>
              </div>
            </div>

            {/* 4. YELLOW BLOB CHARACTER (Right) */}
            <div 
              className={`absolute right-4 bottom-0 w-[80px] h-[92px] bg-[#f59e0b] rounded-t-full flex flex-col items-center pt-4 z-0 transition-transform duration-300 ${
                isPw ? 'rotate-[8deg] translate-y-1' : ''
              }`}
            >
              <div className="flex gap-2.5">
                <div className="w-2.5 h-2.5 bg-[#1e232a] rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="w-1.5 h-1.5 bg-white rounded-full absolute"
                    style={{ transform: isPw ? 'translateY(1.5px)' : `translate(${pupilX * 0.3}px, 0px)` }}
                  />
                </div>
                <div className="w-2.5 h-2.5 bg-[#1e232a] rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="w-1.5 h-1.5 bg-white rounded-full absolute"
                    style={{ transform: isPw ? 'translateY(1.5px)' : `translate(${pupilX * 0.3}px, 0px)` }}
                  />
                </div>
              </div>
              <div className="w-3 h-1.5 border-b-2 border-[#92400e] rounded-full mt-2" />
            </div>

          </div>

          {/* Subtitle Badge */}
          <p className="text-xs text-stone-500 dark:text-zinc-400 mt-6 font-medium text-center">
            {isPw ? "Shh... we're looking away!" : 'Type your password. Watch them look away.'}
          </p>
        </div>

        {/* Right Stage: Authentication Form */}
        <div className="p-8 sm:p-10 flex flex-col justify-center">
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 dark:text-white tracking-tight">
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-zinc-400 mt-1">
              {isSignUp ? 'Start issuing GST invoices today' : 'Please enter your credentials to continue.'}
            </p>
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-400">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={fullName}
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-white transition"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">Email</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-white transition"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-stone-700 dark:text-zinc-300">Password</label>
                {!isSignUp && (
                  <a href="#" className="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-white">
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
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-white transition font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked className="w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-stone-900 dark:bg-zinc-800" />
                <span className="text-xs text-stone-600 dark:text-zinc-400">Remember for 30 days</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-stone-900 hover:bg-stone-800 dark:bg-white dark:hover:bg-stone-200 text-white dark:text-stone-900 font-semibold rounded-xl text-sm transition shadow-md active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-60 mt-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSignUp ? 'Create Account' : 'Log In'}
            </button>
          </form>

          {/* Social Google */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })}
              className="w-full py-2.5 px-4 bg-white hover:bg-stone-50 dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-xl text-xs font-semibold text-stone-700 dark:text-zinc-200 flex items-center justify-center gap-2 transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              Log in with Google
            </button>
          </div>

          {/* Mode Switcher */}
          <p className="text-center text-xs text-stone-500 dark:text-zinc-400 mt-5">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setErrorMsg(null);
              }}
              className="font-semibold text-stone-900 dark:text-white hover:underline ml-1"
            >
              {isSignUp ? 'Log in' : 'Sign up'}
            </button>
          </p>

        </div>

      </div>
    </div>
  );
}
