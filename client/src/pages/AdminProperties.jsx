import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, toNgwee } from '../api.js';
import { Loading, Modal, EmptyState, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

export default function AdminProperties() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useAuth();
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => api.get('/properties?includeArchived=1').then(setRows).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  if (!rows) return <Loading />;

  return (
    <div className="flex flex-col gap-3 px-3.5 pb-6 pt-4">
      <div className="flex items-center justify-between">
        <div className="text-[22px] font-bold tracking-tight">Properties</div>
        <button className="btn-primary px-4 py-2 text-sm" onClick={() => setAdding(true)}>+ Add property</button>
      </div>
      {rows.length === 0 && <EmptyState icon="🏢" title="No properties yet" message="Add your first property." />}
      {rows.map((p) => (
        <button key={p.id} onClick={() => navigate(`/admin/properties/${p.id}`)} className={'card flex items-center gap-3 p-4 text-left ' + (p.archivedAt ? 'opacity-60' : '')}>
          <span className="flex h-11 min-w-[44px] flex-none items-center justify-center rounded-xl bg-brand-light px-1 text-xs font-bold text-paid-text">{p.code}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{p.name}{p.archivedAt && <span className="ml-1 text-xs text-muted">(archived)</span>}</div>
            <div className="truncate text-xs text-muted">{p.address || 'No address'} · {p.roomCount} rooms · {p.bedCount} beds</div>
          </div>
          <span className="text-vacant-border">›</span>
        </button>
      ))}
      {adding && (
        <NewPropertyForm onClose={() => setAdding(false)} onSaved={async (p) => { setAdding(false); await refresh(); navigate(`/admin/properties/${p.id}`); }} />
      )}
    </div>
  );
}

function NewPropertyForm({ onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', address: '', code: '', roomCount: '10', bedCount: '2', rent: '', billingCycle: 'MONTHLY', dueDay: '5' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      const p = await api.post('/properties', {
        name: f.name,
        address: f.address,
        code: f.code,
        roomCount: Number(f.roomCount) || 0,
        bedCount: Number(f.bedCount) || 1,
        defaultRent: toNgwee(f.rent || '0') ?? 0,
        billingCycle: f.billingCycle,
        dueDay: Number(f.dueDay) || 5,
      });
      toast.success(`${p.name} added.`);
      onSaved(p);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Add property" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div><label className="field-label">Name (printed on receipts)</label><input className="field-input" value={f.name} onChange={set('name')} /></div>
        <div><label className="field-label">Address</label><input className="field-input" value={f.address} onChange={set('address')} /></div>
        <div>
          <label className="field-label">Short code</label>
          <input className="field-input uppercase" maxLength={6} value={f.code} onChange={set('code')} placeholder="e.g. KC" />
          <p className="mt-1 text-xs text-muted">2–6 letters/digits, starting with a letter. Receipt numbers look like RCT-{(f.code || 'KC').toUpperCase()}-2026-0001. It can't change after the first receipt.</p>
        </div>
        <div>
          <label className="field-label">How rent is billed</label>
          <div className="grid grid-cols-2 gap-2">
            {[['MONTHLY', 'Every month'], ['TERM', 'Per term / semester']].map(([v, label]) => (
              <button key={v} type="button" onClick={() => setF({ ...f, billingCycle: v })}
                className={'min-h-[44px] rounded-xl text-sm font-semibold ' + (f.billingCycle === v ? 'bg-brand text-white' : 'border border-line bg-white text-muted')}>
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">
            {f.billingCycle === 'TERM' ? 'Add your term dates on the next screen.' : 'Rent is billed on the 1st of each month.'} This can't change once rent has been billed.
          </p>
        </div>
        {f.billingCycle === 'MONTHLY' && (
          <div><label className="field-label">Rent is due on day (1–28)</label><input className="field-input" inputMode="numeric" value={f.dueDay} onChange={set('dueDay')} /></div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div><label className="field-label">Rooms</label><input className="field-input" inputMode="numeric" value={f.roomCount} onChange={set('roomCount')} /></div>
          <div><label className="field-label">Beds/room</label><input className="field-input" inputMode="numeric" value={f.bedCount} onChange={set('bedCount')} /></div>
          <div><label className="field-label">Rent (K) {f.billingCycle === 'TERM' ? '/ term' : '/ month'}</label><input className="field-input" inputMode="decimal" value={f.rent} onChange={set('rent')} /></div>
        </div>
        <p className="text-xs text-muted">Rooms are numbered 1, 2, 3… You can edit each room afterwards.</p>
      </div>
      <div className="mt-5 flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add property'}</button>
      </div>
    </Modal>
  );
}
