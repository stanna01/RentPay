import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useToast } from '../ui.jsx';
import { api } from '../api.js';

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState('login'); // 'login' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');

  const submitLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(res.message || 'If that email is registered, a reset link has been sent.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand px-6">
      <div className="mb-8 text-center text-white">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-3xl font-bold">R</div>
        <h1 className="text-2xl font-bold tracking-tight">RentReceipt</h1>
        <p className="mt-1 text-brand-light">
          {mode === 'login' ? 'Sign in to manage your property' : 'Reset your password'}
        </p>
      </div>

      {mode === 'login' ? (
        <form onSubmit={submitLogin} className="card w-full max-w-sm p-6">
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" className="field-input mb-4" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" className="field-input mb-6" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" onClick={() => { setMode('forgot'); setSent(''); }} className="mt-4 w-full text-center text-sm font-semibold text-brand">
            Forgot password?
          </button>
        </form>
      ) : (
        <form onSubmit={submitForgot} className="card w-full max-w-sm p-6">
          {sent ? (
            <>
              <p className="mb-6 text-sm text-ink">{sent}</p>
              <button type="button" onClick={() => setMode('login')} className="btn-primary w-full">Back to sign in</button>
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted">Enter your account email and we'll send a link to set a new password.</p>
              <label className="field-label" htmlFor="femail">Email</label>
              <input id="femail" type="email" autoComplete="username" className="field-input mb-6" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
              <button type="button" onClick={() => setMode('login')} className="mt-4 w-full text-center text-sm font-semibold text-brand">Back to sign in</button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
