import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatK } from '../api.js';
import { Loading, EmptyState, useToast } from '../ui.jsx';

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

export default function PastTenants() {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('active'); // 'active' | 'archived'
  const [rows, setRows] = useState(null);

  const load = () => {
    setRows(null);
    api.get(`/tenancies/past?archived=${tab === 'archived' ? 1 : 0}`).then(setRows).catch((e) => toast.error(e.message));
  };
  useEffect(load, [tab]);

  const archive = async (id, name) => {
    try {
      await api.post(`/tenancies/${id}/archive`, {});
      toast.success(`${name} archived. Records kept.`);
      load();
    } catch (e) { toast.error(e.message); }
  };
  const restore = async (id, name) => {
    try {
      await api.post(`/tenancies/${id}/unarchive`, {});
      toast.success(`${name} restored.`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">Past tenants</div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setTab('active')}
          className={'rounded-xl px-4 py-2.5 text-sm font-semibold ' + (tab === 'active' ? 'bg-brand text-white' : 'bg-white text-muted border border-line')}>
          Moved out
        </button>
        <button onClick={() => setTab('archived')}
          className={'rounded-xl px-4 py-2.5 text-sm font-semibold ' + (tab === 'archived' ? 'bg-brand text-white' : 'bg-white text-muted border border-line')}>
          Archived
        </button>
      </div>

      <p className="-mt-1 px-1 text-xs text-muted">
        {tab === 'active'
          ? 'Tenants who moved out. Archive them to tidy this list — receipts and income are always kept.'
          : 'Archived tenants are hidden from the list above. Their records still count in Reports.'}
      </p>

      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState icon="📁" title={tab === 'active' ? 'No past tenants' : 'Nothing archived'}
          message={tab === 'active' ? 'Tenants you move out will appear here.' : 'Archived tenants will appear here.'} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((t) => (
            <div key={t.id} className="card p-3.5">
              <button onClick={() => navigate(`/tenancy/${t.id}`)} className="flex w-full items-center gap-3 text-left">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-vacant-bg text-sm font-bold text-muted">{t.roomLabel}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{t.tenantName}</p>
                  <p className="text-xs text-muted">
                    Moved out {fmtDate(t.moveOutDate)} · {t.receiptCount} receipt{t.receiptCount === 1 ? '' : 's'} · {formatK(t.totalCollected)}
                  </p>
                </div>
                <span className="text-vacant-border">›</span>
              </button>
              <div className="mt-2.5 flex gap-2 border-t border-line pt-2.5">
                <button onClick={() => navigate(`/tenancy/${t.id}`)} className="btn-secondary flex-1 py-2 text-sm">View records</button>
                {tab === 'active' ? (
                  <button onClick={() => archive(t.id, t.tenantName)} className="btn-secondary flex-1 py-2 text-sm">Archive</button>
                ) : (
                  <button onClick={() => restore(t.id, t.tenantName)} className="btn-outline flex-1 py-2 text-sm">Restore</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
