import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs, formatK, fmtDay } from '../api.js';
import { Loading, EmptyState, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

export default function ArrearsReport() {
  const navigate = useNavigate();
  const toast = useToast();
  const { propertyId, properties, isOwner } = useAuth();
  const [scope, setScope] = useState('current');
  const [includePast, setIncludePast] = useState(false);
  const [data, setData] = useState(null);
  const params = { propertyId: scope === 'all' ? 'all' : propertyId, includePast: includePast ? 1 : '' };

  useEffect(() => {
    setData(null);
    api.get(`/reports/arrears${qs(params)}`).then(setData).catch((e) => toast.error(e.message));
  }, [scope, includePast, propertyId]);

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">Arrears</div>

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
      <label className="flex items-center gap-2 px-1 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
        Include tenants who have moved out
      </label>

      {!data ? (
        <Loading />
      ) : data.rows.length === 0 ? (
        <EmptyState icon="✅" title="No arrears" message="Every tenant has paid everything billed so far." />
      ) : (
        <>
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Total owed</div>
            <div className="mt-1 text-[28px] font-bold text-due-text">{formatK(data.totalNgwee)}</div>
            <div className="text-xs text-muted">
              {formatK(data.overdueNgwee)} of it overdue · {data.tenantCount} tenant{data.tenantCount === 1 ? '' : 's'} · after waivers
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {data.rows.map((r) => (
              <button key={r.tenancyId} onClick={() => navigate(`/tenancy/${r.tenancyId}`)} className="card flex items-center gap-3 p-3.5 text-left">
                <span className={'flex h-11 w-11 flex-none items-center justify-center rounded-xl text-sm font-bold ' + (r.overdue > 0 ? 'bg-due-bg text-due-text' : 'bg-partial-bg text-partial-text')}>{r.roomLabel}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{r.tenantName}{!r.isCurrent && <span className="ml-1 text-xs text-muted">(moved out)</span>}</div>
                  <div className="text-xs text-muted">
                    {r.charges.length} unpaid item{r.charges.length === 1 ? '' : 's'} · oldest due {fmtDay(r.oldestDue)}
                    {r.overdue > 0 && ` · ${formatK(r.overdue)} overdue`}
                    {scope === 'all' && ` · ${r.property.name}`}
                  </div>
                </div>
                <span className={'font-bold ' + (r.overdue > 0 ? 'text-due-text' : 'text-partial-text')}>{formatK(r.total)}</span>
              </button>
            ))}
          </div>

          <a href={`/api/reports/arrears${qs({ ...params, format: 'csv' })}`} className="btn-secondary w-full">⬇️ Export CSV</a>
          {isOwner && <p className="px-1 text-xs text-muted">To waive part of a charge or add one, open the tenant.</p>}
        </>
      )}
    </div>
  );
}
