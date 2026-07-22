import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../ui.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error('New password must be at least 8 characters.');
    if (pw !== confirm) return toast.error('The two passwords do not match.');
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: pw });
      setDone(true);
      toast.success('Password changed. You can sign in now.');
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
        <p className="mt-1 text-brand-light">Choose a new password</p>
      </div>

      <div className="card w-full max-w-sm p-6">
        {!token ? (
          <>
            <p className="mb-6 text-sm text-ink">This reset link is missing its token. Please use the link from your email again, or request a new one.</p>
            <button onClick={() => navigate('/login')} className="btn-primary w-full">Back to sign in</button>
          </>
        ) : done ? (
          <>
            <p className="mb-6 text-sm text-ink">Your password has been changed.</p>
            <button onClick={() => navigate('/login')} className="btn-primary w-full">Sign in</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <label className="field-label" htmlFor="np">New password</label>
            <input id="np" type="password" autoComplete="new-password" className="field-input mb-4" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" required />
            <label className="field-label" htmlFor="cp">Confirm password</label>
            <input id="cp" type="password" autoComplete="new-password" className="field-input mb-6" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat new password" required />
            <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
