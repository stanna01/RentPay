import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatK, toNgwee, fmtDay, perShort } from '../api.js';
import { Loading, Modal, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

export default function AdminPropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useAuth();
  const [p, setP] = useState(null);
  const [form, setForm] = useState(null);
  const [roomEdit, setRoomEdit] = useState(null); // room | 'new'
  const [termEdit, setTermEdit] = useState(null); // term | 'new'
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get(`/properties/${id}`).then((d) => {
      setP(d);
      setForm({ name: d.name, address: d.address, code: d.code, billingCycle: d.billingCycle, dueDay: String(d.dueDay) });
    }).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [id]);

  const act = async (fn, msg, after) => {
    try { await fn(); toast.success(msg); await refresh(); after ? after() : load(); } catch (e) { toast.error(e.message); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/properties/${id}`, { ...form, dueDay: Number(form.dueDay) || 1 });
      toast.success('Property saved.');
      await refresh();
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!p || !form) return <Loading />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const activeRooms = p.rooms.filter((r) => !r.archivedAt);
  const archivedRooms = p.rooms.filter((r) => r.archivedAt);

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">{p.name}{p.archivedAt && <span className="ml-2 text-sm text-muted">(archived)</span>}</div>

      <div className="card flex flex-col gap-3 p-4">
        <div><label className="field-label">Name (printed on receipts)</label><input className="field-input" value={form.name} onChange={set('name')} /></div>
        <div><label className="field-label">Address</label><input className="field-input" value={form.address} onChange={set('address')} /></div>
        <div>
          <label className="field-label">Short code</label>
          <input className="field-input uppercase" maxLength={6} value={form.code} onChange={set('code')} disabled={p.receiptsIssued} />
          {p.receiptsIssued && <p className="mt-1 text-xs text-muted">Locked: receipts have been issued with this code.</p>}
        </div>
        <div className="border-t border-line pt-3">
          <label className="field-label">How rent is billed</label>
          <div className="grid grid-cols-2 gap-2">
            {[['MONTHLY', 'Every month'], ['TERM', 'Per term / semester']].map(([v, label]) => (
              <button key={v} type="button" disabled={p.rentBilled} onClick={() => setForm({ ...form, billingCycle: v })}
                className={'min-h-[44px] rounded-xl text-sm font-semibold disabled:opacity-60 ' + (form.billingCycle === v ? 'bg-brand text-white' : 'border border-line bg-white text-muted')}>
                {label}
              </button>
            ))}
          </div>
          {p.rentBilled && <p className="mt-1 text-xs text-muted">Locked: rent has already been billed here.</p>}
          {form.billingCycle === 'MONTHLY' && (
            <div className="mt-3">
              <label className="field-label">Rent is due on day</label>
              <input className="field-input" inputMode="numeric" value={form.dueDay} onChange={set('dueDay')} />
              <p className="mt-1 text-xs text-muted">1–28. Each month's rent is billed on the 1st and is overdue after this day.</p>
            </div>
          )}
        </div>
        <button className="btn-primary w-full" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save property'}</button>
      </div>

      {p.billingCycle === 'TERM' && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-[15px] font-bold">Terms ({p.terms.length})</span>
            <button className="text-sm font-semibold text-brand" onClick={() => setTermEdit('new')}>+ Add term</button>
          </div>
          {p.terms.length === 0 && (
            <div className="px-4 py-3 text-[13.5px] text-muted">
              Add your terms (e.g. "Semester 1 2027"). Each tenant is billed the term's rent once the term starts.
            </div>
          )}
          {p.terms.map((t) => (
            <button key={t.id} onClick={() => !t.billed && setTermEdit(t)} className="flex w-full items-center gap-2 border-b border-[#F0F2EE] px-4 py-2.5 text-left text-[14px] last:border-0">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{t.name}</div>
                <div className="text-[12px] text-muted">{fmtDay(t.startDate)} – {fmtDay(t.endDate)} · due {fmtDay(t.dueDate)}</div>
              </div>
              {t.billed ? <span className="text-[12px] text-muted">Billed</span> : <span className="text-vacant-border">›</span>}
            </button>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[15px] font-bold">Rooms ({activeRooms.length})</span>
          <button className="text-sm font-semibold text-brand" onClick={() => setRoomEdit('new')}>+ Add room</button>
        </div>
        {activeRooms.map((r) => (
          <button key={r.id} onClick={() => setRoomEdit(r)} className="flex w-full items-center gap-2 border-b border-[#F0F2EE] px-4 py-2.5 text-left text-[14px] last:border-0">
            <span className="flex-1 font-semibold">Room {r.number}</span>
            <span className="text-muted">{r.bedCount} bed{r.bedCount === 1 ? '' : 's'} · {formatK(r.defaultRent)} {perShort(p.billingCycle)}</span>
            <span className="text-vacant-border">›</span>
          </button>
        ))}
        {archivedRooms.length > 0 && (
          <div className="bg-surface px-4 py-2 text-xs font-bold uppercase text-muted">Removed rooms</div>
        )}
        {archivedRooms.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-b border-[#F0F2EE] px-4 py-2.5 text-[14px] text-muted last:border-0">
            <span className="flex-1">Room {r.number}</span>
            <button className="text-sm font-semibold text-brand" onClick={() => act(() => api.post(`/rooms/${r.id}/unarchive`, {}), `Room ${r.number} restored.`)}>Restore</button>
          </div>
        ))}
      </div>

      {p.archivedAt ? (
        <button className="btn-secondary w-full" onClick={() => act(() => api.post(`/properties/${id}/unarchive`, {}), 'Property restored.')}>Restore property</button>
      ) : (
        <button className="btn-secondary w-full" onClick={() => confirm('Archive this property? It will be hidden everywhere; all records are kept.') && act(() => api.post(`/properties/${id}/archive`, {}), 'Property archived.')}>Archive property</button>
      )}
      <button className="btn-danger w-full" onClick={() => confirm(`Permanently delete ${p.name} and its rooms? Only possible if it has never had tenants.`) && act(() => api.del(`/properties/${id}`), 'Property deleted.', () => navigate('/admin/properties', { replace: true }))}>
        Delete property
      </button>

      {termEdit && (
        <TermForm propertyId={p.id} term={termEdit === 'new' ? null : termEdit}
          onClose={() => setTermEdit(null)} onSaved={() => { setTermEdit(null); load(); }} />
      )}
      {roomEdit && (
        <RoomForm propertyId={p.id} room={roomEdit === 'new' ? null : roomEdit} nextNumber={Math.max(0, ...p.rooms.map((r) => r.number)) + 1}
          onClose={() => setRoomEdit(null)} onSaved={() => { setRoomEdit(null); load(); }} />
      )}
    </div>
  );
}

function TermForm({ propertyId, term, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: term?.name || '', startDate: term?.startDate || '', endDate: term?.endDate || '', dueDate: term?.dueDate || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast.success(msg); onSaved(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={term ? term.name : 'Add term'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div><label className="field-label">Name (shown on bills and receipts)</label><input className="field-input" maxLength={80} value={f.name} onChange={set('name')} placeholder="e.g. Semester 1 2027" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field-label">First day</label><input className="field-input" type="date" value={f.startDate} onChange={set('startDate')} /></div>
          <div><label className="field-label">Last day</label><input className="field-input" type="date" value={f.endDate} onChange={set('endDate')} /></div>
        </div>
        <div><label className="field-label">Rent due by</label><input className="field-input" type="date" value={f.dueDate} onChange={set('dueDate')} /></div>
        <p className="text-xs text-muted">Terms can't overlap. Once rent has been billed for a term, it can no longer be changed.</p>
      </div>
      <div className="mt-5 flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-1" disabled={busy}
          onClick={() => run(() => (term ? api.patch(`/properties/${propertyId}/terms/${term.id}`, f) : api.post(`/properties/${propertyId}/terms`, f)), 'Term saved.')}>
          {busy ? 'Saving…' : 'Save term'}
        </button>
      </div>
      {term && (
        <button className="btn-danger mt-3 w-full" disabled={busy} onClick={() => confirm(`Delete ${term.name}?`) && run(() => api.del(`/properties/${propertyId}/terms/${term.id}`), 'Term deleted.')}>
          Delete term
        </button>
      )}
    </Modal>
  );
}

function RoomForm({ propertyId, room, nextNumber, onClose, onSaved }) {
  const toast = useToast();
  const [number, setNumber] = useState(String(room?.number ?? nextNumber));
  const [bedCount, setBedCount] = useState(String(room?.bedCount ?? 2));
  const [rent, setRent] = useState(room ? String(room.defaultRent / 100) : '');
  const [busy, setBusy] = useState(false);

  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast.success(msg); onSaved(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const body = () => ({ number: Number(number), bedCount: Number(bedCount), defaultRent: toNgwee(rent || '0') ?? -1 });

  return (
    <Modal title={room ? `Room ${room.number}` : 'Add room'} onClose={onClose}>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="field-label">Number</label><input className="field-input" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
        <div><label className="field-label">Beds</label><input className="field-input" inputMode="numeric" value={bedCount} onChange={(e) => setBedCount(e.target.value)} /></div>
        <div><label className="field-label">Rent (K)</label><input className="field-input" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} /></div>
      </div>
      <p className="mt-2 text-xs text-muted">Default rent is suggested when a tenant is assigned; each tenant's own rent is set on their tenancy. To raise the rent of people already living here, use Manage → Notices → Rent increase.</p>
      <div className="mt-5 flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-1" disabled={busy}
          onClick={() => run(() => (room ? api.patch(`/rooms/${room.id}`, body()) : api.post(`/properties/${propertyId}/rooms`, body())), 'Room saved.')}>
          {busy ? 'Saving…' : 'Save room'}
        </button>
      </div>
      {room && (
        <div className="mt-3 flex gap-3">
          <button className="btn-secondary flex-1" disabled={busy} onClick={() => run(() => api.post(`/rooms/${room.id}/archive`, {}), 'Room removed (records kept).')}>Remove room</button>
          <button className="btn-danger flex-1" disabled={busy} onClick={() => confirm('Delete this room permanently? Only possible if it never had a tenant.') && run(() => api.del(`/rooms/${room.id}`), 'Room deleted.')}>Delete</button>
        </div>
      )}
    </Modal>
  );
}
