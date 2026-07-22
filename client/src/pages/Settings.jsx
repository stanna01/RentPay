import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Loading, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Settings() {
  const toast = useToast();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => { api.get('/settings').then(setS); }, []);

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.put('/settings', s);
      setS(saved);
      toast.success('Settings saved.');
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
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">Settings</div>

      <Section title="Property (shown on receipts)">
        <Field label="Property name"><input className="field-input" value={s.propertyName} onChange={set('propertyName')} /></Field>
        <Field label="Address"><input className="field-input" value={s.propertyAddress} onChange={set('propertyAddress')} /></Field>
        <Field label="Landlord email"><input className="field-input" type="email" value={s.landlordEmail} onChange={set('landlordEmail')} /></Field>
      </Section>

      <Section title="Email settings">
        <p className="-mt-1 text-xs text-muted">Used to email receipts to tenants. See the Email setup guide for Gmail / Resend details.</p>
        <Field label="SMTP host"><input className="field-input" value={s.smtpHost} onChange={set('smtpHost')} placeholder="smtp.gmail.com" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port"><input className="field-input" inputMode="numeric" value={s.smtpPort} onChange={set('smtpPort')} /></Field>
          <Field label="Secure (SSL)">
            <label className="flex h-[52px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={s.smtpSecure} onChange={setBool('smtpSecure')} /> <span className="text-sm text-muted">Use SSL</span></label>
          </Field>
        </div>
        <Field label="Username"><input className="field-input" value={s.smtpUser} onChange={set('smtpUser')} placeholder="you@gmail.com" /></Field>
        <Field label={`Password ${s.smtpPassSet ? '(saved — leave blank to keep)' : ''}`}>
          <input className="field-input" type="password" value={s.smtpPass || ''} onChange={set('smtpPass')} placeholder={s.smtpPassSet ? '••••••••' : 'App password'} />
        </Field>
        <Field label="From name"><input className="field-input" value={s.smtpFromName} onChange={set('smtpFromName')} /></Field>
        <Field label="From email"><input className="field-input" type="email" value={s.smtpFromEmail} onChange={set('smtpFromEmail')} placeholder="Defaults to username" /></Field>
        <button onClick={testEmail} className="btn-secondary w-full" disabled={testing}>{testing ? 'Sending test…' : '✉️ Send test email'}</button>
      </Section>

      <button onClick={save} className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-bold text-muted">Tenants</h2>
        <button onClick={() => navigate('/past')} className="flex w-full items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left">
          <span className="text-xl">📁</span>
          <div className="flex-1">
            <div className="font-semibold text-ink">Past tenants</div>
            <div className="text-xs text-muted">View, reprint, or archive tenants who moved out</div>
          </div>
          <span className="text-vacant-border">›</span>
        </button>
      </div>

      <ChangePassword />

      <button onClick={logout} className="btn-danger w-full">Log out</button>
    </div>
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

function ChangePassword() {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next.length < 8) return toast.error('New password must be at least 8 characters.');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
      toast.success('Password changed.');
      setCur(''); setNext('');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-bold text-muted">Change password</h2>
      <div className="flex flex-col gap-3">
        <input className="field-input" type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input className="field-input" type="password" placeholder="New password (min 8 chars)" value={next} onChange={(e) => setNext(e.target.value)} />
        <button onClick={submit} className="btn-secondary w-full" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      </div>
    </div>
  );
}
