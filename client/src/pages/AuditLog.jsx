import { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { Loading, EmptyState, useToast, fmtDateTime } from '../ui.jsx';

const FILTERS = [
  ['', 'Everything'],
  ['payment', 'Payments'],
  ['arrears', 'Arrears'],
  ['tenant', 'Tenants'],
  ['tenancy', 'Tenancies'],
  ['property', 'Properties'],
  ['room', 'Rooms'],
  ['user', 'Users'],
  ['login', 'Sign-ins'],
  ['password', 'Passwords'],
  ['settings', 'Settings'],
];

export default function AuditLog() {
  const toast = useToast();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/admin/audit${qs({ action, page })}`).then(setData).catch((e) => toast.error(e.message));
  }, [action, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-3 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">Audit log</div>
      <p className="-mt-1 text-xs text-muted">A permanent record of every change and sign-in. Entries cannot be edited or deleted.</p>
      <select className="field-input" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
        {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>

      {!data ? (
        <Loading />
      ) : data.rows.length === 0 ? (
        <EmptyState icon="📜" title="Nothing here yet" />
      ) : (
        <div className="card overflow-hidden">
          {data.rows.map((r) => (
            <button key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className="block w-full border-b border-[#F0F2EE] px-4 py-2.5 text-left text-[13px] last:border-0">
              <div className="flex gap-2">
                <span className="flex-1 font-semibold">{r.action}</span>
                <span className="text-[12px] text-muted">{fmtDateTime(r.createdAt)}</span>
              </div>
              <div className="text-[12px] text-muted">
                {r.user ? (r.user.name || r.user.email) : 'Unknown / not signed in'}
                {r.entityType && ` · ${r.entityType} ${r.entityId}`}
                {r.ip && ` · ${r.ip}`}
              </div>
              {open === r.id && (r.before || r.after) && (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface p-2 text-[11px]">
                  {r.before && `Before:\n${JSON.stringify(r.before, null, 2)}\n`}
                  {r.after && `After:\n${JSON.stringify(r.after, null, 2)}`}
                </pre>
              )}
            </button>
          ))}
        </div>
      )}

      {data && pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button className="btn-secondary px-4 py-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Newer</button>
          <span className="text-muted">Page {page} of {pages}</span>
          <button className="btn-secondary px-4 py-2" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Older ›</button>
        </div>
      )}
    </div>
  );
}
