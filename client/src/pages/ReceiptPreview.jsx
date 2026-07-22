import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, formatK, MONTHS } from '../api.js';
import { Loading, useToast } from '../ui.jsx';

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function periodText(periods) {
  const sorted = [...periods].sort((a, b) => a.year - b.year || a.month - b.month);
  const name = (p) => `${MONTHS[p.month - 1]} ${p.year}`;
  if (sorted.length === 1) return name(sorted[0]);
  const idx = (p) => p.year * 12 + p.month;
  const consecutive = sorted.every((p, i) => i === 0 || idx(p) === idx(sorted[i - 1]) + 1);
  if (consecutive) return `${name(sorted[0])} – ${name(sorted[sorted.length - 1])}`;
  return sorted.map(name).join(', ');
}

function Field({ label, children, valueClass = 'text-[15.5px] font-semibold' }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-0.5 ${valueClass}`}>{children}</div>
    </div>
  );
}

export default function ReceiptPreview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/receipts/${id}`).then(setR).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [id]);

  const email = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/receipts/${id}/resend`);
      toast.success(res.emailStatus === 'sent' ? `Receipt emailed to ${r.tenant.email}` : 'Receipt queued — it will send automatically.');
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!r) return <Loading />;

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      {/* Paper receipt */}
      <div className="rounded-[10px] border border-line bg-white px-5 py-6 shadow-paper">
        <div className="border-b-2 border-brand pb-3.5">
          <div className="text-[17px] font-bold">{r.property.name}</div>
          {r.property.address && <div className="mt-0.5 text-xs text-muted">{r.property.address}</div>}
          <div className="mt-2.5 flex justify-between text-[13px]">
            <span className="font-bold text-brand">{r.receiptNumber}</span>
            <span className="text-muted">{fmtDate(r.datePaid)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-line py-4">
          <Field label="Received from">{r.tenant.name} — Room {r.roomLabel}</Field>
          <Field label="Period covered">{periodText(r.periods)}</Field>
          <Field label="Amount received" valueClass="text-[21px] font-bold text-brand">{formatK(r.amount)}</Field>
          <Field label="Amount in words" valueClass="text-[13.5px] italic">{r.amountWords}</Field>
        </div>

        {r.totalBalance > 0 && (
          <div className="mt-3 rounded-lg border border-[#F2D7D0] bg-due-bg px-3.5 py-2.5 text-[13.5px] font-bold text-due-text">
            Balance remaining: {formatK(r.totalBalance)}
          </div>
        )}

        <div className="mt-7">
          <div className="h-6 w-[170px] border-b-[1.5px] border-ink" />
          <div className="mt-1.5 text-xs text-muted">Received by (signature)</div>
        </div>
      </div>

      {/* Email status */}
      {r.emailStatus !== 'none' && (
        <p className="text-center text-sm">
          {r.emailStatus === 'sent' && <span className="text-brand">✅ Emailed to {r.tenant.email}</span>}
          {r.emailStatus === 'pending' && <span className="text-partial-text">⏳ Email queued — will send automatically</span>}
          {r.emailStatus === 'failed' && <span className="text-due-text">⚠️ Email failed — try again</span>}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <button onClick={email} disabled={busy || !r.tenant.email} className="btn-outline w-full text-[15.5px]">Email to tenant</button>
        <button onClick={() => window.open(`/api/receipts/${id}/pdf`, '_blank')} className="btn-secondary w-full text-[15.5px]">Print</button>
        <button onClick={() => navigate('/', { replace: true })} className="btn-primary w-full text-[15.5px]">Save &amp; done</button>
      </div>
    </div>
  );
}
