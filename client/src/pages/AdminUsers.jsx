import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Loading, Modal, useToast, fmtDateTime } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

const ROLE_LABEL = { ADMIN: 'Administrator', LANDLORD: 'Landlord' };

export default function AdminUsers() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [properties, setProperties] = useState([]);
  const [editing, setEditing] = useState(null); // user | 'new'
  const [resetting, setResetting] = useState(null);

  const load = () => {
    api.get('/admin/users').then(setUsers).catch((e) => toast.error(e.message));
    api.get('/properties?includeArchived=1').then(setProperties).catch(() => {});
  };
  useEffect(load, []);

  const act = async (fn, msg) => {
    try { await fn(); toast.success(msg); load(); } catch (e) { toast.error(e.message); }
  };

  if (!users) return <Loading />;

  return (
    <div className="flex flex-col gap-3 px-3.5 pb-6 pt-4">
      <div className="flex items-center justify-between">
        <div className="text-[22px] font-bold tracking-tight">Users</div>
        <button className="btn-primary px-4 py-2 text-sm" onClick={() => setEditing('new')}>+ Add user</button>
      </div>

      {users.map((u) => {
        const self = u.id === me.id;
        const props = properties.filter((p) => u.propertyIds.includes(p.id)).map((p) => p.name);
        return (
          <div key={u.id} className={'card p-4 ' + (u.isActive ? '' : 'opacity-60')}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{u.name || u.email}{self && <span className="ml-1 text-xs text-muted">(you)</span>}</div>
                <div className="truncate text-xs text-muted">{u.email}</div>
              </div>
              <span className={'rounded-full px-2.5 py-0.5 text-xs font-bold ' + (u.role === 'ADMIN' ? 'bg-brand text-white' : 'bg-surface text-ink')}>{ROLE_LABEL[u.role]}</span>
            </div>
            <div className="mt-2 text-xs text-muted">
              {u.role === 'ADMIN' ? 'All properties' : props.length ? props.join(', ') : 'No properties assigned'}
              {' · '}{u.lastLoginAt ? `last sign-in ${fmtDateTime(u.lastLoginAt)}` : 'never signed in'}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold">
              {!u.isActive && <span className="rounded-full bg-vacant-bg px-2 py-0.5 text-vacant-text">Deactivated</span>}
              {u.mustChangePassword && <span className="rounded-full bg-partial-bg px-2 py-0.5 text-partial-text">Temporary password</span>}
              {u.lockedUntil && <span className="rounded-full bg-due-bg px-2 py-0.5 text-due-text">Locked until {fmtDateTime(u.lockedUntil)}</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[12.5px]">
              <Btn onClick={() => setEditing(u)}>Edit</Btn>
              <Btn onClick={() => setResetting(u)}>Reset password</Btn>
              {u.lockedUntil && <Btn onClick={() => act(() => api.post(`/admin/users/${u.id}/unlock`, {}), 'Account unlocked.')}>Unlock</Btn>}
              {!self && <Btn onClick={() => act(() => api.post(`/admin/users/${u.id}/revoke-sessions`, {}), 'Signed out on all devices.')}>Sign out everywhere</Btn>}
              {!self && (u.isActive ? (
                <Btn onClick={() => confirm(`Deactivate ${u.email}? They will be signed out and unable to sign in.`) && act(() => api.patch(`/admin/users/${u.id}`, { isActive: false }), 'User deactivated.')}>Deactivate</Btn>
              ) : (
                <Btn onClick={() => act(() => api.patch(`/admin/users/${u.id}`, { isActive: true }), 'User reactivated.')}>Reactivate</Btn>
              ))}
              {!self && (
                <Btn danger onClick={() => confirm(`Permanently delete ${u.email}? Their past actions stay in the audit log. Deactivating is usually better.`) && act(() => api.del(`/admin/users/${u.id}`), 'User deleted.')}>Delete</Btn>
              )}
            </div>
          </div>
        );
      })}

      {editing && (
        <UserForm user={editing === 'new' ? null : editing} self={editing !== 'new' && editing.id === me.id} properties={properties}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
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

function UserForm({ user, self, properties, onClose, onSaved }) {
  const toast = useToast();
  const [email, setEmail] = useState(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [role, setRole] = useState(user?.role || 'LANDLORD');
  const [propertyIds, setPropertyIds] = useState(user?.propertyIds || []);
  const [tempPassword, setTempPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (id) => setPropertyIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = async () => {
    setBusy(true);
    try {
      if (user) {
        await api.patch(`/admin/users/${user.id}`, { name, ...(self ? {} : { role }), propertyIds });
        toast.success('User updated.');
      } else {
        await api.post('/admin/users', { email, name, role, propertyIds, tempPassword });
        toast.success('User created. Give them the temporary password — they must change it when they first sign in.');
      }
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={user ? `Edit ${user.email}` : 'Add user'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {!user && <div><label className="field-label">Email</label><input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>}
        <div><label className="field-label">Name</label><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <label className="field-label">Role</label>
          <select className="field-input" value={role} disabled={self} onChange={(e) => setRole(e.target.value)}>
            <option value="LANDLORD">Landlord — day-to-day: tenants, payments, receipts</option>
            <option value="ADMIN">Administrator — full control, incl. voids, users, properties</option>
          </select>
          {self && <p className="mt-1 text-xs text-muted">You cannot change your own role.</p>}
        </div>
        {role === 'LANDLORD' && (
          <div>
            <div className="field-label">Properties they can manage</div>
            {properties.length === 0 && <p className="text-xs text-muted">No properties yet.</p>}
            {properties.map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={propertyIds.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.name}{p.archivedAt && <span className="text-xs text-muted">(archived)</span>}
              </label>
            ))}
          </div>
        )}
        {!user && (
          <div>
            <label className="field-label">Temporary password</label>
            <input className="field-input" type="text" autoComplete="off" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
            <p className="mt-1 text-xs text-muted">At least {role === 'ADMIN' ? 12 : 8} characters. They must change it at first sign-in.</p>
          </div>
        )}
      </div>
      <div className="mt-5 flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
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
      <div className="mt-5 flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Set temporary password'}</button>
      </div>
    </Modal>
  );
}
