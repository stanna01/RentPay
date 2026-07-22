import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatK, MONTHS } from '../api.js';
import { Loading } from '../ui.jsx';

// Per-status styling for a bed button.
const BED = {
  PAID: { box: 'bg-paid-bg border-paid-border', chip: 'bg-paid-dot', name: 'text-paid-text' },
  PARTIAL: { box: 'bg-partial-bg border-partial-border', chip: 'bg-partial-dot', name: 'text-partial-text' },
  DUE: { box: 'bg-due-bg border-due-border', chip: 'bg-due-dot', name: 'text-due-text' },
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
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/rooms?month=${month}&year=${year}`).then(setData).finally(() => setLoading(false));
  }, [month, year]);

  const tapBed = (bed) => {
    if (bed.status === 'VACANT') navigate(`/assign/${bed.roomNumber}/${bed.bed}`);
    else navigate(`/tenancy/${bed.tenancyId}`);
  };

  const shiftMonth = (delta) => {
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  };

  if (loading || !data) return <Loading />;

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-4 pt-3.5">
      {/* Month context */}
      <div className="flex items-center justify-center gap-1 text-sm">
        <button onClick={() => shiftMonth(-1)} className="h-8 w-8 rounded-full text-muted hover:bg-white" aria-label="Previous month">‹</button>
        <span className="w-32 text-center font-bold text-ink">{MONTHS[month - 1]} {year}</span>
        <button onClick={() => shiftMonth(1)} className="h-8 w-8 rounded-full text-muted hover:bg-white" aria-label="Next month">›</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Beds occupied">
          {data.summary.occupied} <span className="text-[13px] font-medium text-muted">/ {data.summary.totalBeds}</span>
        </StatCard>
        <StatCard label="Vacant beds">{data.summary.vacant}</StatCard>
        <StatCard label="Collected" valueClass="text-brand"><span className="text-[19px]">{formatK(data.summary.collected)}</span></StatCard>
        <StatCard label="Outstanding" valueClass="text-due-text"><span className="text-[19px]">{formatK(data.summary.outstanding)}</span></StatCard>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-0.5 text-[11.5px] text-muted">
        <LegendDot color="bg-paid-dot" label="Paid" />
        <LegendDot color="bg-partial-dot" label="Partial" />
        <LegendDot color="bg-due-dot" label="Due" />
        <LegendDot color="bg-vacant-dot" label="Vacant" />
      </div>

      {/* Room grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {data.rooms.map((room) => (
          <div key={room.number} className="flex flex-col gap-1.5 rounded-2xl border border-line bg-white p-2.5">
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
