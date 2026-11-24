import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, toNgwee, perLabel, todayDay } from '../api.js';
import { Loading, useToast } from '../ui.jsx';


export default function AssignTenant() {
  const { roomId, bed } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [roomLabel, setRoomLabel] = useState(bed);

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [moveIn, setMoveIn] = useState(todayDay());
  const [rent, setRent] = useState('');
  const [deposit, setDeposit] = useState('');
  const [cycle, setCycle] = useState('MONTHLY');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/rooms/${roomId}/${bed}`).then((r) => {
      setRoomLabel(r.roomLabel);
      setRent((r.room.defaultRent / 100).toString());
      setCycle(r.room.property?.billingCycle || 'MONTHLY');
      if (r.tenancy) {
        toast.info('This bed is already occupied.');
        navigate(`/tenancy/${r.tenancy.id}`, { replace: true });
      }
    }).catch((e) => { toast.error(e.message); navigate('/', { replace: true }); }).finally(() => setLoading(false));
  }, [roomId, bed]);

  const submit = async (e) => {
    e.preventDefault();
    const ngwee = toNgwee(rent);
    if (!name.trim() || ngwee == null || ngwee <= 0) return toast.error('Please enter at least a name and rent.');
    const depositNgwee = deposit.trim() ? toNgwee(deposit) : 0;
    if (depositNgwee == null) return toast.error('Please enter a valid deposit, or leave it empty.');
    setBusy(true);
    try {
      const tenancy = await api.post('/tenancies', {
        roomId: Number(roomId),
        bed,
        newTenant: { name, phone, email },
        rent: ngwee,
        moveInDate: moveIn,
      });
      if (depositNgwee > 0) {
        await api.post(`/tenancies/${tenancy.id}/charges`, { type: 'DEPOSIT', description: 'Deposit', amount: depositNgwee, dueDate: moveIn });
      }
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
          <div><label className="field-label">Rent (K) {perLabel(cycle)}</label><input className="field-input" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} /></div>
        </div>
        <div>
          <label className="field-label">Deposit (K) <span className="font-normal text-muted">— optional</span></label>
          <input className="field-input" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" />
        </div>
        <p className="text-xs text-muted">
          {cycle === 'TERM'
            ? 'Rent is billed for every term that overlaps the stay, from the move-in date.'
            : 'Rent is billed for every month from the move-in date.'}{' '}
          A move-in before today bills the past months too.
        </p>
        <button type="submit" className="btn-primary w-full text-[16px]" disabled={busy}>{busy ? 'Assigning…' : 'Assign tenant'}</button>
      </div>
    </form>
  );
}
