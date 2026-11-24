import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs, formatK } from '../api.js';
import { Loading, EmptyState, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

// Per-status styling for a bed button: green = owes nothing, amber = owes
// but nothing is late yet, red = something is past its due date.
const OWING = { box: 'bg-partial-bg border-partial-border', chip: 'bg-partial-dot', name: 'text-partial-text' };
const BED = {
  PAID: { box: 'bg-paid-bg border-paid-border', chip: 'bg-paid-dot', name: 'text-paid-text' },
  PARTIAL: OWING,
  DUE: OWING,
  OVERDUE: { box: 'bg-due-bg border-due-border', chip: 'bg-due-dot', name: 'text-due-text' },
  VACANT: { box: 'bg-vacant-bg border-dashed border-vacant-border', chip: 'bg-vacant-dot', name: 'text-vacant-text' },
};

function StatCard({ label, children, valueClass = 'text-ink' }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-2.5">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className={`text-[21px] font-bold leading-tight ${valueClass}`}>{children}</div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2.5 w-2.5 rounded ${color}`} />
      {label}
    </span>
  );
}

function BedButton({ bed, onClick }) {
  const s = BED[bed.status] || BED.VACANT;
  const vacant = bed.status === 'VACANT';
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[46px] w-full items-center gap-2 rounded-[10px] border-[1.5px] px-2.5 text-left transition active:scale-[.99] ${s.box}`}
    >
      <span
        className={`flex h-5 w-5 flex-none items-center justify-center rounded-md text-[11px] font-bold text-white ${s.chip}`}
      >
        {bed.bed}
      </span>
      <span className={`truncate text-[13.5px] font-semibold ${s.name}`}>
        {vacant ? 'Vacant · tap to assign' : bed.tenantFirstName}
      </span>
    </button>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const { propertyId, isOwner } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!propertyId) { setLoading(false); return; }
    setLoading(true);
    api.get(`/rooms${qs({ propertyId })}`)
      .then(setData)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  const tapBed = (bed) => {
    if (bed.status === 'VACANT') navigate(`/assign/${bed.roomId}/${bed.bed}`);
    else navigate(`/tenancy/${bed.tenancyId}`);
  };

  if (!propertyId) {
    return (
      <EmptyState
        icon="🏢"
        title="No property yet"
        message={isOwner ? 'Add your first property to get started.' : 'No property has been set up yet.'}
        action={isOwner && <button className="btn-primary" onClick={() => navigate('/admin/properties')}>Add a property</button>}
      />
    );
  }

  if (loading || !data) return <Loading />;

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-4 pt-3.5">
      <div className="text-center text-[12.5px] text-muted">
        {data.property.billingCycle === 'TERM' ? 'Billed per term' : `Billed monthly · rent due on day ${data.property.dueDay}`}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Beds occupied">
          {data.summary.occupied} <span className="text-[13px] font-medium text-muted">/ {data.summary.totalBeds}</span>
        </StatCard>
        <StatCard label="Vacant beds">{data.summary.vacant}</StatCard>
        <StatCard label={`Received in ${data.periodLabel}`} valueClass="text-brand"><span className="text-[19px]">{formatK(data.summary.collected)}</span></StatCard>
        <button onClick={() => navigate('/arrears')} className="text-left" aria-label="Open arrears report">
          <StatCard label="Owed now ›" valueClass="text-due-text">
            <span className="text-[19px]">{formatK(data.summary.outstanding)}</span>
            {data.summary.overdue > 0 && <span className="block text-[11.5px] font-semibold">{formatK(data.summary.overdue)} overdue</span>}
          </StatCard>
        </button>
      </div>

      {data.rooms.length === 0 && (
        <EmptyState icon="🚪" title="No rooms yet" message={isOwner ? 'Add rooms to this property in Manage → Properties.' : 'This property has no rooms yet.'} />
      )}

      {data.unplaced?.length > 0 && (
        <div className="rounded-xl border border-partial-border bg-partial-bg px-3.5 py-2.5 text-[13px] text-partial-text">
          <div className="font-bold">Tenants in removed rooms or beds:</div>
          {data.unplaced.map((u) => (
            <button key={u.tenancyId} onClick={() => navigate(`/tenancy/${u.tenancyId}`)} className="mr-3 underline">{u.tenantName}</button>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-0.5 text-[11.5px] text-muted">
        <LegendDot color="bg-paid-dot" label="Paid up" />
        <LegendDot color="bg-partial-dot" label="Owes (not late)" />
        <LegendDot color="bg-due-dot" label="Overdue" />
        <LegendDot color="bg-vacant-dot" label="Vacant" />
      </div>

      {/* Room grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {data.rooms.map((room) => (
          <div key={room.id} className="flex flex-col gap-1.5 rounded-2xl border border-line bg-white p-2.5">
            <div className="text-[13px] font-bold tracking-wide text-muted">Room {room.number}</div>
            {room.beds.map((bed) => (
              <BedButton key={bed.bed} bed={bed} onClick={() => tapBed(bed)} />
            ))}
          </div>
        ))}
      </div>

      {/* Sticky CTA */}
      <div className="sticky bottom-2 pt-1">
        <button onClick={() => navigate('/pay')} className="w-full rounded-2xl bg-brand text-[17px] font-bold text-white shadow-fab hover:bg-brand-dark" style={{ minHeight: 56 }}>
          Record payment
        </button>
      </div>
    </div>
  );
}
