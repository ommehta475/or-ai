import { FormEvent, useState } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { PublicConfig } from '../types';
import { OrlixaMark } from './OrlixaMark';

export type AuthMode = 'login' | 'register' | 'forgot' | 'recovery';

interface AuthScreenProps {
  supabase: SupabaseClient | null;
  config: PublicConfig;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onRecovered: () => void;
}

export function AuthScreen({
  supabase,
  config,
  mode,
  onModeChange,
  onRecovered,
}: AuthScreenProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const hasConfirmInput = confirmPassword.length > 0;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const switchMode = (nextMode: AuthMode) => {
    setErrorMsg('');
    setSuccessMsg('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    onModeChange(nextMode);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !config.supabaseConfigured) {
      setErrorMsg('Supabase environment variables are not configured on the server.');
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } else if (mode === 'register') {
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters long.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setSuccessMsg(
            'Account created. Check your inbox and verify your email address before signing in.'
          );
          setPassword('');
          setConfirmPassword('');
        }
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/?type=recovery`,
        });
        if (error) throw error;
        setSuccessMsg(
          'Password reset instructions have been sent if an account exists for that email.'
        );
      } else if (mode === 'recovery') {
        if (password.length < 8) {
          throw new Error('New password must be at least 8 characters long.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setSuccessMsg('Password updated successfully.');
        setTimeout(() => onRecovered(), 700);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Authentication request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#060B16] text-slate-50">
      <section className="hidden lg:flex lg:col-span-6 flex-col justify-between p-14 border-r border-slate-800/80 bg-[radial-gradient(circle_at_15%_10%,rgba(56,189,248,0.09),transparent_50%)]">
        <div className="flex items-center gap-3">
          <OrlixaMark size={28} />
          <span className="font-display text-lg font-bold tracking-tight text-white">
            ORLIXA AI
          </span>
        </div>

        <div className="max-w-xl">
          <h1 className="font-display text-4xl xl:text-[44px] font-bold leading-[1.15] tracking-tight text-white [text-wrap:balance]">
            Your AI. Your Ideas. Your Possibilities.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-300 max-w-[48ch]">
            A focused, private AI workspace engineered by Orlixa Labs for fast reasoning, writing,
            and code collaboration.
          </p>
        </div>

        <div className="text-xs text-slate-500">
          Developed by Orlixa Labs
        </div>
      </section>

      <section className="lg:col-span-6 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[430px] rounded-2xl border border-slate-800 bg-[#0B1221] p-7 sm:p-8">
          <div className="flex items-center gap-2.5 lg:hidden mb-6">
            <OrlixaMark size={24} />
            <span className="font-display text-base font-bold tracking-tight text-white">
              ORLIXA AI
            </span>
          </div>

          {!config.supabaseConfigured && (
            <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-200">
              <div className="flex items-center gap-2 font-semibold text-amber-100 mb-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Environment configuration required</span>
              </div>
              <p className="text-amber-200/90">
                Downloaded builds do not include runtime secrets. Add
                <code className="mx-1 px-1 py-0.5 rounded bg-slate-900 text-sky-300">SUPABASE_URL</code>,
                <code className="mx-1 px-1 py-0.5 rounded bg-slate-900 text-sky-300">SUPABASE_ANON_KEY</code>,
                <code className="mx-1 px-1 py-0.5 rounded bg-slate-900 text-sky-300">SUPABASE_SERVICE_ROLE_KEY</code>,
                <code className="mx-1 px-1 py-0.5 rounded bg-slate-900 text-sky-300">OPENROUTER_API_KEY</code>,
                and
                <code className="mx-1 px-1 py-0.5 rounded bg-slate-900 text-sky-300">OPENROUTER_MODEL</code>
                to your hosting Environment Variables or root <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">.env</code> file, then run the Node server (<code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">npm start</code>).
              </p>
            </div>
          )}

          <div className="mb-6">
            <h2 className="font-display text-2xl font-bold text-white">
              {mode === 'login' && 'Welcome back'}
              {mode === 'register' && 'Create your account'}
              {mode === 'forgot' && 'Reset your password'}
              {mode === 'recovery' && 'Set a new password'}
            </h2>
            <p className="mt-1.5 text-sm text-slate-400">
              {mode === 'login' && 'Sign in to access your ORLIXA AI conversations.'}
              {mode === 'register' && 'Register with your email to start using ORLIXA AI.'}
              {mode === 'forgot' && 'Enter your email address to receive a recovery link.'}
              {mode === 'recovery' && 'Choose a strong password for your account.'}
            </p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-sm text-rose-200"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3.5 text-sm text-emerald-200"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="full-name">
                  Full name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="full-name"
                    type="text"
                    required
                    maxLength={120}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-slate-800 bg-[#070D19] text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="email">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-slate-800 bg-[#070D19] text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {(mode === 'login' || mode === 'register' || mode === 'recovery') && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-300" htmlFor="password">
                    {mode === 'recovery' ? 'New password' : 'Password'}
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs font-medium text-sky-400 hover:text-sky-300 cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={mode === 'login' ? 1 : 8}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'login' ? 'Enter password' : 'At least 8 characters'}
                    className="w-full h-11 pl-10 pr-10 rounded-xl border border-slate-800 bg-[#070D19] text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {(mode === 'register' || mode === 'recovery') && (
              <div>
                <label
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                  htmlFor="confirm-password"
                >
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className={`w-full h-11 pl-10 pr-10 rounded-xl border bg-[#070D19] text-sm text-white placeholder:text-slate-500 focus:outline-none ${
                      hasConfirmInput
                        ? passwordsMatch
                          ? 'border-emerald-500/70 focus:border-emerald-400'
                          : 'border-rose-500/70 focus:border-rose-400'
                        : 'border-slate-800 focus:border-sky-400'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    aria-pressed={showConfirmPassword}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {hasConfirmInput && (
                  <p
                    role="status"
                    aria-live="polite"
                    className={`mt-1.5 flex items-center gap-1.5 text-xs ${
                      passwordsMatch ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {passwordsMatch ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Passwords match</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Passwords do not match</span>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !config.supabaseConfigured}
              className="w-full h-11 rounded-xl bg-sky-400 hover:bg-sky-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-display text-sm font-semibold transition-colors cursor-pointer"
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'register'
                    ? 'Create account'
                    : mode === 'forgot'
                      ? 'Send reset link'
                      : 'Update password'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800/80 text-center text-sm text-slate-400">
            {mode === 'login' && (
              <>
                New to ORLIXA AI?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="font-medium text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  Create an account
                </button>
              </>
            )}
            {(mode === 'register' || mode === 'forgot' || mode === 'recovery') && (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="font-medium text-sky-400 hover:text-sky-300 cursor-pointer"
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
