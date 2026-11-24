import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, formatK } from '../api.js';
import { Loading, useToast, fmtDate } from '../ui.jsx';

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
  const isVoid = r.status === 'VOID';

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      {isVoid && (
        <div className="rounded-xl border border-[#F2D7D0] bg-due-bg px-3.5 py-3 text-[13.5px] text-due-text">
          <div className="font-bold">This receipt is VOID — it is no longer valid.</div>
          <div>Voided {fmtDate(r.voidedAt)}. Reason: {r.voidReason}</div>
          {r.replacedBy && (
            <button onClick={() => navigate(`/receipt/${r.replacedBy.id}`)} className="mt-1 font-semibold underline">
              See replacement receipt {r.replacedBy.receiptNumber}
            </button>
          )}
        </div>
      )}
      {r.replaces && (
        <div className="rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] text-muted">
          This receipt corrects{' '}
          <button onClick={() => navigate(`/receipt/${r.replaces.id}`)} className="font-semibold text-ink underline">{r.replaces.receiptNumber}</button>
          , which is now void.
        </div>
      )}

      {/* Paper receipt */}
      <div className={'relative rounded-[10px] border border-line bg-white px-5 py-6 shadow-paper ' + (isVoid ? 'opacity-60' : '')}>
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
          <Field label="Paid for" valueClass="text-[14px]">
            {r.lines.map((l) => (
              <div key={l.chargeId} className="flex justify-between gap-2">
                <span className="font-semibold">{l.description}</span>
                <span>{formatK(l.paid)}{l.balanceAfter > 0 && <span className="text-due-text"> · {formatK(l.balanceAfter)} left</span>}</span>
              </div>
            ))}
            {r.amount - r.lines.reduce((s, l) => s + l.paid, 0) > 0 && (
              <div className="flex justify-between gap-2 text-paid-text">
                <span className="font-semibold">Kept as credit</span>
                <span>{formatK(r.amount - r.lines.reduce((s, l) => s + l.paid, 0))}</span>
              </div>
            )}
          </Field>
          <Field label="Amount received" valueClass="text-[21px] font-bold text-brand">{formatK(r.amount)}</Field>
          <Field label="Amount in words" valueClass="text-[13.5px] italic">{r.amountWords}</Field>
        </div>

        {r.totalBalance > 0 && (
          <div className="mt-3 rounded-lg border border-[#F2D7D0] bg-due-bg px-3.5 py-2.5 text-[13.5px] font-bold text-due-text">
            Still owed after this payment: {formatK(r.totalBalance)}
          </div>
        )}
        {r.credit > 0 && (
          <div className="mt-3 rounded-lg border border-paid-border bg-paid-bg px-3.5 py-2.5 text-[13.5px] font-bold text-paid-text">
            Credit held for the next bill: {formatK(r.credit)}
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
        {!isVoid && <button onClick={email} disabled={busy || !r.tenant.email} className="btn-outline w-full text-[15.5px]">Email to tenant</button>}
        <button onClick={() => window.open(`/api/receipts/${id}/pdf`, '_blank')} className="btn-secondary w-full text-[15.5px]">Print</button>
        <button onClick={() => navigate(`/tenancy/${r.tenancyId}`)} className="btn-secondary w-full text-[15.5px]">Tenant's records</button>
        <button onClick={() => navigate('/', { replace: true })} className="btn-primary w-full text-[15.5px]">Save &amp; done</button>
      </div>
    </div>
  );
}
