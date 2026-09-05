import React, { useState, useEffect } from 'react';
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

  // Calculate eye movement based on typing length (simulates caret tracking)
  const typingOffset = focusedField === 'email' || focusedField === 'name' 
    ? Math.min(email.length * 0.4, 12) 
    : 0;
  
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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app` }
    });
    if (error) setErrorMsg(error.message);
  };

  return (
    <div className="min-h-screen w-full bg-[#f6eee3] flex items-center justify-center p-4 sm:p-8 font-sans">
      <style>{`
        .spring-transition {
          transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease;
        }
        .eye-transition {
          transition: transform 0.15s ease-out;
        }
        .paw-transition {
          transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1.2), opacity 0.3s;
        }
      `}</style>

      <div className="w-full max-w-[920px] bg-white rounded-[24px] shadow-2xl overflow-hidden flex flex-col md:flex-row">
        
        {/* Left Side: Exact Huddle Cartoons Stage */}
        <div className="w-full md:w-[45%] bg-[#eddcc8] relative p-8 flex flex-col items-center justify-end min-h-[380px] md:min-h-[580px] overflow-hidden">
          
          {/* Decorative Background Elements */}
          <div className="absolute top-12 left-12 w-8 h-8 rounded-full bg-[#ff5733] opacity-20" />
          <div className="absolute top-24 right-16 w-4 h-4 rounded-full bg-[#5b32e8] opacity-20" />
          <div className="absolute bottom-40 left-8 w-6 h-6 rounded-full bg-[#f59e0b] opacity-20" />

          {/* Character Container with bottom clip for sinking effect */}
          <div className="relative w-full max-w-[320px] h-[260px] flex items-end justify-center overflow-hidden z-10 border-b-2 border-[#d9c7b3]">
            
            {/* 1. ORANGE ARCH */}
            <div className={`absolute left-[15px] bottom-0 w-[78px] h-[135px] bg-[#ff5733] rounded-t-full flex flex-col items-center pt-8 spring-transition z-20 ${isPw ? 'translate-y-1' : ''}`}>
              <div className="flex gap-2">
                <div className="w-4 h-4 bg-white rounded-full relative overflow-hidden">
                  <div className="w-2 h-2 bg-[#1c2024] rounded-full absolute top-1 left-1 eye-transition" style={{ transform: `translateX(${typingOffset}px)` }} />
                </div>
                <div className="w-4 h-4 bg-white rounded-full relative overflow-hidden">
                  <div className="w-2 h-2 bg-[#1c2024] rounded-full absolute top-1 left-1 eye-transition" style={{ transform: `translateX(${typingOffset}px)` }} />
                </div>
              </div>
              <div className="w-2.5 h-1 bg-[#b32b0e] rounded-full mt-3" />
              {/* Paws covering eyes */}
              <div className={`absolute top-6 left-2 w-7 h-7 bg-[#ff5733] border-[3px] border-[#e64a2b] rounded-full paw-transition ${isPw ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-8 opacity-0 scale-50'}`} />
              <div className={`absolute top-6 right-2 w-7 h-7 bg-[#ff5733] border-[3px] border-[#e64a2b] rounded-full paw-transition ${isPw ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-8 opacity-0 scale-50'}`} />
            </div>

            {/* 2. PURPLE PILLAR */}
            <div className={`absolute left-[90px] bottom-0 w-[88px] h-[210px] bg-[#5b32e8] rounded-t-full flex flex-col items-center pt-10 spring-transition z-10`} style={{ transform: isPw ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
              {!isPw ? (
                <>
                  <div className="flex gap-2.5">
                    <div className="w-[22px] h-[22px] bg-white rounded-full relative overflow-hidden shadow-inner">
                      <div className="w-2.5 h-2.5 bg-[#0f1115] rounded-full absolute top-1.5 left-1.5 eye-transition" style={{ transform: `translateX(${typingOffset}px)` }} />
                    </div>
                    <div className="w-[22px] h-[22px] bg-white rounded-full relative overflow-hidden shadow-inner">
                      <div className="w-2.5 h-2.5 bg-[#0f1115] rounded-full absolute top-1.5 left-1.5 eye-transition" style={{ transform: `translateX(${typingOffset}px)` }} />
                    </div>
                  </div>
                  <div className="w-2 h-1 bg-[#3a1d9e] rounded-full mt-4" />
                </>
              ) : (
                <div className="flex flex-col items-center mt-2 opacity-80">
                  <div className="w-8 h-1.5 bg-[#4722c2] rounded-full" />
                  <div className="w-10 h-1.5 bg-[#4722c2] rounded-full mt-2" />
                  <div className="w-6 h-1.5 bg-[#4722c2] rounded-full mt-2" />
                </div>
              )}
            </div>

            {/* 3. BLACK PEEK MONSTER */}
            <div className={`absolute right-[75px] bottom-0 w-[64px] h-[110px] bg-[#161922] rounded-t-full flex flex-col items-center pt-6 spring-transition z-20 ${isPw ? 'translate-y-[110px]' : 'translate-y-0'}`}>
              <div className="flex gap-2">
                <div className="w-3.5 h-3.5 bg-[#facc15] rounded-full relative overflow-hidden">
                  <div className="w-2 h-2 bg-black rounded-full absolute top-[3px] left-[3px] eye-transition" style={{ transform: `translateX(${typingOffset * 0.7}px)` }} />
                </div>
                <div className="w-3.5 h-3.5 bg-[#facc15] rounded-full relative overflow-hidden">
                  <div className="w-2 h-2 bg-black rounded-full absolute top-[3px] left-[3px] eye-transition" style={{ transform: `translateX(${typingOffset * 0.7}px)` }} />
                </div>
              </div>
            </div>

            {/* 4. YELLOW BLOB */}
            <div className={`absolute right-[10px] bottom-0 w-[70px] h-[85px] bg-[#f59e0b] rounded-t-full flex flex-col items-center pt-5 spring-transition z-10 ${isPw ? 'rotate-[15deg] translate-y-3 translate-x-1' : ''}`}>
              <div className="flex gap-2">
                <div className="w-2.5 h-2.5 bg-[#1e232a] rounded-full relative overflow-hidden">
                  <div className="w-1 h-1 bg-white rounded-full absolute top-0.5 right-0.5" />
                </div>
                <div className="w-2.5 h-2.5 bg-[#1e232a] rounded-full relative overflow-hidden">
                  <div className="w-1 h-1 bg-white rounded-full absolute top-0.5 right-0.5" />
                </div>
              </div>
              <div className="w-3 h-1.5 border-b-2 border-[#92400e] rounded-full mt-2" />
            </div>
          </div>

          <p className="text-[13px] text-stone-600 mt-8 font-medium text-center max-w-[200px] leading-snug">
            {isPw ? "Shh... they're looking away!" : 'Type your password. Watch them look away.'}
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
                  onChange={e => setFullName(e.target.value)}
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
                onChange={e => setEmail(e.target.value)}
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
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-11 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 text-[14px] focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition-all font-medium placeholder:text-stone-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 pb-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" defaultChecked className="w-4 h-4 rounded-[4px] border-stone-300 text-stone-900 focus:ring-stone-900" />
                <span className="text-[13px] font-medium text-stone-600">Remember for 30 days</span>
              </label>
            </div>

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
            <div className="flex-grow border-t border-stone-200"></div>
            <span className="flex-shrink-0 mx-4 text-stone-400 text-[12px] font-medium uppercase tracking-wider">or</span>
            <div className="flex-grow border-t border-stone-200"></div>
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
              onClick={() => { setIsSignUp(!isSignUp); setErrorMsg(null); }}
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
