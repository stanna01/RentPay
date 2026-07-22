import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api, formatK } from '../api.js';
import { Loading } from '../ui.jsx';

export default function Reports() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/reports/income?year=${year}`).then(setData).finally(() => setLoading(false));
  }, [year]);

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

      {loading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Total collected in {year}</div>
            <div className="mt-1 text-[28px] font-bold text-brand">{formatK(data.totalNgwee)}</div>
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

          <a href={`/api/reports/income?year=${year}&format=csv`} className="btn-secondary w-full">⬇️ Export CSV</a>
        </>
      )}
    </div>
  );
}
