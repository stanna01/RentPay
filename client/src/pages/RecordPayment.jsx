import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs, formatK, toNgwee, MONTHS } from '../api.js';
import { Loading, EmptyState, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

const mk = (y, m) => `${y}-${m}`;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'bank', label: 'Bank' },
];

/**
 * Month-by-month owed/paid from the server's ledger (which already ignores
 * voided payments and includes waivers/charges). In correction mode the
 * payment being replaced is taken back out so its months can be re-chosen.
 */
function ledgerMaps(profile, correcting) {
  const expected = new Map();
  const applied = new Map();
  for (const m of profile.months) {
    expected.set(m.key, m.expected);
    applied.set(m.key, m.applied);
  }
  if (correcting) {
    for (const pd of correcting.periods) {
      const key = mk(pd.year, pd.month);
      applied.set(key, Math.max(0, (applied.get(key) || 0) - pd.amountApplied));
    }
  }
  return { expected, applied };
}

// 12 months centred around now (now-4 .. now+7), plus any older unpaid months.
function monthWindow(profile) {
  const now = new Date();
  const out = new Map();
  for (const u of profile?.unpaidMonths || []) {
    out.set(mk(u.year, u.month), { month: u.month, year: u.year, key: mk(u.year, u.month) });
  }
  for (let i = -4; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = mk(d.getFullYear(), d.getMonth() + 1);
    out.set(key, { month: d.getMonth() + 1, year: d.getFullYear(), key });
  }
  return [...out.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

export default function RecordPayment() {
  const navigate = useNavigate();
  const toast = useToast();
  const { propertyId, isAdmin } = useAuth();
  const [params] = useSearchParams();
  const preId = params.get('tenancyId');
  const correctId = params.get('correct'); // admin: payment id being corrected

  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tenancyId, setTenancyId] = useState('');
  const [profile, setProfile] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [datePaid, setDatePaid] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  const correcting = useMemo(
    () => (correctId && profile ? profile.payments.find((p) => String(p.id) === String(correctId)) : null),
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
          if (bed.tenancyId) opts.push({ id: bed.tenancyId, label: `${bed.tenantName} — Room ${bed.roomLabel}` });
      setOptions(opts);
      if (preId && opts.some((o) => String(o.id) === String(preId))) pick(preId);
    }).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [propertyId]);

  const pick = async (id) => {
    setTenancyId(id);
    setProfile(null);
    if (!id) { setSelectedKeys([]); setAmount(''); return; }
    try {
      const p = await api.get(`/tenancies/${id}`);
      setProfile(p);
      const orig = correctId ? p.payments.find((x) => String(x.id) === String(correctId)) : null;
      if (orig) {
        setSelectedKeys(orig.periods.map((pd) => mk(pd.year, pd.month)));
        setAmount(String(orig.amount / 100));
        setMethod(orig.method);
        setDatePaid(String(orig.datePaid).slice(0, 10));
      } else {
        const first = p.unpaidMonths[0];
        const now = new Date();
        setSelectedKeys([first ? mk(first.year, first.month) : mk(now.getFullYear(), now.getMonth() + 1)]);
        setAmount(String((first ? first.balance : p.tenancy.monthlyRent) / 100));
      }
    } catch (e) { toast.error(e.message); }
  };

  const window12 = useMemo(() => monthWindow(profile), [profile]);
  const { applied, expected } = useMemo(
    () => (profile ? ledgerMaps(profile, correcting) : { applied: new Map(), expected: new Map() }),
    [profile, correcting]
  );
  const rent = profile?.tenancy.monthlyRent || 0;
  const owedFor = (key) => Math.max(0, (expected.get(key) ?? rent) - (applied.get(key) || 0));

  const toggle = (key) => {
    setSelectedKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      // Auto-fill the amount to what the selected months still owe.
      if (next.length) setAmount(String(next.reduce((s, k) => s + owedFor(k), 0) / 100));
      return next;
    });
  };

  const amountNgwee = toNgwee(amount) ?? 0;
  const due = selectedKeys.reduce((s, k) => s + owedFor(k), 0);
  const showBalance = amountNgwee > 0 && selectedKeys.length > 0 && amountNgwee < due;
  const showFull = amountNgwee > 0 && selectedKeys.length > 0 && amountNgwee >= due;

  const submit = async () => {
    if (!selectedKeys.length) return toast.error('Select at least one month');
    if (amountNgwee <= 0) return toast.error('Enter the amount received');
    if (correcting && reason.trim().length < 3) return toast.error('Please give a reason for the correction.');
    setBusy(true);
    try {
      const months = selectedKeys
        .map((k) => { const [y, m] = k.split('-'); return { year: Number(y), month: Number(m) }; })
        .sort((a, b) => a.year - b.year || a.month - b.month);
      const body = { amount: amountNgwee, method, datePaid, months, sendEmail };
      const res = correcting
        ? await api.post(`/payments/${correcting.id}/correct`, { ...body, reason: reason.trim() })
        : await api.post('/payments', { ...body, tenancyId: Number(tenancyId) });
      if (correcting) toast.success(`Corrected. New receipt ${res.receiptNumber} issued; the old one is void.`);
      navigate(`/receipt/${res.receiptId}`, { replace: true });
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (loading) return <Loading />;
  if (correctId && !isAdmin) return <EmptyState icon="🔒" title="Admins only" message="Only an administrator can correct a payment." />;
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
            <span><strong className="text-ink">Rent:</strong> {formatK(rent)} / month</span>
            {profile.unpaidMonths.length > 0 && (
              <span className="text-due-text"><strong>Owes:</strong> {formatK(profile.unpaidMonths.reduce((s, m) => s + m.balance, 0))}</span>
            )}
          </div>
        )}
      </div>

      {/* Step 2: details */}
      {profile && (
        <div className="card flex flex-col gap-3.5 p-4">
          <div className="text-[13px] font-bold text-muted">2 · Payment details</div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">Period covered <span className="font-normal text-muted">(tap months)</span></label>
            <div className="grid grid-cols-3 gap-1.5">
              {window12.map((mo) => {
                const done = owedFor(mo.key) === 0 && (expected.get(mo.key) ?? rent) > 0;
                const sel = selectedKeys.includes(mo.key);
                const label = `${MONTHS[mo.month - 1].slice(0, 3)} ${String(mo.year).slice(2)}`;
                if (done && !sel)
                  return <div key={mo.key} className="flex min-h-[46px] items-center justify-center rounded-[10px] border-[1.5px] border-[#EDF0EC] bg-[#F3F5F2] text-[13px] font-semibold text-vacant-text">{label} ✓</div>;
                return (
                  <button key={mo.key} type="button" onClick={() => toggle(mo.key)}
                    className={'min-h-[46px] rounded-[10px] border-[1.5px] text-[13px] font-bold transition ' +
                      (sel ? 'border-brand bg-brand text-white' : 'border-[#D6DCD4] bg-white font-semibold text-ink')}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

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
              <input id="date" type="date" className="field-input" max={todayISO()} value={datePaid} onChange={(e) => setDatePaid(e.target.value)} />
            </div>
          </div>

          {showBalance && (
            <div className="rounded-[10px] border border-partial-border bg-partial-bg px-3.5 py-2.5 text-sm font-semibold text-partial-text">
              Balance remaining: {formatK(Math.max(0, due - amountNgwee))}
            </div>
          )}
          {showFull && (
            <div className="rounded-[10px] border border-paid-border bg-paid-bg px-3.5 py-2.5 text-sm font-semibold text-paid-text">
              Full payment — no balance
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
