import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../ui.jsx';

// Shown instead of the app when the account has a temporary or default
// password (new user, admin reset, first sign-in after setup).
export default function ChangePasswordRequired() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const min = user?.role === 'SUPER_ADMIN' ? 12 : 8;

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < min) return toast.error(`New password must be at least ${min} characters.`);
    if (pw !== confirm) return toast.error('The two passwords do not match.');
    setBusy(true);
    try {
      const fresh = await api.post('/auth/change-password', { currentPassword: cur, newPassword: pw });
      setUser(fresh);
      toast.success('Password changed. Welcome!');
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
        <h1 className="text-2xl font-bold tracking-tight">Choose your own password</h1>
        <p className="mt-1 text-brand-light">You're signed in with a temporary password. Set a new one to continue.</p>
      </div>
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <label className="field-label" htmlFor="cur">Temporary password</label>
        <input id="cur" type="password" autoComplete="current-password" className="field-input mb-4" value={cur} onChange={(e) => setCur(e.target.value)} required />
        <label className="field-label" htmlFor="np">New password</label>
        <input id="np" type="password" autoComplete="new-password" className="field-input mb-1" value={pw} onChange={(e) => setPw(e.target.value)} required />
        <p className="mb-4 text-xs text-muted">At least {min} characters. A short phrase of a few words is easy to remember and hard to guess.</p>
        <label className="field-label" htmlFor="cp">Confirm new password</label>
        <input id="cp" type="password" autoComplete="new-password" className="field-input mb-6" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
        <button type="button" onClick={logout} className="mt-4 w-full text-center text-sm font-semibold text-brand">Sign out</button>
      </form>
    </div>
  );
}
