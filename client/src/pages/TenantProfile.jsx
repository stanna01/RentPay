import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, formatK, toNgwee, fmtDay, perShort, perLabel, todayDay } from '../api.js';
import { Loading, EmptyState, useToast, Modal, ReasonDialog, StatusBadge, VoidBadge, fmtDate } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

const METHOD_LABEL = { cash: 'Cash', mobile_money: 'Mobile money', bank: 'Bank' };
const TYPE_LABEL = { RENT: 'Rent', DEPOSIT: 'Deposit', FEE: 'Fee', OTHER: 'Other' };

const linesText = (lines) => lines.map((l) => l.description).join(', ');

export default function TenantProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { isOwner } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState(null); // payment
  const [waiving, setWaiving] = useState(null); // charge
  const [cancelling, setCancelling] = useState(null); // charge
  const [reversing, setReversing] = useState(null); // { charge, waiver }
  const [showAll, setShowAll] = useState(false);
  const [showStatement, setShowStatement] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/tenancies/${id}`).then(setData).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const resend = async (receiptId) => {
    try {
      const r = await api.post(`/receipts/${receiptId}/resend`);
      toast.success(r.emailStatus === 'sent' ? 'Receipt emailed to tenant.' : 'Receipt queued to send.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const moveOut = async () => {
    if (!confirm('Move this tenant out today? Their bill and payment history will be kept.')) return;
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
  const cycle = tenancy.property.billingCycle;
  const first = tenant.name.split(' ')[0];
  // Open charges first, then the rest newest first; hide cancelled/paid unless asked.
  const charges = [...data.charges].reverse();
  const shown = showAll ? charges : charges.filter((c) => c.balance > 0);

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
            {tenancy.property.name} · Room {tenancy.roomNumber} · Bed {tenancy.bed} · {formatK(tenancy.rent)} {perShort(cycle)}
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
        <div className="text-[11.5px] font-bold uppercase tracking-wider text-paid-text">Tenancy</div>
        <div className="mt-1 text-[15.5px] font-semibold text-paid-text">
          Since {fmtDay(tenancy.moveInDate)}{tenancy.moveOutDate ? ` — moved out ${fmtDay(tenancy.moveOutDate)}` : ` — ${tenancy.duration}`}
        </div>
      </div>

      {data.upcomingRentChange && (
        <div className="rounded-2xl border border-partial-border bg-partial-bg px-4 py-3 text-[14px] font-semibold text-partial-text">
          Rent changes to {formatK(data.upcomingRentChange.newRent)} {perShort(cycle)} on {fmtDay(data.upcomingRentChange.startsOn)} (tenant notified).
        </div>
      )}

      {/* Balance */}
      <div className={'rounded-2xl border px-4 py-3 ' + (data.owed > 0 ? 'border-[#F2D7D0] bg-due-bg text-due-text' : 'border-paid-border bg-paid-bg text-paid-text')}>
        <div className="text-[15px] font-bold">
          {data.owed > 0 ? `Owes ${formatK(data.owed)}` : 'Owes nothing'}
          {data.overdue > 0 && <span className="font-semibold"> · {formatK(data.overdue)} overdue</span>}
        </div>
        {data.credit > 0 && <div className="text-[13.5px] font-semibold text-paid-text">Credit {formatK(data.credit)} — used automatically on the next bill</div>}
      </div>

      {tenancy.isCurrent && (
        <button onClick={() => navigate(`/pay?tenancyId=${tenancy.id}`)} className="btn-primary w-full text-[16px]">
          Record payment for {first}
        </button>
      )}

      {/* The bill */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[15px] font-bold">{showAll ? 'All charges' : 'Unpaid charges'}</span>
          <div className="flex gap-3 text-sm font-semibold">
            <button className="text-muted" onClick={() => setShowAll(!showAll)}>{showAll ? 'Unpaid only' : 'Show all'}</button>
            {isOwner && <button className="text-brand" onClick={() => setAdding(true)}>+ Add charge</button>}
          </div>
        </div>
        {shown.length === 0 ? (
          <EmptyState icon="✅" title={showAll ? 'No charges yet' : 'Nothing unpaid'} message={showAll ? 'Rent is billed automatically from the move-in date.' : undefined} />
        ) : (
          shown.map((c) => (
            <div key={c.id} className={'flex flex-col gap-1 border-b border-[#F0F2EE] px-4 py-2.5 last:border-0 ' + (c.overdue ? 'bg-due-bg/50' : '')}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className={'text-[14.5px] font-bold ' + (c.status === 'CANCELLED' ? 'text-muted line-through' : '')}>{c.description}</div>
                  <div className="text-[12px] text-muted">
                    {TYPE_LABEL[c.type]} · {formatK(c.amount)} · due {fmtDay(c.dueDate)}
                    {c.paid > 0 && ` · paid ${formatK(c.paid)}`}
                    {c.waived > 0 && ` · waived ${formatK(c.waived)}`}
                    {c.balance > 0 && <span className="font-semibold text-due-text"> · {formatK(c.balance)} left</span>}
                  </div>
                  {c.status === 'CANCELLED' && <div className="text-[12px] text-muted">Cancelled: {c.cancelReason}</div>}
                </div>
                <StatusBadge status={c.status} />
              </div>
              {c.waivers.filter((w) => !w.reversedAt).map((w) => (
                <div key={w.id} className="flex items-center gap-2 pl-2 text-[12px] text-muted">
                  <span className="flex-1">Waived {formatK(w.amount)} — {w.reason} · {fmtDate(w.createdAt)}</span>
                  {isOwner && <button className="font-semibold text-brand" onClick={() => setReversing({ charge: c, waiver: w })}>Reverse</button>}
                </div>
              ))}
              {isOwner && c.status !== 'CANCELLED' && (
                <div className="flex gap-1.5 pt-0.5 text-[12.5px]">
                  {c.balance > 0 && <button onClick={() => setWaiving(c)} className="min-h-[34px] rounded-lg border border-line bg-white px-2.5 font-semibold">Waive</button>}
                  <button onClick={() => setCancelling(c)} className="min-h-[34px] rounded-lg border border-line bg-white px-2.5 font-semibold text-muted">Cancel charge</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Statement */}
      <div className="card overflow-hidden">
        <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setShowStatement(!showStatement)}>
          <span className="text-[15px] font-bold">Statement</span>
          <span className="text-sm font-semibold text-muted">{showStatement ? 'Hide' : 'Show'}</span>
        </button>
        {showStatement && (
          data.statement.length === 0 ? (
            <div className="border-t border-line px-4 py-3 text-sm text-muted">Nothing yet.</div>
          ) : (
            <div className="border-t border-line">
              {data.statement.map((r, i) => (
                <div key={`${r.kind}-${r.id}-${i}`} className="flex items-center gap-2 border-b border-[#F0F2EE] px-4 py-2 text-[12.5px] last:border-0">
                  <span className="w-[78px] flex-none text-muted">{fmtDay(r.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{r.description}</span>
                  <span className={'w-[78px] flex-none text-right font-semibold ' + (r.amount < 0 ? 'text-paid-text' : '')}>{r.amount < 0 ? `− ${formatK(-r.amount)}` : formatK(r.amount)}</span>
                  <span className="w-[84px] flex-none text-right text-muted">{r.balance < 0 ? `${formatK(-r.balance)} cr` : formatK(r.balance)}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

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
                  {p.lines.length ? linesText(p.lines) : 'Credit'}{p.creditAfter > 0 && p.lines.reduce((s, l) => s + l.paid, 0) < p.amount ? ' · part kept as credit' : ''}
                  {' · '}{METHOD_LABEL[p.method] || p.method}{p.receipt ? ` · ${p.receipt.receiptNumber}` : ''}
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

      {/* Rent history */}
      {data.rentChanges.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 text-[15px] font-bold">Rent changes</div>
          {data.rentChanges.map((r) => (
            <div key={r.id} className={'border-b border-[#F0F2EE] px-4 py-2.5 text-[13px] last:border-0 ' + (r.cancelledAt ? 'text-muted line-through' : '')}>
              {formatK(r.oldRent)} → {formatK(r.newRent)} from {fmtDay(r.startsOn)}
              <span className="text-muted"> · {r.cancelledAt ? 'cancelled' : r.appliedAt ? 'in effect' : 'planned'}{r.fromNotice ? ' · with notice' : ''}</span>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditTenantModal tenant={tenant} tenancy={tenancy} isOwner={isOwner} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      )}
      {adding && <AddChargeModal tenancyId={tenancy.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {voiding && <VoidDialog payment={voiding} tenant={tenant} onClose={() => setVoiding(null)} onDone={load} />}
      {waiving && <WaiveDialog charge={waiving} onClose={() => setWaiving(null)} onDone={load} />}
      {cancelling && (
        <ReasonDialog
          title={`Cancel "${cancelling.description}"?`}
          message={`Use this when the charge was a mistake. It stops counting${cancelling.paid > 0 ? `, and the ${formatK(cancelling.paid)} already paid on it becomes credit for the other charges` : ''}.${cancelling.type === 'RENT' ? ' This rent will not be billed again.' : ''} The charge is kept in the records, marked cancelled.`}
          confirmLabel="Cancel charge"
          danger
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await api.post(`/charges/${cancelling.id}/cancel`, { reason });
            toast.success('Charge cancelled.');
            load();
          }}
        />
      )}
      {reversing && (
        <ReasonDialog
          title="Reverse this waiver?"
          message={`${reversing.charge.description}: the ${formatK(reversing.waiver.amount)} waived will be owed again.`}
          confirmLabel="Reverse"
          onClose={() => setReversing(null)}
          onConfirm={async () => {
            await api.post(`/charges/waivers/${reversing.waiver.id}/reverse`, {});
            toast.success('Waiver reversed.');
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
      message={`This cancels the payment of ${formatK(payment.amount)}. The charges it paid are owed again. The receipt number is kept and a copy stamped VOID is stored. To fix a mistake instead, use "Correct".`}
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

function WaiveDialog({ charge, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(charge.balance / 100));
  return (
    <ReasonDialog
      title={`Waive part of "${charge.description}"`}
      message={`Still owed on it: ${formatK(charge.balance)}. You can waive up to that amount.`}
      confirmLabel="Waive"
      extra={
        <div className="mt-3">
          <label className="field-label" htmlFor="waiveamt">Amount to waive (K)</label>
          <input id="waiveamt" className="field-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      }
      onClose={onClose}
      onConfirm={async (reason) => {
        const ngwee = toNgwee(amount);
        if (!ngwee) throw new Error('Please enter an amount greater than zero.');
        await api.post(`/charges/${charge.id}/waivers`, { amount: ngwee, reason });
        toast.success('Amount waived.');
        onDone();
      }}
    />
  );
}

function AddChargeModal({ tenancyId, onClose, onSaved }) {
  const toast = useToast();
  const [type, setType] = useState('DEPOSIT');
  const [description, setDescription] = useState('Deposit');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(todayDay());
  const [busy, setBusy] = useState(false);
  const pickType = (t) => {
    setType(t);
    if (['Deposit', 'Fee', ''].includes(description)) setDescription(t === 'DEPOSIT' ? 'Deposit' : t === 'FEE' ? 'Fee' : '');
  };
  const save = async () => {
    const ngwee = toNgwee(amount);
    if (!description.trim() || !ngwee) return toast.error('Please describe the charge and enter an amount.');
    setBusy(true);
    try {
      await api.post(`/tenancies/${tenancyId}/charges`, { type, description, amount: ngwee, dueDate });
      toast.success('Charge added.');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a charge" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {[['DEPOSIT', 'Deposit'], ['FEE', 'Fee'], ['OTHER', 'Other']].map(([v, label]) => (
            <button key={v} type="button" onClick={() => pickType(v)}
              className={'min-h-[44px] rounded-xl text-sm font-semibold ' + (type === v ? 'bg-brand text-white' : 'border border-line bg-white text-muted')}>{label}</button>
          ))}
        </div>
        <div><label className="field-label">Description (shown on the bill and receipt)</label><input className="field-input" maxLength={191} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Broken window" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field-label">Amount (K)</label><input className="field-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="field-label">Due</label><input className="field-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        <p className="text-xs text-muted">Rent is billed automatically — no need to add it here. Any credit the tenant has is used on this charge straight away.</p>
      </div>
      <div className="mt-5 flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add charge'}</button>
      </div>
    </Modal>
  );
}

function EditTenantModal({ tenant, tenancy, isOwner, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(tenant.name);
  const [phone, setPhone] = useState(tenant.phone || '');
  const [email, setEmail] = useState(tenant.email || '');
  const [rent, setRent] = useState((tenancy.rent / 100).toString());
  const [moveIn, setMoveIn] = useState(tenancy.moveInDate || '');
  const [moveOut, setMoveOut] = useState(tenancy.moveOutDate || '');
  const [busy, setBusy] = useState(false);
  const fresh = Date.now() - new Date(tenancy.createdAt).getTime() <= 7 * 86_400_000;

  const save = async () => {
    const ngwee = toNgwee(rent);
    if (!name.trim() || ngwee == null || ngwee <= 0) return toast.error('Please enter at least a name and rent.');
    setBusy(true);
    try {
      await api.patch(`/tenants/${tenant.id}`, { name, phone, email });
      const tenancyPatch = {};
      if (ngwee !== tenancy.rent) tenancyPatch.rent = ngwee;
      if (isOwner && moveIn && moveIn !== tenancy.moveInDate) tenancyPatch.moveInDate = moveIn;
      if (isOwner && tenancy.moveOutDate && moveOut && moveOut !== tenancy.moveOutDate) tenancyPatch.moveOutDate = moveOut;
      if (Object.keys(tenancyPatch).length) await api.patch(`/tenancies/${tenancy.id}`, tenancyPatch);
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
        <div>
          <label className="field-label">Rent (K) {perLabel(tenancy.property.billingCycle)}</label>
          <input className="field-input" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} />
          <p className="mt-1 text-xs text-muted">
            {fresh
              ? 'Moved in this week: a mistyped rent can still be fixed; unpaid rent is billed again at the new amount.'
              : 'Lowering applies from today. To raise it, send a rent increase from Manage → Notices (30 days notice).'}
          </p>
        </div>
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
