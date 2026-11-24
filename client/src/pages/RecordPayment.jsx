import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs, formatK, toNgwee, fmtDay, perShort, todayDay } from '../api.js';
import { Loading, EmptyState, StatusBadge, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'bank', label: 'Bank' },
];

/**
 * Open charges as they will be when this payment is saved. When correcting,
 * the money the original payment put on each charge is given back first
 * (the server does the same when it voids the original).
 */
function openChargesFor(profile, correcting) {
  const back = new Map();
  for (const l of correcting?.lines || []) back.set(l.chargeId, (back.get(l.chargeId) || 0) + l.paid);
  return profile.charges
    .filter((c) => c.status !== 'CANCELLED')
    .map((c) => ({ ...c, balance: c.balance + (back.get(c.id) || 0) }))
    .filter((c) => c.balance > 0);
}

/** Where the money goes: picked charges first, then the oldest due. Mirrors the server. */
function plan(amount, open, pickedIds) {
  const order = [...pickedIds.map((id) => open.find((c) => c.id === id)).filter(Boolean), ...open.filter((c) => !pickedIds.includes(c.id))];
  let left = amount;
  const lines = [];
  for (const c of order) {
    if (left <= 0) break;
    const take = Math.min(left, c.balance);
    lines.push({ id: c.id, description: c.description, take, after: c.balance - take });
    left -= take;
  }
  return { lines, credit: Math.max(0, left) };
}

