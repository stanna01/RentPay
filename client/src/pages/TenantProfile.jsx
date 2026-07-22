import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, formatK, toNgwee, MONTHS } from '../api.js';
import { Loading, EmptyState, useToast } from '../ui.jsx';

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Build a reverse-chronological month list from move-in to now, each month
// either a payment row or an unpaid ("due") row.
function buildHistory(tenancy, payments) {
  const byMonth = new Map(); // "y-m" -> { payment, period }
  for (const p of payments) {
    for (const pd of p.periods) {
      byMonth.set(`${pd.year}-${pd.month}`, { payment: p, period: pd });
    }
  }
  const rows = [];
  const start = new Date(tenancy.moveInDate);
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  while ((y > start.getFullYear() || (y === start.getFullYear() && m >= start.getMonth() + 1)) && rows.length < 24) {
    const hit = byMonth.get(`${y}-${m}`);
    const label = `${MONTHS[m - 1]} ${y}`;
    if (hit) {
      const bal = Math.max(0, hit.period.expectedRent - hit.period.amountApplied);
      rows.push({
        key: `${y}-${m}`, label, paid: true,
        amount: hit.period.amountApplied, balance: bal,
        date: hit.payment.datePaid, receipt: hit.payment.receipt,
      });
    } else {
      rows.push({ key: `${y}-${m}`, label, paid: false, amount: tenancy.monthlyRent });
    }
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return rows;
}

export default function TenantProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/tenancies/${id}`).then(setData).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const history = useMemo(() => (data ? buildHistory(data.tenancy, data.payments) : []), [data]);

  const resend = async (receiptId) => {
    try {
      const r = await api.post(`/receipts/${receiptId}/resend`);
      toast.success(r.emailStatus === 'sent' ? 'Receipt emailed to tenant.' : 'Receipt queued to send.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const moveOut = async () => {
    if (!confirm('Move this tenant out? Their payment history will be kept.')) return;
    try {
      await api.post(`/tenancies/${id}/moveout`, {});
      toast.success(`${data.tenant.name} moved out — Room ${data.tenancy.roomLabel} is now vacant. History kept.`);
      navigate('/', { replace: true });
    } catch (e) { toast.error(e.message); }
  };

  if (loading || !data) return <Loading />;
  const { tenant, tenancy } = data;
  const first = tenant.name.split(' ')[0];

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <div className="flex h-[54px] w-[54px] flex-none flex-col items-center justify-center rounded-[13px] bg-brand text-white">
          <div className="text-[9px] font-bold uppercase tracking-wider opacity-80">Room</div>
          <div className="text-[18px] font-bold leading-none">{tenancy.roomLabel}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[20px] font-bold tracking-tight">{tenant.name}</div>
          <div className="text-[13.5px] text-muted">
            Room {tenancy.roomNumber} · Bed {tenancy.bed} · {formatK(tenancy.monthlyRent)} / month
          </div>
        </div>
      </div>

      {tenancy.isCurrent && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setEditing(true)} className="btn-secondary min-h-[48px] text-[14.5px]">Edit tenant</button>
          <button onClick={moveOut} className="btn-danger min-h-[48px] text-[14.5px]">Move out</button>
        </div>
      )}

      {/* Contact */}
      <div className="card flex flex-col gap-2.5 px-4 py-3.5">
        <div><div className="text-xs text-muted">Phone</div><div className="text-[15px] font-semibold">{tenant.phone || '—'}</div></div>
        <div><div className="text-xs text-muted">Email</div><div className="break-all text-[15px] font-semibold">{tenant.email || '—'}</div></div>
      </div>

      {/* Duration */}
      <div className="rounded-2xl border border-paid-border bg-brand-light px-4 py-3.5">
        <div className="text-[11.5px] font-bold uppercase tracking-wider text-paid-text">Tenancy duration</div>
        <div className="mt-1 text-[15.5px] font-semibold text-paid-text">
          Tenant since {fmtDate(tenancy.moveInDate)}{tenancy.moveOutDate ? ` — moved out ${fmtDate(tenancy.moveOutDate)}` : ` — ${tenancy.duration}`}
        </div>
      </div>

      {tenancy.isCurrent && (
        <button
          onClick={() => navigate(`/pay?tenancyId=${tenancy.id}`)}
          className="btn-primary w-full text-[16px]"
        >
          Record payment for {first}
        </button>
      )}

      {/* History */}
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3 text-[15px] font-bold">Payment history</div>
        {history.length === 0 ? (
          <EmptyState icon="🧾" title="No history yet" message="Payments will appear here." />
        ) : (
          history.map((h) =>
            h.paid ? (
              <div key={h.key} className="flex flex-col gap-2 border-b border-[#F0F2EE] px-4 py-3 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[15px] font-bold">{h.label}</span>
                  <span className="text-[15px] font-semibold">{formatK(h.amount)}</span>
                </div>
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span className="flex-1 truncate">
                    {fmtDate(h.date)}{h.receipt ? ` · ${h.receipt.receiptNumber}` : ''}
                    {h.balance > 0 && <span className="ml-1 font-semibold text-due-text">· {formatK(h.balance)} due</span>}
                  </span>
                  {h.receipt && (
                    <>
                      <a href={`/api/receipts/${h.receipt.id}/pdf`} target="_blank" rel="noreferrer" className="min-h-[36px] rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold text-ink">Reprint</a>
                      <button onClick={() => resend(h.receipt.id)} className="min-h-[36px] rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold text-ink">Re-send</button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div key={h.key} className="flex items-center gap-2 border-b border-[#F0F2EE] bg-due-bg px-4 py-3 last:border-0">
                <span className="flex-1 text-[15px] font-bold text-due-text">{h.label}</span>
                <span className="text-[14px] font-semibold text-due-text">{formatK(h.amount)} due</span>
                <span className="rounded-full bg-[#FBE9E5] px-2.5 py-1 text-[11.5px] font-bold text-due-text">Unpaid</span>
              </div>
            )
          )
        )}
      </div>

      {editing && (
        <EditTenantModal tenant={tenant} tenancy={tenancy} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      )}
    </div>
  );
}

function EditTenantModal({ tenant, tenancy, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(tenant.name);
  const [phone, setPhone] = useState(tenant.phone || '');
  const [email, setEmail] = useState(tenant.email || '');
  const [rent, setRent] = useState((tenancy.monthlyRent / 100).toString());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const ngwee = toNgwee(rent);
    if (!name.trim() || ngwee == null || ngwee <= 0) return toast.error('Please enter at least a name and rent.');
    setBusy(true);
    try {
      await api.patch(`/tenants/${tenant.id}`, { name, phone, email });
      await api.patch(`/tenancies/${tenancy.id}`, { monthlyRent: ngwee });
      toast.success('Tenant updated');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-[20px] font-bold tracking-tight">Edit tenant — Room {tenancy.roomLabel}</h2>
        <div className="mb-4 rounded-xl border border-paid-border bg-brand-light px-3.5 py-3 text-[13.5px] font-semibold text-paid-text">
          You only enter this once — future receipts auto-fill.
        </div>
        <div className="flex flex-col gap-3">
          <div><label className="field-label">Full name</label><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="field-label">Phone</label><input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><label className="field-label">Email</label><input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="field-label">Rent (K)</label><input className="field-input" inputMode="numeric" value={rent} onChange={(e) => setRent(e.target.value)} /></div>
        </div>
        <div className="mt-5 flex gap-3">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}
