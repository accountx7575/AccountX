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

  // Exact mood calculation from the video's app.js panel
  const getMood = () => {
    if (showPassword && password.length > 0) return 'exposed';
    if (focusedField === 'password') return 'shy';
    if (focusedField === 'email' || focusedField === 'name') return 'nosy';
    return 'idle';
  };

  const mood = getMood();

  // Caret offset tracking for email field
  const caretRatio = Math.min(Math.max(email.length / 28, 0), 1);
  const eyeDx = (caretRatio - 0.5) * 14; // Left to right gaze angle

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
        else setErrorMsg('Registration successful! Please check your email inbox.');
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

  const handleGoogleAuth = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/app` },
      });
      if (error) throw error;
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#f6eee3] flex items-center justify-center p-4 sm:p-6 font-sans select-none">
      <style>{`
        /* Exact transform physics from video's app.css */
        .huddle-body {
          transition: transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: bottom center;
        }
        .pupil-track {
          transition: transform 0.12s ease-out;
        }
        .eyelid {
          transition: transform 0.25s ease;
        }
        .huddle-arm {
          transition: transform 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28), opacity 0.25s;
        }
      `}</style>

      {/* Main Split Window */}
      <div className="w-full max-w-[940px] bg-white rounded-[26px] shadow-2xl overflow-hidden grid grid-cols-1 md:grid-cols-[1.1fr_1fr] border border-stone-200">
        
        {/* LEFT STAGE: The 4 HUDDLE CHARACTERS */}
        <div className="bg-[#eddcc8] p-6 sm:p-10 flex flex-col items-center justify-end relative min-h-[380px] md:min-h-[560px] overflow-hidden border-b md:border-b-0 md:border-r border-[#dfceb9]">
          
          {/* Subtle Stage Lighting & Ground Shadow */}
          <div className="absolute bottom-6 w-80 h-5 bg-stone-900/10 rounded-full blur-sm" />

          {/* SVG Canvas for Pixel-Exact Proportions */}
          <div className="relative w-full max-w-[340px] h-[300px] flex items-end justify-center">
            
            {/* 1. ORANGE ARCH CHARACTER (Door Arch) */}
            <div 
              className={`huddle-body absolute left-2 bottom-0 w-[92px] h-[155px] bg-[#ff5733] rounded-t-full flex flex-col items-center pt-9 z-20 shadow-sm ${
                mood === 'shy' ? 'scale-y-95 translate-y-1' : ''
              } ${mood === 'exposed' ? 'scale-105 -rotate-2' : ''}`}
            >
              {/* Eyes */}
              <div className="flex gap-3">
                <div className="w-4 h-4 bg-white rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="pupil-track w-2.5 h-2.5 bg-[#1a1e24] rounded-full absolute"
                    style={{
                      transform: mood === 'nosy' 
                        ? `translate(${eyeDx * 0.4}px, 2px)` 
                        : mood === 'exposed' ? 'translate(0px, -2px) scale(1.2)' : 'translate(0px, 1px)'
                    }}
                  />
                </div>
                <div className="w-4 h-4 bg-white rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="pupil-track w-2.5 h-2.5 bg-[#1a1e24] rounded-full absolute"
                    style={{
                      transform: mood === 'nosy' 
                        ? `translate(${eyeDx * 0.4}px, 2px)` 
                        : mood === 'exposed' ? 'translate(0px, -2px) scale(1.2)' : 'translate(0px, 1px)'
                    }}
                  />
                </div>
              </div>

              {/* Mouth */}
              {mood === 'exposed' ? (
                <div className="w-4 h-4 border-2 border-[#b32b0e] bg-[#801e0a] rounded-full mt-3 animate-pulse" />
              ) : (
                <div className="w-2.5 h-1 bg-[#b32b0e] rounded-full mt-3.5 opacity-70" />
              )}

              {/* Paws covering eyes when SHY */}
              <div 
                className={`huddle-arm absolute top-7 left-2 w-7 h-7 bg-[#ff5733] border-2 border-[#ff704d] rounded-full shadow-md z-30 ${
                  mood === 'shy' ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'
                }`}
              />
              <div 
                className={`huddle-arm absolute top-7 right-2 w-7 h-7 bg-[#ff5733] border-2 border-[#ff704d] rounded-full shadow-md z-30 ${
                  mood === 'shy' ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'
                }`}
              />
            </div>

            {/* 2. PURPLE TALL PILLAR (Leader - Turns Around or Exposed) */}
            <div 
              className={`huddle-body absolute left-[86px] bottom-0 w-[102px] h-[230px] bg-[#5b32e8] rounded-t-[50px] flex flex-col items-center pt-11 z-10 shadow-lg ${
                mood === 'shy' ? 'rotate-[-5deg] scale-y-95' : ''
              } ${mood === 'exposed' ? 'scale-105' : ''}`}
            >
              {/* If SHY: Turned around == no face at all */}
              {mood === 'shy' ? (
                <div className="flex flex-col items-center gap-2 mt-4 opacity-40">
                  <div className="w-8 h-1.5 bg-[#421eb5] rounded-full" />
                  <div className="w-11 h-1.5 bg-[#421eb5] rounded-full" />
                  <div className="w-6 h-1.5 bg-[#421eb5] rounded-full" />
                </div>
              ) : (
                <>
                  <div className="flex gap-3">
                    <div className="w-6 h-6 bg-white rounded-full relative overflow-hidden flex items-center justify-center shadow-inner">
                      <div 
                        className="pupil-track w-3 h-3 bg-[#0d1017] rounded-full absolute"
                        style={{
                          transform: mood === 'nosy' 
                            ? `translate(${eyeDx * 0.7}px, 3px)` 
                            : mood === 'exposed' ? 'translate(0px, 0px) scale(1.3)' : 'translate(0px, 1px)'
                        }}
                      />
                    </div>
                    <div className="w-6 h-6 bg-white rounded-full relative overflow-hidden flex items-center justify-center shadow-inner">
                      <div 
                        className="pupil-track w-3 h-3 bg-[#0d1017] rounded-full absolute"
                        style={{
                          transform: mood === 'nosy' 
                            ? `translate(${eyeDx * 0.7}px, 3px)` 
                            : mood === 'exposed' ? 'translate(0px, 0px) scale(1.3)' : 'translate(0px, 1px)'
                        }}
                      />
                    </div>
                  </div>

                  {/* Mouth state */}
                  {mood === 'exposed' ? (
                    <div className="w-5 h-6 bg-[#2a1278] rounded-full mt-5 border border-[#421eb5]" />
                  ) : (
                    <div className="w-3 h-1 bg-[#371b96] rounded-full mt-5 opacity-80" />
                  )}
                </>
              )}
            </div>

            {/* 3. BLACK PEEK MONSTER (Hides in floor when shy) */}
            <div 
              className={`huddle-body absolute right-[70px] bottom-0 w-[74px] h-[126px] bg-[#14171d] rounded-t-full flex flex-col items-center pt-7 z-20 shadow-md ${
                mood === 'shy' ? 'translate-y-[135px] opacity-0' : 'translate-y-0 opacity-100'
              }`}
            >
              <div className="flex gap-2.5">
                <div className="w-3.5 h-3.5 bg-[#facc15] rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="pupil-track w-2 h-2 bg-black rounded-full absolute"
                    style={{ transform: mood === 'nosy' ? `translate(${eyeDx * 0.4}px, 1.5px)` : 'translate(0px, 0px)' }}
                  />
                </div>
                <div className="w-3.5 h-3.5 bg-[#facc15] rounded-full relative overflow-hidden flex items-center justify-center">
                  <div 
                    className="pupil-track w-2 h-2 bg-black rounded-full absolute"
                    style={{ transform: mood === 'nosy' ? `translate(${eyeDx * 0.4}px, 1.5px)` : 'translate(0px, 0px)' }}
                  />
                </div>
              </div>
            </div>

            {/* 4. YELLOW BLOB (Tilts head inquisitively) */}
            <div 
              className={`huddle-body absolute right-2 bottom-0 w-[84px] h-[95px] bg-[#f59e0b] rounded-t-full flex flex-col items-center pt-5 z-10 shadow-sm ${
                mood === 'shy' ? 'rotate-12 translate-y-1' : ''
              } ${mood === 'exposed' ? '-rotate-6 scale-105' : ''}`}
            >
              <div className="flex gap-3">
                <div className="w-3 h-3 bg-[#1e232a] rounded-full relative overflow-hidden">
                  <div className="w-1 h-1 bg-white rounded-full absolute top-0.5 right-0.5" />
                </div>
                <div className="w-3 h-3 bg-[#1e232a] rounded-full relative overflow-hidden">
                  <div className="w-1 h-1 bg-white rounded-full absolute top-0.5 right-0.5" />
                </div>
              </div>
              <div className="w-3.5 h-1.5 border-b-2 border-[#92400e] rounded-full mt-3" />
            </div>

          </div>

          {/* Subtitle Caption */}
          <p className="text-[13px] text-stone-600 mt-8 font-medium text-center">
            {mood === 'shy' && "Shh... they're looking away!"}
            {mood === 'exposed' && "Whoa! Password exposed!"}
            {(mood === 'idle' || mood === 'nosy') && "Type your password. Watch them look away."}
          </p>
        </div>

        {/* RIGHT STAGE: AUTHENTICATION FORM */}
        <div className="p-8 sm:p-12 lg:p-14 flex flex-col justify-center bg-white">
          <div className="mb-7">
            <h1 className="text-3xl font-extrabold text-stone-900 tracking-tight">
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-sm text-stone-500 mt-1.5">
              Please enter your details.
            </p>
          </div>

          {errorMsg && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="Rahul Sharma"
                  value={fullName}
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-stone-300 bg-stone-50 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1.5">Email</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-stone-300 bg-stone-50 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-stone-700">Password</label>
                {!isSignUp && (
                  <a href="#" className="text-xs text-stone-500 hover:text-stone-900 font-medium">
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
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border border-stone-300 bg-stone-50 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked className="w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-stone-900" />
                <span className="text-xs text-stone-600 font-medium">Remember for 30 days</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#18181b] hover:bg-black text-white font-bold rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] mt-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSignUp ? 'Create Account' : 'Log in'}
            </button>
          </form>

          <div className="relative flex items-center py-5">
            <div className="flex-grow border-t border-stone-200"></div>
            <span className="flex-shrink-0 mx-3 text-stone-400 text-xs font-semibold">or</span>
            <div className="flex-grow border-t border-stone-200"></div>
          </div>

          {/* Fully Working Google OAuth Button */}
          <button
            type="button"
            onClick={handleGoogleAuth}
            className="w-full py-2.5 px-4 bg-white hover:bg-stone-50 border border-stone-300 rounded-xl text-xs font-bold text-stone-700 flex items-center justify-center gap-2.5 transition active:scale-[0.98] shadow-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Log in with Google
          </button>

          <p className="text-center text-xs text-stone-500 mt-6 font-medium">
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
