import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, formatK, toNgwee, MONTHS } from '../api.js';
import { Loading, EmptyState, useToast, Modal, ReasonDialog, StatusBadge, VoidBadge, fmtDate } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

const METHOD_LABEL = { cash: 'Cash', mobile_money: 'Mobile money', bank: 'Bank' };
const monthName = (m, y) => `${MONTHS[m - 1]} ${y}`;
const isoDate = (d) => (d ? String(d).slice(0, 10) : '');

function periodsText(periods) {
  return periods.map((p) => `${MONTHS[p.month - 1].slice(0, 3)} ${p.year}`).join(', ');
}

export default function TenantProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { isOwner } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(null); // payment
  const [adjusting, setAdjusting] = useState(null); // month row
  const [reversing, setReversing] = useState(null); // adjustment

  const load = () => {
    setLoading(true);
    api.get(`/tenancies/${id}`).then(setData).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  // Months from move-in up to this month (plus any future month already paid), newest first.
  const monthRows = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const curKey = now.getFullYear() * 12 + now.getMonth() + 1;
    const end = data.tenancy.moveOutDate ? new Date(data.tenancy.moveOutDate) : null;
    const endKey = end ? end.getFullYear() * 12 + end.getMonth() + 1 : Infinity;
    return data.months
      .filter((m) => {
        const k = m.year * 12 + m.month;
        return k <= endKey && (k <= curKey || m.applied > 0);
      })
      .reverse()
      .slice(0, 36);
  }, [data]);

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

  const undoMoveOut = async () => {
    if (!confirm('Undo the move-out? The tenant will be put back in their bed.')) return;
    try {
      await api.post(`/tenancies/${id}/undo-moveout`, {});
      toast.success('Move-out undone.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const deleteTenant = async () => {
    if (!confirm(`Delete ${data.tenant.name}? They will be removed from all lists. Their payments and receipts are kept for your records.`)) return;
    try {
      await api.del(`/tenants/${data.tenant.id}`);
      toast.success('Tenant deleted. Financial records kept.');
      navigate('/past', { replace: true });
    } catch (e) { toast.error(e.message); }
  };

  if (loading || !data) return <Loading />;
  const { tenant, tenancy } = data;
  const first = tenant.name.split(' ')[0];
  const owed = data.unpaidMonths.reduce((s, m) => s + m.balance, 0);

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
            {tenancy.property.name} · Room {tenancy.roomNumber} · Bed {tenancy.bed} · {formatK(tenancy.monthlyRent)} / month
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setEditing(true)} className="btn-secondary min-h-[48px] text-[14.5px]">Edit tenant</button>
        {tenancy.isCurrent ? (
          <button onClick={moveOut} className="btn-danger min-h-[48px] text-[14.5px]">Move out</button>
        ) : isOwner ? (
          <button onClick={undoMoveOut} className="btn-secondary min-h-[48px] text-[14.5px]">Undo move-out</button>
        ) : null}
        {!tenancy.isCurrent && isOwner && (
          <button onClick={deleteTenant} className="btn-danger col-span-2 min-h-[48px] text-[14.5px]">Delete tenant</button>
        )}
      </div>

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

      {owed > 0 && (
        <div className="rounded-2xl border border-[#F2D7D0] bg-due-bg px-4 py-3 text-[14px] font-bold text-due-text">
          Owes {formatK(owed)} across {data.unpaidMonths.length} month{data.unpaidMonths.length === 1 ? '' : 's'}
        </div>
      )}

      {tenancy.isCurrent && (
        <button onClick={() => navigate(`/pay?tenancyId=${tenancy.id}`)} className="btn-primary w-full text-[16px]">
          Record payment for {first}
        </button>
      )}

      {/* Month by month */}
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3 text-[15px] font-bold">Rent by month</div>
        {monthRows.length === 0 ? (
          <EmptyState icon="🗓️" title="No months yet" />
        ) : (
          monthRows.map((m) => (
            <div key={m.key} className={'flex items-center gap-2 border-b border-[#F0F2EE] px-4 py-2.5 last:border-0 ' + (m.balance > 0 ? 'bg-due-bg/50' : '')}>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-bold">{monthName(m.month, m.year)}</div>
                <div className="text-[12px] text-muted">
                  Paid {formatK(m.applied)} of {formatK(m.expected)}
                  {m.adjustment !== 0 && <span className="ml-1">· {m.adjustment < 0 ? 'waived' : 'charge'} {formatK(Math.abs(m.adjustment))}</span>}
                  {m.balance > 0 && <span className="ml-1 font-semibold text-due-text">· {formatK(m.balance)} due</span>}
                </div>
              </div>
              <StatusBadge status={m.status} />
              {isOwner && (
                <button onClick={() => setAdjusting(m)} className="min-h-[36px] rounded-lg border border-line bg-white px-2.5 text-[12.5px] font-semibold text-ink">Adjust</button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Adjustments */}
      {data.adjustments.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 text-[15px] font-bold">Waivers &amp; charges</div>
          {data.adjustments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 border-b border-[#F0F2EE] px-4 py-2.5 text-[13px] last:border-0">
              <div className={'min-w-0 flex-1 ' + (a.reversedAt ? 'text-muted line-through' : '')}>
                <div className="font-semibold">{monthName(a.month, a.year)} · {a.amount < 0 ? 'Waived' : 'Charge'} {formatK(Math.abs(a.amount))}</div>
                <div className="text-[12px] text-muted">{a.reason} · {fmtDate(a.createdAt)}</div>
              </div>
              {a.reversedAt ? (
                <span className="text-[12px] text-muted">Reversed</span>
              ) : isOwner ? (
                <button onClick={() => setReversing(a)} className="min-h-[36px] rounded-lg border border-line bg-white px-2.5 text-[12.5px] font-semibold">Reverse</button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Payments & receipts */}
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3 text-[15px] font-bold">Payments &amp; receipts</div>
        {data.payments.length === 0 ? (
          <EmptyState icon="🧾" title="No payments yet" message="Payments will appear here." />
        ) : (
          data.payments.map((p) => {
            const isVoid = p.status === 'VOID';
            return (
              <div key={p.id} className={'flex flex-col gap-1.5 border-b border-[#F0F2EE] px-4 py-3 last:border-0 ' + (isVoid ? 'bg-[#F7F7F5]' : '')}>
                <div className="flex items-center gap-2">
                  <span className={'flex-1 text-[15px] font-bold ' + (isVoid ? 'text-muted line-through' : '')}>{formatK(p.amount)}</span>
                  {isVoid && <VoidBadge />}
                  <span className="text-[12.5px] text-muted">{fmtDate(p.datePaid)}</span>
                </div>
                <div className="text-[12.5px] text-muted">
                  {periodsText(p.periods)} · {METHOD_LABEL[p.method] || p.method}{p.receipt ? ` · ${p.receipt.receiptNumber}` : ''}
                </div>
                {isVoid && <div className="text-[12px] text-due-text">Voided {fmtDate(p.voidedAt)}: {p.voidReason}</div>}
                {p.replacesPaymentId && <div className="text-[12px] text-muted">Corrected payment (replaces an earlier receipt)</div>}
                {p.receipt && (
                  <div className="flex flex-wrap gap-1.5 pt-1 text-[12.5px]">
                    <button onClick={() => navigate(`/receipt/${p.receipt.id}`)} className="min-h-[36px] rounded-lg border border-line bg-white px-2.5 font-semibold text-ink">View</button>
                    <a href={`/api/receipts/${p.receipt.id}/pdf`} target="_blank" rel="noreferrer" className="flex min-h-[36px] items-center rounded-lg border border-line bg-white px-2.5 font-semibold text-ink">Reprint</a>
                    {!isVoid && <button onClick={() => resend(p.receipt.id)} className="min-h-[36px] rounded-lg border border-line bg-white px-2.5 font-semibold text-ink">Re-send</button>}
                    {!isVoid && isOwner && (
                      <>
                        <button onClick={() => navigate(`/pay?tenancyId=${tenancy.id}&correct=${p.id}`)} className="min-h-[36px] rounded-lg border border-line bg-white px-2.5 font-semibold text-ink">Correct</button>
                        <button onClick={() => setVoiding(p)} className="min-h-[36px] rounded-lg border border-[#F2D7D0] bg-due-bg px-2.5 font-semibold text-due-text">Void</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {editing && (
        <EditTenantModal tenant={tenant} tenancy={tenancy} isOwner={isOwner} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      )}
      {voiding && <VoidDialog payment={voiding} tenant={tenant} onClose={() => setVoiding(null)} onDone={load} />}
      {adjusting && <AdjustDialog tenancyId={tenancy.id} month={adjusting} onClose={() => setAdjusting(null)} onDone={load} />}
      {reversing && (
        <ReasonDialog
          title="Reverse this adjustment?"
          message={`${monthName(reversing.month, reversing.year)}: ${reversing.amount < 0 ? 'waiver' : 'charge'} of ${formatK(Math.abs(reversing.amount))} will no longer apply.`}
          confirmLabel="Reverse"
          onClose={() => setReversing(null)}
          onConfirm={async () => {
            await api.post(`/tenancies/adjustments/${reversing.id}/reverse`, {});
            toast.success('Adjustment reversed.');
            load();
          }}
        />
      )}
    </div>
  );
}

function VoidDialog({ payment, tenant, onClose, onDone }) {
  const toast = useToast();
  const [notify, setNotify] = useState(false);
  return (
    <ReasonDialog
      title={`Void receipt ${payment.receipt?.receiptNumber || ''}?`}
      message={`This cancels the payment of ${formatK(payment.amount)}. It will no longer count toward balances or reports. The receipt number is kept and a copy stamped VOID is stored. To fix a mistake instead, use "Correct".`}
      confirmLabel="Void payment"
      danger
      extra={tenant.email && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Tell the tenant by email that this receipt is cancelled
        </label>
      )}
      onClose={onClose}
      onConfirm={async (reason) => {
        await api.post(`/payments/${payment.id}/void`, { reason, notifyTenant: notify });
        toast.success('Payment voided.');
        onDone();
      }}
    />
  );
}

function AdjustDialog({ tenancyId, month, onClose, onDone }) {
  const toast = useToast();
  const [kind, setKind] = useState(month.balance > 0 ? 'waive' : 'charge');
  const [amount, setAmount] = useState(String((month.balance > 0 ? month.balance : 0) / 100 || ''));
  return (
    <ReasonDialog
      title={`Adjust ${monthName(month.month, month.year)}`}
      message={`Currently owed: ${formatK(month.expected)} · paid ${formatK(month.applied)}.`}
      confirmLabel={kind === 'waive' ? 'Waive amount' : 'Add charge'}
      extra={
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="kind">Type</label>
            <select id="kind" className="field-input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="waive">Waive (reduce)</option>
              <option value="charge">Charge (add)</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="adjamt">Amount (K)</label>
            <input id="adjamt" className="field-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
      }
      onClose={onClose}
      onConfirm={async (reason) => {
        const ngwee = toNgwee(amount);
        if (!ngwee) throw new Error('Please enter an amount greater than zero.');
        await api.post(`/tenancies/${tenancyId}/adjustments`, {
          month: month.month,
          year: month.year,
          amount: kind === 'waive' ? -ngwee : ngwee,
          reason,
        });
        toast.success(kind === 'waive' ? 'Amount waived.' : 'Charge added.');
        onDone();
      }}
    />
  );
}

function EditTenantModal({ tenant, tenancy, isOwner, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(tenant.name);
  const [phone, setPhone] = useState(tenant.phone || '');
  const [email, setEmail] = useState(tenant.email || '');
  const [rent, setRent] = useState((tenancy.monthlyRent / 100).toString());
  const [moveIn, setMoveIn] = useState(isoDate(tenancy.moveInDate));
  const [moveOut, setMoveOut] = useState(isoDate(tenancy.moveOutDate));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const ngwee = toNgwee(rent);
    if (!name.trim() || ngwee == null || ngwee <= 0) return toast.error('Please enter at least a name and rent.');
    setBusy(true);
    try {
      await api.patch(`/tenants/${tenant.id}`, { name, phone, email });
      const tenancyPatch = { monthlyRent: ngwee };
      if (isOwner && moveIn && moveIn !== isoDate(tenancy.moveInDate)) tenancyPatch.moveInDate = moveIn;
      if (isOwner && tenancy.moveOutDate && moveOut && moveOut !== isoDate(tenancy.moveOutDate)) tenancyPatch.moveOutDate = moveOut;
      await api.patch(`/tenancies/${tenancy.id}`, tenancyPatch);
      toast.success('Tenant updated');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Edit tenant — Room ${tenancy.roomLabel}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div><label className="field-label">Full name</label><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="field-label">Phone</label><input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><label className="field-label">Email</label><input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="field-label">Rent (K)</label><input className="field-input" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} /></div>
        {isOwner && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="field-label">Move-in</label><input className="field-input" type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} /></div>
            {tenancy.moveOutDate && (
              <div><label className="field-label">Move-out</label><input className="field-input" type="date" value={moveOut} onChange={(e) => setMoveOut(e.target.value)} /></div>
            )}
          </div>
        )}
      </div>
      <div className="mt-5 flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </Modal>
  );
}
