import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, formatK, toNgwee, MONTHS } from '../api.js';
import { Loading, EmptyState, useToast } from '../ui.jsx';

const mk = (y, m) => `${y}-${m}`;

// Amount already applied per month, from the tenant's payments.
function appliedMap(payments) {
  const applied = new Map();
  const expected = new Map();
  for (const p of payments) {
    for (const pd of p.periods) {
      const key = mk(pd.year, pd.month);
      applied.set(key, (applied.get(key) || 0) + pd.amountApplied);
      expected.set(key, pd.expectedRent);
    }
  }
  return { applied, expected };
}

// 12 months centred around now (now-4 .. now+7).
function monthWindow() {
  const now = new Date();
  const out = [];
  for (let i = -4; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ month: d.getMonth() + 1, year: d.getFullYear(), key: mk(d.getFullYear(), d.getMonth() + 1) });
  }
  return out;
}

function firstUnpaid(tenancy, applied) {
  const start = new Date(tenancy.moveInDate);
  const now = new Date();
  let y = start.getFullYear(), m = start.getMonth() + 1;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    const key = mk(y, m);
    if ((applied.get(key) || 0) < tenancy.monthlyRent) return key;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return mk(now.getFullYear(), now.getMonth() + 1);
}

export default function RecordPayment() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const preId = params.get('tenancyId');

  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tenancyId, setTenancyId] = useState('');
  const [profile, setProfile] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/rooms').then((data) => {
      const opts = [];
      for (const room of data.rooms)
        for (const bed of room.beds)
          if (bed.tenancyId) opts.push({ id: bed.tenancyId, label: `${bed.tenantName} — Room ${bed.roomLabel}`, roomLabel: bed.roomLabel });
      setOptions(opts);
      if (preId && opts.some((o) => String(o.id) === String(preId))) pick(preId);
    }).finally(() => setLoading(false));
  }, []);

  const pick = async (id) => {
    setTenancyId(id);
    setProfile(null);
    if (!id) { setSelectedKeys([]); setAmount(''); return; }
    const p = await api.get(`/tenancies/${id}`);
    setProfile(p);
    const { applied } = appliedMap(p.payments);
    const fu = firstUnpaid(p.tenancy, applied);
    setSelectedKeys([fu]);
    setAmount(String(p.tenancy.monthlyRent / 100));
  };

  const window12 = useMemo(monthWindow, []);
  const { applied, expected } = useMemo(() => (profile ? appliedMap(profile.payments) : { applied: new Map(), expected: new Map() }), [profile]);
  const rent = profile?.tenancy.monthlyRent || 0;

  const toggle = (key) => {
    setSelectedKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      // Auto-fill amount to full months selected (design behaviour).
      setAmount(next.length ? String((rent * next.length) / 100) : amount);
      return next;
    });
  };

  const amountNgwee = toNgwee(amount) ?? 0;
  const due = rent * selectedKeys.length;
  const showBalance = amountNgwee > 0 && selectedKeys.length > 0 && amountNgwee < due;
  const showFull = amountNgwee > 0 && selectedKeys.length > 0 && amountNgwee >= due;

  const submit = async () => {
    if (!selectedKeys.length) return toast.error('Select at least one month');
    if (amountNgwee <= 0) return toast.error('Enter the amount received');
    setBusy(true);
    try {
      const months = selectedKeys
        .map((k) => { const [y, m] = k.split('-'); return { year: Number(y), month: Number(m) }; })
        .sort((a, b) => a.year - b.year || a.month - b.month);
      const res = await api.post('/payments', {
        tenancyId: Number(tenancyId), amount: amountNgwee, method: 'cash', months, sendEmail: false,
      });
      navigate(`/receipt/${res.receiptId}`, { replace: true });
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (loading) return <Loading />;
  if (options.length === 0)
    return <EmptyState icon="🏠" title="No tenants yet" message="Assign a tenant to a bed first, then record their payment." />;

  const selOpt = options.find((o) => String(o.id) === String(tenancyId));

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">Record payment</div>

      {/* Step 1: who paid */}
      <div className="card flex flex-col gap-2.5 p-4">
        <label htmlFor="who" className="text-[13px] font-bold text-muted">1 · Who paid?</label>
        <select id="who" value={tenancyId} onChange={(e) => pick(e.target.value)} className="field-input">
          <option value="">Select a tenant…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {profile && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-[10px] bg-surface px-3.5 py-2.5 text-[13.5px] text-[#4A5A52]">
            <span><strong className="text-ink">Room:</strong> {selOpt?.roomLabel}</span>
            <span><strong className="text-ink">Rent:</strong> {formatK(rent)} / month</span>
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
                const done = (applied.get(mo.key) || 0) >= (expected.get(mo.key) ?? rent) && (expected.get(mo.key) ?? rent) > 0;
                const sel = selectedKeys.includes(mo.key);
                const label = `${MONTHS[mo.month - 1].slice(0, 3)} ${String(mo.year).slice(2)}`;
                if (done)
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
            <input id="amt" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
              className="field-input text-[20px] font-bold" />
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

          <button onClick={submit} disabled={busy} className="w-full rounded-2xl bg-brand text-[17px] font-bold text-white shadow-cta hover:bg-brand-dark disabled:opacity-50" style={{ minHeight: 58 }}>
            {busy ? 'Generating…' : 'Generate receipt'}
          </button>
        </div>
      )}
    </div>
  );
}
