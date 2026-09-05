import React, { useState, useEffect, useRef } from 'react';
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

  // Eye pupil coordinates
  const [pupilPos, setPupilPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusedField === 'email' || focusedField === 'name') {
      // Look towards the form fields on the right
      setPupilPos({ x: 4, y: 3 });
    } else if (focusedField === 'password') {
      // Look down / away shyly
      setPupilPos({ x: -4, y: 5 });
    } else {
      setPupilPos({ x: 0, y: 0 });
    }
  }, [focusedField]);

  // Track global mouse position when not actively focused
  const handleMouseMove = (e: React.MouseEvent) => {
    if (focusedField) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 8;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 8;
    setPupilPos({ 
      x: Math.max(-5, Math.min(5, x)), 
      y: Math.max(-5, Math.min(5, y)) 
    });
  };

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
          setErrorMsg('Registration successful! Check your email for confirmation link.');
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

  const isShy = focusedField === 'password';

  return (
    <div 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="min-h-screen w-full bg-[#f6eee3] dark:bg-[#111317] flex items-center justify-center p-4 sm:p-8 font-sans selection:bg-amber-200"
    >
      <div className="w-full max-w-4xl bg-white dark:bg-[#1a1e26] rounded-3xl shadow-2xl border border-stone-200/80 dark:border-zinc-800 overflow-hidden grid grid-cols-1 md:grid-cols-2">
        
        {/* Left Side: Huddle Animated Characters Stage */}
        <div className="bg-[#eddcc8] dark:bg-[#161a22] p-8 flex flex-col items-center justify-end relative min-h-[340px] md:min-h-[520px] overflow-hidden border-b md:border-b-0 md:border-r border-stone-200 dark:border-zinc-800 select-none">
          
          {/* Subtle Ambient Shapes */}
          <div className="absolute top-10 left-10 w-24 h-24 rounded-full bg-[#e3cdb4]/50 dark:bg-zinc-800/30 blur-xl pointer-events-none" />
          <div className="absolute bottom-6 w-72 h-8 bg-stone-900/10 dark:bg-black/30 rounded-full blur-md" />

          {/* Characters Container */}
          <div className="relative w-full max-w-[320px] h-[240px] flex items-end justify-center gap-2 z-10">
            
            {/* 1. Orange Character (Left Pill) */}
            <div className={`w-16 h-36 bg-[#ff6b4a] rounded-t-full relative flex flex-col items-center pt-8 shadow-md transition-all duration-300 ${isShy ? 'rotate-[-6deg] translate-y-2' : ''}`}>
              {/* Eyes */}
              <div className="flex gap-2">
                <div className="w-3.5 h-3.5 bg-white rounded-full relative overflow-hidden">
                  <div 
                    className="w-2 h-2 bg-stone-900 rounded-full absolute transition-transform duration-100"
                    style={{ transform: isShy ? 'translate(0px, 2px)' : `translate(${pupilPos.x * 0.4}px, ${pupilPos.y * 0.4}px)` }}
                  />
                </div>
                <div className="w-3.5 h-3.5 bg-white rounded-full relative overflow-hidden">
                  <div 
                    className="w-2 h-2 bg-stone-900 rounded-full absolute transition-transform duration-100"
                    style={{ transform: isShy ? 'translate(0px, 2px)' : `translate(${pupilPos.x * 0.4}px, ${pupilPos.y * 0.4}px)` }}
                  />
                </div>
              </div>
              {/* Mouth */}
              <div className="w-2 h-1 bg-stone-900 rounded-full mt-3 opacity-60" />
            </div>

            {/* 2. Purple Tall Character (Center-Left) */}
            <div className={`w-20 h-52 bg-[#5d3ebd] rounded-t-[40px] relative flex flex-col items-center pt-10 shadow-lg z-20 transition-all duration-300 ${isShy ? 'rotate-[4deg]' : ''}`}>
              {/* Eyes Container */}
              <div className="flex gap-3">
                {isShy ? (
                  // Closed shy lines
                  <>
                    <div className="w-4 h-1 bg-white rounded-full mt-2 rotate-12" />
                    <div className="w-4 h-1 bg-white rounded-full mt-2 -rotate-12" />
                  </>
                ) : (
                  <>
                    <div className="w-5 h-5 bg-white rounded-full relative overflow-hidden flex items-center justify-center">
                      <div 
                        className="w-2.5 h-2.5 bg-stone-950 rounded-full absolute transition-transform duration-100"
                        style={{ transform: `translate(${pupilPos.x * 0.6}px, ${pupilPos.y * 0.6}px)` }}
                      />
                    </div>
                    <div className="w-5 h-5 bg-white rounded-full relative overflow-hidden flex items-center justify-center">
                      <div 
                        className="w-2.5 h-2.5 bg-stone-950 rounded-full absolute transition-transform duration-100"
                        style={{ transform: `translate(${pupilPos.x * 0.6}px, ${pupilPos.y * 0.6}px)` }}
                      />
                    </div>
                  </>
                )}
              </div>
              {/* Cute Blushing Cheeks when Shy */}
              {isShy && (
                <div className="flex justify-between w-14 mt-2">
                  <div className="w-2.5 h-1.5 bg-pink-400 rounded-full opacity-80" />
                  <div className="w-2.5 h-1.5 bg-pink-400 rounded-full opacity-80" />
                </div>
              )}
            </div>

            {/* 3. Black Peek Monster (Center-Right) */}
            <div className={`w-14 h-32 bg-[#1e232a] rounded-t-full relative flex flex-col items-center pt-6 shadow-md transition-all duration-300 ${isShy ? 'translate-y-4' : ''}`}>
              <div className="flex gap-2">
                <div className="w-3 h-3 bg-amber-400 rounded-full relative overflow-hidden">
                  <div 
                    className="w-1.5 h-1.5 bg-black rounded-full absolute"
                    style={{ transform: isShy ? 'translate(1px, 2px)' : `translate(${pupilPos.x * 0.3}px, ${pupilPos.y * 0.3}px)` }}
                  />
                </div>
                <div className="w-3 h-3 bg-amber-400 rounded-full relative overflow-hidden">
                  <div 
                    className="w-1.5 h-1.5 bg-black rounded-full absolute"
                    style={{ transform: isShy ? 'translate(1px, 2px)' : `translate(${pupilPos.x * 0.3}px, ${pupilPos.y * 0.3}px)` }}
                  />
                </div>
              </div>
            </div>

            {/* 4. Yellow Round Blob (Far Right) */}
            <div className={`w-16 h-24 bg-[#ffcb37] rounded-t-full relative flex flex-col items-center pt-5 shadow-sm transition-all duration-300 ${isShy ? 'rotate-12 translate-y-3' : ''}`}>
              <div className="flex gap-2">
                <div className="w-2.5 h-2.5 bg-stone-900 rounded-full" />
                <div className="w-2.5 h-2.5 bg-stone-900 rounded-full" />
              </div>
              <div className="w-3 h-1.5 border-b-2 border-stone-900 rounded-full mt-2" />
            </div>

          </div>

          <p className="text-xs text-stone-500 dark:text-zinc-500 mt-6 font-medium tracking-wide text-center">
            {isShy ? "Shh... we're looking away!" : "Type your password. Watch them look away."}
          </p>
        </div>

        {/* Right Side: Clean Authentication Form */}
        <div className="p-8 sm:p-12 flex flex-col justify-center">
          <div className="mb-6 text-center sm:text-left">
            <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 dark:text-white tracking-tight">
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-zinc-400 mt-1">
              {isSignUp ? 'Start managing GST invoices with AccountX' : 'Please enter your credentials to continue.'}
            </p>
          </div>

          {errorMsg && (
            <div className="mb-5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-400">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={fullName}
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50/50 dark:bg-zinc-800 text-stone-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-white transition"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">Email</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50/50 dark:bg-zinc-800 text-stone-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-white transition"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-stone-700 dark:text-zinc-300">Password</label>
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
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50/50 dark:bg-zinc-800 text-stone-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-white transition"
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

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-stone-900 dark:bg-zinc-800" />
                <span className="text-xs text-stone-600 dark:text-zinc-400">Remember for 30 days</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-stone-900 hover:bg-stone-800 dark:bg-white dark:hover:bg-stone-200 text-white dark:text-stone-900 font-semibold rounded-xl text-sm transition-all shadow-md active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSignUp ? 'Create Account' : 'Log in'}
            </button>
          </form>

          {/* Social Sign In */}
          <div className="mt-6">
            <button
              type="button"
              onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })}
              className="w-full py-2.5 px-4 bg-stone-50 hover:bg-stone-100 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-xl text-xs font-semibold text-stone-700 dark:text-zinc-200 flex items-center justify-center gap-2.5 transition active:scale-[0.99]"
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

          {/* Toggle between Sign In and Sign Up */}
          <p className="text-center text-xs text-stone-500 dark:text-zinc-400 mt-6">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setErrorMsg(null);
              }}
              className="font-semibold text-stone-900 dark:text-white hover:underline ml-1"
            >
              {isSignUp ? 'Sign In' : 'Sign up'}
            </button>
          </p>

        </div>

      </div>
    </div>
  );
}
