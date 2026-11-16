import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Loading, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Settings() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isSuperAdmin, logout, logoutEverywhere } = useAuth();

  const signOutEverywhere = async () => {
    if (!confirm('Sign out on every phone and computer, including this one?')) return;
    try {
      await logoutEverywhere();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">Settings</div>

      <div className="card px-4 py-3.5">
        <div className="text-xs text-muted">Signed in as</div>
        <div className="font-semibold">{user.name ? `${user.name} · ` : ''}{user.email}</div>
        <div className="text-xs font-bold uppercase tracking-wide text-brand">{isSuperAdmin ? 'Super admin' : `Landlord · ${user.organization?.name || ''}`}</div>
      </div>

      {isSuperAdmin && <EmailSettings />}

      {!isSuperAdmin && <div className="card p-4">
        <h2 className="mb-3 text-sm font-bold text-muted">Tenants</h2>
        <button onClick={() => navigate('/past')} className="flex w-full items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left">
          <span className="text-xl">📁</span>
          <div className="flex-1">
            <div className="font-semibold text-ink">Past tenants</div>
            <div className="text-xs text-muted">View, reprint, or archive tenants who moved out</div>
          </div>
          <span className="text-vacant-border">›</span>
        </button>
      </div>}

      <ChangePassword minLength={isSuperAdmin ? 12 : 8} />

      <button onClick={signOutEverywhere} className="btn-secondary w-full">Sign out of all devices</button>
      <button onClick={logout} className="btn-danger w-full">Log out</button>
    </div>
  );
}

function EmailSettings() {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => { api.get('/settings').then(setS).catch((e) => toast.error(e.message)); }, []);

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.put('/settings', s);
      setS(saved);
      toast.success('Email settings saved.');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const testEmail = async () => {
    setTesting(true);
    try {
      await api.put('/settings', s);
      const res = await api.post('/settings/test-email', {});
      toast.success(`Test email sent to ${res.sentTo}.`);
    } catch (e) { toast.error(e.message); } finally { setTesting(false); }
  };

  if (!s) return <Loading />;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const setBool = (k) => (e) => setS({ ...s, [k]: e.target.checked });

  return (
    <Section title="Email settings (all properties)">
      <p className="-mt-1 text-xs text-muted">Used to email receipts and security notices. See the Email setup guide for Gmail / Resend details.</p>
      <Field label="Contact / test email"><input className="field-input" type="email" value={s.landlordEmail} onChange={set('landlordEmail')} /></Field>
      <Field label="SMTP host"><input className="field-input" value={s.smtpHost} onChange={set('smtpHost')} placeholder="smtp.gmail.com" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Port"><input className="field-input" inputMode="numeric" value={s.smtpPort} onChange={set('smtpPort')} /></Field>
        <Field label="Secure (SSL)">
          <label className="flex h-[52px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={s.smtpSecure} onChange={setBool('smtpSecure')} /> <span className="text-sm text-muted">Use SSL</span></label>
        </Field>
      </div>
      <Field label="Username"><input className="field-input" value={s.smtpUser} onChange={set('smtpUser')} placeholder="you@gmail.com" /></Field>
      <Field label={`Password ${s.smtpPassSet ? '(saved — leave blank to keep)' : ''}`}>
        <input className="field-input" type="password" autoComplete="new-password" value={s.smtpPass || ''} onChange={set('smtpPass')} placeholder={s.smtpPassSet ? '••••••••' : 'App password'} />
      </Field>
      <Field label="From name"><input className="field-input" value={s.smtpFromName} onChange={set('smtpFromName')} /></Field>
      <Field label="From email"><input className="field-input" type="email" value={s.smtpFromEmail} onChange={set('smtpFromEmail')} placeholder="Defaults to username" /></Field>
      <button onClick={testEmail} className="btn-secondary w-full" disabled={testing}>{testing ? 'Sending test…' : '✉️ Send test email'}</button>
      <button onClick={save} className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save email settings'}</button>
    </Section>
  );
}

function Section({ title, children }) {
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-bold text-muted">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
function Field({ label, children }) {
  return <div><label className="field-label">{label}</label>{children}</div>;
}

function ChangePassword({ minLength }) {
  const toast = useToast();
  const { setUser } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next.length < minLength) return toast.error(`New password must be at least ${minLength} characters.`);
    setBusy(true);
    try {
      const fresh = await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
      setUser(fresh);
      toast.success('Password changed. Other devices have been signed out.');
      setCur(''); setNext('');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-bold text-muted">Change password</h2>
      <div className="flex flex-col gap-3">
        <input className="field-input" type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input className="field-input" type="password" autoComplete="new-password" placeholder={`New password (min ${minLength} chars)`} value={next} onChange={(e) => setNext(e.target.value)} />
        <button onClick={submit} className="btn-secondary w-full" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      </div>
    </div>
  );
}
