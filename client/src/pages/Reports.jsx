import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api, qs, formatK } from '../api.js';
import { Loading, useToast, fmtDate } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Reports() {
  const navigate = useNavigate();
  const toast = useToast();
  const { propertyId, properties, isAdmin } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [scope, setScope] = useState('current'); // 'current' | 'all'
  const [data, setData] = useState(null);
  const [voids, setVoids] = useState(null);
  const [loading, setLoading] = useState(true);
  const scopeParam = scope === 'all' ? 'all' : propertyId;

  useEffect(() => {
    setLoading(true);
    api.get(`/reports/income${qs({ year, propertyId: scopeParam })}`)
      .then(setData)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
    if (isAdmin) api.get(`/reports/voids${qs({ year, propertyId: scopeParam })}`).then(setVoids).catch(() => setVoids([]));
  }, [year, scopeParam]);

  const chartData = data?.rows.map((r) => ({ name: r.label, value: r.kwacha })) || [];

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="flex items-center justify-between">
        <div className="text-[22px] font-bold tracking-tight">Reports</div>
        <div className="flex items-center gap-1 text-sm">
          <button onClick={() => setYear((y) => y - 1)} className="h-8 w-8 rounded-full text-muted hover:bg-white" aria-label="Previous year">‹</button>
          <span className="w-14 text-center font-bold text-ink">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} className="h-8 w-8 rounded-full text-muted hover:bg-white" aria-label="Next year">›</button>
        </div>
      </div>

      {properties.length > 1 && (
        <div className="grid grid-cols-2 gap-2">
          {[['current', 'This property'], ['all', 'All properties']].map(([v, label]) => (
            <button key={v} onClick={() => setScope(v)}
              className={'rounded-xl px-4 py-2.5 text-sm font-semibold ' + (scope === v ? 'bg-brand text-white' : 'border border-line bg-white text-muted')}>
              {label}
            </button>
          ))}
        </div>
      )}

      <button onClick={() => navigate('/arrears')} className="card flex items-center gap-3 px-4 py-3.5 text-left">
        <span className="text-2xl">⚠️</span>
        <div className="flex-1">
          <div className="font-semibold text-ink">Arrears report</div>
          <div className="text-xs text-muted">Who owes rent, how much, and since when</div>
        </div>
        <span className="text-vacant-border">›</span>
      </button>

      {loading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Total collected in {year}</div>
            <div className="mt-1 text-[28px] font-bold text-brand">{formatK(data.totalNgwee)}</div>
            <div className="mt-1 text-xs text-muted">Voided payments are not counted.</div>
          </div>

          <div className="card p-4">
            <div className="mb-3 text-sm font-bold text-muted">Income per month</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7A72' }} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7A72' }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                  <Tooltip formatter={(v) => [formatK(Math.round(v * 100)), 'Income']} cursor={{ fill: 'rgba(14,107,74,0.06)' }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => <Cell key={i} fill="#0E6B4A" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs uppercase text-muted">
                <tr><th className="px-4 py-2 font-semibold">Month</th><th className="px-4 py-2 text-right font-semibold">Income</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.month} className="border-t border-line">
                    <td className="px-4 py-2.5">{r.label}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{formatK(r.ngwee)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line bg-surface font-bold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right text-brand">{formatK(data.totalNgwee)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <a href={`/api/reports/income${qs({ year, propertyId: scopeParam, format: 'csv' })}`} className="btn-secondary w-full">⬇️ Export CSV</a>

          {isAdmin && voids && (
            <div className="card overflow-hidden">
              <div className="border-b border-line px-4 py-3 text-[15px] font-bold">Voided payments in {year}</div>
              {voids.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted">None.</div>
              ) : (
                voids.map((v) => (
                  <button key={v.paymentId} onClick={() => v.receipt && navigate(`/receipt/${v.receipt.id}`)} className="flex w-full flex-col border-b border-[#F0F2EE] px-4 py-2.5 text-left text-[13px] last:border-0">
                    <div className="flex w-full gap-2">
                      <span className="flex-1 font-semibold">{v.tenantName} · Room {v.roomLabel}</span>
                      <span className="font-semibold text-muted line-through">{formatK(v.amount)}</span>
                    </div>
                    <div className="text-[12px] text-muted">
                      {v.receipt?.receiptNumber} · voided {fmtDate(v.voidedAt)}{v.voidedBy ? ` by ${v.voidedBy.name || v.voidedBy.email}` : ''} · {v.voidReason}
                      {v.replacement?.receipt && ` · replaced by ${v.replacement.receipt.receiptNumber}`}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