export default function RecordPayment() {
  const navigate = useNavigate();
  const toast = useToast();
  const { propertyId, isOwner } = useAuth();
  const [params] = useSearchParams();
  const preId = params.get('tenancyId');
  const correctId = params.get('correct'); // payment id being corrected

  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tenancyId, setTenancyId] = useState('');
  const [profile, setProfile] = useState(null);
  const [picked, setPicked] = useState([]); // charge ids to pay first, in tap order
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [datePaid, setDatePaid] = useState(todayDay());
  const [reason, setReason] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  const correcting = useMemo(
    () => (correctId && profile ? profile.payments.find((p) => String(p.id) === String(correctId) && p.status === 'ACTIVE') : null),
    [correctId, profile]
  );

  useEffect(() => {
    if (correctId && preId) {
      // Correction: go straight to the tenancy, which may be in any property.
      pick(preId).finally(() => setLoading(false));
      return;
    }
    if (!propertyId) { setLoading(false); return; }
    api.get(`/rooms${qs({ propertyId })}`).then((data) => {
      const opts = [];
      for (const room of data.rooms)
        for (const bed of room.beds)
          if (bed.tenancyId) opts.push({ id: bed.tenancyId, label: `${bed.tenantName} — Room ${bed.roomLabel}${bed.balance > 0 ? ` · owes ${formatK(bed.balance)}` : ''}` });
      setOptions(opts);
      if (preId && opts.some((o) => String(o.id) === String(preId))) pick(preId);
    }).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [propertyId]);

  const pick = async (id) => {
    setTenancyId(id);
    setProfile(null);
    setPicked([]);
    if (!id) { setAmount(''); return; }
    try {
      const p = await api.get(`/tenancies/${id}`);
      setProfile(p);
      const orig = correctId ? p.payments.find((x) => String(x.id) === String(correctId)) : null;
      if (orig) {
        setAmount(String(orig.amount / 100));
        setMethod(orig.method);
        setDatePaid(String(orig.datePaid).slice(0, 10));
      } else {
        setAmount(p.owed > 0 ? String(p.owed / 100) : '');
      }
    } catch (e) { toast.error(e.message); }
  };

  const open = useMemo(() => (profile ? openChargesFor(profile, correcting) : []), [profile, correcting]);
  const owedNow = open.reduce((s, c) => s + c.balance, 0);
  const amountNgwee = toNgwee(amount) ?? 0;
  const preview = useMemo(() => plan(amountNgwee, open, picked), [amountNgwee, open, picked]);

  const toggle = (c) => {
    setPicked((prev) => {
      const next = prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id];
      if (next.length) setAmount(String(next.reduce((s, id) => s + (open.find((o) => o.id === id)?.balance || 0), 0) / 100));
      else setAmount(owedNow > 0 ? String(owedNow / 100) : '');
      return next;
    });
  };

  const submit = async () => {
    if (amountNgwee <= 0) return toast.error('Enter the amount received');
    if (correcting && reason.trim().length < 3) return toast.error('Please give a reason for the correction.');
    setBusy(true);
    try {
      const body = { amount: amountNgwee, method, datePaid, chargeIds: picked, sendEmail };
      const res = correcting
        ? await api.post(`/payments/${correcting.id}/correct`, { ...body, reason: reason.trim() })
        : await api.post('/payments', { ...body, tenancyId: Number(tenancyId) });
      if (correcting) toast.success(`Corrected. New receipt ${res.receiptNumber} issued; the old one is void.`);
      navigate(`/receipt/${res.receiptId}`, { replace: true });
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (loading) return <Loading />;
  if (correctId && !isOwner) return <EmptyState icon="🔒" title="Not allowed" message="You do not have permission to correct a payment." />;
  if (correctId && profile && !correcting)
    return <EmptyState icon="🧾" title="Payment not found" message="That payment may already have been corrected or voided." />;
  if (!correctId && options.length === 0)
    return <EmptyState icon="🏠" title="No tenants yet" message="Assign a tenant to a bed first, then record their payment." />;

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">{correcting ? 'Correct payment' : 'Record payment'}</div>

      {correcting && (
        <div className="rounded-xl border border-partial-border bg-partial-bg px-3.5 py-3 text-[13.5px] font-semibold text-partial-text">
          The original receipt {correcting.receipt?.receiptNumber} will be marked VOID and a new receipt with a new number
          will be issued with the details below. Both are kept in the records.
        </div>
      )}

      {/* Step 1: who paid */}
      <div className="card flex flex-col gap-2.5 p-4">
        <label htmlFor="who" className="text-[13px] font-bold text-muted">1 · Who paid?</label>
        {correcting ? (
          <div className="text-[15px] font-semibold">{profile.tenant.name} — Room {profile.tenancy.roomLabel}</div>
        ) : (
          <select id="who" value={tenancyId} onChange={(e) => pick(e.target.value)} className="field-input">
            <option value="">Select a tenant…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        {profile && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-[10px] bg-surface px-3.5 py-2.5 text-[13.5px] text-[#4A5A52]">
            <span><strong className="text-ink">Room:</strong> {profile.tenancy.roomLabel}</span>
            <span><strong className="text-ink">Rent:</strong> {formatK(profile.tenancy.rent)} {perShort(profile.tenancy.property.billingCycle)}</span>
            {owedNow > 0 ? (
              <span className="text-due-text"><strong>Owes:</strong> {formatK(owedNow)}</span>
            ) : (
              <span className="text-paid-text"><strong>Owes nothing</strong></span>
            )}
            {profile.credit > 0 && <span className="text-paid-text"><strong>Credit:</strong> {formatK(profile.credit)}</span>}
          </div>
        )}
      </div>

      {/* Step 2: details */}
      {profile && (
        <div className="card flex flex-col gap-3.5 p-4">
          <div className="text-[13px] font-bold text-muted">2 · Payment details</div>

          {open.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-sm font-semibold">
                What it pays for <span className="font-normal text-muted">(oldest first — tap to pay something else first)</span>
              </div>
              {open.map((c) => {
                const order = picked.indexOf(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggle(c)}
                    className={'flex min-h-[48px] items-center gap-2.5 rounded-[10px] border-[1.5px] px-3 text-left ' +
                      (order >= 0 ? 'border-brand bg-brand-light' : 'border-[#D6DCD4] bg-white')}>
                    <span className={'flex h-6 w-6 flex-none items-center justify-center rounded-md text-[12px] font-bold ' + (order >= 0 ? 'bg-brand text-white' : 'border border-line text-muted')}>
                      {order >= 0 ? order + 1 : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{c.description}</span>
                      <span className="block text-[12px] text-muted">Due {fmtDay(c.dueDate)}</span>
                    </span>
                    <span className="text-[14px] font-bold">{formatK(c.balance)}</span>
                    <StatusBadge status={c.status} />
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="amt" className="text-sm font-semibold">Amount received (K)</label>
            <input id="amt" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
              className="field-input text-[20px] font-bold" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="method" className="field-label">Paid by</label>
              <select id="method" className="field-input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="date" className="field-label">Date paid</label>
              <input id="date" type="date" className="field-input" max={todayDay()} value={datePaid} onChange={(e) => setDatePaid(e.target.value)} />
            </div>
          </div>

          {amountNgwee > 0 && (
            <div className="rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[13.5px]">
              {preview.lines.map((l) => (
                <div key={l.id} className="flex justify-between gap-2">
                  <span className="truncate">{l.description}</span>
                  <span className="font-semibold">{formatK(l.take)}{l.after > 0 && <span className="font-normal text-due-text"> · {formatK(l.after)} left</span>}</span>
                </div>
              ))}
              {preview.credit > 0 && (
                <div className="flex justify-between gap-2 text-paid-text">
                  <span>Kept as credit for the next bill</span>
                  <span className="font-semibold">{formatK(preview.credit)}</span>
                </div>
              )}
              <div className={'mt-1.5 border-t border-line pt-1.5 font-bold ' + (owedNow - (amountNgwee - preview.credit) > 0 ? 'text-due-text' : 'text-paid-text')}>
                {owedNow - (amountNgwee - preview.credit) > 0
                  ? `Still owed after this: ${formatK(owedNow - (amountNgwee - preview.credit))}`
                  : 'Owes nothing after this payment'}
              </div>
            </div>
          )}

          {correcting && (
            <div>
              <label htmlFor="reason" className="field-label">Reason for the correction</label>
              <textarea id="reason" className="field-input min-h-[80px] py-3" maxLength={191} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Amount entered as K1,500 but tenant paid K1,050" />
            </div>
          )}

          {profile.tenant.email && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              Email the receipt to {profile.tenant.email}
            </label>
          )}

          <button onClick={submit} disabled={busy} className="w-full rounded-2xl bg-brand text-[17px] font-bold text-white shadow-cta hover:bg-brand-dark disabled:opacity-50" style={{ minHeight: 58 }}>
            {busy ? 'Generating…' : correcting ? 'Void old receipt & issue new one' : 'Generate receipt'}
          </button>
        </div>
      )}
    </div>
  );
}
