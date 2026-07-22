import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, toNgwee } from '../api.js';
import { Loading, useToast } from '../ui.jsx';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function AssignTenant() {
  const { roomNumber, bed } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const roomLabel = `${roomNumber}${bed}`;

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [moveIn, setMoveIn] = useState(todayISO());
  const [rent, setRent] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/rooms/${roomNumber}/${bed}`).then((r) => {
      setRent((r.room.defaultRent / 100).toString());
      if (r.tenancy) {
        toast.info('This bed is already occupied.');
        navigate(`/tenancy/${r.tenancy.id}`, { replace: true });
      }
    }).finally(() => setLoading(false));
  }, [roomNumber, bed]);

  const submit = async (e) => {
    e.preventDefault();
    const ngwee = toNgwee(rent);
    if (!name.trim() || ngwee == null || ngwee <= 0) return toast.error('Please enter at least a name and rent.');
    setBusy(true);
    try {
      const tenancy = await api.post('/tenancies', {
        roomNumber: Number(roomNumber),
        bed,
        newTenant: { name, phone, email },
        monthlyRent: ngwee,
        moveInDate: moveIn,
      });
      toast.success(`${name.trim()} assigned to Room ${roomLabel}`);
      navigate(`/tenancy/${tenancy.id}`, { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="flex items-center gap-3">
        <div className="flex h-[54px] w-[54px] flex-none flex-col items-center justify-center rounded-[13px] bg-brand text-white">
          <div className="text-[9px] font-bold uppercase tracking-wider opacity-80">Room</div>
          <div className="text-[18px] font-bold leading-none">{roomLabel}</div>
        </div>
        <div className="text-[20px] font-bold tracking-tight">Assign tenant to Room {roomLabel}</div>
      </div>

      <div className="rounded-xl border border-paid-border bg-brand-light px-3.5 py-3 text-[13.5px] font-semibold text-paid-text">
        This bed is free — just add the new tenant below. Any previous tenant's receipts stay
        safely in your records.
      </div>

      <div className="card flex flex-col gap-3 p-4">
        <div><label className="field-label">Full name</label><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mary Banda" /></div>
        <div><label className="field-label">Phone</label><input className="field-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+260 97 …" /></div>
        <div><label className="field-label">Email</label><input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field-label">Move-in</label><input className="field-input" type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} /></div>
          <div><label className="field-label">Rent for this bed (K)</label><input className="field-input" inputMode="numeric" value={rent} onChange={(e) => setRent(e.target.value)} /></div>
        </div>
        <button type="submit" className="btn-primary w-full text-[16px]" disabled={busy}>{busy ? 'Assigning…' : 'Assign tenant'}</button>
      </div>
    </form>
  );
}
