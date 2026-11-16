import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Loading, Modal, EmptyState, useToast, fmtDateTime } from '../ui.jsx';

/** Super admin: every landlord business, with its sign-in account and size. */
export default function AdminLandlords() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [resetting, setResetting] = useState(null);

  const load = () => api.get('/admin/landlords').then(setRows).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const act = async (fn, msg) => {
    try { await fn(); toast.success(msg); load(); } catch (e) { toast.error(e.message); }
  };

  if (!rows) return <Loading />;

  return (
    <div className="flex flex-col gap-3 px-3.5 pb-6 pt-4">
      <div className="flex items-center justify-between">
        <div className="text-[22px] font-bold tracking-tight">Landlords</div>
        <button className="btn-primary px-4 py-2 text-sm" onClick={() => setAdding(true)}>+ Add landlord</button>
      </div>
      <p className="-mt-1 text-xs text-muted">Each landlord sees only their own properties, tenants and payments.</p>

      {rows.length === 0 && <EmptyState icon="🏢" title="No landlords yet" message="Add the first landlord to get started." />}

      {rows.map((o) => (
        <div key={o.id} className={'card p-4 ' + (o.isActive ? '' : 'opacity-70')}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{o.name}</div>
              <div className="text-xs text-muted">
                {o.propertyCount} {o.propertyCount === 1 ? 'property' : 'properties'} · {o.occupiedBeds} of {o.bedCount} beds occupied
              </div>
            </div>
            {!o.isActive && <span className="rounded-full bg-due-bg px-2.5 py-0.5 text-xs font-bold text-due-text">Suspended</span>}
          </div>

          {o.users.map((u) => (
            <div key={u.id} className="mt-3 rounded-xl border border-line bg-surface px-3 py-2.5">
              <div className="truncate text-sm font-semibold">{u.name || u.email}</div>
              <div className="truncate text-xs text-muted">
                {u.email} · {u.lastLoginAt ? `last sign-in ${fmtDateTime(u.lastLoginAt)}` : 'never signed in'}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold">
                {u.mustChangePassword && <span className="rounded-full bg-partial-bg px-2 py-0.5 text-partial-text">Temporary password</span>}
                {u.lockedUntil && <span className="rounded-full bg-due-bg px-2 py-0.5 text-due-text">Locked until {fmtDateTime(u.lockedUntil)}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
                <Btn onClick={() => setResetting(u)}>Reset password</Btn>
                {u.lockedUntil && <Btn onClick={() => act(() => api.post(`/admin/users/${u.id}/unlock`, {}), 'Account unlocked.')}>Unlock</Btn>}
                <Btn onClick={() => act(() => api.post(`/admin/users/${u.id}/revoke-sessions`, {}), 'Signed out on all devices.')}>Sign out everywhere</Btn>
              </div>
            </div>
          ))}

          <div className="mt-3 flex flex-wrap gap-1.5 text-[12.5px]">
            <Btn onClick={() => setRenaming(o)}>Rename</Btn>
            {o.isActive ? (
              <Btn danger onClick={() => confirm(`Suspend ${o.name}? They will be signed out and unable to sign in until you reactivate them. Their records are kept.`) && act(() => api.patch(`/admin/landlords/${o.id}`, { isActive: false }), 'Landlord suspended.')}>Suspend</Btn>
            ) : (
              <Btn onClick={() => act(() => api.patch(`/admin/landlords/${o.id}`, { isActive: true }), 'Landlord reactivated.')}>Reactivate</Btn>
            )}
          </div>
        </div>
      ))}

      {adding && <NewLandlordForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {renaming && <RenameForm landlord={renaming} onClose={() => setRenaming(null)} onSaved={() => { setRenaming(null); load(); }} />}
      {resetting && <ResetForm user={resetting} onClose={() => setResetting(null)} onSaved={() => { setResetting(null); load(); }} />}
    </div>
  );
}

function Btn({ children, onClick, danger }) {
  return (
    <button onClick={onClick}
      className={'min-h-[36px] rounded-lg border px-2.5 font-semibold ' + (danger ? 'border-[#F2D7D0] bg-due-bg text-due-text' : 'border-line bg-white text-ink')}>
      {children}
    </button>
  );
}

function FormButtons({ onClose, onSave, busy, label }) {
  return (
    <div className="mt-5 flex gap-3">
      <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
      <button className="btn-primary flex-1" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : label}</button>
    </div>
  );
}

function NewLandlordForm({ onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', ownerName: '', ownerEmail: '', tempPassword: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/admin/landlords', f);
      toast.success('Landlord added. Give them the temporary password — they must change it when they first sign in.');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Add landlord" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div><label className="field-label">Landlord or business name</label><input className="field-input" value={f.name} onChange={set('name')} placeholder="e.g. Kabulonga Court Ltd" /></div>
        <div><label className="field-label">Contact person</label><input className="field-input" value={f.ownerName} onChange={set('ownerName')} /></div>
        <div><label className="field-label">Sign-in email</label><input className="field-input" type="email" value={f.ownerEmail} onChange={set('ownerEmail')} /></div>
        <div>
          <label className="field-label">Temporary password</label>
          <input className="field-input" type="text" autoComplete="off" value={f.tempPassword} onChange={set('tempPassword')} />
          <p className="mt-1 text-xs text-muted">At least 8 characters. They must change it at first sign-in.</p>
        </div>
      </div>
      <FormButtons onClose={onClose} onSave={save} busy={busy} label="Add landlord" />
    </Modal>
  );
}

function RenameForm({ landlord, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(landlord.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/landlords/${landlord.id}`, { name });
      toast.success('Landlord renamed.');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Rename ${landlord.name}`} onClose={onClose}>
      <label className="field-label">Landlord or business name</label>
      <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
      <FormButtons onClose={onClose} onSave={save} busy={busy} label="Save" />
    </Modal>
  );
}

function ResetForm({ user, onClose, onSaved }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/users/${user.id}/reset-password`, { tempPassword: pw });
      toast.success('Temporary password set. They have been signed out and must choose a new password.');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Reset password for ${user.email}`} onClose={onClose}>
      <label className="field-label">Temporary password</label>
      <input className="field-input" type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
      <p className="mt-1 text-xs text-muted">Share it with them privately. It also clears any sign-in lockout.</p>
      <FormButtons onClose={onClose} onSave={save} busy={busy} label="Set temporary password" />
    </Modal>
  );
}
